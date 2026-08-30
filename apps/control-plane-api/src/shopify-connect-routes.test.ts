import { describe, expect, it, afterEach } from "vitest";
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from "jose";
import { createServer } from "./index.js";
import {
  ShopifyOAuthError,
  type ShopifyConnectionProvisionerLike,
  type BeginAuthorizationResult,
  type CompleteAuthorizationResult,
  type ShopifyConnectionStatus,
} from "./shopify-connection-store.js";
import type { FastifyInstance } from "fastify";

// --- Test helpers ---

const TEST_ISSUER = "https://dev-jzw3etjxnn3svs56.us.auth0.com/";
const TEST_AUDIENCE = "https://api.counter.dev";
const CLAIMS_NAMESPACE = "https://counter.dev/";
const TEST_MERCHANT_ID = "ctr_merchant_AAAAAAAAAAAAAAAAAAAAAA";
const OTHER_MERCHANT_ID = "ctr_merchant_BBBBBBBBBBBBBBBBBBBBBB";
const TEST_SHOP_DOMAIN = "test-store.myshopify.com";

interface TestKeyPair {
  privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
  jwks: ReturnType<typeof createLocalJWKSet>;
}

let testKeys: TestKeyPair | undefined;

async function getTestKeys(): Promise<TestKeyPair> {
  if (testKeys !== undefined) return testKeys;
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(publicKey);
  const jwks = createLocalJWKSet({ keys: [{ ...publicJwk, alg: "RS256", use: "sig" }] });
  testKeys = { privateKey, jwks };
  return testKeys;
}

async function createMerchantUserToken(
  merchantId: string,
  roles: readonly string[],
  claims: Record<string, unknown> = {},
): Promise<string> {
  const { privateKey } = await getTestKeys();
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    sub: "auth0|test-merchant-user",
    [`${CLAIMS_NAMESPACE}actor_kind`]: "merchant_user",
    [`${CLAIMS_NAMESPACE}environment`]: "test",
    [`${CLAIMS_NAMESPACE}scope`]: { kind: "merchant", merchantId },
    [`${CLAIMS_NAMESPACE}roles`]: roles,
    [`${CLAIMS_NAMESPACE}assurance`]: "session",
    ...claims,
  })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(TEST_ISSUER)
    .setAudience(TEST_AUDIENCE)
    .setExpirationTime(now + 3600)
    .setIssuedAt(now)
    .sign(privateKey);
}

class FakeShopifyConnectionProvisioner implements ShopifyConnectionProvisionerLike {
  readonly beginAuthorizationCalls: Array<{ merchantId: string; shopDomain: string }> = [];
  nextAuthorizeUrl = `https://${TEST_SHOP_DOMAIN}/admin/oauth/authorize?client_id=fake-client&state=fake-state`;
  nextCompleteResult: CompleteAuthorizationResult | Error = {
    merchantId: TEST_MERCHANT_ID,
    shopDomain: TEST_SHOP_DOMAIN,
  };
  connectionStatuses = new Map<string, ShopifyConnectionStatus>();

  async beginAuthorization(
    merchantId: string,
    shopDomain: string,
  ): Promise<BeginAuthorizationResult> {
    this.beginAuthorizationCalls.push({ merchantId, shopDomain });
    return { authorizeUrl: this.nextAuthorizeUrl };
  }

  async completeAuthorization(): Promise<CompleteAuthorizationResult> {
    if (this.nextCompleteResult instanceof Error) {
      throw this.nextCompleteResult;
    }
    return this.nextCompleteResult;
  }

  async getConnectionStatus(merchantId: string): Promise<ShopifyConnectionStatus> {
    return this.connectionStatuses.get(merchantId) ?? { connected: false };
  }
}

// --- Tests ---

