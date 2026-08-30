/**
 * Self-serve merchant onboarding, Step 6: manifest confirmation.
 *
 * Once a merchant reaches SANDBOX_READY (or later), generates and persists
 * its CapabilityManifest (packages/merchant-application/src/capability-
 * manifest.ts's real generateManifest()) — the first durable home for a
 * CapabilityManifest belonging to a self-serve merchant.
 *
 * capabilities = PILOT_CAPABILITIES (static, all 5 — this pilot release
 * offers no partial capability set). fulfillmentCapabilities = the
 * merchant's own Step-1 goods-type selection. versionBindings are pulled
 * from a FRESH MerchantReadinessService.evaluate() call made at generation
 * time (not cached from an earlier readiness check) — so the manifest
 * always reflects the connector/policy/payment/protocol versions actually
 * in effect right now, not a stale snapshot.
 */
import type { Environment, MerchantId } from "@counter/domain";
import { instantFromEpochMilliseconds, parseCounterId, type Instant } from "@counter/domain";
import type { TransactionalDatabase } from "@counter/data";
import {
  generateManifest,
  PILOT_CAPABILITIES,
  isFulfillmentCapability,
  isMerchantLifecycleState,
  type CapabilityManifest,
  type FulfillmentCapability,
  type VersionBindings,
} from "@counter/merchant-application";
import type { MerchantReadinessServiceLike } from "./merchant-readiness-store.js";

const MANIFEST_VERSION = "1.0.0";

/** A client-caused failure (unknown merchant, not yet SANDBOX_READY) — maps to 400/404 at the route layer. */
export class MerchantManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MerchantManifestError";
  }
}

export interface PersistedManifest {
  readonly merchantId: string;
  readonly manifestVersion: string;
  readonly capabilities: readonly string[];
  readonly fulfillmentCapabilities: readonly string[];
  readonly versionBindings: VersionBindings;
  readonly generatedAt: string;
  readonly signatureDigest: string;
}

export interface MerchantManifestStoreLike {
  /** Throws MerchantManifestError if the merchant doesn't exist or isn't SANDBOX_READY yet. */
  generateAndPersist(merchantId: string): Promise<PersistedManifest>;
  getManifest(merchantId: string): Promise<PersistedManifest | undefined>;
}

function nowInstant(): Instant {
  const result = instantFromEpochMilliseconds(Date.now());
  if (!result.ok) {
    throw new Error("Failed to derive the current instant");
  }
  return result.value;
}

export class MerchantManifestStore implements MerchantManifestStoreLike {
  constructor(
    private readonly database: TransactionalDatabase,
    private readonly environment: Environment,
    private readonly readinessService: MerchantReadinessServiceLike,
  ) {}

