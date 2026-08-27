import { describe, expect, it, afterEach } from "vitest";
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from "jose";
import { createServer } from "./index.js";
import { createMockHandlers } from "./merchant-handlers.js";
import { createInMemoryRuntimeIdempotencyStore } from "./idempotency-store.js";
import type { MerchantHandlers } from "./merchant-handlers.js";
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
    permissions: ["identity.scope.read"],
    ...claims,
  })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(TEST_ISSUER)
    .setAudience(TEST_AUDIENCE)
    .setExpirationTime(now + 3600)
    .setIssuedAt(now)
    .sign(privateKey);
}

// --- Tests ---

describe("merchant routes", () => {
  let server: FastifyInstance | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  describe("authentication - no existence leakage", () => {
    it("unauthenticated GET /capabilities returns 401 with standard shape", async () => {
      const { jwks } = await getTestKeys();
      server = createServer({ jwks, environment: "test", allowMockHandlers: true });
      await server.ready();

      const response = await server.inject({
        method: "GET",
        url: `/runtime/v1/merchants/${TEST_MERCHANT_ID}/capabilities`,
      });
      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("UNAUTHENTICATED");
      expect(body.error.message).toBe("Authentication is required");
    });

    it("unauthenticated POST /search returns 401 without leaking resource existence", async () => {
      const { jwks } = await getTestKeys();
      server = createServer({ jwks, environment: "test", allowMockHandlers: true });
      await server.ready();

      const response = await server.inject({
        method: "POST",
        url: `/runtime/v1/merchants/nonexistent_merchant/search`,
        payload: { query: "test" },
      });
      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as { error: { code: string } };
      expect(body.error.code).toBe("UNAUTHENTICATED");
    });

    it("unauthenticated GET /transactions/:id returns 401 same as non-existent", async () => {
      const { jwks } = await getTestKeys();
      server = createServer({ jwks, environment: "test", allowMockHandlers: true });
      await server.ready();

      const response = await server.inject({
        method: "GET",
        url: `/runtime/v1/merchants/${TEST_MERCHANT_ID}/transactions/nonexistent_txn`,
      });
      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as { error: { code: string } };
      expect(body.error.code).toBe("UNAUTHENTICATED");
    });
  });

  describe("validation errors - 400", () => {
    it("POST /search without query returns 400", async () => {
      const { jwks } = await getTestKeys();
      server = createServer({ jwks, environment: "test", allowMockHandlers: true });
      await server.ready();

      const token = await createTestToken();
      const response = await server.inject({
        method: "POST",
        url: `/runtime/v1/merchants/${TEST_MERCHANT_ID}/search`,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: {},
      });
      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("INVALID_FORMAT");
    });

    it("POST /quotes without required fields returns 400", async () => {
      const { jwks } = await getTestKeys();
      server = createServer({ jwks, environment: "test", allowMockHandlers: true });
      await server.ready();

      const token = await createTestToken();
      const response = await server.inject({
        method: "POST",
        url: `/runtime/v1/merchants/${TEST_MERCHANT_ID}/quotes`,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: { variantId: "var_001" },
      });
      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as { error: { code: string } };
      expect(body.error.code).toBe("INVALID_FORMAT");
    });

    it("POST /quotes with invalid quantity returns 400", async () => {
      const { jwks } = await getTestKeys();
      server = createServer({ jwks, environment: "test", allowMockHandlers: true });
      await server.ready();

      const token = await createTestToken();
      const response = await server.inject({
        method: "POST",
        url: `/runtime/v1/merchants/${TEST_MERCHANT_ID}/quotes`,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: { variantId: "var_001", quantity: -1, currency: "USD" },
      });
      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("INVALID_FORMAT");
      expect(body.error.message).toContain("quantity");
    });

    it("POST /transactions without body returns 400", async () => {
      const { jwks } = await getTestKeys();
      server = createServer({ jwks, environment: "test", allowMockHandlers: true });
      await server.ready();

      const token = await createTestToken();
      const response = await server.inject({
        method: "POST",
        url: `/runtime/v1/merchants/${TEST_MERCHANT_ID}/transactions`,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: {},
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe("successful operations", () => {
    it("GET /capabilities returns signed capability response", async () => {
      const { jwks } = await getTestKeys();
      server = createServer({ jwks, environment: "test", allowMockHandlers: true });
      await server.ready();

      const token = await createTestToken();
      const response = await server.inject({
        method: "GET",
        url: `/runtime/v1/merchants/${TEST_MERCHANT_ID}/capabilities`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { merchantId: string; manifestDigest: string; signature: string };
      expect(body.merchantId).toBe(TEST_MERCHANT_ID);
      expect(body.manifestDigest).toBeDefined();
      expect(body.signature).toBeDefined();
    });

    it("POST /search returns results with pagination", async () => {
      const { jwks } = await getTestKeys();
      server = createServer({ jwks, environment: "test", allowMockHandlers: true });
      await server.ready();

      const token = await createTestToken();
      const response = await server.inject({
        method: "POST",
        url: `/runtime/v1/merchants/${TEST_MERCHANT_ID}/search`,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: { query: "test product" },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { merchantId: string; results: unknown[]; totalCount: number };
      expect(body.merchantId).toBe(TEST_MERCHANT_ID);
      expect(body.results).toBeInstanceOf(Array);
      expect(body.totalCount).toBeGreaterThanOrEqual(0);
    });

    it("GET /products/:variantId returns product details", async () => {
      const { jwks } = await getTestKeys();
      server = createServer({ jwks, environment: "test", allowMockHandlers: true });
      await server.ready();

      const token = await createTestToken();
      const response = await server.inject({
        method: "GET",
        url: `/runtime/v1/merchants/${TEST_MERCHANT_ID}/products/var_001`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { variantId: string; version: string };
      expect(body.variantId).toBe("var_001");
      expect(body.version).toBeDefined();
    });

    it("POST /quotes returns immutable quote", async () => {
      const { jwks } = await getTestKeys();
      server = createServer({ jwks, environment: "test", allowMockHandlers: true });
      await server.ready();

      const token = await createTestToken();
      const response = await server.inject({
        method: "POST",
        url: `/runtime/v1/merchants/${TEST_MERCHANT_ID}/quotes`,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "idempotency-key": "idem_quote_001",
        },
        payload: { variantId: "var_001", quantity: 2, currency: "USD" },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { quoteId: string; quantity: number };
      expect(body.quoteId).toBeDefined();
      expect(body.quantity).toBe(2);
    });

    it("POST /transactions creates transaction", async () => {
      const { jwks } = await getTestKeys();
      server = createServer({ jwks, environment: "test", allowMockHandlers: true });
      await server.ready();

      const token = await createTestToken();
      const response = await server.inject({
        method: "POST",
        url: `/runtime/v1/merchants/${TEST_MERCHANT_ID}/transactions`,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "idempotency-key": "idem_txn_001",
        },
        payload: { quoteId: "quote_001", paymentMethod: "card" },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { transactionId: string; status: string };
      expect(body.transactionId).toBeDefined();
      expect(body.status).toBe("pending");
    });

    it("GET /transactions/:id returns status", async () => {
      const { jwks } = await getTestKeys();
      server = createServer({ jwks, environment: "test", allowMockHandlers: true });
      await server.ready();

      const token = await createTestToken();
      const response = await server.inject({
        method: "GET",
        url: `/runtime/v1/merchants/${TEST_MERCHANT_ID}/transactions/txn_001`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { transactionId: string; version: string };
      expect(body.transactionId).toBe("txn_001");
      expect(body.version).toBeDefined();
    });

    it("GET /transactions/:id/receipt returns signed receipt", async () => {
      const { jwks } = await getTestKeys();
      server = createServer({ jwks, environment: "test", allowMockHandlers: true });
      await server.ready();

      const token = await createTestToken();
      const response = await server.inject({
        method: "GET",
        url: `/runtime/v1/merchants/${TEST_MERCHANT_ID}/transactions/txn_001/receipt`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { receiptId: string; signature: string };
      expect(body.receiptId).toBeDefined();
      expect(body.signature).toBeDefined();
    });
  });

  describe("review-required - 202", () => {
    it("POST /transactions returns 202 when review is required", async () => {
      const { jwks } = await getTestKeys();
      const handlers = createMockHandlers({ behavior: "review_required" });
      server = createServer({ jwks, environment: "test", merchantHandlers: handlers });
      await server.ready();

      const token = await createTestToken();
      const response = await server.inject({
        method: "POST",
        url: `/runtime/v1/merchants/${TEST_MERCHANT_ID}/transactions`,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "idempotency-key": "idem_review_001",
        },
        payload: { quoteId: "quote_001", paymentMethod: "card" },
      });
      expect(response.statusCode).toBe(202);
      const body = JSON.parse(response.body) as {
        status: string;
        reviewId: string;
        reason: string;
        blockingRuleIds: string[];
        correlationId: string;
      };
      expect(body.status).toBe("review_required");
      expect(body.reviewId).toBeDefined();
      expect(body.reason).toBeDefined();
      expect(body.blockingRuleIds).toBeInstanceOf(Array);
      expect(body.blockingRuleIds.length).toBeGreaterThan(0);
      expect(body.correlationId).toBeDefined();
    });
  });

  describe("stale version - 409", () => {
    it("GET /products/:id returns 409 with version info when stale", async () => {
      const { jwks } = await getTestKeys();
      const handlers = createMockHandlers({ behavior: "stale" });
      server = createServer({ jwks, environment: "test", merchantHandlers: handlers });
      await server.ready();

      const token = await createTestToken();
      const response = await server.inject({
        method: "GET",
        url: `/runtime/v1/merchants/${TEST_MERCHANT_ID}/products/var_001`,
        headers: {
          authorization: `Bearer ${token}`,
          "if-match": "v1",
        },
      });
      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body) as {
        error: { code: string; message: string; details: { currentVersion: string; requestedVersion: string } };
      };
      expect(body.error.code).toBe("STALE");
      expect(body.error.details.currentVersion).toBe("v2");
      expect(body.error.details.requestedVersion).toBe("v1");
    });

    it("GET /transactions/:id returns 409 when stale", async () => {
      const { jwks } = await getTestKeys();
      const handlers = createMockHandlers({ behavior: "stale" });
      server = createServer({ jwks, environment: "test", merchantHandlers: handlers });
      await server.ready();

      const token = await createTestToken();
      const response = await server.inject({
        method: "GET",
        url: `/runtime/v1/merchants/${TEST_MERCHANT_ID}/transactions/txn_001`,
        headers: {
          authorization: `Bearer ${token}`,
          "if-match": "v1",
        },
      });
      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body) as { error: { code: string } };
      expect(body.error.code).toBe("STALE");
    });
  });

  describe("indeterminate - 502", () => {
    it("POST /quotes returns 502 with correlation for query-before-retry", async () => {
      const { jwks } = await getTestKeys();
      const handlers = createMockHandlers({ behavior: "indeterminate" });
      server = createServer({ jwks, environment: "test", merchantHandlers: handlers });
      await server.ready();

      const token = await createTestToken();
      const response = await server.inject({
        method: "POST",
        url: `/runtime/v1/merchants/${TEST_MERCHANT_ID}/quotes`,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "idempotency-key": "idem_indet_001",
        },
        payload: { variantId: "var_001", quantity: 1, currency: "USD" },
      });
      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as {
        error: { code: string; message: string; details: { correlationId: string; retry: string } };
      };
      expect(body.error.code).toBe("INDETERMINATE");
      expect(body.error.details.correlationId).toBeDefined();
      expect(body.error.details.retry).toBe("query_before_retry");
    });

    it("POST /transactions returns 502 when indeterminate", async () => {
      const { jwks } = await getTestKeys();
      const handlers = createMockHandlers({ behavior: "indeterminate" });
      server = createServer({ jwks, environment: "test", merchantHandlers: handlers });
      await server.ready();

      const token = await createTestToken();
      const response = await server.inject({
        method: "POST",
        url: `/runtime/v1/merchants/${TEST_MERCHANT_ID}/transactions`,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "idempotency-key": "idem_indet_txn_001",
        },
        payload: { quoteId: "quote_001", paymentMethod: "card" },
      });
      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as { error: { code: string } };
      expect(body.error.code).toBe("INDETERMINATE");
    });
  });

  describe("idempotency replay", () => {
    it("POST /transactions with same idempotency-key returns cached result", async () => {
      const { jwks } = await getTestKeys();
      const idempotencyCache = new Map<string, unknown>();
      const handlers = createMockHandlers({ behavior: "success", idempotencyCache });
      server = createServer({ jwks, environment: "test", merchantHandlers: handlers });
      await server.ready();

      const token = await createTestToken();
      const key = "idem_replay_001";

      // First request
      const response1 = await server.inject({
        method: "POST",
        url: `/runtime/v1/merchants/${TEST_MERCHANT_ID}/transactions`,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "idempotency-key": key,
        },
        payload: { quoteId: "quote_001", paymentMethod: "card" },
      });
      expect(response1.statusCode).toBe(200);
      const body1 = JSON.parse(response1.body) as { transactionId: string };

      // Second request with same key
      const response2 = await server.inject({
        method: "POST",
        url: `/runtime/v1/merchants/${TEST_MERCHANT_ID}/transactions`,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "idempotency-key": key,
        },
        payload: { quoteId: "quote_001", paymentMethod: "card" },
      });
      expect(response2.statusCode).toBe(200);
      const body2 = JSON.parse(response2.body) as { transactionId: string };

      // Same transaction ID returned (cached)
      expect(body2.transactionId).toBe(body1.transactionId);
    });

    it("POST /quotes with same idempotency-key returns cached quote", async () => {
      const { jwks } = await getTestKeys();
      const idempotencyCache = new Map<string, unknown>();
      const handlers = createMockHandlers({ behavior: "success", idempotencyCache });
      server = createServer({ jwks, environment: "test", merchantHandlers: handlers });
      await server.ready();

      const token = await createTestToken();
      const key = "idem_quote_replay_001";

      const response1 = await server.inject({
        method: "POST",
        url: `/runtime/v1/merchants/${TEST_MERCHANT_ID}/quotes`,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "idempotency-key": key,
        },
        payload: { variantId: "var_001", quantity: 2, currency: "USD" },
      });
      expect(response1.statusCode).toBe(200);
      const body1 = JSON.parse(response1.body) as { quoteId: string };

      const response2 = await server.inject({
        method: "POST",
        url: `/runtime/v1/merchants/${TEST_MERCHANT_ID}/quotes`,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "idempotency-key": key,
        },
        payload: { variantId: "var_001", quantity: 2, currency: "USD" },
      });
      expect(response2.statusCode).toBe(200);
      const body2 = JSON.parse(response2.body) as { quoteId: string };

      expect(body2.quoteId).toBe(body1.quoteId);
    });
  });

  // Route-level coverage for the DURABLE idempotency wrapper (runWithIdempotency).
  // These inject an in-memory RuntimeIdempotencyStore via createServer options so
  // the wrapper (not the handler-level cache) is the dedup authority, and use a
  // counting handler with NO internal cache so duplicate side effects are visible.
  describe("durable idempotency wrapper (route-level)", () => {
    function countingHandlers(): {
      handlers: MerchantHandlers;
      counts: { transactionCreate: number };
    } {
      const base = createMockHandlers({ behavior: "success" });
      const counts = { transactionCreate: 0 };
      const handlers: MerchantHandlers = {
        ...base,
        transactionCreate: {
          async handle(ctx, input) {
            counts.transactionCreate += 1;
            return {
              ok: true as const,
              value: {
                // Include the invocation count so a duplicate execution would
                // change the snapshot; a genuine replay returns the first one.
                transactionId: `txn_${counts.transactionCreate}`,
                merchantId: ctx.merchantId,
                status: "pending" as const,
                quoteId: input.quoteId,
                amount: { amount: "100.00", currency: "USD" },
                createdAt: new Date().toISOString(),
                version: "v1",
              },
            };
          },
        },
      };
      return { handlers, counts };
    }

    it("same key + same body => replay (identical response, handler runs once)", async () => {
      const { jwks } = await getTestKeys();
      const { handlers, counts } = countingHandlers();
      server = createServer({
        jwks,
        environment: "test",
        merchantHandlers: handlers,
        idempotencyStore: createInMemoryRuntimeIdempotencyStore(),
      });
      await server.ready();
      const token = await createTestToken();
      const key = "durable_same_body_001";
      const payload = { quoteId: "quote_001", paymentMethod: "card" };

      const r1 = await server.inject({
        method: "POST",
        url: `/runtime/v1/merchants/${TEST_MERCHANT_ID}/transactions`,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "idempotency-key": key,
        },
        payload,
      });
      expect(r1.statusCode).toBe(200);
      const body1 = JSON.parse(r1.body) as { transactionId: string };

      const r2 = await server.inject({
        method: "POST",
        url: `/runtime/v1/merchants/${TEST_MERCHANT_ID}/transactions`,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "idempotency-key": key,
        },
        payload,
      });
      expect(r2.statusCode).toBe(200);
      const body2 = JSON.parse(r2.body) as { transactionId: string };

      // Replay returns the persisted snapshot verbatim and the handler ran once.
      expect(body2).toEqual(body1);
      expect(body2.transactionId).toBe("txn_1");
      expect(counts.transactionCreate).toBe(1);
    });

    it("same key + changed body => 409 digest_conflict (no second side effect)", async () => {
      const { jwks } = await getTestKeys();
      const { handlers, counts } = countingHandlers();
      server = createServer({
        jwks,
        environment: "test",
        merchantHandlers: handlers,
        idempotencyStore: createInMemoryRuntimeIdempotencyStore(),
      });
      await server.ready();
      const token = await createTestToken();
      const key = "durable_changed_body_001";

      const r1 = await server.inject({
        method: "POST",
        url: `/runtime/v1/merchants/${TEST_MERCHANT_ID}/transactions`,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "idempotency-key": key,
        },
        payload: { quoteId: "quote_001", paymentMethod: "card" },
      });
      expect(r1.statusCode).toBe(200);

      // Same key, DIFFERENT payload: must be rejected, not replayed.
      const r2 = await server.inject({
        method: "POST",
        url: `/runtime/v1/merchants/${TEST_MERCHANT_ID}/transactions`,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "idempotency-key": key,
        },
        payload: { quoteId: "quote_TAMPERED", paymentMethod: "card" },
      });
      expect(r2.statusCode).toBe(409);
      const body2 = JSON.parse(r2.body) as { error: { code: string } };
      expect(body2.error.code).toBe("CONFLICT");
      // The tampered request never reached the handler.
      expect(counts.transactionCreate).toBe(1);
    });

    it("same key while first is still pending => 409 in_flight", async () => {
      const { jwks } = await getTestKeys();
      // A handler that blocks until released, so the first request holds the
      // key in `pending` while the second arrives concurrently.
      const base = createMockHandlers({ behavior: "success" });
      let release: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const handlers: MerchantHandlers = {
        ...base,
        transactionCreate: {
          async handle(ctx, input) {
            await gate;
            return {
              ok: true as const,
              value: {
                transactionId: "txn_pending",
                merchantId: ctx.merchantId,
                status: "pending" as const,
                quoteId: input.quoteId,
                amount: { amount: "100.00", currency: "USD" },
                createdAt: new Date().toISOString(),
                version: "v1",
              },
            };
          },
        },
      };
      server = createServer({
        jwks,
        environment: "test",
        merchantHandlers: handlers,
        idempotencyStore: createInMemoryRuntimeIdempotencyStore(),
      });
      await server.ready();
      const token = await createTestToken();
      const key = "durable_in_flight_001";
      const payload = { quoteId: "quote_001", paymentMethod: "card" };
      const inject = () =>
        server!.inject({
          method: "POST",
          url: `/runtime/v1/merchants/${TEST_MERCHANT_ID}/transactions`,
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "idempotency-key": key,
          },
          payload,
        });

      // Fire the first (blocked) request, then the second while it is pending.
      const first = inject();
      // Give the first request a tick to acquire the key before the second.
      await new Promise((resolve) => setTimeout(resolve, 20));
      const second = await inject();
      expect(second.statusCode).toBe(409);
      const secondBody = JSON.parse(second.body) as { error: { code: string; message: string } };
      expect(secondBody.error.code).toBe("CONFLICT");
      expect(secondBody.error.message).toContain("in flight");

      // Release the first and confirm it completed successfully.
      release?.();
      const firstResponse = await first;
      expect(firstResponse.statusCode).toBe(200);
    });

    it("same key value across different merchants does not collide (per-tenant namespace)", async () => {
      const { jwks } = await getTestKeys();
      const { handlers } = countingHandlers();
      server = createServer({
        jwks,
        environment: "test",
        merchantHandlers: handlers,
        idempotencyStore: createInMemoryRuntimeIdempotencyStore(),
      });
      await server.ready();
      const merchantA = "ctr_merchant_AAAAAAAAAAAAAAAAAAAAAA";
      const merchantB = "ctr_merchant_BBBBBBBBBBBBBBBBBBBBBB";
      // Each tenant authenticates with a token scoped to its OWN merchant.
      const tokenA = await createTestToken({
        [`${CLAIMS_NAMESPACE}scope`]: { kind: "merchant", merchantId: merchantA },
      });
      const tokenB = await createTestToken({
        [`${CLAIMS_NAMESPACE}scope`]: { kind: "merchant", merchantId: merchantB },
      });
      const key = "shared_key_across_tenants";
      const payload = { quoteId: "quote_001", paymentMethod: "card" };

      const rA = await server.inject({
        method: "POST",
        url: `/runtime/v1/merchants/${merchantA}/transactions`,
        headers: {
          authorization: `Bearer ${tokenA}`,
          "content-type": "application/json",
          "idempotency-key": key,
        },
        payload,
      });
      expect(rA.statusCode).toBe(200);

      // Same opaque key value, DIFFERENT merchant: must be a fresh acquire, not
      // a spurious 409 collision on a shared row.
      const rB = await server.inject({
        method: "POST",
        url: `/runtime/v1/merchants/${merchantB}/transactions`,
        headers: {
          authorization: `Bearer ${tokenB}`,
          "content-type": "application/json",
          "idempotency-key": key,
        },
        payload,
      });
      expect(rB.statusCode).toBe(200);
    });
  });

  describe("correlation ID propagation", () => {
    it("response includes x-correlation-id header", async () => {
      const { jwks } = await getTestKeys();
      server = createServer({ jwks, environment: "test", allowMockHandlers: true });
      await server.ready();

      const token = await createTestToken();
      const response = await server.inject({
        method: "GET",
        url: `/runtime/v1/merchants/${TEST_MERCHANT_ID}/capabilities`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers["x-correlation-id"]).toBeDefined();
    });

    it("uses provided correlation ID from request", async () => {
      const { jwks } = await getTestKeys();
      server = createServer({ jwks, environment: "test", allowMockHandlers: true });
      await server.ready();

      const token = await createTestToken();
      const correlationId = "ctr_correlation_AAAAAAAAAAAAAAAAAAAAAA";
      const response = await server.inject({
        method: "GET",
        url: `/runtime/v1/merchants/${TEST_MERCHANT_ID}/capabilities`,
        headers: {
          authorization: `Bearer ${token}`,
          "x-correlation-id": correlationId,
        },
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers["x-correlation-id"]).toBe(correlationId);
    });
  });

  describe("tenant isolation - negative path", () => {
    it("token scoped to merchant B requesting merchant A resources returns 403", async () => {
      const { jwks } = await getTestKeys();
      server = createServer({ jwks, environment: "test", allowMockHandlers: true });
      await server.ready();

      const OTHER_MERCHANT_ID = "ctr_merchant_BBBBBBBBBBBBBBBBBBBBBB";

      // Create token scoped to merchant B
      const token = await createTestToken({
        [`${CLAIMS_NAMESPACE}scope`]: { kind: "merchant", merchantId: OTHER_MERCHANT_ID },
      });

      // Request merchant A resources (TEST_MERCHANT_ID)
      const response = await server.inject({
        method: "GET",
        url: `/runtime/v1/merchants/${TEST_MERCHANT_ID}/capabilities`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("UNAUTHORIZED");
      expect(body.error.message).toContain("Access denied");
    });
  });
});
