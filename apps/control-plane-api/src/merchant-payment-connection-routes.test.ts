import { describe, expect, it, afterEach } from "vitest";
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from "jose";
import { createServer } from "./index.js";
import type {
  MerchantPaymentConnectionStoreLike,
  PaymentConnectionStatus,
  RazorpayConnectionInput,
} from "./merchant-payment-connection-store.js";
import { PaymentConnectionError } from "./merchant-payment-connection-store.js";
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

class FakeMerchantPaymentConnectionStore implements MerchantPaymentConnectionStoreLike {
  #status = new Map<string, PaymentConnectionStatus>();
  rejectVerification = false;

  async connectRazorpay(
    merchantId: string,
    input: RazorpayConnectionInput,
  ): Promise<PaymentConnectionStatus> {
    if (this.rejectVerification) {
      throw new PaymentConnectionError("Razorpay rejected these credentials (HTTP 401)");
    }
    const status: PaymentConnectionStatus = {
      connected: true,
      provider: "razorpay",
      keyId: input.keyId,
      verifiedAt: new Date().toISOString(),
    };
    this.#status.set(merchantId, status);
    return status;
  }

  async getConnectionStatus(merchantId: string): Promise<PaymentConnectionStatus> {
    return this.#status.get(merchantId) ?? { connected: false };
  }
}

describe("merchant-payment-connection routes", () => {
  let server: FastifyInstance | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("connects with valid credentials (200)", async () => {
    const { jwks } = await getTestKeys();
    const store = new FakeMerchantPaymentConnectionStore();
    server = createServer({ jwks, environment: "test", merchantPaymentConnectionStore: store });
    await server.ready();

    const token = await createMerchantOwnerToken(TEST_MERCHANT_ID);
    const response = await server.inject({
      method: "POST",
      url: `/control/v1/merchant-applications/${TEST_MERCHANT_ID}/payment-connection`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { keyId: "rzp_test_abc", keySecret: "secret" },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { connected: boolean; keyId: string };
    expect(body.connected).toBe(true);
    expect(body.keyId).toBe("rzp_test_abc");
  });

  it("returns 400 when Razorpay rejects the credentials", async () => {
    const { jwks } = await getTestKeys();
    const store = new FakeMerchantPaymentConnectionStore();
    store.rejectVerification = true;
    server = createServer({ jwks, environment: "test", merchantPaymentConnectionStore: store });
    await server.ready();

    const token = await createMerchantOwnerToken(TEST_MERCHANT_ID);
    const response = await server.inject({
      method: "POST",
      url: `/control/v1/merchant-applications/${TEST_MERCHANT_ID}/payment-connection`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { keyId: "rzp_test_bad", keySecret: "wrong" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("returns 400 for a missing keySecret", async () => {
    const { jwks } = await getTestKeys();
    const store = new FakeMerchantPaymentConnectionStore();
    server = createServer({ jwks, environment: "test", merchantPaymentConnectionStore: store });
    await server.ready();

    const token = await createMerchantOwnerToken(TEST_MERCHANT_ID);
    const response = await server.inject({
      method: "POST",
      url: `/control/v1/merchant-applications/${TEST_MERCHANT_ID}/payment-connection`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { keyId: "rzp_test_abc" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("a DIFFERENT merchant's token gets 404, not 403 (existence-hiding)", async () => {
    const { jwks } = await getTestKeys();
    const store = new FakeMerchantPaymentConnectionStore();
    server = createServer({ jwks, environment: "test", merchantPaymentConnectionStore: store });
    await server.ready();

    const token = await createMerchantOwnerToken(OTHER_MERCHANT_ID);
    const response = await server.inject({
      method: "POST",
      url: `/control/v1/merchant-applications/${TEST_MERCHANT_ID}/payment-connection`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { keyId: "rzp_test_abc", keySecret: "secret" },
    });
    expect(response.statusCode).toBe(404);
  });

  it("GET reports disconnected before any connection is made", async () => {
    const { jwks } = await getTestKeys();
    const store = new FakeMerchantPaymentConnectionStore();
    server = createServer({ jwks, environment: "test", merchantPaymentConnectionStore: store });
    await server.ready();

    const token = await createMerchantOwnerToken(TEST_MERCHANT_ID);
    const response = await server.inject({
      method: "GET",
      url: `/control/v1/merchant-applications/${TEST_MERCHANT_ID}/payment-connection`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { connected: boolean };
    expect(body.connected).toBe(false);
  });

  it("GET after a successful connect reports connected (200)", async () => {
    const { jwks } = await getTestKeys();
    const store = new FakeMerchantPaymentConnectionStore();
    server = createServer({ jwks, environment: "test", merchantPaymentConnectionStore: store });
    await server.ready();

    const token = await createMerchantOwnerToken(TEST_MERCHANT_ID);
    await server.inject({
      method: "POST",
      url: `/control/v1/merchant-applications/${TEST_MERCHANT_ID}/payment-connection`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { keyId: "rzp_test_abc", keySecret: "secret" },
    });
    const response = await server.inject({
      method: "GET",
      url: `/control/v1/merchant-applications/${TEST_MERCHANT_ID}/payment-connection`,
      headers: { authorization: `Bearer ${token}` },
    });
    const body = JSON.parse(response.body) as { connected: boolean };
    expect(body.connected).toBe(true);
  });
});
