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
  /** Throws ShopifyOAuthError if the token is rejected by Shopify or under-scoped. */
  connectWithToken(
    merchantId: string,
    shopDomain: string,
    accessToken: string,
  ): Promise<CompleteAuthorizationResult>;
  getConnectionStatus(merchantId: string): Promise<ShopifyConnectionStatus>;
}

/**
 * True when this deployment has a Shopify OAuth app configured, i.e. the
 * one-click "Connect Shopify" flow is available. When false, the
 * merchant-supplied-token path (connectWithToken) is the only way to
 * connect — the console asks the API rather than guessing.
 */
export interface ShopifyConnectCapabilities {
  readonly oauthAvailable: boolean;
}

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

export function isValidShopDomain(shopDomain: string): boolean {
  return SHOP_DOMAIN_PATTERN.test(shopDomain);
}

/**
 * Recognises a Postgres unique-violation (SQLSTATE 23505) raised by one
 * specific constraint. Matched on the driver's structured `code`/
 * `constraint` fields where available, falling back to the message text
 * only if the driver did not populate them.
 */
function isUniqueViolation(error: unknown, constraintName: string): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const candidate = error as { code?: unknown; constraint?: unknown; message?: unknown };
  if (candidate.code === "23505" && candidate.constraint === constraintName) {
    return true;
  }
  return (
    candidate.code === "23505" &&
    typeof candidate.message === "string" &&
    candidate.message.includes(constraintName)
  );
}

/** Default Admin API version used for the token-verification calls. */
const DEFAULT_ADMIN_API_VERSION = "2025-07";

/**
 * The Admin API scopes a merchant's connection must actually hold to be
 * usable end to end: read the catalog, read orders for reconciliation, and
 * create orders at purchase time. Checked up front rather than discovered
 * at purchase time, so an under-scoped connection can never be stored as
 * "active" and then fail silently when an agent tries to buy.
 */
const REQUIRED_ADMIN_SCOPES = ["read_products", "read_orders", "write_orders"] as const;

export class ShopifyConnectionProvisioner implements ShopifyConnectionProvisionerLike {
  constructor(
    private readonly database: TransactionalDatabase,
    private readonly environment: Environment,
    /**
     * Optional: present only when this deployment has a Shopify OAuth app
     * (SHOPIFY_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI). The one-click
     * authorize/callback pair needs it; connectWithToken and
     * getConnectionStatus do not, which is why the whole provisioner is now
     * constructed whenever a database exists rather than only when an OAuth
     * app is configured. Previously, no OAuth app meant these routes were
     * never registered at all, so a merchant hit a bare 404/403 on the
     * Shopify page with nothing explaining why.
     */
    private readonly config: ShopifyOAuthConfig | undefined,
    private readonly onConnected?: OnShopifyConnected,
    private readonly adminApiVersion: string = DEFAULT_ADMIN_API_VERSION,
  ) {}

  capabilities(): ShopifyConnectCapabilities {
    return { oauthAvailable: this.config !== undefined };
  }

  private requireOAuthConfig(): ShopifyOAuthConfig {
    if (this.config === undefined) {
      throw new ShopifyOAuthError(
        "One-click Shopify connect is not available on this deployment — " +
          "connect with a Shopify Admin API access token instead.",
      );
    }
    return this.config;
  }

  private async requireMerchantExists(merchantId: string): Promise<void> {
    const merchantExists = await this.database.query(
      `SELECT 1 FROM merchant.scopes WHERE environment = $1 AND merchant_id = $2`,
      [this.environment, merchantId],
    );
    if (merchantExists.rows.length === 0) {
      throw new Error(`No such merchant: ${merchantId}`);
    }
  }

  /**
   * Durably records an active connection and kicks off the first catalog
   * sync. Shared by BOTH connect paths (OAuth callback and
   * merchant-supplied token) so the two can never drift into storing
   * different things — the rest of the platform reads exactly one row shape
   * from merchant.shopify_connections regardless of how it got there.
   */
  private async storeConnection(input: {
    merchantId: string;
    shopDomain: string;
    accessToken: string;
    grantedScope: string;
  }): Promise<void> {
    const now = new Date().toISOString();
    try {
      await this.storeConnectionRow(input, now);
    } catch (error) {
      // migration 0013's shopify_connections_shop_domain_active partial
      // unique index: one live store may be sold by at most one merchant.
      // The ON CONFLICT below covers "same merchant reconnects the same
      // store"; this covers "a DIFFERENT merchant tries to claim a store
      // that is already connected", which the ON CONFLICT target cannot
      // see. Without this the merchant got a raw 500 from a Postgres
      // constraint name (observed by execution, 2026-09-05) instead of
      // being told the actual, resolvable situation.
      if (isUniqueViolation(error, "shopify_connections_shop_domain_active")) {
        throw new ShopifyOAuthError(
          `${input.shopDomain} is already connected to another Counter merchant account. ` +
            `Disconnect it there first, or connect a different store.`,
        );
      }
      throw error;
    }

    // Fire-and-forget by contract - see OnShopifyConnected's doc comment.
    // Never let a sync-trigger failure surface as a connect error; the
    // connection is already durably saved above.
    this.onConnected?.({
      merchantId: input.merchantId,
      shopDomain: input.shopDomain,
      accessToken: input.accessToken,
    });
  }

