/**
 * Read-only, durable lookup of a merchant's own registered webhook endpoint
 * (merchant.webhook_endpoints — created via the self-serve registration
 * route, apps/control-plane-api/src/merchant-webhook-endpoint-store.ts).
 * Used by apps/worker's outbox dispatcher to resolve WHERE to deliver a
 * merchant-scoped order/fulfillment event — see outbox-dispatcher.ts.
 *
 * Read-only by design, mirroring payment-connection-read-store.ts's split:
 * registration/verification is owned by control-plane-api; this store never
 * writes.
 *
 * SECURITY: signing_secret is a real HMAC signing key used to let the
 * receiving merchant system verify a delivered webhook actually came from
 * Counter. It is read here and used only to compute a signature — never
 * logged, never included in the delivered payload itself.
 */
import type { Environment } from "@counter/domain";
import type { TransactionalDatabase } from "./database.js";

export interface WebhookEndpointReadResult {
  readonly url: string;
  readonly signingSecret: string;
}

interface WebhookEndpointRow {
  url: string;
  signing_secret: string;
}

export class PostgresWebhookEndpointReadStore {
  constructor(
    private readonly database: TransactionalDatabase,
    private readonly environment: Environment,
  ) {}

  async findByMerchantId(merchantId: string): Promise<WebhookEndpointReadResult | undefined> {
    const result = await this.database.query<WebhookEndpointRow>(
      `SELECT url, signing_secret FROM merchant.webhook_endpoints
        WHERE environment = $1 AND merchant_id = $2 AND status = 'active'`,
      [this.environment, merchantId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      return undefined;
    }
    return { url: row.url, signingSecret: row.signing_secret };
  }
}
