/**
 * Direct-SQL provisioning for self-serve merchant onboarding: turns a real
 * login into a real merchant application record, and lets that merchant's
 * own session move it through Steps 1-2 of the onboarding wizard.
 *
 * Writes go straight through parameterized SQL (matching
 * wallet-user-store.ts's exact shape) rather than the RBAC-gated
 * PostgresIdentityRepositories — same reason as that file: the repository's
 * ScopedTransactionManager requires a Postgres role posture this deployment
 * doesn't have configured. See wallet-user-store.ts's header for the full
 * rationale; this file makes the identical trade-off.
 *
 * lifecycle_state/lifecycle_version in merchant.onboarding_applications
 * mirror packages/merchant-application/src/lifecycle.ts's REAL
 * MERCHANT_LIFECYCLE_STATES state machine exactly — every transition here
 * goes through transitionMerchantLifecycle() so this store can never write
 * a state the pure domain logic wouldn't allow.
 */
import { randomBytes } from "node:crypto";
import type { Environment, MerchantId, MerchantUserId } from "@counter/domain";
import { createCounterId, parseCounterId, instantFromEpochMilliseconds } from "@counter/domain";
import type { TransactionalDatabase } from "@counter/data";
import {
  transitionMerchantLifecycle,
  isMerchantLifecycleState,
  isFulfillmentCapability,
  type MerchantLifecycleState,
  type FulfillmentCapability,
} from "@counter/merchant-application";

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface ProvisionApplicationResult {
  readonly merchantId: string;
  readonly merchantUserActorId: string;
  readonly created: boolean;
  readonly lifecycleState: MerchantLifecycleState;
  readonly approvalStatus: ApprovalStatus;
}

export interface BusinessBasicsInput {
  readonly legalEntityName: string;
  readonly contactEmail: string;
  readonly contactPhone?: string;
  readonly goodsTypes: readonly string[];
}

export interface MerchantApplicationSnapshot {
  readonly merchantId: string;
  readonly auth0Subject: string;
  readonly merchantUserActorId: string;
  readonly legalEntityName: string | null;
  readonly contactEmail: string | null;
  readonly contactPhone: string | null;
  readonly goodsTypes: readonly string[];
  readonly approvalStatus: ApprovalStatus;
  readonly lifecycleState: MerchantLifecycleState;
  readonly lifecycleVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Set when Step 3 (catalog review) confirms the catalog — null before that. Used as Step 5's mapping_freshness evidence timestamp. */
  readonly catalogConfirmedAt: string | null;
}

export interface ManualCatalogItemInput {
  readonly name: string;
  readonly description?: string;
  readonly priceMinor: number;
  readonly currency: string;
}

export interface ManualCatalogItem {
  readonly itemId: string;
  readonly merchantId: string;
  readonly name: string;
  readonly description: string | null;
  readonly priceMinor: number;
  readonly currency: string;
  readonly createdAt: string;
  readonly reviewed: boolean;
}

/** A client-caused failure (bad goodsTypes, disallowed lifecycle transition) — maps to 400. */
export class MerchantApplicationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MerchantApplicationValidationError";
  }
}

/**
 * Structural interface for MerchantApplicationProvisioner's public surface —
 * lets merchant-application-routes.ts (and its tests) depend on the
 * interface rather than the concrete direct-SQL class, matching
 * WalletUserProvisionerLike's existing separation in this app.
 */
