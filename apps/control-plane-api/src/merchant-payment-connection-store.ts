/**
 * Self-serve merchant onboarding, Step 4: "bring your own Razorpay gateway."
 * A merchant pastes their OWN Razorpay `key_id`/`key_secret`; this store
 * verifies them with a real, harmless, read-only Razorpay API call before
 * ever persisting them as "connected" — an unverified credential is never
 * stored as connected (CLAUDE.md: "No silent consequential failure").
 *
 * SCOPE BOUNDARY, explicitly per the roadmap plan's Phase 2 design: this is
 * the own-gateway path ONLY. Razorpay Route sub-merchant KYC (Counter
 * collecting funds on the merchant's behalf via a marketplace/split
 * arrangement) is a separate, large, already-deferred follow-up — not
 * attempted here.
 *
 * DISCLOSED LIMITATION (real, not hidden): this pass does NOT wire these
 * per-merchant credentials into the actual checkout/worker payment path.
 * apps/worker/src/boot.ts resolves ONE platform-level Razorpay credential
 * set via requireRazorpayCredentials(env) and uses it for every merchant's
 * transactions today (confirmed by reading that file). Making the worker
 * support real per-merchant BYO gateway credentials is a distinct, larger
 * follow-up. This pass only proves the merchant owns valid Razorpay
 * credentials and records that fact for Step 5's readiness evaluation — it
 * does NOT mean a real transaction would use these credentials yet.
 *
 * Verification calls Razorpay's real "List all Payments" endpoint
 * (`GET /v1/payments?count=1`) — the least-privileged real read-only call
 * available through @counter/razorpay-adapter's existing HTTP client/types
 * (packages/razorpay-adapter/src/real-http-client.ts): it requires valid
 * Basic auth (so it proves the key_id/key_secret pair is real and active)
 * and never creates, modifies, or captures anything.
 *
 * SECURITY: key_secret is a real, live credential. See migration 0016's
 * header for how it is (and deliberately isn't) protected at rest — same
 * disclosed, no-new-encryption-precedent trade-off as
 * shopify-connection-store.ts's access_token.
 *
 * Writes go straight through parameterized SQL rather than the RBAC-gated
 * PostgresIdentityRepositories, matching every other store in this app —
 * see wallet-user-store.ts's header for the full rationale.
 */
import type { Environment } from "@counter/domain";
import type { TransactionalDatabase } from "@counter/data";
import { createRazorpayHttpClient } from "@counter/razorpay-adapter";
import type { RazorpayHttpPort } from "@counter/razorpay-adapter";

export interface RazorpayConnectionInput {
  readonly keyId: string;
  readonly keySecret: string;
}

export interface PaymentConnectionStatus {
  readonly connected: boolean;
  readonly provider?: "razorpay";
  /** Safe to expose — the public half of the credential pair, never key_secret. */
  readonly keyId?: string;
  readonly verifiedAt?: string;
}

/** A client-caused failure (credentials rejected by Razorpay, malformed input) — maps to 400. */
export class PaymentConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentConnectionError";
  }
}

/**
 * Structural interface for MerchantPaymentConnectionStore's public surface —
 * lets routes (and tests) depend on the interface rather than the concrete
 * direct-SQL class, matching MerchantApplicationProvisionerLike's existing
 * separation in this app.
 */
export interface MerchantPaymentConnectionStoreLike {
  /** Throws PaymentConnectionError if Razorpay rejects the credentials, or the merchant doesn't exist. */
  connectRazorpay(
    merchantId: string,
    input: RazorpayConnectionInput,
  ): Promise<PaymentConnectionStatus>;
  getConnectionStatus(merchantId: string): Promise<PaymentConnectionStatus>;
}

export interface MerchantPaymentConnectionConfig {
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
}

const DEFAULT_RAZORPAY_BASE_URL = "https://api.razorpay.com";

export class MerchantPaymentConnectionStore implements MerchantPaymentConnectionStoreLike {
  constructor(
    private readonly database: TransactionalDatabase,
    private readonly environment: Environment,
    private readonly config: MerchantPaymentConnectionConfig = {},
    /** Injectable for tests — defaults to the real fetch-based Razorpay client. */
    private readonly buildHttpClient: (keyId: string, keySecret: string) => RazorpayHttpPort = (
      keyId,
      keySecret,
    ) =>
      createRazorpayHttpClient({
        keyId,
        keySecret,
        baseUrl: this.config.baseUrl ?? DEFAULT_RAZORPAY_BASE_URL,
        ...(this.config.timeoutMs !== undefined ? { timeoutMs: this.config.timeoutMs } : {}),
      }),
  ) {}

  private async verify(keyId: string, keySecret: string): Promise<void> {
    const client = this.buildHttpClient(keyId, keySecret);
    const response = await client.request<unknown>({ method: "GET", path: "/v1/payments?count=1" });
    if (response.status !== 200) {
      throw new PaymentConnectionError(
        `Razorpay rejected these credentials (HTTP ${response.status}) — check the key ID and secret`,
      );
    }
  }

  async connectRazorpay(
    merchantId: string,
    input: RazorpayConnectionInput,
  ): Promise<PaymentConnectionStatus> {
    if (input.keyId.trim().length === 0) {
      throw new PaymentConnectionError("keyId must not be empty");
    }
    if (input.keySecret.trim().length === 0) {
      throw new PaymentConnectionError("keySecret must not be empty");
    }

    const merchantExists = await this.database.query(
      `SELECT 1 FROM merchant.scopes WHERE environment = $1 AND merchant_id = $2`,
      [this.environment, merchantId],
    );
    if (merchantExists.rows.length === 0) {
      throw new PaymentConnectionError(`No such merchant: ${merchantId}`);
    }

    // Verify BEFORE ever persisting — an unverified credential is never
    // stored as "connected" (CLAUDE.md: money-affecting checks run before
    // the effect, not after).
    await this.verify(input.keyId, input.keySecret);

    const now = new Date().toISOString();
    await this.database.query(
      `INSERT INTO merchant.payment_connections
         (environment, merchant_id, provider, key_id, key_secret, verified_at, created_at, updated_at)
       VALUES ($1, $2, 'razorpay', $3, $4, $5, $5, $5)
       ON CONFLICT (environment, merchant_id) DO UPDATE
         SET key_id = EXCLUDED.key_id,
             key_secret = EXCLUDED.key_secret,
             verified_at = EXCLUDED.verified_at,
             updated_at = EXCLUDED.updated_at`,
      [this.environment, merchantId, input.keyId, input.keySecret, now],
    );

    return { connected: true, provider: "razorpay", keyId: input.keyId, verifiedAt: now };
  }

  async getConnectionStatus(merchantId: string): Promise<PaymentConnectionStatus> {
    const result = await this.database.query<{
      key_id: string;
      verified_at: string | Date;
    }>(
      `SELECT key_id, verified_at FROM merchant.payment_connections
        WHERE environment = $1 AND merchant_id = $2`,
      [this.environment, merchantId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      return { connected: false };
    }
    return {
      connected: true,
      provider: "razorpay",
      keyId: row.key_id,
      verifiedAt: new Date(row.verified_at).toISOString(),
    };
  }
}
