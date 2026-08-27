import { describe, expect, it, afterEach } from "vitest";
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from "jose";
import { createServer } from "./index.js";
import { createInMemoryPolicyStore, createDefaultPolicyCompiler } from "./policy-routes.js";
import type { FastifyInstance } from "fastify";

// --- Test helpers ---

const TEST_ISSUER = "https://dev-jzw3etjxnn3svs56.us.auth0.com/";
const TEST_AUDIENCE = "https://api.counter.dev";
const CLAIMS_NAMESPACE = "https://counter.dev/";
const TEST_MERCHANT_ID = "ctr_merchant_AAAAAAAAAAAAAAAAAAAAAA";

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

async function createTestToken(claims: Record<string, unknown> = {}): Promise<string> {
  const { privateKey } = await getTestKeys();
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    sub: "ctr_merchant-user_AAAAAAAAAAAAAAAAAAAAAA",
    [`${CLAIMS_NAMESPACE}actor_kind`]: "merchant_user",
    [`${CLAIMS_NAMESPACE}environment`]: "test",
    [`${CLAIMS_NAMESPACE}scope`]: { kind: "merchant", merchantId: TEST_MERCHANT_ID },
    [`${CLAIMS_NAMESPACE}roles`]: ["merchant.owner"],
    [`${CLAIMS_NAMESPACE}assurance`]: "session",
    // merchant.owner carries both read and manage in the permission catalog.
    // The manage permission is required to POST (create/update) policy.
    permissions: ["identity.scope.read", "identity.scope.manage"],
    ...claims,
  })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(TEST_ISSUER)
    .setAudience(TEST_AUDIENCE)
    .setExpirationTime(now + 3600)
    .setIssuedAt(now)
    .sign(privateKey);
}

const VALID_POLICY_BODY = {
  policyVersion: "1.0.0",
  rules: [
    {
      ruleId: "rule_amount_limit",
      category: "transaction",
      constraint: "max_amount",
      parameters: { maxAmount: 10000, currency: "USD" },
      enabled: true,
    },
  ],
  effectiveFrom: "2024-01-01T00:00:00.000Z",
  effectiveUntil: null,
};

// --- Tests ---

