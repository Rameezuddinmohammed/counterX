/**
 * Read-only, durable lookup of a merchant's own verified Razorpay credentials
 * (merchant.payment_connections — created and verified by
 * apps/control-plane-api/src/merchant-payment-connection-store.ts's self-serve
 * "bring your own gateway" onboarding step). Used by apps/worker's boot-time
 * connector selection to authorize/capture that SPECIFIC merchant's
 * transactions through the merchant's own credential pair, instead of a
 * single shared platform-level credential — see boot.ts's
 * resolveRazorpayCredentialsForMerchant for how a missing connection fails
 * loud rather than silently falling back to a shared secret.
 *
 * Read-only by design: this store never writes. Verification and persistence
 * of a new connection are owned by control-plane-api's
 * MerchantPaymentConnectionStore.
 *
 * SECURITY: key_secret is a real, live Razorpay API secret. It is read here
 * and passed straight into the real connector factory — never logged.
 */
import type { Environment } from "@counter/domain";
import type { TransactionalDatabase } from "./database.js";

export interface PaymentConnectionReadResult {
  readonly keyId: string;
  readonly keySecret: string;
  readonly verifiedAt: string;
}

interface PaymentConnectionRow {
  key_id: string;
  key_secret: string;
  verified_at: Date;
}

export class PostgresPaymentConnectionReadStore {
  constructor(
    private readonly database: TransactionalDatabase,
    private readonly environment: Environment,
  ) {}

  async findByMerchantId(merchantId: string): Promise<PaymentConnectionReadResult | undefined> {
    const result = await this.database.query<PaymentConnectionRow>(
      `SELECT key_id, key_secret, verified_at FROM merchant.payment_connections
        WHERE environment = $1 AND merchant_id = $2 AND provider = 'razorpay'`,
      [this.environment, merchantId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      return undefined;
    }
    return {
      keyId: row.key_id,
      keySecret: row.key_secret,
      verifiedAt: new Date(row.verified_at).toISOString(),
    };
  }
}
