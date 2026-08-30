/**
 * Direct-SQL provisioning for recurring payment mandates (UPI Autopay /
 * e-mandate, via Razorpay's Tokens/Recurring-Payments API — see
 * @counter/razorpay-adapter's recurring-mandate-provider.ts for why that's
 * a deliberately different product than Razorpay's "Subscriptions").
 *
 * Same direct-SQL trust boundary as wallet-user-store.ts (see that file's
 * header for the full rationale): writes go straight through parameterized
 * SQL against wallet.recurring_payment_mandates rather than the RBAC-gated
 * PostgresIdentityRepositories, matching every other durable write this
 * deployment already makes.
 *
 * SCOPE NOTE: revoke() updates this table's own status and cancels the
 * Razorpay token, but does NOT call packages/wallet-application's
 * WalletRevocationService/CTP revocation-cascade machinery. That service
 * requires a signing key (its revoke() call takes a `kid` and produces a
 * signed CTP envelope) and today is wired only into apps/local-mcp with an
 * in-memory store — there is no durable, control-plane-api-reachable
 * revocation trail anywhere in the real path yet. Wiring this mandate's
 * revocation into that broader system is real follow-up work, not silently
 * folded into this change.
 */
import { randomBytes } from "node:crypto";
import type { Environment } from "@counter/domain";
import { createCounterId, parseCounterId } from "@counter/domain";
import type { TransactionalDatabase } from "@counter/data";
import type {
  ChargeRecurringParams,
  CreateCustomerParams,
  CreateRegistrationOrderParams,
  RegistrationCallbackInput,
  RegistrationCallbackResult,
} from "@counter/razorpay-adapter";
import type { PaymentOperationResult } from "@counter/payment-sdk";

/**
 * Structural interface for the subset of RazorpayRecurringMandateProvider's
 * surface this store actually calls — lets tests inject a fake instead of
 * requiring live Razorpay credentials, matching WalletUserProvisionerLike's
 * existing separation in this app.
 */
export interface RazorpayRecurringMandateProviderLike {
  createCustomer(params: CreateCustomerParams): Promise<string>;
  createRegistrationOrder(params: CreateRegistrationOrderParams): Promise<PaymentOperationResult>;
  verifyRegistrationCallback(input: RegistrationCallbackInput): Promise<RegistrationCallbackResult>;
  cancelToken(customerId: string, tokenId: string): Promise<void>;
}

// chargeRecurring isn't called from this store today (only from
// apps/worker/src/real-lifecycle.ts, per the plan's §1e) — imported for
// re-export convenience only so callers of this module don't need a second
// import from @counter/razorpay-adapter just for the type.
export type { ChargeRecurringParams };

export interface RecurringMandateSummary {
  readonly referenceId: string;
  readonly status: "pending" | "active" | "revoked" | "cancelled";
  readonly ceilingMinor: string;
  readonly currency: string;
  readonly validFrom: string;
  readonly validUntil: string;
  readonly eligibleMerchants: readonly string[];
  readonly eligibleOperations: readonly string[];
}

export interface BeginRegistrationParams {
  readonly walletId: string;
  readonly principalId: string;
  readonly contactName: string;
  readonly contactEmail: string;
  readonly contactPhone: string;
  readonly ceilingMinor: bigint;
  readonly validUntil: string;
  readonly eligibleMerchants: readonly string[];
  readonly eligibleOperations: readonly string[];
}

export interface BeginRegistrationResult {
  readonly referenceId: string;
  readonly checkout: {
    readonly razorpayOrderId: string;
    readonly razorpayKeyId: string;
    readonly razorpayCustomerId: string;
    readonly amountMinor: string;
    readonly currency: string;
  };
}

export interface ConfirmRegistrationParams {
  readonly walletId: string;
  readonly referenceId: string;
  readonly razorpayOrderId: string;
  readonly razorpayPaymentId: string;
  readonly razorpaySignature: string;
}