  async generateAndPersist(merchantId: string): Promise<PersistedManifest> {
    const parsedMerchantId = parseCounterId(merchantId, "merchant");
    if (!parsedMerchantId.ok) {
      throw new MerchantManifestError(`Invalid merchantId: ${parsedMerchantId.error.message}`);
    }

    const appRow = await this.database.query<{
      lifecycle_state: string;
      goods_types: readonly string[] | null;
    }>(
      `SELECT lifecycle_state, goods_types FROM merchant.onboarding_applications
        WHERE environment = $1 AND merchant_id = $2`,
      [this.environment, merchantId],
    );
    const application = appRow.rows[0];
    if (application === undefined) {
      throw new MerchantManifestError(`No such merchant application: ${merchantId}`);
    }
    if (!isMerchantLifecycleState(application.lifecycle_state)) {
      throw new Error("Corrupt onboarding application row: invalid lifecycle_state");
    }

    const SANDBOX_READY_OR_LATER: ReadonlySet<string> = new Set([
      "SANDBOX_READY",
      "ACTIVATION_REVIEW",
      "ACTIVE",
      "ACTIVE_DEGRADED",
      "SUSPENDED",
      "OFFBOARDING",
      "CLOSED",
    ]);
    if (!SANDBOX_READY_OR_LATER.has(application.lifecycle_state)) {
      throw new MerchantManifestError(
        `Merchant is not SANDBOX_READY yet (currently ${application.lifecycle_state}) — pass the readiness check first`,
      );
    }

    // Fresh readiness evaluation for up-to-date version bindings — never a
    // stale cached snapshot. Uses the SAME evaluate() this merchant already
    // passed to reach SANDBOX_READY, so this call is a no-op transition-wise
    // (already past VERIFYING) and just re-derives the evidence.
    const readiness = await this.readinessService.evaluate(merchantId);

    const fulfillmentCapabilities: FulfillmentCapability[] = (application.goods_types ?? []).filter(
      isFulfillmentCapability,
    );

    const manifestResult = generateManifest({
      merchantId: parsedMerchantId.value as MerchantId,
      manifestVersion: MANIFEST_VERSION,
      capabilities: [...PILOT_CAPABILITIES],
      fulfillmentCapabilities,
      versionBindings: readiness.versionBindings,
      generatedAt: nowInstant(),
    });
    if (!manifestResult.ok) {
      throw new MerchantManifestError(manifestResult.error.message);
    }
    const manifest: CapabilityManifest = manifestResult.value;

    const now = new Date().toISOString();
    await this.database.query(
      `INSERT INTO merchant.capability_manifests
         (environment, merchant_id, manifest_version, capabilities, fulfillment_capabilities,
          version_bindings, generated_at, signature_digest, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (environment, merchant_id) DO UPDATE
         SET manifest_version = EXCLUDED.manifest_version,
             capabilities = EXCLUDED.capabilities,
             fulfillment_capabilities = EXCLUDED.fulfillment_capabilities,
             version_bindings = EXCLUDED.version_bindings,
             generated_at = EXCLUDED.generated_at,
             signature_digest = EXCLUDED.signature_digest`,
      [
        this.environment,
        merchantId,
        manifest.manifestVersion,
        manifest.capabilities,
        manifest.fulfillmentCapabilities ?? [],
        JSON.stringify(manifest.versionBindings),
        new Date(manifest.generatedAt).toISOString(),
        manifest.signatureDigest,
        now,
      ],
    );

    return this.#toPersisted(manifest);
  }

  async getManifest(merchantId: string): Promise<PersistedManifest | undefined> {
    const result = await this.database.query<{
      manifest_version: string;
      capabilities: readonly string[];
      fulfillment_capabilities: readonly string[];
      version_bindings: VersionBindings | string;
      generated_at: string | Date;
      signature_digest: string;
    }>(
      `SELECT manifest_version, capabilities, fulfillment_capabilities, version_bindings,
              generated_at, signature_digest
         FROM merchant.capability_manifests
        WHERE environment = $1 AND merchant_id = $2`,
      [this.environment, merchantId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      return undefined;
    }
    const versionBindings: VersionBindings =
      typeof row.version_bindings === "string"
        ? (JSON.parse(row.version_bindings) as VersionBindings)
        : row.version_bindings;
    return {
      merchantId,
      manifestVersion: row.manifest_version,
      capabilities: row.capabilities,
      fulfillmentCapabilities: row.fulfillment_capabilities,
      versionBindings,
      generatedAt: new Date(row.generated_at).toISOString(),
      signatureDigest: row.signature_digest,
    };
  }

  #toPersisted(manifest: CapabilityManifest): PersistedManifest {
    return {
      merchantId: manifest.merchantId,
      manifestVersion: manifest.manifestVersion,
      capabilities: manifest.capabilities,
      fulfillmentCapabilities: manifest.fulfillmentCapabilities ?? [],
      versionBindings: manifest.versionBindings,
      generatedAt: new Date(manifest.generatedAt).toISOString(),
      signatureDigest: manifest.signatureDigest,
    };
  }
}
