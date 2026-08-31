/**
 * Self-serve Shopify OAuth: direct-SQL provisioning for the REAL
 * authorization-code grant flow (Shopify's public OAuth docs:
 * https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/authorization-code-grant).
 * Replaces "an operator manually sets SHOPIFY_STORE_DOMAIN/SHOPIFY_ACCESS_TOKEN"
 * (apps/worker/src/connector-env.ts's resolveShopifyCredentials) with "a
 * merchant clicks Connect Shopify and authorizes their own store" — see
 * shopify-connect-routes.ts for the route-level flow this backs.
 *
 * Writes go straight through parameterized SQL rather than the RBAC-gated
 * PostgresIdentityRepositories, matching wallet-user-store.ts's exact
 * trade-off and for the same reason: that repository's ScopedTransactionManager
 * requires a Postgres role posture this deployment doesn't have configured.
 * See wallet-user-store.ts's header for the full rationale.
 *
 * SECURITY: this flow's real access token is a live credential capable of
 * acting on the merchant's store. See
 * packages/data/migrations/0013-shopify-connections.up.sql's header for how
 * it is (and deliberately isn't) protected at rest. Two independent
 * defenses gate the callback that writes it: (1) the OAuth `state` nonce
 * minted by beginAuthorization — hashed, single-use, 10-minute expiry, the
 * same shape as wallet-user-store.ts's setup tokens — and (2) Shopify's own
 * HMAC-SHA256 signature over the callback query string, verified here with
 * the app's client secret and a timing-safe comparison, per Shopify's
 * documented OAuth security requirements.
 */
import { randomBytes, createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Environment } from "@counter/domain";
import type { TransactionalDatabase } from "@counter/data";

const STATE_TTL_MS = 10 * 60 * 1000;

/** Shopify's own store-domain shape: `{handle}.myshopify.com`. */
const SHOP_DOMAIN_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;

export interface ShopifyOAuthConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  /** Comma-separated Shopify Admin API access scopes, e.g. "read_products,read_orders". */
  readonly scopes: string;
  /** Must exactly match the redirect/callback URL configured on the Shopify app. */
  readonly redirectUri: string;
}

export interface BeginAuthorizationResult {
  readonly authorizeUrl: string;
}

export interface CompleteAuthorizationResult {
  readonly merchantId: string;
  readonly shopDomain: string;
}

export interface ShopifyConnectionStatus {
  readonly connected: boolean;
  readonly shopDomain?: string;
  readonly connectedAt?: string;
}

/**
 * Fired after a merchant's Shopify connection is durably stored, carrying
 * the real access token this call just obtained. Fire-and-forget by
 * contract - completeAuthorization does not await it and a rejection here
 * must never fail the OAuth callback response (the connection is already
 * saved by that point; the merchant should see "connected" regardless of
 * whether the first catalog sync succeeds). The one real consumer today
 * (see main.ts) kicks off CatalogSyncService.backfillProducts.
 */
export type OnShopifyConnected = (input: {
  readonly merchantId: string;
  readonly shopDomain: string;
  readonly accessToken: string;
}) => void;

/** A client-caused failure (bad/expired state, failed HMAC, malformed callback) — maps to 400. */
export class ShopifyOAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShopifyOAuthError";
  }
}

/**
 * Structural interface for ShopifyConnectionProvisioner's public surface —
 * lets shopify-connect-routes.ts (and its tests) depend on the interface
 * rather than the concrete direct-SQL class, matching
 * WalletUserProvisionerLike's existing separation in this app.
 */
export interface ShopifyConnectionProvisionerLike {
  /** Throws if merchantId does not name a real merchant, or shopDomain is malformed. */
  beginAuthorization(merchantId: string, shopDomain: string): Promise<BeginAuthorizationResult>;
  /** Throws ShopifyOAuthError for any client-caused callback failure. */
  completeAuthorization(
    query: Readonly<Record<string, string | undefined>>,
  ): Promise<CompleteAuthorizationResult>;
  getConnectionStatus(merchantId: string): Promise<ShopifyConnectionStatus>;
}

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

export function isValidShopDomain(shopDomain: string): boolean {
  return SHOP_DOMAIN_PATTERN.test(shopDomain);
}

export class ShopifyConnectionProvisioner implements ShopifyConnectionProvisionerLike {
  constructor(
    private readonly database: TransactionalDatabase,
    private readonly environment: Environment,
    private readonly config: ShopifyOAuthConfig,
    private readonly onConnected?: OnShopifyConnected,
  ) {}

  async beginAuthorization(
    merchantId: string,
    shopDomain: string,
  ): Promise<BeginAuthorizationResult> {
    if (!isValidShopDomain(shopDomain)) {
      throw new ShopifyOAuthError(`Invalid Shopify shop domain: ${shopDomain}`);
    }

    const merchantExists = await this.database.query(
      `SELECT 1 FROM merchant.scopes WHERE environment = $1 AND merchant_id = $2`,
      [this.environment, merchantId],
    );
    if (merchantExists.rows.length === 0) {
      throw new Error(`No such merchant: ${merchantId}`);
    }

    const rawState = randomBytes(32).toString("base64url");
    const stateHash = hashToken(rawState);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + STATE_TTL_MS);

