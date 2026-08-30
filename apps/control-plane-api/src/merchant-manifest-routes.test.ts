import { describe, expect, it, afterEach } from "vitest";
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from "jose";
import { sha256Digest } from "@counter/domain";
import { createServer } from "./index.js";
import type { MerchantManifestStoreLike, PersistedManifest } from "./merchant-manifest-store.js";
import { MerchantManifestError } from "./merchant-manifest-store.js";
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

function fixtureManifest(merchantId: string): PersistedManifest {
  return {
    merchantId,
    manifestVersion: "1.0.0",
    capabilities: [
      "quote.create",
      "quote.accept",
      "payment.initiate",
      "payment.confirm",
      "refund.initiate",
    ],
    fulfillmentCapabilities: ["fulfillment.physical.ship"],
    versionBindings: {
      connectorVersion: "manual-catalog@1",
      mappingSchemaHash: TEST_DIGEST,
      policyVersion: "1.0.0-default",
      protocolVersion: "0.1",
      paymentProviderVersion: "razorpay-byo@1",
    },
    generatedAt: new Date().toISOString(),
    signatureDigest: TEST_DIGEST,
  };
}

class FakeMerchantManifestStore implements MerchantManifestStoreLike {
  #manifests = new Map<string, PersistedManifest>();
  shouldThrowOnGenerate: string | undefined;

  async generateAndPersist(merchantId: string): Promise<PersistedManifest> {
    if (this.shouldThrowOnGenerate !== undefined) {
      throw new MerchantManifestError(this.shouldThrowOnGenerate);
    }
    const manifest = fixtureManifest(merchantId);
    this.#manifests.set(merchantId, manifest);
    return manifest;
  }

  async getManifest(merchantId: string): Promise<PersistedManifest | undefined> {
    return this.#manifests.get(merchantId);
  }
}

describe("merchant-manifest routes", () => {
  let server: FastifyInstance | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("generates and persists a manifest (201)", async () => {
    const { jwks } = await getTestKeys();
    const store = new FakeMerchantManifestStore();
    server = createServer({ jwks, environment: "test", merchantManifestStore: store });
    await server.ready();

    const token = await createMerchantOwnerToken(TEST_MERCHANT_ID);
    const response = await server.inject({
      method: "POST",
      url: `/control/v1/merchant-applications/${TEST_MERCHANT_ID}/manifest`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body) as { capabilities: string[] };
    expect(body.capabilities).toHaveLength(5);
  });

  it("returns 400 when not yet SANDBOX_READY", async () => {
    const { jwks } = await getTestKeys();
    const store = new FakeMerchantManifestStore();
    store.shouldThrowOnGenerate = "Merchant is not SANDBOX_READY yet";
    server = createServer({ jwks, environment: "test", merchantManifestStore: store });
    await server.ready();

    const token = await createMerchantOwnerToken(TEST_MERCHANT_ID);
    const response = await server.inject({
      method: "POST",
      url: `/control/v1/merchant-applications/${TEST_MERCHANT_ID}/manifest`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(400);
  });

  it("GET returns 404 before any manifest is generated", async () => {
    const { jwks } = await getTestKeys();
    const store = new FakeMerchantManifestStore();
    server = createServer({ jwks, environment: "test", merchantManifestStore: store });
    await server.ready();

    const token = await createMerchantOwnerToken(TEST_MERCHANT_ID);
    const response = await server.inject({
      method: "GET",
      url: `/control/v1/merchant-applications/${TEST_MERCHANT_ID}/manifest`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(404);
  });

  it("GET returns the persisted manifest after generation (200)", async () => {
    const { jwks } = await getTestKeys();
    const store = new FakeMerchantManifestStore();
    server = createServer({ jwks, environment: "test", merchantManifestStore: store });
    await server.ready();

    const token = await createMerchantOwnerToken(TEST_MERCHANT_ID);
    await server.inject({
      method: "POST",
      url: `/control/v1/merchant-applications/${TEST_MERCHANT_ID}/manifest`,
      headers: { authorization: `Bearer ${token}` },
    });
    const response = await server.inject({
      method: "GET",
      url: `/control/v1/merchant-applications/${TEST_MERCHANT_ID}/manifest`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { manifestVersion: string };
    expect(body.manifestVersion).toBe("1.0.0");
  });

  it("a DIFFERENT merchant's token gets 404, not 403 (existence-hiding)", async () => {
    const { jwks } = await getTestKeys();
    const store = new FakeMerchantManifestStore();
    server = createServer({ jwks, environment: "test", merchantManifestStore: store });
    await server.ready();

    const token = await createMerchantOwnerToken(OTHER_MERCHANT_ID);
    const response = await server.inject({
      method: "POST",
      url: `/control/v1/merchant-applications/${TEST_MERCHANT_ID}/manifest`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(404);
  });
});
