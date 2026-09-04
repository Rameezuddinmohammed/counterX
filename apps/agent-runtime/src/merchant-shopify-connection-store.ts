/**
 * Reads ONE merchant's own active Shopify connection from
 * merchant.shopify_connections (migration 0013) — the durable record of a
 * merchant's own store, written by the real OAuth flow in
 * apps/control-plane-api/src/shopify-connection-store.ts. This is the
 * per-merchant analog of that store's getConnectionStatus, scoped down to
 * exactly the fields real-handlers.ts needs to construct a ShopifyConnector
 * for THIS merchant: shop_domain + access_token (+ granted_scope,
 * informational only).
 *
 * Trust boundary: same direct-SQL convention as shopify-connection-store.ts
 * and merchant-directory-store.ts — no RLS policies on this table, the
 * service-role connection this app uses bypasses RLS by design (see
 * migration 0013's header for the full rationale). Never logs or echoes
 * access_token.
 *
 * A merchant with no row here, or whose row's status is 'revoked' (not
 * 'active'), resolves to `undefined` — callers MUST treat that as "this
 * merchant has no working Shopify catalog right now" (a clean not_found),
 * never as an error to throw, and NEVER fall back to any other merchant's
 * row. Always queries by the exact (environment, merchant_id) pair — there
 * is no code path here that could return a different merchant's connection.
 */
import type { TransactionalDatabase } from "@counter/data";
import type { Environment } from "@counter/domain";

export interface MerchantShopifyConnection {
  readonly shopDomain: string;
  readonly accessToken: string;
  readonly grantedScope: string;
}

interface ConnectionRow {
  readonly shop_domain: string;
  readonly access_token: string;
  readonly granted_scope: string;
}

/**
 * Structural interface for MerchantShopifyConnectionStore's public surface —
 * lets real-handlers.ts's resolver (and its unit tests) depend on the
 * interface rather than the concrete direct-SQL class, matching
 * ShopifyConnectionProvisionerLike's existing separation in
 * shopify-connection-store.ts.
 */
export interface MerchantShopifyConnectionStoreLike {
  getActive(merchantId: string): Promise<MerchantShopifyConnection | undefined>;
}

export class MerchantShopifyConnectionStore implements MerchantShopifyConnectionStoreLike {
  constructor(
    private readonly database: TransactionalDatabase,
    private readonly environment: Environment,
  ) {}

  /** Returns this merchant's active Shopify connection, or `undefined` when none exists. */
  async getActive(merchantId: string): Promise<MerchantShopifyConnection | undefined> {
    const result = await this.database.query<ConnectionRow>(
      `SELECT shop_domain, access_token, granted_scope
         FROM merchant.shopify_connections
        WHERE environment = $1 AND merchant_id = $2 AND status = 'active'`,
      [this.environment, merchantId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      return undefined;
    }
    return Object.freeze({
      shopDomain: row.shop_domain,
      accessToken: row.access_token,
      grantedScope: row.granted_scope,
    });
  }
}