export interface MerchantApplicationProvisionerLike {
  provisionForAuth0Subject(auth0Subject: string): Promise<ProvisionApplicationResult>;
  getApplication(merchantId: string): Promise<MerchantApplicationSnapshot | undefined>;
  /** Looks a merchant application up by the Auth0 subject that owns it (no merchantId known yet). */
  getApplicationByAuth0Subject(
    auth0Subject: string,
  ): Promise<MerchantApplicationSnapshot | undefined>;
  /** Throws MerchantApplicationValidationError for any client-caused failure. */
  updateBusinessBasics(
    merchantId: string,
    input: BusinessBasicsInput,
  ): Promise<MerchantApplicationSnapshot>;
  /** Step 2's manual (non-Shopify) catalog path. Throws MerchantApplicationValidationError. */
  addManualCatalogItem(
    merchantId: string,
    input: ManualCatalogItemInput,
  ): Promise<ManualCatalogItem>;
  listManualCatalogItems(merchantId: string): Promise<readonly ManualCatalogItem[]>;
  /**
   * Step 2 -> Step 3: re-verifies server-side (never trusts the caller's
   * claim) that the merchant has EITHER an active Shopify connection
   * (merchant.shopify_connections, written by shopify-connection-store.ts —
   * read here, never written) OR at least one manual catalog item, then
   * transitions CONNECTING -> MAPPING. Idempotent: a no-op (returns the
   * current snapshot) if already past CONNECTING. Throws
   * MerchantApplicationValidationError if neither condition holds, or if
   * called before Step 1 (still in DRAFT).
   */
  markCatalogConnected(merchantId: string): Promise<MerchantApplicationSnapshot>;
  /**
   * Step 3, catalog review. JUDGMENT CALL (disclosed): the merchant typed
   * manual items themselves, so no AI extraction was involved — they are
   * eligible for a single bulk "confirm all" rather than a mandatory
   * per-item AI-review gate (that gate only matters once AI-driven
   * extraction exists, which it doesn't yet). Marks every one of the
   * merchant's manual catalog items `reviewed = true`. Idempotent: items
   * already reviewed are left as-is.
   */
  confirmManualCatalogItems(merchantId: string): Promise<readonly ManualCatalogItem[]>;
  /**
   * Step 3 -> Step 4: validates the merchant is in MAPPING, requires EITHER
   * (a) an active Shopify connection (sufficient on its own — see this
   * method's implementation for why no per-item review applies to Shopify
   * catalogs in this pass) OR (b) at least one manual item (bulk-confirmed
   * by this same call), then transitions MAPPING -> VERIFYING. Idempotent:
   * a no-op (returns the current snapshot) if already past MAPPING. Throws
   * MerchantApplicationValidationError if neither condition holds, or if
   * called before Step 2 (still before MAPPING).
   */
  confirmCatalog(merchantId: string): Promise<MerchantApplicationSnapshot>;
}

function requireCounterId(
  kind: Parameters<typeof createCounterId>[0],
  entropy: Uint8Array,
): string {
  const result = createCounterId(kind, entropy);
  if (!result.ok) {
    throw new Error(`Failed to derive a ${kind} id: ${result.error.message}`);
  }
  return result.value as unknown as string;
}

function nowInstant() {
  const result = instantFromEpochMilliseconds(Date.now());
  if (!result.ok) {
    throw new Error("Failed to derive the current instant");
  }
  return result.value;
}

interface ApplicationRow {
  environment: string;
  merchant_id: string;
  auth0_subject: string;
  merchant_user_actor_id: string;
  legal_entity_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  goods_types: readonly string[] | null;
  approval_status: string;
  lifecycle_state: string;
  lifecycle_version: number;
  created_at: string | Date;
  updated_at: string | Date;
  catalog_confirmed_at: string | Date | null;
}

function toSnapshot(row: ApplicationRow): MerchantApplicationSnapshot {
  if (!isMerchantLifecycleState(row.lifecycle_state)) {
    throw new Error(`Corrupt onboarding application row: invalid lifecycle_state`);
  }
  const approvalStatus = row.approval_status;
  if (
    approvalStatus !== "pending" &&
    approvalStatus !== "approved" &&
    approvalStatus !== "rejected"
  ) {
    throw new Error(`Corrupt onboarding application row: invalid approval_status`);
  }
  return {
    merchantId: row.merchant_id,
    auth0Subject: row.auth0_subject,
    merchantUserActorId: row.merchant_user_actor_id,
    legalEntityName: row.legal_entity_name,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    goodsTypes: row.goods_types ?? [],
    approvalStatus,
    lifecycleState: row.lifecycle_state,
    lifecycleVersion: row.lifecycle_version,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    catalogConfirmedAt:
      row.catalog_confirmed_at === null ? null : new Date(row.catalog_confirmed_at).toISOString(),
  };
}

export class MerchantApplicationProvisioner implements MerchantApplicationProvisionerLike {
  constructor(
    private readonly database: TransactionalDatabase,
    private readonly environment: Environment,
  ) {}