export interface RecurringMandateProvisionerLike {
  beginRegistration(params: BeginRegistrationParams): Promise<BeginRegistrationResult>;
  confirmRegistration(params: ConfirmRegistrationParams): Promise<RecurringMandateSummary>;
  revoke(walletId: string, referenceId: string): Promise<void>;
  list(walletId: string): Promise<readonly RecurringMandateSummary[]>;
}

interface MandateRow {
  readonly reference_id: string;
  readonly wallet_id: string;
  readonly status: "pending" | "active" | "revoked" | "cancelled";
  readonly provider_customer_id: string;
  readonly provider_token_id: string | null;
  readonly ceiling_minor: string;
  readonly currency: string;
  readonly valid_from: string;
  readonly valid_until: string;
  readonly eligible_merchants: readonly string[];
  readonly eligible_operations: readonly string[];
}

function toSummary(row: MandateRow): RecurringMandateSummary {
  return {
    referenceId: row.reference_id,
    status: row.status,
    ceilingMinor: row.ceiling_minor,
    currency: row.currency,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    eligibleMerchants: row.eligible_merchants,
    eligibleOperations: row.eligible_operations,
  };
}

export class RecurringMandateProvisioner implements RecurringMandateProvisionerLike {
  constructor(
    private readonly database: TransactionalDatabase,
    private readonly environment: Environment,
    private readonly razorpay: RazorpayRecurringMandateProviderLike,
  ) {}

  async beginRegistration(params: BeginRegistrationParams): Promise<BeginRegistrationResult> {
    const walletExists = await this.database.query(
      `SELECT 1 FROM wallet.scopes WHERE environment = $1 AND wallet_id = $2`,
      [this.environment, params.walletId],
    );
    if (walletExists.rows.length === 0) {
      throw new Error(`No such wallet: ${params.walletId}`);
    }

    const referenceIdResult = createCounterId("payment-reference", randomBytes(16));
    if (!referenceIdResult.ok) {
      throw new Error(
        `Failed to derive a payment-reference id: ${referenceIdResult.error.message}`,
      );
    }
    const referenceId = referenceIdResult.value as unknown as string;

    // Reuse a prior Razorpay customer for this wallet rather than creating a
    // fresh one every time — verified live against a real Razorpay test-mode
    // account that its "Customer already exists" error carries no id to
    // recover, so detecting/reusing a duplicate customer is CounterX's own
    // responsibility, not something the Razorpay API hands back.
    const priorCustomer = await this.database.query<{ provider_customer_id: string }>(
      `SELECT provider_customer_id FROM wallet.recurring_payment_mandates
        WHERE environment = $1 AND wallet_id = $2
        ORDER BY created_at DESC LIMIT 1`,
      [this.environment, params.walletId],
    );
    const customerId =
      priorCustomer.rows[0]?.provider_customer_id ??
      (await this.razorpay.createCustomer({
        name: params.contactName,
        contact: params.contactPhone,
        email: params.contactEmail,
      }));

    const ceilingPaise = Number(params.ceilingMinor);
    const validUntilEpochSeconds = Math.floor(new Date(params.validUntil).getTime() / 1000);

    const order = await this.razorpay.createRegistrationOrder({
      customerId,
      ceilingPaise,
      validUntilEpochSeconds,
      idempotencyKey: referenceId,
    });

    if (order.kind !== "action_required") {
      throw new Error(
        `Could not begin mandate registration (order outcome: ${order.kind}) — safe to retry, nothing was charged`,
      );
    }
    const razorpayOrderId = order.action.metadata?.["razorpay_order_id"];
    const razorpayKeyId = order.action.metadata?.["razorpay_key_id"];
    if (typeof razorpayOrderId !== "string" || typeof razorpayKeyId !== "string") {
      throw new Error("Razorpay registration order response was missing expected fields");
    }

    const now = new Date().toISOString();
    await this.database.query(
      `INSERT INTO wallet.recurring_payment_mandates (
         environment, reference_id, wallet_id, principal_id, adapter, status,
         provider_customer_id, ceiling_minor, currency, valid_from, valid_until,
         eligible_merchants, eligible_operations, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, 'razorpay_recurring', 'pending', $5, $6, 'INR', $7, $8, $9, $10, $11, $11)`,
      [
        this.environment,
        referenceId,
        params.walletId,
        params.principalId,
        customerId,
        params.ceilingMinor.toString(),
        now,
        params.validUntil,
        params.eligibleMerchants,
        params.eligibleOperations,
        now,
      ],
    );

    return {
      referenceId,
      checkout: {
        razorpayOrderId,
        razorpayKeyId,
        razorpayCustomerId: customerId,
        amountMinor: params.ceilingMinor.toString(),
        currency: "INR",
      },
    };
  }

