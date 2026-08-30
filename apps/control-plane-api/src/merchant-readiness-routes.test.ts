import { describe, expect, it, afterEach } from "vitest";
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from "jose";
import { sha256Digest } from "@counter/domain";
import { createServer } from "./index.js";
import type {
  MerchantReadinessServiceLike,
  MerchantReadinessSummary,
} from "./merchant-readiness-store.js";
import { MerchantReadinessError } from "./merchant-readiness-store.js";
import type { FastifyInstance } from "fastify";

const TEST_DIGEST = sha256Digest(new TextEncoder().encode("test"));

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

async function createMerchantOwnerToken(merchantId: string): Promise<string> {
  const { privateKey } = await getTestKeys();
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    sub: "auth0|test-merchant-user",
    [`${CLAIMS_NAMESPACE}actor_kind`]: "merchant_user",
    [`${CLAIMS_NAMESPACE}environment`]: "test",
    [`${CLAIMS_NAMESPACE}scope`]: { kind: "merchant", merchantId },
    [`${CLAIMS_NAMESPACE}roles`]: ["merchant.owner"],
    [`${CLAIMS_NAMESPACE}assurance`]: "session",
  })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(TEST_ISSUER)
    .setAudience(TEST_AUDIENCE)
    .setExpirationTime(now + 3600)
    .setIssuedAt(now)
    .sign(privateKey);
}

class FakeMerchantReadinessService implements MerchantReadinessServiceLike {
  nextSummary: MerchantReadinessSummary | undefined;
  shouldThrow = false;

  async evaluate(merchantId: string): Promise<MerchantReadinessSummary> {
    if (this.shouldThrow) {
      throw new MerchantReadinessError(`No such merchant application: ${merchantId}`);
    }
    return (
      this.nextSummary ?? {
        merchantId,
        isReady: false,
        overallStatus: "Blocking",
        checks: [
          { checkKind: "connector_health", status: "Advisory", reason: "healthy" },
          { checkKind: "payment_configured", status: "Blocking", reason: "not configured" },
        ],
        lifecycleState: "VERIFYING",
        versionBindings: {
          connectorVersion: "manual-catalog@1",
          mappingSchemaHash: TEST_DIGEST,
          policyVersion: "1.0.0-default",
          protocolVersion: "0.1",
          paymentProviderVersion: "none",
        },
        evaluatedAt: new Date().toISOString(),
      }
    );
  }
}

describe("merchant-readiness routes", () => {
  let server: FastifyInstance | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("returns the readiness summary (200)", async () => {
    const { jwks } = await getTestKeys();
    const service = new FakeMerchantReadinessService();
    server = createServer({ jwks, environment: "test", merchantReadinessService: service });
    await server.ready();

    const token = await createMerchantOwnerToken(TEST_MERCHANT_ID);
    const response = await server.inject({
      method: "GET",
      url: `/control/v1/merchant-applications/${TEST_MERCHANT_ID}/readiness`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { isReady: boolean; overallStatus: string };
    expect(body.isReady).toBe(false);
    expect(body.overallStatus).toBe("Blocking");
  });

  it("reflects SANDBOX_READY once the service reports isReady", async () => {
    const { jwks } = await getTestKeys();
    const service = new FakeMerchantReadinessService();
    service.nextSummary = {
      merchantId: TEST_MERCHANT_ID,
      isReady: true,
      overallStatus: "Advisory",
      checks: [],
      lifecycleState: "SANDBOX_READY",
      versionBindings: {
        connectorVersion: "manual-catalog@1",
        mappingSchemaHash: TEST_DIGEST,
        policyVersion: "1.0.0-default",
        protocolVersion: "0.1",
        paymentProviderVersion: "razorpay-byo@1",
      },
      evaluatedAt: new Date().toISOString(),
    };
    server = createServer({ jwks, environment: "test", merchantReadinessService: service });
    await server.ready();

    const token = await createMerchantOwnerToken(TEST_MERCHANT_ID);
    const response = await server.inject({
      method: "GET",
      url: `/control/v1/merchant-applications/${TEST_MERCHANT_ID}/readiness`,
      headers: { authorization: `Bearer ${token}` },
    });
    const body = JSON.parse(response.body) as { isReady: boolean; lifecycleState: string };
    expect(body.isReady).toBe(true);
    expect(body.lifecycleState).toBe("SANDBOX_READY");
  });

  it("a nonexistent merchant returns 404", async () => {
    const { jwks } = await getTestKeys();
    const service = new FakeMerchantReadinessService();
    service.shouldThrow = true;
    server = createServer({ jwks, environment: "test", merchantReadinessService: service });
    await server.ready();

    const token = await createMerchantOwnerToken(TEST_MERCHANT_ID);
    const response = await server.inject({
      method: "GET",
      url: `/control/v1/merchant-applications/${TEST_MERCHANT_ID}/readiness`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(404);
  });

  it("a DIFFERENT merchant's token gets 404, not 403 (existence-hiding)", async () => {
    const { jwks } = await getTestKeys();
    const service = new FakeMerchantReadinessService();
    server = createServer({ jwks, environment: "test", merchantReadinessService: service });
    await server.ready();

    const token = await createMerchantOwnerToken(OTHER_MERCHANT_ID);
    const response = await server.inject({
      method: "GET",
      url: `/control/v1/merchant-applications/${TEST_MERCHANT_ID}/readiness`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(404);
  });
});