  /** Idempotent: a repeat login/click for the same Auth0 subject returns the same merchant. */
  async provisionForAuth0Subject(auth0Subject: string): Promise<ProvisionApplicationResult> {
    const existing = await this.database.query<{
      merchant_id: string;
      merchant_user_actor_id: string;
      lifecycle_state: string;
      approval_status: string;
    }>(
      `SELECT merchant_id, merchant_user_actor_id, lifecycle_state, approval_status
         FROM merchant.onboarding_applications
        WHERE environment = $1 AND auth0_subject = $2`,
      [this.environment, auth0Subject],
    );
    const row = existing.rows[0];
    if (row !== undefined) {
      if (!isMerchantLifecycleState(row.lifecycle_state)) {
        throw new Error("Corrupt onboarding application row: invalid lifecycle_state");
      }
      return {
        merchantId: row.merchant_id,
        merchantUserActorId: row.merchant_user_actor_id,
        created: false,
        lifecycleState: row.lifecycle_state,
        approvalStatus: row.approval_status as ApprovalStatus,
      };
    }

    const merchantId = requireCounterId("merchant", randomBytes(16));
    const merchantUserActorId = requireCounterId("merchant-user", randomBytes(16));
    const now = new Date().toISOString();

    await this.database.transaction(async (session) => {
      await session.query(
        `INSERT INTO identity.scope_registry (environment, scope_kind, scope_id, created_at)
         VALUES ($1, 'merchant', $2, $3)`,
        [this.environment, merchantId, now],
      );
      await session.query(
        `INSERT INTO merchant.scopes (environment, scope_kind, merchant_id, created_at)
         VALUES ($1, 'merchant', $2, $3)`,
        [this.environment, merchantId, now],
      );
      await session.query(
        `INSERT INTO identity.actors (
           environment, actor_kind, actor_id, owner_scope_kind, owner_scope_id, status, created_at
         ) VALUES ($1, 'merchant_user', $2, 'merchant', $3, 'active', $4)`,
        [this.environment, merchantUserActorId, merchantId, now],
      );
      await session.query(
        `INSERT INTO merchant.onboarding_applications (
           environment, merchant_id, auth0_subject, merchant_user_actor_id,
           approval_status, lifecycle_state, lifecycle_version, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, 'pending', 'DRAFT', 0, $5, $5)`,
        [this.environment, merchantId, auth0Subject, merchantUserActorId, now],
      );
    });

    return {
      merchantId,
      merchantUserActorId,
      created: true,
      lifecycleState: "DRAFT",
      approvalStatus: "pending",
    };
  }