    await this.database.query(
      `INSERT INTO merchant.shopify_oauth_states
         (environment, state_hash, merchant_id, shop_domain, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        this.environment,
        stateHash,
        merchantId,
        shopDomain,
        now.toISOString(),
        expiresAt.toISOString(),
      ],
    );

    const authorizeUrl = new URL(`https://${shopDomain}/admin/oauth/authorize`);
    authorizeUrl.searchParams.set("client_id", this.config.clientId);
    authorizeUrl.searchParams.set("scope", this.config.scopes);
    authorizeUrl.searchParams.set("redirect_uri", this.config.redirectUri);
    authorizeUrl.searchParams.set("state", rawState);

    return { authorizeUrl: authorizeUrl.toString() };
  }

  /**
   * Verifies Shopify's HMAC over the FULL callback query string (every
   * param except `hmac` itself, sorted alphabetically by key, joined as
   * `key=value` pairs with `&`), per Shopify's documented algorithm.
   */
  private verifyHmac(query: Readonly<Record<string, string | undefined>>): boolean {
    const receivedHmac = query["hmac"];
    if (typeof receivedHmac !== "string" || receivedHmac.length === 0) {
      return false;
    }

    const message = Object.keys(query)
      .filter((key) => key !== "hmac" && query[key] !== undefined)
      .sort()
      .map((key) => `${key}=${query[key]}`)
      .join("&");

    const computedHmac = createHmac("sha256", this.config.clientSecret)
      .update(message, "utf8")
      .digest("hex");

    const computedBuffer = Buffer.from(computedHmac, "hex");
    const receivedBuffer = Buffer.from(receivedHmac, "hex");
    if (computedBuffer.length !== receivedBuffer.length) {
      return false;
    }
    return timingSafeEqual(computedBuffer, receivedBuffer);
  }

  private async exchangeCodeForToken(
    shopDomain: string,
    code: string,
  ): Promise<{ accessToken: string; scope: string }> {
    const response = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
      }),
    });
    if (!response.ok) {
      throw new Error(`Shopify token exchange failed with status ${response.status}`);
    }
    const body = (await response.json()) as { access_token?: string; scope?: string };
    if (typeof body.access_token !== "string" || body.access_token.length === 0) {
      throw new Error("Shopify token exchange response is missing access_token");
    }
    return { accessToken: body.access_token, scope: body.scope ?? "" };
  }

  async completeAuthorization(
    query: Readonly<Record<string, string | undefined>>,
  ): Promise<CompleteAuthorizationResult> {
    const code = query["code"];
    const shopDomain = query["shop"];
    const state = query["state"];

    if (typeof code !== "string" || code.length === 0) {
      throw new ShopifyOAuthError("Callback is missing 'code'");
    }
    if (typeof shopDomain !== "string" || !isValidShopDomain(shopDomain)) {
      throw new ShopifyOAuthError("Callback is missing a valid 'shop'");
    }
    if (typeof state !== "string" || state.length === 0) {
      throw new ShopifyOAuthError("Callback is missing 'state'");
    }
    if (!this.verifyHmac(query)) {
      throw new ShopifyOAuthError("Callback HMAC verification failed");
    }

    const stateHash = hashToken(state);
    const redeemed = await this.database.transaction(async (session) => {
      const result = await session.query<{ merchant_id: string; shop_domain: string }>(
        `UPDATE merchant.shopify_oauth_states
            SET used_at = clock_timestamp()
          WHERE environment = $1
            AND state_hash = $2
            AND used_at IS NULL
            AND expires_at > clock_timestamp()
        RETURNING merchant_id, shop_domain`,
        [this.environment, stateHash],
      );
      return result.rows[0];
    });
    if (redeemed === undefined) {
      throw new ShopifyOAuthError("OAuth state is invalid, expired, or already used");
    }
    if (redeemed.shop_domain !== shopDomain) {
      throw new ShopifyOAuthError("Shop domain does not match the authorization request");
    }

    const token = await this.exchangeCodeForToken(shopDomain, code);
    const now = new Date().toISOString();

    await this.database.query(
      `INSERT INTO merchant.shopify_connections
         (environment, merchant_id, shop_domain, access_token, granted_scope, status, connected_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'active', $6, $6)
       ON CONFLICT (environment, merchant_id) DO UPDATE
         SET shop_domain = EXCLUDED.shop_domain,
             access_token = EXCLUDED.access_token,
             granted_scope = EXCLUDED.granted_scope,
             status = 'active',
             connected_at = EXCLUDED.connected_at,
             updated_at = EXCLUDED.updated_at`,
      [this.environment, redeemed.merchant_id, shopDomain, token.accessToken, token.scope, now],
    );

    // Fire-and-forget by contract - see OnShopifyConnected's doc comment.
    // Never let a sync-trigger failure surface as an OAuth callback error;
    // the connection is already durably saved above.
    this.onConnected?.({ merchantId: redeemed.merchant_id, shopDomain, accessToken: token.accessToken });

    return { merchantId: redeemed.merchant_id, shopDomain };
  }

  async getConnectionStatus(merchantId: string): Promise<ShopifyConnectionStatus> {
    const result = await this.database.query<{
      shop_domain: string;
      connected_at: string | Date;
    }>(
      `SELECT shop_domain, connected_at FROM merchant.shopify_connections
        WHERE environment = $1 AND merchant_id = $2 AND status = 'active'`,
      [this.environment, merchantId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      return { connected: false };
    }
    return {
      connected: true,
      shopDomain: row.shop_domain,
      connectedAt: new Date(row.connected_at).toISOString(),
    };
  }
}
