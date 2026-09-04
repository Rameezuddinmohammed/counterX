import { describe, expect, it, afterEach } from "vitest";
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from "jose";
import { createServer } from "./index.js";
import type {
  MerchantActivationResult,
  MerchantActivationStoreLike,
} from "./merchant-activation-store.js";
import { MerchantActivationError } from "./merchant-activation-store.js";
import type { FastifyInstance } from "fastify";

const TEST_ISSUER = "https://dev-jzw3etjxnn3svs56.us.auth0.com/";
const TEST_AUDIENCE = "https://api.counter.dev";
const CLAIMS_NAMESPACE = "https://counter.dev/";
const TEST_MERCHANT_ID = "ctr_merchant_AAAAAAAAAAAAAAAAAAAAAA";
const TEST_OPERATOR_ID = "ctr_operator_AAAAAAAAAAAAAAAAAAAAAA";

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

async function createOperatorToken(claims: Record<string, unknown> = {}): Promise<string> {
  const { privateKey } = await getTestKeys();
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    sub: TEST_OPERATOR_ID,
    [`${CLAIMS_NAMESPACE}actor_kind`]: "operator",
    [`${CLAIMS_NAMESPACE}environment`]: "test",
    [`${CLAIMS_NAMESPACE}scope`]: { kind: "platform" },
    [`${CLAIMS_NAMESPACE}roles`]: ["platform.operator"],
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

async function createMerchantOwnerToken(merchantId: string): Promise<string> {
  const { privateKey } = await getTestKeys();
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    sub: "auth0|test-merchant-user",
    [`${CLAIMS_NAMESPACE}actor_kind`]: "merchant_user",
    [`${CLAIMS_NAMESPACE}environment`]: "test",
    [`${CLAIMS_NAMESPACE}scope`]: { kind: "merchant", merchantId },
    [`${CLAIMS_NAMESPACE}roles`]: ["merchant.owner"],
    [`${CLAIMS_NAMESPACE}assurance`]: "step_up",
  })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(TEST_ISSUER)
    .setAudience(TEST_AUDIENCE)
    .setExpirationTime(now + 3600)
    .setIssuedAt(now)
    .sign(privateKey);
}

/**
 * A platform-scoped SERVICE credential (service.onboarding) — also holds
 * identity.scope.manage on platform scope, same as platform.operator. Used
 * to prove permission membership alone is NOT enough to reach the approve
 * route: it must also fail this actor.kind !== 'operator' check.
 */
async function createServiceOnboardingToken(): Promise<string> {
  const { privateKey } = await getTestKeys();
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    sub: "service|onboarding",
    [`${CLAIMS_NAMESPACE}actor_kind`]: "service",
    [`${CLAIMS_NAMESPACE}environment`]: "test",
    [`${CLAIMS_NAMESPACE}scope`]: { kind: "platform" },
    [`${CLAIMS_NAMESPACE}roles`]: ["service.onboarding"],
    [`${CLAIMS_NAMESPACE}assurance`]: "service_authenticated",
  })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(TEST_ISSUER)
    .setAudience(TEST_AUDIENCE)
    .setExpirationTime(now + 3600)
    .setIssuedAt(now)
    .sign(privateKey);
}

class FakeMerchantActivationStore implements MerchantActivationStoreLike {
  shouldThrow: MerchantActivationError | undefined;
  lastMerchantId: string | undefined;
  lastOperatorId: string | undefined;
  lastReason: string | undefined;

  async approve(
    merchantId: string,
    operatorId: string,
    reason: string,
  ): Promise<MerchantActivationResult> {
    this.lastMerchantId = merchantId;
    this.lastOperatorId = operatorId;
    this.lastReason = reason;
    if (this.shouldThrow !== undefined) {
      throw this.shouldThrow;
    }
    return { merchantId, lifecycleState: "ACTIVE", lifecycleVersion: 7 };
  }
}