  async getApplication(merchantId: string): Promise<MerchantApplicationSnapshot | undefined> {
    const result = await this.database.query<ApplicationRow>(
      `SELECT * FROM merchant.onboarding_applications WHERE environment = $1 AND merchant_id = $2`,
      [this.environment, merchantId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toSnapshot(row);
  }

  async getApplicationByAuth0Subject(
    auth0Subject: string,
  ): Promise<MerchantApplicationSnapshot | undefined> {
    const result = await this.database.query<ApplicationRow>(
      `SELECT * FROM merchant.onboarding_applications WHERE environment = $1 AND auth0_subject = $2`,
      [this.environment, auth0Subject],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toSnapshot(row);
  }

  /**
   * Step 1: records the business's legal/contact identity and its
   * fulfillment taxonomy, then transitions DRAFT -> CONNECTING through the
   * real state machine (packages/merchant-application/src/lifecycle.ts).
   */
  async updateBusinessBasics(
    merchantId: string,
    input: BusinessBasicsInput,
  ): Promise<MerchantApplicationSnapshot> {
    if (input.legalEntityName.trim().length === 0) {
      throw new MerchantApplicationValidationError("legalEntityName must not be empty");
    }
    if (input.contactEmail.trim().length === 0) {
      throw new MerchantApplicationValidationError("contactEmail must not be empty");
    }
    if (input.goodsTypes.length === 0) {
      throw new MerchantApplicationValidationError("goodsTypes must include at least one value");
    }
    const goodsTypes: FulfillmentCapability[] = [];
    for (const value of input.goodsTypes) {
      if (!isFulfillmentCapability(value)) {
        throw new MerchantApplicationValidationError(`Unknown goods type: ${value}`);
      }
      goodsTypes.push(value);
    }

    const parsedMerchantId = parseCounterId(merchantId, "merchant");
    if (!parsedMerchantId.ok) {
      throw new MerchantApplicationValidationError(
        `Invalid merchantId: ${parsedMerchantId.error.message}`,
      );
    }

    return this.database.transaction(async (session) => {
      const existing = await session.query<ApplicationRow>(
        `SELECT * FROM merchant.onboarding_applications
          WHERE environment = $1 AND merchant_id = $2
          FOR UPDATE`,
        [this.environment, merchantId],
      );
      const row = existing.rows[0];
      if (row === undefined) {
        throw new MerchantApplicationValidationError(`No such merchant application: ${merchantId}`);
      }
      const snapshot = toSnapshot(row);

      const parsedActorId = parseCounterId(snapshot.merchantUserActorId, "merchant-user");
      if (!parsedActorId.ok) {
        throw new Error("Corrupt onboarding application row: invalid merchant_user_actor_id");
      }

      const transition = transitionMerchantLifecycle({
        merchantId: parsedMerchantId.value as MerchantId,
        currentState: snapshot.lifecycleState,
        targetState: "CONNECTING",
        actor: { kind: "merchant_user", id: parsedActorId.value as MerchantUserId },
        reason: "business basics submitted",
        occurredAt: nowInstant(),
        currentVersion: snapshot.lifecycleVersion,
      });
      if (!transition.ok) {
        throw new MerchantApplicationValidationError(transition.error.message);
      }

      const now = new Date().toISOString();
      const updated = await session.query<ApplicationRow>(
        `UPDATE merchant.onboarding_applications
            SET legal_entity_name = $3,
                contact_email = $4,
                contact_phone = $5,
                goods_types = $6,
                lifecycle_state = $7,
                lifecycle_version = $8,
                updated_at = $9
          WHERE environment = $1 AND merchant_id = $2
        RETURNING *`,
        [
          this.environment,
          merchantId,
          input.legalEntityName.trim(),
          input.contactEmail.trim(),
          input.contactPhone?.trim() || null,
          goodsTypes,
          transition.value.toState,
          transition.value.version,
          now,
        ],
      );
      const updatedRow = updated.rows[0];
      if (updatedRow === undefined) {
        throw new Error("Failed to persist business basics update");
      }
      return toSnapshot(updatedRow);
    });
  }

  /** Step 2's manual (non-Shopify) catalog path — keep it simple, no mapping/review logic yet. */
  async addManualCatalogItem(
    merchantId: string,
    input: ManualCatalogItemInput,
  ): Promise<ManualCatalogItem> {
    if (input.name.trim().length === 0) {
      throw new MerchantApplicationValidationError("name must not be empty");
    }
    if (!Number.isInteger(input.priceMinor) || input.priceMinor < 0) {
      throw new MerchantApplicationValidationError("priceMinor must be a non-negative integer");
    }
    if (input.currency !== "INR") {
      throw new MerchantApplicationValidationError("currency must be 'INR'");
    }

    const merchantExists = await this.database.query(
      `SELECT 1 FROM merchant.scopes WHERE environment = $1 AND merchant_id = $2`,
      [this.environment, merchantId],
    );
    if (merchantExists.rows.length === 0) {
      throw new MerchantApplicationValidationError(`No such merchant: ${merchantId}`);
    }

    const now = new Date().toISOString();
    const result = await this.database.query<{
      item_id: string;
      merchant_id: string;
      name: string;
      description: string | null;
      price_minor: string | number;
      currency: string;
      created_at: string | Date;
      reviewed: boolean;
    }>(
      `INSERT INTO merchant.manual_catalog_items
         (environment, merchant_id, name, description, price_minor, currency, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING item_id, merchant_id, name, description, price_minor, currency, created_at, reviewed`,
      [
        this.environment,
        merchantId,
        input.name.trim(),
        input.description?.trim() || null,
        input.priceMinor,
        input.currency,
        now,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error("Failed to persist manual catalog item");
    }
    return {
      itemId: String(row.item_id),
      merchantId: row.merchant_id,
      name: row.name,
      description: row.description,
      priceMinor: Number(row.price_minor),
      currency: row.currency,
      createdAt: new Date(row.created_at).toISOString(),
      reviewed: row.reviewed,
    };
  }

  async listManualCatalogItems(merchantId: string): Promise<readonly ManualCatalogItem[]> {
    const result = await this.database.query<{
      item_id: string;
      merchant_id: string;
      name: string;
      description: string | null;
      price_minor: string | number;
      currency: string;
      created_at: string | Date;
      reviewed: boolean;
    }>(
      `SELECT item_id, merchant_id, name, description, price_minor, currency, created_at, reviewed
         FROM merchant.manual_catalog_items
        WHERE environment = $1 AND merchant_id = $2
        ORDER BY item_id`,
      [this.environment, merchantId],
    );
    return result.rows.map((row) => ({
      itemId: String(row.item_id),
      merchantId: row.merchant_id,
      name: row.name,
      description: row.description,
      priceMinor: Number(row.price_minor),
      currency: row.currency,
      createdAt: new Date(row.created_at).toISOString(),
      reviewed: row.reviewed,
    }));
  }

  async confirmManualCatalogItems(merchantId: string): Promise<readonly ManualCatalogItem[]> {
    await this.database.query(
      `UPDATE merchant.manual_catalog_items
          SET reviewed = true
        WHERE environment = $1 AND merchant_id = $2 AND reviewed = false`,
      [this.environment, merchantId],
    );
    return this.listManualCatalogItems(merchantId);
  }

  /**
   * Step 3, catalog review -> Step 4. JUDGMENT CALL, disclosed: a Shopify
   * connection has no real product-fetch/sync pipeline yet (confirmed —
   * shopify-connection-store.ts only stores the OAuth token, never calls
   * Shopify's product API), so there is no real per-item product data to
   * show a review UI for. Rather than block the wizard on unbuilt Shopify
   * catalog sync, a verified-active Shopify connection is treated as
   * sufficient on its own for this step. Building real Shopify catalog sync
   * (and a real per-item review UI for it) is a distinct, large follow-up,
   * explicitly out of scope here.
   */
  async confirmCatalog(merchantId: string): Promise<MerchantApplicationSnapshot> {
    const parsedMerchantId = parseCounterId(merchantId, "merchant");
    if (!parsedMerchantId.ok) {
      throw new MerchantApplicationValidationError(
        `Invalid merchantId: ${parsedMerchantId.error.message}`,
      );
    }

    return this.database.transaction(async (session) => {
      const existing = await session.query<ApplicationRow>(
        `SELECT * FROM merchant.onboarding_applications
          WHERE environment = $1 AND merchant_id = $2
          FOR UPDATE`,
        [this.environment, merchantId],
      );
      const row = existing.rows[0];
      if (row === undefined) {
        throw new MerchantApplicationValidationError(`No such merchant application: ${merchantId}`);
      }
      const snapshot = toSnapshot(row);

      // Idempotent: already past MAPPING — just return the current state.
      if (snapshot.lifecycleState !== "MAPPING") {
        return snapshot;
      }

      const shopifyConnected = await session.query(
        `SELECT 1 FROM merchant.shopify_connections
          WHERE environment = $1 AND merchant_id = $2 AND status = 'active'`,
        [this.environment, merchantId],
      );
      const hasManualItems = await session.query(
        `SELECT 1 FROM merchant.manual_catalog_items
          WHERE environment = $1 AND merchant_id = $2 LIMIT 1`,
        [this.environment, merchantId],
      );
      if (shopifyConnected.rows.length === 0 && hasManualItems.rows.length === 0) {
        throw new MerchantApplicationValidationError(
          "No catalog to review yet — connect Shopify or add at least one item first",
        );
      }

      // Bulk-confirm-all: the merchant typed manual items themselves, so no
      // AI extraction was involved — they're eligible for confirmation as-is.
      await session.query(
        `UPDATE merchant.manual_catalog_items
            SET reviewed = true
          WHERE environment = $1 AND merchant_id = $2 AND reviewed = false`,
        [this.environment, merchantId],
      );

      const parsedActorId = parseCounterId(snapshot.merchantUserActorId, "merchant-user");
      if (!parsedActorId.ok) {
        throw new Error("Corrupt onboarding application row: invalid merchant_user_actor_id");
      }

      const transition = transitionMerchantLifecycle({
        merchantId: parsedMerchantId.value as MerchantId,
        currentState: snapshot.lifecycleState,
        targetState: "VERIFYING",
        actor: { kind: "merchant_user", id: parsedActorId.value as MerchantUserId },
        reason: "catalog reviewed and confirmed",
        occurredAt: nowInstant(),
        currentVersion: snapshot.lifecycleVersion,
      });
      if (!transition.ok) {
        throw new MerchantApplicationValidationError(transition.error.message);
      }

      const now = new Date().toISOString();
      const updated = await session.query<ApplicationRow>(
        `UPDATE merchant.onboarding_applications
            SET lifecycle_state = $3, lifecycle_version = $4, updated_at = $5,
                catalog_confirmed_at = $5
          WHERE environment = $1 AND merchant_id = $2
        RETURNING *`,
        [this.environment, merchantId, transition.value.toState, transition.value.version, now],
      );
      const updatedRow = updated.rows[0];
      if (updatedRow === undefined) {
        throw new Error("Failed to persist catalog-confirmed transition");
      }
      return toSnapshot(updatedRow);
    });
  }

  async markCatalogConnected(merchantId: string): Promise<MerchantApplicationSnapshot> {
    const parsedMerchantId = parseCounterId(merchantId, "merchant");
    if (!parsedMerchantId.ok) {
      throw new MerchantApplicationValidationError(
        `Invalid merchantId: ${parsedMerchantId.error.message}`,
      );
    }

    return this.database.transaction(async (session) => {
      const existing = await session.query<ApplicationRow>(
        `SELECT * FROM merchant.onboarding_applications
          WHERE environment = $1 AND merchant_id = $2
          FOR UPDATE`,
        [this.environment, merchantId],
      );
      const row = existing.rows[0];
      if (row === undefined) {
        throw new MerchantApplicationValidationError(`No such merchant application: ${merchantId}`);
      }
      const snapshot = toSnapshot(row);

      // Idempotent: already past CONNECTING (e.g. a second Shopify-connected
      // redirect, or the manual-item path called after Shopify already
      // completed it) — just return the current state, not an error.
      if (snapshot.lifecycleState !== "CONNECTING") {
        return snapshot;
      }

      const shopifyConnected = await session.query(
        `SELECT 1 FROM merchant.shopify_connections
          WHERE environment = $1 AND merchant_id = $2 AND status = 'active'`,
        [this.environment, merchantId],
      );
      const hasManualItems = await session.query(
        `SELECT 1 FROM merchant.manual_catalog_items
          WHERE environment = $1 AND merchant_id = $2 LIMIT 1`,
        [this.environment, merchantId],
      );
      if (shopifyConnected.rows.length === 0 && hasManualItems.rows.length === 0) {
        throw new MerchantApplicationValidationError(
          "No catalog connection found — connect Shopify or add at least one item first",
        );
      }

      const parsedActorId = parseCounterId(snapshot.merchantUserActorId, "merchant-user");
      if (!parsedActorId.ok) {
        throw new Error("Corrupt onboarding application row: invalid merchant_user_actor_id");
      }

      const transition = transitionMerchantLifecycle({
        merchantId: parsedMerchantId.value as MerchantId,
        currentState: snapshot.lifecycleState,
        targetState: "MAPPING",
        actor: { kind: "merchant_user", id: parsedActorId.value as MerchantUserId },
        reason: "catalog connected (Shopify or manual entry)",
        occurredAt: nowInstant(),
        currentVersion: snapshot.lifecycleVersion,
      });
      if (!transition.ok) {
        throw new MerchantApplicationValidationError(transition.error.message);
      }

      const now = new Date().toISOString();
      const updated = await session.query<ApplicationRow>(
        `UPDATE merchant.onboarding_applications
            SET lifecycle_state = $3, lifecycle_version = $4, updated_at = $5
          WHERE environment = $1 AND merchant_id = $2
        RETURNING *`,
        [this.environment, merchantId, transition.value.toState, transition.value.version, now],
      );
      const updatedRow = updated.rows[0];
      if (updatedRow === undefined) {
        throw new Error("Failed to persist catalog-connected transition");
      }
      return toSnapshot(updatedRow);
    });
  }
}
