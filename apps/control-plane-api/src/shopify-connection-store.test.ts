import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DatabaseSession, TransactionalDatabase } from "@counter/data";
import {
  ShopifyConnectionProvisioner,
  ShopifyOAuthError,
  isValidShopDomain,
  type ShopifyOAuthConfig,
} from "./shopify-connection-store.js";

const ENVIRONMENT = "test" as const;
const TEST_MERCHANT_ID = "ctr_merchant_AAAAAAAAAAAAAAAAAAAAAA";
const TEST_SHOP_DOMAIN = "test-store.myshopify.com";
const TEST_CONFIG: ShopifyOAuthConfig = {
  clientId: "fake-client-id",
  clientSecret: "fake-client-secret",
  scopes: "read_products,read_orders",
  redirectUri: "https://control-plane.example.test/control/v1/merchants/x/shopify/callback",
};

interface FakeOAuthState {
  merchantId: string;
  shopDomain: string;
  usedAt: string | null;
  expiresAt: string;
}

interface FakeConnection {
  shopDomain: string;
  accessToken: string;
  grantedScope: string;
  status: string;
  connectedAt: string;
}

interface FakeDatabaseHandle {
  readonly database: TransactionalDatabase;
  readonly merchants: Set<string>;
  readonly states: Map<string, FakeOAuthState>;
  readonly connections: Map<string, FakeConnection>;
}

/**
 * A minimal in-memory stand-in for the three tables shopify-connection-store.ts
 * touches, matched by SQL prefix — NOT a real SQL engine. Good enough to
 * exercise the store's actual logic (HMAC verification, state single-use
 * redemption, shop-domain cross-check, upsert-on-reconnect) without a real
 * database, matching this task's "do not run a real migration/DB" constraint.
 *
 * Built as a plain object literal (not a class implementing
 * TransactionalDatabase) so its methods are contextually typed from the
 * interface — control-plane-api has no direct dependency on "pg" for the
 * QueryResult/QueryResultRow types that interface's signatures reference.
 */
function createFakeDatabase(): FakeDatabaseHandle {
  const merchants = new Set<string>([TEST_MERCHANT_ID]);
  const states = new Map<string, FakeOAuthState>();
  const connections = new Map<string, FakeConnection>();

  function run(text: string, values: readonly unknown[]): { rows: unknown[] } {
    const sql = text.trim();

    if (sql.startsWith("SELECT 1 FROM merchant.scopes")) {
      const [, merchantId] = values as [string, string];
      return { rows: merchants.has(merchantId) ? [{}] : [] };
    }

    if (sql.startsWith("INSERT INTO merchant.shopify_oauth_states")) {
      const [, stateHash, merchantId, shopDomain, , expiresAt] = values as string[];
      states.set(stateHash as string, {
        merchantId: merchantId as string,
        shopDomain: shopDomain as string,
        usedAt: null,
        expiresAt: expiresAt as string,
      });
      return { rows: [] };
    }

    if (sql.startsWith("UPDATE merchant.shopify_oauth_states")) {
      const [, stateHash] = values as [string, string];
      const state = states.get(stateHash);
      if (
        state === undefined ||
        state.usedAt !== null ||
        new Date(state.expiresAt).getTime() <= Date.now()
      ) {
        return { rows: [] };
      }
      state.usedAt = new Date().toISOString();
      return { rows: [{ merchant_id: state.merchantId, shop_domain: state.shopDomain }] };
    }

    if (sql.startsWith("INSERT INTO merchant.shopify_connections")) {
      const [, merchantId, shopDomain, accessToken, grantedScope, connectedAt] = values as string[];
      connections.set(merchantId as string, {
        shopDomain: shopDomain as string,
        accessToken: accessToken as string,
        grantedScope: grantedScope as string,
        status: "active",
        connectedAt: connectedAt as string,
      });
      return { rows: [] };
    }

    if (sql.startsWith("SELECT shop_domain, connected_at FROM merchant.shopify_connections")) {
      const [, merchantId] = values as [string, string];
      const connection = connections.get(merchantId);
      return {
        rows:
          connection !== undefined && connection.status === "active"
            ? [{ shop_domain: connection.shopDomain, connected_at: connection.connectedAt }]
            : [],
      };
    }

    throw new Error(`FakeDatabase: unhandled query: ${sql}`);
  }

  const query = (text: string, values: readonly unknown[] = []) =>
    Promise.resolve(run(text, values));
  const session = { query } as unknown as DatabaseSession;

  const database = {
    query,
    transaction: (operation: (session: DatabaseSession) => Promise<unknown>) => operation(session),
  } as unknown as TransactionalDatabase;

  return { database, merchants, states, connections };
}

