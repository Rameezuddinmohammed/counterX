import { describe, expect, it, afterEach } from "vitest";
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from "jose";
import { createServer } from "./index.js";
import type {
  MerchantWebhookEndpointStoreLike,
  WebhookEndpointRegistration,
  WebhookEndpointStatus,
} from "./merchant-webhook-endpoint-store.js";
import { WebhookEndpointValidationError } from "./merchant-webhook-endpoint-store.js";
import type { FastifyInstance } from "fastify";

const TEST_ISSUER = "https://dev-jzw3etjxnn3svs56.us.auth0.com/";
const TEST_AUDIENCE = "https://api.counter.dev";
const CLAIMS_NAMESPACE = "https://counter.dev/";
const TEST_MERCHANT_ID = "ctr_merchant_AAAAAAAAAAAAAAAAAAAAAA";
const OTHER_MERCHANT_ID = "ctr_merchant_BBBBBBBBBBBBBBBBBBBBBB";

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

async function createMerchantOwnerToken(
  merchantId: string,
  claims: Record<string, unknown> = {},
): Promise<string> {
  const { privateKey } = await getTestKeys();
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    sub: "auth0|test-merchant-user",
    [`${CLAIMS_NAMESPACE}actor_kind`]: "merchant_user",
    [`${CLAIMS_NAMESPACE}environment`]: "test",
    [`${CLAIMS_NAMESPACE}scope`]: { kind: "merchant", merchantId },
    [`${CLAIMS_NAMESPACE}roles`]: ["merchant.owner"],
    [`${CLAIMS_NAMESPACE}assurance`]: "step_up",
    ...claims,
  })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(TEST_ISSUER)
    .setAudience(TEST_AUDIENCE)
    .setExpirationTime(now + 3600)
    .setIssuedAt(now)
    .sign(privateKey);
}

class FakeMerchantWebhookEndpointStore implements MerchantWebhookEndpointStoreLike {
  #status = new Map<string, WebhookEndpointStatus>();
  rejectUrl = false;

  async register(merchantId: string, url: string): Promise<WebhookEndpointRegistration> {
    if (this.rejectUrl) {
      throw new WebhookEndpointValidationError("url must use https://");
    }
    this.#status.set(merchantId, { connected: true, url });
    return { url, signingSecret: "whsec_test_generated_secret" };
  }

  async getStatus(merchantId: string): Promise<WebhookEndpointStatus> {
    return this.#status.get(merchantId) ?? { connected: false };
  }
}

describe("merchant-webhook-endpoint routes", () => {
  let server: FastifyInstance | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("registers with a valid https URL (200), returning a real secret", async () => {
    const { jwks } = await getTestKeys();
    const store = new FakeMerchantWebhookEndpointStore();
    server = createServer({ jwks, environment: "test", merchantWebhookEndpointStore: store });
    await server.ready();

    const token = await createMerchantOwnerToken(TEST_MERCHANT_ID);
    const response = await server.inject({
      method: "POST",
      url: `/control/v1/merchants/${TEST_MERCHANT_ID}/webhook-endpoint`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { url: "https://merchant.example.com/webhooks/counter" },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { url: string; signingSecret: string };
    expect(body.url).toBe("https://merchant.example.com/webhooks/counter");
    expect(body.signingSecret).toBe("whsec_test_generated_secret");
  });

  it("returns 400 when the store rejects the URL", async () => {
    const { jwks } = await getTestKeys();
    const store = new FakeMerchantWebhookEndpointStore();
    store.rejectUrl = true;
    server = createServer({ jwks, environment: "test", merchantWebhookEndpointStore: store });
    await server.ready();

    const token = await createMerchantOwnerToken(TEST_MERCHANT_ID);
    const response = await server.inject({
      method: "POST",
      url: `/control/v1/merchants/${TEST_MERCHANT_ID}/webhook-endpoint`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { url: "http://insecure.example.com/webhook" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("returns 400 for a missing url", async () => {
    const { jwks } = await getTestKeys();
    const store = new FakeMerchantWebhookEndpointStore();
    server = createServer({ jwks, environment: "test", merchantWebhookEndpointStore: store });
    await server.ready();

    const token = await createMerchantOwnerToken(TEST_MERCHANT_ID);
    const response = await server.inject({
      method: "POST",
      url: `/control/v1/merchants/${TEST_MERCHANT_ID}/webhook-endpoint`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: {},
    });
    expect(response.statusCode).toBe(400);
  });

  it("a DIFFERENT merchant's token gets 404, not 403 (existence-hiding)", async () => {
    const { jwks } = await getTestKeys();
    const store = new FakeMerchantWebhookEndpointStore();
    server = createServer({ jwks, environment: "test", merchantWebhookEndpointStore: store });
    await server.ready();

    const token = await createMerchantOwnerToken(OTHER_MERCHANT_ID);
    const response = await server.inject({
      method: "POST",
      url: `/control/v1/merchants/${TEST_MERCHANT_ID}/webhook-endpoint`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { url: "https://merchant.example.com/webhook" },
    });
    expect(response.statusCode).toBe(404);
  });

  it("GET reports disconnected before any registration", async () => {
    const { jwks } = await getTestKeys();
    const store = new FakeMerchantWebhookEndpointStore();
    server = createServer({ jwks, environment: "test", merchantWebhookEndpointStore: store });
    await server.ready();

    const token = await createMerchantOwnerToken(TEST_MERCHANT_ID);
    const response = await server.inject({
      method: "GET",
      url: `/control/v1/merchants/${TEST_MERCHANT_ID}/webhook-endpoint`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { connected: boolean };
    expect(body.connected).toBe(false);
  });

  it("GET after registration reports connected and NEVER includes the secret", async () => {
    const { jwks } = await getTestKeys();
    const store = new FakeMerchantWebhookEndpointStore();
    server = createServer({ jwks, environment: "test", merchantWebhookEndpointStore: store });
    await server.ready();

    const token = await createMerchantOwnerToken(TEST_MERCHANT_ID);
    await server.inject({
      method: "POST",
      url: `/control/v1/merchants/${TEST_MERCHANT_ID}/webhook-endpoint`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { url: "https://merchant.example.com/webhook" },
    });
    const response = await server.inject({
      method: "GET",
      url: `/control/v1/merchants/${TEST_MERCHANT_ID}/webhook-endpoint`,
      headers: { authorization: `Bearer ${token}` },
    });
    const body = JSON.parse(response.body) as { connected: boolean; url?: string };
    expect(body.connected).toBe(true);
    expect(body.url).toBe("https://merchant.example.com/webhook");
    expect(body).not.toHaveProperty("signingSecret");
  });
});