describe("merchant-activation routes", () => {
  let server: FastifyInstance | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("an operator can approve a merchant into ACTIVE (200)", async () => {
    const { jwks } = await getTestKeys();
    const store = new FakeMerchantActivationStore();
    server = createServer({ jwks, environment: "test", merchantActivationStore: store });
    await server.ready();

    const token = await createOperatorToken();
    const response = await server.inject({
      method: "POST",
      url: `/control/v1/merchant-applications/${TEST_MERCHANT_ID}/approve`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: "documents verified" },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as MerchantActivationResult;
    expect(body.lifecycleState).toBe("ACTIVE");
    expect(store.lastMerchantId).toBe(TEST_MERCHANT_ID);
    expect(store.lastOperatorId).toBe(TEST_OPERATOR_ID);
    expect(store.lastReason).toBe("documents verified");
  });

  it("a merchant's own session (merchant.owner) gets 403, not access", async () => {
    const { jwks } = await getTestKeys();
    const store = new FakeMerchantActivationStore();
    server = createServer({ jwks, environment: "test", merchantActivationStore: store });
    await server.ready();

    const token = await createMerchantOwnerToken(TEST_MERCHANT_ID);
    const response = await server.inject({
      method: "POST",
      url: `/control/v1/merchant-applications/${TEST_MERCHANT_ID}/approve`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: "self-approving" },
    });

    expect(response.statusCode).toBe(403);
    expect(store.lastMerchantId).toBeUndefined();
  });

  it("a platform-scoped SERVICE credential with identity.scope.manage still gets 403 (not actor.kind 'operator')", async () => {
    const { jwks } = await getTestKeys();
    const store = new FakeMerchantActivationStore();
    server = createServer({ jwks, environment: "test", merchantActivationStore: store });
    await server.ready();

    const token = await createServiceOnboardingToken();
    const response = await server.inject({
      method: "POST",
      url: `/control/v1/merchant-applications/${TEST_MERCHANT_ID}/approve`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: "automated" },
    });

    expect(response.statusCode).toBe(403);
    expect(store.lastMerchantId).toBeUndefined();
  });

  it("an unauthenticated request is rejected (401)", async () => {
    const { jwks } = await getTestKeys();
    const store = new FakeMerchantActivationStore();
    server = createServer({ jwks, environment: "test", merchantActivationStore: store });
    await server.ready();

    const response = await server.inject({
      method: "POST",
      url: `/control/v1/merchant-applications/${TEST_MERCHANT_ID}/approve`,
      payload: { reason: "no auth header" },
    });

    expect(response.statusCode).toBe(401);
  });

  it("requires a non-empty reason (400)", async () => {
    const { jwks } = await getTestKeys();
    const store = new FakeMerchantActivationStore();
    server = createServer({ jwks, environment: "test", merchantActivationStore: store });
    await server.ready();

    const token = await createOperatorToken();
    const response = await server.inject({
      method: "POST",
      url: `/control/v1/merchant-applications/${TEST_MERCHANT_ID}/approve`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 404 when the merchant application doesn't exist", async () => {
    const { jwks } = await getTestKeys();
    const store = new FakeMerchantActivationStore();
    store.shouldThrow = new MerchantActivationError("No such merchant application: whatever");
    server = createServer({ jwks, environment: "test", merchantActivationStore: store });
    await server.ready();

    const token = await createOperatorToken();
    const response = await server.inject({
      method: "POST",
      url: `/control/v1/merchant-applications/${TEST_MERCHANT_ID}/approve`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: "documents verified" },
    });

    expect(response.statusCode).toBe(404);
  });

  it("returns 400 when the merchant isn't in ACTIVATION_REVIEW", async () => {
    const { jwks } = await getTestKeys();
    const store = new FakeMerchantActivationStore();
    store.shouldThrow = new MerchantActivationError("Merchant is not in ACTIVATION_REVIEW");
    server = createServer({ jwks, environment: "test", merchantActivationStore: store });
    await server.ready();

    const token = await createOperatorToken();
    const response = await server.inject({
      method: "POST",
      url: `/control/v1/merchant-applications/${TEST_MERCHANT_ID}/approve`,
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: "documents verified" },
    });

    expect(response.statusCode).toBe(400);
  });
});