  async confirmRegistration(params: ConfirmRegistrationParams): Promise<RecurringMandateSummary> {
    const existing = await this.database.query<MandateRow>(
      `SELECT reference_id, wallet_id, status, provider_customer_id, provider_token_id,
              ceiling_minor, currency, valid_from, valid_until, eligible_merchants, eligible_operations
         FROM wallet.recurring_payment_mandates
        WHERE environment = $1 AND reference_id = $2 AND wallet_id = $3`,
      [this.environment, params.referenceId, params.walletId],
    );
    const row = existing.rows[0];
    if (row === undefined) {
      throw new Error(`No such pending mandate registration: ${params.referenceId}`);
    }

    const verification = await this.razorpay.verifyRegistrationCallback({
      razorpayOrderId: params.razorpayOrderId,
      razorpayPaymentId: params.razorpayPaymentId,
      razorpaySignature: params.razorpaySignature,
    });
    if (!verification.verified) {
      throw new Error("Mandate registration callback signature could not be verified");
    }

    const now = new Date().toISOString();
    const updated = await this.database.query<MandateRow>(
      `UPDATE wallet.recurring_payment_mandates
          SET status = 'active', provider_token_id = $1, updated_at = $2
        WHERE environment = $3 AND reference_id = $4
      RETURNING reference_id, wallet_id, status, provider_customer_id, provider_token_id,
                ceiling_minor, currency, valid_from, valid_until, eligible_merchants, eligible_operations`,
      [verification.providerTokenId, now, this.environment, params.referenceId],
    );
    const updatedRow = updated.rows[0];
    if (updatedRow === undefined) {
      throw new Error(`Failed to activate mandate: ${params.referenceId}`);
    }
    return toSummary(updatedRow);
  }

  async revoke(walletId: string, referenceId: string): Promise<void> {
    const existing = await this.database.query<MandateRow>(
      `SELECT reference_id, wallet_id, status, provider_customer_id, provider_token_id,
              ceiling_minor, currency, valid_from, valid_until, eligible_merchants, eligible_operations
         FROM wallet.recurring_payment_mandates
        WHERE environment = $1 AND reference_id = $2 AND wallet_id = $3`,
      [this.environment, referenceId, walletId],
    );
    const row = existing.rows[0];
    if (row === undefined) {
      throw new Error(`No such mandate: ${referenceId}`);
    }

    if (row.status === "active" && row.provider_token_id !== null) {
      await this.razorpay.cancelToken(row.provider_customer_id, row.provider_token_id);
    }

    const nextStatus = row.status === "pending" ? "cancelled" : "revoked";
    await this.database.query(
      `UPDATE wallet.recurring_payment_mandates
          SET status = $1, updated_at = $2
        WHERE environment = $3 AND reference_id = $4`,
      [nextStatus, new Date().toISOString(), this.environment, referenceId],
    );
  }

  async list(walletId: string): Promise<readonly RecurringMandateSummary[]> {
    const result = await this.database.query<MandateRow>(
      `SELECT reference_id, wallet_id, status, provider_customer_id, provider_token_id,
              ceiling_minor, currency, valid_from, valid_until, eligible_merchants, eligible_operations
         FROM wallet.recurring_payment_mandates
        WHERE environment = $1 AND wallet_id = $2
        ORDER BY created_at DESC`,
      [this.environment, walletId],
    );
    return result.rows.map(toSummary);
  }
}

// Re-exported so callers can validate a reference id shape without reaching
// into @counter/domain directly.
export function isPaymentReferenceId(value: string): boolean {
  return parseCounterId(value, "payment-reference").ok;
}