describe("policy routes", () => {
  let server: FastifyInstance | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  describe("authorization", () => {
    it("unauthenticated POST /policy returns 401", async () => {
      const { jwks } = await getTestKeys();
      server = createServer({ jwks, environment: "test" });
      await server.ready();

      const response = await server.inject({
        method: "POST",
        url: `/control/v1/merchants/${TEST_MERCHANT_ID}/policy`,
        payload: VALID_POLICY_BODY,
      });
      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as { error: { code: string } };
      expect(body.error.code).toBe("UNAUTHENTICATED");
    });

    it("unauthenticated GET /policy returns 401", async () => {
      const { jwks } = await getTestKeys();
      server = createServer({ jwks, environment: "test" });
      await server.ready();

      const response = await server.inject({
        method: "GET",
        url: `/control/v1/merchants/${TEST_MERCHANT_ID}/policy`,
      });
      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as { error: { code: string } };
      expect(body.error.code).toBe("UNAUTHENTICATED");
    });
  });

  describe("write-permission enforcement (bug 1c)", () => {
    it("POST /policy with a read-only token (no identity.scope.manage) returns 403", async () => {
      const { jwks } = await getTestKeys();
      const store = createInMemoryPolicyStore();
      server = createServer({ jwks, environment: "test", policyStore: store });
      await server.ready();

      // A token whose role only grants read (merchant.read_only) must NOT be
      // able to write. Effective permissions are derived from roles, so the
      // role - not a decorative permissions claim - determines authorization.
      const token = await createTestToken({
        [`${CLAIMS_NAMESPACE}roles`]: ["merchant.read_only"],
      });
      const response = await server.inject({
        method: "POST",
        url: `/control/v1/merchants/${TEST_MERCHANT_ID}/policy`,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: VALID_POLICY_BODY,
      });
      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body) as { error: { code: string } };
      expect(body.error.code).toBe("UNAUTHORIZED");
      // The read-only write must not have persisted anything.
      expect(store.get(TEST_MERCHANT_ID)).toBeUndefined();
    });

    it("POST /policy with a token that has identity.scope.manage returns 201", async () => {
      const { jwks } = await getTestKeys();
      const store = createInMemoryPolicyStore();
      server = createServer({ jwks, environment: "test", policyStore: store });
      await server.ready();

      const token = await createTestToken({
        permissions: ["identity.scope.read", "identity.scope.manage"],
      });
      const response = await server.inject({
        method: "POST",
        url: `/control/v1/merchants/${TEST_MERCHANT_ID}/policy`,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: VALID_POLICY_BODY,
      });
      expect(response.statusCode).toBe(201);
      expect(store.get(TEST_MERCHANT_ID)?.config.policyVersion).toBe("1.0.0");
    });

    it("GET /policy still succeeds with only identity.scope.read", async () => {
      const { jwks } = await getTestKeys();
      const store = createInMemoryPolicyStore();
      server = createServer({ jwks, environment: "test", policyStore: store });
      await server.ready();

      // Seed a policy with a manage token.
      const manageToken = await createTestToken();
      await server.inject({
        method: "POST",
        url: `/control/v1/merchants/${TEST_MERCHANT_ID}/policy`,
        headers: { authorization: `Bearer ${manageToken}`, "content-type": "application/json" },
        payload: VALID_POLICY_BODY,
      });

      const readToken = await createTestToken({
        [`${CLAIMS_NAMESPACE}roles`]: ["merchant.read_only"],
      });
      const response = await server.inject({
        method: "GET",
        url: `/control/v1/merchants/${TEST_MERCHANT_ID}/policy`,
        headers: { authorization: `Bearer ${readToken}` },
      });
      expect(response.statusCode).toBe(200);
    });

    it("cross-tenant POST is denied 403 (merchant A token writing merchant B policy)", async () => {
      const { jwks } = await getTestKeys();
      const store = createInMemoryPolicyStore();
      server = createServer({ jwks, environment: "test", policyStore: store });
      await server.ready();

      const OTHER_MERCHANT_ID = "ctr_merchant_BBBBBBBBBBBBBBBBBBBBBB";
      // Token scoped to merchant A (TEST_MERCHANT_ID) with full manage rights.
      const token = await createTestToken({
        [`${CLAIMS_NAMESPACE}scope`]: { kind: "merchant", merchantId: TEST_MERCHANT_ID },
        permissions: ["identity.scope.read", "identity.scope.manage"],
      });
      const response = await server.inject({
        method: "POST",
        url: `/control/v1/merchants/${OTHER_MERCHANT_ID}/policy`,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: VALID_POLICY_BODY,
      });
      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body) as { error: { code: string } };
      expect(body.error.code).toBe("FORBIDDEN");
      // Nothing should have been written for the other merchant.
      expect(store.get(OTHER_MERCHANT_ID)).toBeUndefined();
    });
  });

  describe("validation", () => {
    it("POST /policy without policyVersion returns 400", async () => {
      const { jwks } = await getTestKeys();
      server = createServer({ jwks, environment: "test" });
      await server.ready();

      const token = await createTestToken();
      const response = await server.inject({
        method: "POST",
        url: `/control/v1/merchants/${TEST_MERCHANT_ID}/policy`,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: { rules: [], effectiveFrom: "2024-01-01T00:00:00.000Z" },
      });
      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("INVALID_FORMAT");
      expect(body.error.message).toContain("policyVersion");
    });

    it("POST /policy without rules array returns 400", async () => {
      const { jwks } = await getTestKeys();
      server = createServer({ jwks, environment: "test" });
      await server.ready();

      const token = await createTestToken();
      const response = await server.inject({
        method: "POST",
        url: `/control/v1/merchants/${TEST_MERCHANT_ID}/policy`,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: { policyVersion: "1.0.0", effectiveFrom: "2024-01-01T00:00:00.000Z" },
      });
      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as { error: { code: string } };
      expect(body.error.code).toBe("INVALID_FORMAT");
    });

    it("POST /policy with empty rules returns 400 validation failure", async () => {
      const { jwks } = await getTestKeys();
      server = createServer({ jwks, environment: "test" });
      await server.ready();

      const token = await createTestToken();
      const response = await server.inject({
        method: "POST",
        url: `/control/v1/merchants/${TEST_MERCHANT_ID}/policy`,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: {
          policyVersion: "1.0.0",
          rules: [],
          effectiveFrom: "2024-01-01T00:00:00.000Z",
        },
      });
      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as { error: { code: string; message: string; details: { errors: string[] } } };
      expect(body.error.code).toBe("INVALID_FORMAT");
      expect(body.error.message).toBe("Policy validation failed");
      expect(body.error.details.errors).toContain("At least one policy rule is required");
    });
  });

  describe("successful operations", () => {
    it("POST /policy creates policy and returns compiled result", async () => {
      const { jwks } = await getTestKeys();
      const store = createInMemoryPolicyStore();
      server = createServer({ jwks, environment: "test", policyStore: store });
      await server.ready();

      const token = await createTestToken();
      const response = await server.inject({
        method: "POST",
        url: `/control/v1/merchants/${TEST_MERCHANT_ID}/policy`,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: VALID_POLICY_BODY,
      });
      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body) as {
        merchantId: string;
        policyVersion: string;
        compiled: { success: boolean; constraintCount: number };
        correlationId: string;
      };
      expect(body.merchantId).toBe(TEST_MERCHANT_ID);
      expect(body.policyVersion).toBe("1.0.0");
      expect(body.compiled.success).toBe(true);
      expect(body.compiled.constraintCount).toBe(1);
      expect(body.correlationId).toBeDefined();
    });

    it("GET /policy returns stored policy", async () => {
      const { jwks } = await getTestKeys();
      const store = createInMemoryPolicyStore();
      server = createServer({ jwks, environment: "test", policyStore: store });
      await server.ready();

      const token = await createTestToken();

      // First create a policy
      await server.inject({
        method: "POST",
        url: `/control/v1/merchants/${TEST_MERCHANT_ID}/policy`,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: VALID_POLICY_BODY,
      });

      // Then retrieve it
      const response = await server.inject({
        method: "GET",
        url: `/control/v1/merchants/${TEST_MERCHANT_ID}/policy`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        merchantId: string;
        policy: { merchantId: string; policyVersion: string; rules: unknown[] };
        correlationId: string;
      };
      expect(body.merchantId).toBe(TEST_MERCHANT_ID);
      expect(body.policy.policyVersion).toBe("1.0.0");
      expect(body.policy.rules).toHaveLength(1);
    });

    it("GET /policy returns 404 when no policy configured", async () => {
      const { jwks } = await getTestKeys();
      server = createServer({ jwks, environment: "test" });
      await server.ready();

      const token = await createTestToken();
      const response = await server.inject({
        method: "GET",
        url: `/control/v1/merchants/${TEST_MERCHANT_ID}/policy`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body) as { error: { code: string } };
      expect(body.error.code).toBe("NOT_FOUND");
    });
  });

  describe("compilation", () => {
    it("compiles policy with correct constraint count", async () => {
      const { jwks } = await getTestKeys();
      const store = createInMemoryPolicyStore();
      const compiler = createDefaultPolicyCompiler();
      server = createServer({ jwks, environment: "test", policyStore: store, policyCompiler: compiler });
      await server.ready();

      const token = await createTestToken();
      const response = await server.inject({
        method: "POST",
        url: `/control/v1/merchants/${TEST_MERCHANT_ID}/policy`,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: {
          ...VALID_POLICY_BODY,
          rules: [
            ...VALID_POLICY_BODY.rules,
            { ruleId: "rule_velocity", category: "fraud", constraint: "velocity_check", parameters: { window: 3600 }, enabled: true },
            { ruleId: "rule_disabled", category: "test", constraint: "noop", parameters: {}, enabled: false },
          ],
        },
      });
      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body) as { compiled: { constraintCount: number } };
      // Only enabled rules count
      expect(body.compiled.constraintCount).toBe(2);
    });
  });

  describe("version-conflict detection", () => {
    it("POST /policy with correct If-Match version succeeds", async () => {
      const { jwks } = await getTestKeys();
      const store = createInMemoryPolicyStore();
      server = createServer({ jwks, environment: "test", policyStore: store });
      await server.ready();

      const token = await createTestToken();

      // Create initial policy (version becomes 1)
      const response1 = await server.inject({
        method: "POST",
        url: `/control/v1/merchants/${TEST_MERCHANT_ID}/policy`,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: VALID_POLICY_BODY,
      });
      expect(response1.statusCode).toBe(201);
      expect(response1.headers["etag"]).toBe("1");

      // Update with correct If-Match (current version is 1)
      const response2 = await server.inject({
        method: "POST",
        url: `/control/v1/merchants/${TEST_MERCHANT_ID}/policy`,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "if-match": "1",
        },
        payload: { ...VALID_POLICY_BODY, policyVersion: "2.0.0" },
      });
      expect(response2.statusCode).toBe(201);
      expect(response2.headers["etag"]).toBe("2");
    });

    it("POST /policy with stale If-Match version returns 409", async () => {
      const { jwks } = await getTestKeys();
      const store = createInMemoryPolicyStore();
      server = createServer({ jwks, environment: "test", policyStore: store });
      await server.ready();

      const token = await createTestToken();

      // Create initial policy (version becomes 1)
      await server.inject({
        method: "POST",
        url: `/control/v1/merchants/${TEST_MERCHANT_ID}/policy`,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: VALID_POLICY_BODY,
      });

      // Try to update with stale version (claiming version 0)
      const response = await server.inject({
        method: "POST",
        url: `/control/v1/merchants/${TEST_MERCHANT_ID}/policy`,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "if-match": "0",
        },
        payload: { ...VALID_POLICY_BODY, policyVersion: "2.0.0" },
      });
      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body) as {
        error: { code: string; message: string; details: { currentVersion: number; expectedVersion: number } };
      };
      expect(body.error.code).toBe("VERSION_CONFLICT");
      expect(body.error.details.currentVersion).toBe(1);
      expect(body.error.details.expectedVersion).toBe(0);
    });

    it("POST /policy without If-Match header succeeds unconditionally", async () => {
      const { jwks } = await getTestKeys();
      const store = createInMemoryPolicyStore();
      server = createServer({ jwks, environment: "test", policyStore: store });
      await server.ready();

      const token = await createTestToken();

      // Create initial policy
      await server.inject({
        method: "POST",
        url: `/control/v1/merchants/${TEST_MERCHANT_ID}/policy`,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: VALID_POLICY_BODY,
      });

      // Update without If-Match (unconditional write)
      const response = await server.inject({
        method: "POST",
        url: `/control/v1/merchants/${TEST_MERCHANT_ID}/policy`,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: { ...VALID_POLICY_BODY, policyVersion: "2.0.0" },
      });
      expect(response.statusCode).toBe(201);
    });

    it("GET /policy returns etag header with version", async () => {
      const { jwks } = await getTestKeys();
      const store = createInMemoryPolicyStore();
      server = createServer({ jwks, environment: "test", policyStore: store });
      await server.ready();

      const token = await createTestToken();

      // Create policy
      await server.inject({
        method: "POST",
        url: `/control/v1/merchants/${TEST_MERCHANT_ID}/policy`,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: VALID_POLICY_BODY,
      });

      // GET returns etag
      const response = await server.inject({
        method: "GET",
        url: `/control/v1/merchants/${TEST_MERCHANT_ID}/policy`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers["etag"]).toBe("1");
    });
  });
});