  private async storeConnectionRow(
    input: {
      merchantId: string;
      shopDomain: string;
      accessToken: string;
      grantedScope: string;
    },
    now: string,
  ): Promise<void> {
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
      [
        this.environment,
        input.merchantId,
        input.shopDomain,
        input.accessToken,
        input.grantedScope,
        now,
      ],
    );
  }

  /**
   * Connects a store using an Admin API access token the merchant created
   * themselves (Shopify "custom app" — Settings → Apps and sales channels →
   * Develop apps). This is the path that works with NO Shopify Partner app
   * on Counter's side.
   *
   * Fails closed: the token is proven against Shopify's own Admin API
   * before anything is stored, and the granted scopes must cover
   * REQUIRED_ADMIN_SCOPES. A token that is wrong, revoked, belongs to a
   * different store, or is too narrowly scoped is rejected with a message
   * the merchant can act on — never saved as a connection that would later
   * fail mid-purchase. Same verify-before-storing discipline as the
   * merchant Razorpay connect in merchant-payment-connection-store.ts.
   */
  async connectWithToken(
    merchantId: string,
    shopDomain: string,
    accessToken: string,
  ): Promise<CompleteAuthorizationResult> {
    if (!isValidShopDomain(shopDomain)) {
      throw new ShopifyOAuthError(`Invalid Shopify shop domain: ${shopDomain}`);
    }
    if (accessToken.trim().length === 0) {
      throw new ShopifyOAuthError("An Admin API access token is required");
    }
    await this.requireMerchantExists(merchantId);

    const token = accessToken.trim();
    const grantedScopes = await this.verifyTokenAndReadScopes(shopDomain, token);

    const missing = REQUIRED_ADMIN_SCOPES.filter((scope) => !grantedScopes.includes(scope));
    if (missing.length > 0) {
      throw new ShopifyOAuthError(
        `This token is missing required Admin API access: ${missing.join(", ")}. ` +
          `Edit the app's API scopes in your Shopify admin, then reinstall it and use the new token.`,
      );
    }

    await this.storeConnection({
      merchantId,
      shopDomain,
      accessToken: token,
      grantedScope: grantedScopes.join(","),
    });

    return { merchantId, shopDomain };
  }

  /**
   * Proves the token really works against THIS store and returns the scopes
   * Shopify says it holds. Two calls, deliberately: shop.json is the
   * cheapest possible "is this token valid for this shop" probe and gives a
   * clean 401 for a bad token, while access_scopes.json is the only
   * authoritative source for what the token may actually do.
   */
  private async verifyTokenAndReadScopes(
    shopDomain: string,
    accessToken: string,
  ): Promise<readonly string[]> {
    const headers = { "X-Shopify-Access-Token": accessToken };

    let shopResponse: Response;
    try {
      shopResponse = await fetch(
        `https://${shopDomain}/admin/api/${this.adminApiVersion}/shop.json`,
        { headers },
      );
    } catch {
      throw new ShopifyOAuthError(
        `Could not reach ${shopDomain}. Check the store domain and try again.`,
      );
    }
    if (shopResponse.status === 401 || shopResponse.status === 403) {
      throw new ShopifyOAuthError(
        `Shopify rejected this access token for ${shopDomain}. ` +
          `Check that you copied the Admin API access token from a custom app installed on this store.`,
      );
    }
    if (shopResponse.status === 404) {
      throw new ShopifyOAuthError(`Shopify does not recognise the store ${shopDomain}.`);
    }
    if (!shopResponse.ok) {
      throw new ShopifyOAuthError(
        `Shopify returned an unexpected error (HTTP ${shopResponse.status}) while verifying the token.`,
      );
    }

    const scopesResponse = await fetch(`https://${shopDomain}/admin/oauth/access_scopes.json`, {
      headers,
    });
    if (!scopesResponse.ok) {
      throw new ShopifyOAuthError(
        `Could not read this token's permissions from Shopify (HTTP ${scopesResponse.status}).`,
      );
    }
    const body = (await scopesResponse.json()) as {
      access_scopes?: readonly { handle?: string }[];
    };
    return (body.access_scopes ?? [])
      .map((entry) => entry.handle)
      .filter((handle): handle is string => typeof handle === "string" && handle.length > 0);
  }

  async beginAuthorization(
    merchantId: string,
    shopDomain: string,
  ): Promise<BeginAuthorizationResult> {
    const config = this.requireOAuthConfig();
    if (!isValidShopDomain(shopDomain)) {
      throw new ShopifyOAuthError(`Invalid Shopify shop domain: ${shopDomain}`);
    }

    await this.requireMerchantExists(merchantId);

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
    authorizeUrl.searchParams.set("client_id", config.clientId);
    authorizeUrl.searchParams.set("scope", config.scopes);
    authorizeUrl.searchParams.set("redirect_uri", config.redirectUri);
    authorizeUrl.searchParams.set("state", rawState);

    return { authorizeUrl: authorizeUrl.toString() };
  }

  /**
   * Verifies Shopify's HMAC over the FULL callback query string (every
   * param except `hmac` itself, sorted alphabetically by key, joined as
   * `key=value` pairs with `&`), per Shopify's documented algorithm.
   */
  private verifyHmac(query: Readonly<Record<string, string | undefined>>): boolean {
    const config = this.requireOAuthConfig();
    const receivedHmac = query["hmac"];
    if (typeof receivedHmac !== "string" || receivedHmac.length === 0) {
      return false;
    }

    const message = Object.keys(query)
      .filter((key) => key !== "hmac" && query[key] !== undefined)
      .sort()
      .map((key) => `${key}=${query[key]}`)
      .join("&");

    const computedHmac = createHmac("sha256", config.clientSecret)
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
    const config = this.requireOAuthConfig();
    const response = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_id: config.clientId,
        client_secret: config.clientSecret,
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
    this.requireOAuthConfig();
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

    await this.storeConnection({
      merchantId: redeemed.merchant_id,
      shopDomain,
      accessToken: token.accessToken,
      grantedScope: token.scope,
    });

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