function computeHmac(secret: string, query: Record<string, string>): string {
  const message = Object.keys(query)
    .filter((key) => key !== "hmac")
    .sort()
    .map((key) => `${key}=${query[key]}`)
    .join("&");
  return createHmac("sha256", secret).update(message, "utf8").digest("hex");
}

function stubFetchOnce(response: { ok: boolean; status?: number; body?: unknown }): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 500),
      json: () => Promise.resolve(response.body ?? {}),
    }),
  );
}

describe("isValidShopDomain", () => {
  it("accepts a well-formed myshopify.com domain", () => {
    expect(isValidShopDomain("test-store.myshopify.com")).toBe(true);
  });

  it("rejects a non-myshopify.com domain (SSRF guard)", () => {
    expect(isValidShopDomain("evil.example.com")).toBe(false);
    expect(isValidShopDomain("test-store.myshopify.com.evil.com")).toBe(false);
    expect(isValidShopDomain("")).toBe(false);
  });
});

describe("ShopifyConnectionProvisioner", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("beginAuthorization", () => {
    it("rejects an invalid shop domain", async () => {
      const { database } = createFakeDatabase();
      const provisioner = new ShopifyConnectionProvisioner(database, ENVIRONMENT, TEST_CONFIG);
      await expect(provisioner.beginAuthorization(TEST_MERCHANT_ID, "not-a-shop")).rejects.toThrow(
        ShopifyOAuthError,
      );
    });

    it("rejects an unknown merchant", async () => {
      const { database } = createFakeDatabase();
      const provisioner = new ShopifyConnectionProvisioner(database, ENVIRONMENT, TEST_CONFIG);
      await expect(
        provisioner.beginAuthorization("ctr_merchant_UNKNOWN00000000000000", TEST_SHOP_DOMAIN),
      ).rejects.toThrow(/No such merchant/);
    });

    it("builds a real Shopify authorize URL with client_id/scope/redirect_uri/state", async () => {
      const { database } = createFakeDatabase();
      const provisioner = new ShopifyConnectionProvisioner(database, ENVIRONMENT, TEST_CONFIG);
      const { authorizeUrl } = await provisioner.beginAuthorization(
        TEST_MERCHANT_ID,
        TEST_SHOP_DOMAIN,
      );
      const url = new URL(authorizeUrl);
      expect(url.origin).toBe(`https://${TEST_SHOP_DOMAIN}`);
      expect(url.pathname).toBe("/admin/oauth/authorize");
      expect(url.searchParams.get("client_id")).toBe(TEST_CONFIG.clientId);
      expect(url.searchParams.get("scope")).toBe(TEST_CONFIG.scopes);
      expect(url.searchParams.get("redirect_uri")).toBe(TEST_CONFIG.redirectUri);
      expect(url.searchParams.get("state")).toBeTruthy();
    });
  });

  describe("completeAuthorization", () => {
    async function beginAndGetState(provisioner: ShopifyConnectionProvisioner): Promise<string> {
      const { authorizeUrl } = await provisioner.beginAuthorization(
        TEST_MERCHANT_ID,
        TEST_SHOP_DOMAIN,
      );
      const state = new URL(authorizeUrl).searchParams.get("state");
      if (state === null) throw new Error("test setup: no state in authorize URL");
      return state;
    }

    it("rejects a callback whose HMAC does not match", async () => {
      const { database } = createFakeDatabase();
      const provisioner = new ShopifyConnectionProvisioner(database, ENVIRONMENT, TEST_CONFIG);
      const state = await beginAndGetState(provisioner);

      const query: Record<string, string> = {
        code: "real-code",
        shop: TEST_SHOP_DOMAIN,
        state,
        timestamp: "1700000000",
        hmac: "0".repeat(64),
      };

      await expect(provisioner.completeAuthorization(query)).rejects.toThrow(
        /HMAC verification failed/,
      );
    });

    it("rejects an unknown or already-used state (replay protection)", async () => {
      const { database } = createFakeDatabase();
      const provisioner = new ShopifyConnectionProvisioner(database, ENVIRONMENT, TEST_CONFIG);

      const base: Record<string, string> = {
        code: "real-code",
        shop: TEST_SHOP_DOMAIN,
        state: "never-minted-state",
        timestamp: "1700000000",
      };
      const query = { ...base, hmac: computeHmac(TEST_CONFIG.clientSecret, base) };

      await expect(provisioner.completeAuthorization(query)).rejects.toThrow(
        /OAuth state is invalid, expired, or already used/,
      );
    });

    it("rejects a callback whose shop does not match the shop the state was minted for", async () => {
      const { database } = createFakeDatabase();
      const provisioner = new ShopifyConnectionProvisioner(database, ENVIRONMENT, TEST_CONFIG);
      const state = await beginAndGetState(provisioner);

      const otherShop = "different-store.myshopify.com";
      const base: Record<string, string> = {
        code: "real-code",
        shop: otherShop,
        state,
        timestamp: "1700000000",
      };
      const query = { ...base, hmac: computeHmac(TEST_CONFIG.clientSecret, base) };

      await expect(provisioner.completeAuthorization(query)).rejects.toThrow(
        /Shop domain does not match/,
      );
    });

    it("exchanges the code, stores the access token, and redeems the state exactly once", async () => {
      const { database, connections } = createFakeDatabase();
      const provisioner = new ShopifyConnectionProvisioner(database, ENVIRONMENT, TEST_CONFIG);
      const state = await beginAndGetState(provisioner);

      stubFetchOnce({
        ok: true,
        body: { access_token: "shpat_real_token_value", scope: TEST_CONFIG.scopes },
      });

      const base: Record<string, string> = {
        code: "real-code",
        shop: TEST_SHOP_DOMAIN,
        state,
        timestamp: "1700000000",
      };
      const query = { ...base, hmac: computeHmac(TEST_CONFIG.clientSecret, base) };

      const result = await provisioner.completeAuthorization(query);
      expect(result).toEqual({ merchantId: TEST_MERCHANT_ID, shopDomain: TEST_SHOP_DOMAIN });

      const stored = connections.get(TEST_MERCHANT_ID);
      expect(stored?.accessToken).toBe("shpat_real_token_value");
      expect(stored?.shopDomain).toBe(TEST_SHOP_DOMAIN);

      // Replaying the exact same callback must fail — the state was consumed.
      await expect(provisioner.completeAuthorization(query)).rejects.toThrow(
        /OAuth state is invalid, expired, or already used/,
      );
    });

    it("surfaces a non-2xx token-exchange response as a plain (non-ShopifyOAuthError) failure", async () => {
      const { database } = createFakeDatabase();
      const provisioner = new ShopifyConnectionProvisioner(database, ENVIRONMENT, TEST_CONFIG);
      const state = await beginAndGetState(provisioner);

      stubFetchOnce({ ok: false, status: 401 });

      const base: Record<string, string> = {
        code: "real-code",
        shop: TEST_SHOP_DOMAIN,
        state,
        timestamp: "1700000000",
      };
      const query = { ...base, hmac: computeHmac(TEST_CONFIG.clientSecret, base) };

      await expect(provisioner.completeAuthorization(query)).rejects.toThrow(
        /Shopify token exchange failed with status 401/,
      );
    });
  });

  describe("getConnectionStatus", () => {
    it("reports connected: false when nothing is stored", async () => {
      const { database } = createFakeDatabase();
      const provisioner = new ShopifyConnectionProvisioner(database, ENVIRONMENT, TEST_CONFIG);
      await expect(provisioner.getConnectionStatus(TEST_MERCHANT_ID)).resolves.toEqual({
        connected: false,
      });
    });

    it("reports the connected store once one is recorded", async () => {
      const { database } = createFakeDatabase();
      const provisioner = new ShopifyConnectionProvisioner(database, ENVIRONMENT, TEST_CONFIG);
      const { authorizeUrl } = await provisioner.beginAuthorization(
        TEST_MERCHANT_ID,
        TEST_SHOP_DOMAIN,
      );
      const state = new URL(authorizeUrl).searchParams.get("state") as string;

      stubFetchOnce({ ok: true, body: { access_token: "shpat_x", scope: TEST_CONFIG.scopes } });
      const base: Record<string, string> = {
        code: "c",
        shop: TEST_SHOP_DOMAIN,
        state,
        timestamp: "1700000000",
      };
      await provisioner.completeAuthorization({
        ...base,
        hmac: computeHmac(TEST_CONFIG.clientSecret, base),
      });

      const status = await provisioner.getConnectionStatus(TEST_MERCHANT_ID);
      expect(status.connected).toBe(true);
      expect(status.shopDomain).toBe(TEST_SHOP_DOMAIN);
      expect(typeof status.connectedAt).toBe("string");
    });
  });
});