describe("shopify-connect routes", () => {
  let server: FastifyInstance | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  describe("GET /shopify/authorize", () => {
    it("unauthenticated request returns 401", async () => {
      const { jwks } = await getTestKeys();
      server = createServer({
        jwks,
        environment: "test",
        shopifyConnectionProvisioner: new FakeShopifyConnectionProvisioner(),
      });
      await server.ready();

      const response = await server.inject({
        method: "GET",
        url: `/control/v1/merchants/${TEST_MERCHANT_ID}/shopify/authorize?shop=${TEST_SHOP_DOMAIN}`,
      });
      expect(response.statusCode).toBe(401);
    });

    it("a merchant-scoped token for a DIFFERENT merchant gets 404, not 403 (existence-hiding)", async () => {
      const { jwks } = await getTestKeys();
      server = createServer({
        jwks,
        environment: "test",
        shopifyConnectionProvisioner: new FakeShopifyConnectionProvisioner(),
      });
      await server.ready();

      const token = await createMerchantUserToken(OTHER_MERCHANT_ID, ["merchant.integration"]);
      const response = await server.inject({
        method: "GET",
        url: `/control/v1/merchants/${TEST_MERCHANT_ID}/shopify/authorize?shop=${TEST_SHOP_DOMAIN}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body) as { error: { code: string } };
      expect(body.error.code).toBe("NOT_FOUND");
    });

    it("a role without identity.service_identity.manage (merchant.read_only) is denied 403", async () => {
      const { jwks } = await getTestKeys();
      server = createServer({
        jwks,
        environment: "test",
        shopifyConnectionProvisioner: new FakeShopifyConnectionProvisioner(),
      });
      await server.ready();

      const token = await createMerchantUserToken(TEST_MERCHANT_ID, ["merchant.read_only"]);
      const response = await server.inject({
        method: "GET",
        url: `/control/v1/merchants/${TEST_MERCHANT_ID}/shopify/authorize?shop=${TEST_SHOP_DOMAIN}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(403);
    });

    it("missing 'shop' query param returns 400", async () => {
      const { jwks } = await getTestKeys();
      server = createServer({
        jwks,
        environment: "test",
        shopifyConnectionProvisioner: new FakeShopifyConnectionProvisioner(),
      });
      await server.ready();

      const token = await createMerchantUserToken(TEST_MERCHANT_ID, ["merchant.integration"]);
      const response = await server.inject({
        method: "GET",
        url: `/control/v1/merchants/${TEST_MERCHANT_ID}/shopify/authorize`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(400);
    });

    it("a merchant-owner token for its OWN merchant is redirected to the provisioner's authorize URL", async () => {
      const { jwks } = await getTestKeys();
      const provisioner = new FakeShopifyConnectionProvisioner();
      server = createServer({
        jwks,
        environment: "test",
        shopifyConnectionProvisioner: provisioner,
      });
      await server.ready();

      const token = await createMerchantUserToken(TEST_MERCHANT_ID, ["merchant.owner"]);
      const response = await server.inject({
        method: "GET",
        url: `/control/v1/merchants/${TEST_MERCHANT_ID}/shopify/authorize?shop=${TEST_SHOP_DOMAIN}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe(provisioner.nextAuthorizeUrl);
      expect(provisioner.beginAuthorizationCalls).toEqual([
        { merchantId: TEST_MERCHANT_ID, shopDomain: TEST_SHOP_DOMAIN },
      ]);
    });

    it("propagates a ShopifyOAuthError from the provisioner as 400", async () => {
      const { jwks } = await getTestKeys();
      class RejectingProvisioner extends FakeShopifyConnectionProvisioner {
        override async beginAuthorization(): Promise<BeginAuthorizationResult> {
          throw new ShopifyOAuthError("Invalid Shopify shop domain: not-a-shop");
        }
      }
      const rejecting = new RejectingProvisioner();
      server = createServer({ jwks, environment: "test", shopifyConnectionProvisioner: rejecting });
      await server.ready();

      const token = await createMerchantUserToken(TEST_MERCHANT_ID, ["merchant.owner"]);
      const response = await server.inject({
        method: "GET",
        url: `/control/v1/merchants/${TEST_MERCHANT_ID}/shopify/authorize?shop=not-a-shop`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe("GET /shopify/callback (deliberately unauthenticated)", () => {
    it("works without any Authorization header — proves the dynamic-path skip-auth match works", async () => {
      const { jwks } = await getTestKeys();
      const provisioner = new FakeShopifyConnectionProvisioner();
      server = createServer({
        jwks,
        environment: "test",
        shopifyConnectionProvisioner: provisioner,
      });
      await server.ready();

      const response = await server.inject({
        method: "GET",
        url:
          `/control/v1/merchants/${TEST_MERCHANT_ID}/shopify/callback` +
          `?code=fake-code&hmac=fake-hmac&shop=${TEST_SHOP_DOMAIN}&state=fake-state&timestamp=123`,
      });
      // Must NOT be 401 — no Authorization header was sent. A 401 here would
      // mean the dynamic-path skip-auth registration silently failed and
      // Shopify's own redirect would never reach this route in production.
      expect(response.statusCode).not.toBe(401);
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("/shopify?shopify=connected");
    });

    it("redirects with an error flag when the provisioner rejects the callback", async () => {
      const { jwks } = await getTestKeys();
      const provisioner = new FakeShopifyConnectionProvisioner();
      provisioner.nextCompleteResult = new ShopifyOAuthError("Callback HMAC verification failed");
      server = createServer({
        jwks,
        environment: "test",
        shopifyConnectionProvisioner: provisioner,
      });
      await server.ready();

      const response = await server.inject({
        method: "GET",
        url:
          `/control/v1/merchants/${TEST_MERCHANT_ID}/shopify/callback` +
          `?code=fake-code&hmac=bad-hmac&shop=${TEST_SHOP_DOMAIN}&state=fake-state`,
      });
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("/shopify?shopify=error");
    });

    it("an unexpected (non-ShopifyOAuthError) failure surfaces as 500, not a silent redirect", async () => {
      const { jwks } = await getTestKeys();
      const provisioner = new FakeShopifyConnectionProvisioner();
      provisioner.nextCompleteResult = new Error("Shopify token exchange failed with status 500");
      server = createServer({
        jwks,
        environment: "test",
        shopifyConnectionProvisioner: provisioner,
      });
      await server.ready();

      const response = await server.inject({
        method: "GET",
        url: `/control/v1/merchants/${TEST_MERCHANT_ID}/shopify/callback?code=c&hmac=h&shop=${TEST_SHOP_DOMAIN}&state=s`,
      });
      expect(response.statusCode).toBe(500);
    });
  });

  describe("GET /shopify/connection", () => {
    it("a merchant-scoped token for a DIFFERENT merchant gets 404, not 403 (existence-hiding)", async () => {
      const { jwks } = await getTestKeys();
      server = createServer({
        jwks,
        environment: "test",
        shopifyConnectionProvisioner: new FakeShopifyConnectionProvisioner(),
      });
      await server.ready();

      const token = await createMerchantUserToken(OTHER_MERCHANT_ID, ["merchant.read_only"]);
      const response = await server.inject({
        method: "GET",
        url: `/control/v1/merchants/${TEST_MERCHANT_ID}/shopify/connection`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(404);
    });

    it("reports connected: false when no connection exists", async () => {
      const { jwks } = await getTestKeys();
      server = createServer({
        jwks,
        environment: "test",
        shopifyConnectionProvisioner: new FakeShopifyConnectionProvisioner(),
      });
      await server.ready();

      const token = await createMerchantUserToken(TEST_MERCHANT_ID, ["merchant.read_only"]);
      const response = await server.inject({
        method: "GET",
        url: `/control/v1/merchants/${TEST_MERCHANT_ID}/shopify/connection`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ connected: false });
    });

    it("reports the connected store once one is recorded", async () => {
      const { jwks } = await getTestKeys();
      const provisioner = new FakeShopifyConnectionProvisioner();
      provisioner.connectionStatuses.set(TEST_MERCHANT_ID, {
        connected: true,
        shopDomain: TEST_SHOP_DOMAIN,
        connectedAt: "2026-01-01T00:00:00.000Z",
      });
      server = createServer({
        jwks,
        environment: "test",
        shopifyConnectionProvisioner: provisioner,
      });
      await server.ready();

      const token = await createMerchantUserToken(TEST_MERCHANT_ID, ["merchant.read_only"]);
      const response = await server.inject({
        method: "GET",
        url: `/control/v1/merchants/${TEST_MERCHANT_ID}/shopify/connection`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({
        connected: true,
        shopDomain: TEST_SHOP_DOMAIN,
        connectedAt: "2026-01-01T00:00:00.000Z",
      });
    });
  });
});
