/**
 * Read-only lookup of a merchant's own self-serve-connected Shopify store,
 * for the worker's per-merchant checkout routing (see boot.ts's
 * `resolveShopifyCredentialsForMerchant`).
 *
 * Mirrors apps/control-plane-api/src/shopify-connection-store.ts's table
 * (merchant.shopify_connections, migration 0013) and its exact direct-SQL
 * trust-boundary convention (RLS enabled+forced, no policies — see that
 * file's header for the full rationale): apps don't import from other apps
 * in this monorepo, so this worker gets its own minimal read-only copy of
 * the query rather than a cross-app import.
 */
import type { TransactionalDatabase } from "@counter/data";
import type { Environment, MerchantId } from "@counter/domain";

export interface MerchantShopifyConnection {
  readonly shopDomain: string;
  readonly accessToken: string;
}

interface ConnectionRow {
  readonly shop_domain: string;
  readonly access_token: string;
}

export interface MerchantShopifyConnectionReadStore {
  findActiveByMerchantId(merchantId: MerchantId): Promise<MerchantShopifyConnection | undefined>;
}

export class PostgresMerchantShopifyConnectionReadStore
  implements MerchantShopifyConnectionReadStore
{
  constructor(
    private readonly database: TransactionalDatabase,
    private readonly environment: Environment,
  ) {}

  async findActiveByMerchantId(
    merchantId: MerchantId,
  ): Promise<MerchantShopifyConnection | undefined> {
    const result = await this.database.query<ConnectionRow>(
      `SELECT shop_domain, access_token
         FROM merchant.shopify_connections
        WHERE environment = $1 AND merchant_id = $2 AND status = 'active'`,
      [this.environment, merchantId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      return undefined;
    }
    return Object.freeze({ shopDomain: row.shop_domain, accessToken: row.access_token });
  }
}
