import { describe, expect, it, afterEach } from "vitest";
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from "jose";
import { createServer } from "./index.js";
import {
  RefundExecutionFailedError,
  RefundRequestNotFoundError,
  type RefundRequestStoreLike,
  type RefundRequestSummary,
} from "./refund-request-store.js";
import type { FastifyInstance } from "fastify";

// --- Test helpers ---

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

/**
 * Mirrors the merchant-owner claims a real merchant-console session would
 * carry. Defaults to "step_up" assurance, NOT "session": payment.refund.manage
 * requires tenantMutationAssurances (see packages/authorization/src/
 * assurance.ts) — a plain browser session cannot decide a real refund.
 */
async function createMerchantOwnerToken(
  merchantId: string,
  claims: Record<string, unknown> = {},
): Promise<string> {
  const { privateKey } = await getTestKeys();
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    sub: "ctr_merchant-user_AAAAAAAAAAAAAAAAAAAAAA",
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

function makeSummary(overrides: Partial<RefundRequestSummary> = {}): RefundRequestSummary {
  return {
    id: "ctr_refund-request_generated_0",
    transactionId: "ctr_transaction_generated_0",
    merchantId: TEST_MERCHANT_ID,
    requestedAmountMinor: "10000",
    currency: "INR",
    reason: "Item arrived damaged",
    status: "pending",
    autoApproved: false,
    providerReference: null,
    requestedAt: new Date().toISOString(),
    decidedAt: null,
    decidedBy: null,
    ...overrides,
  };
}

class FakeRefundRequestStore implements RefundRequestStoreLike {
  #requests = new Map<string, RefundRequestSummary>();
  shouldFailExecution = false;
  lastDecidedBy: string | undefined;

  seed(summary: RefundRequestSummary): void {
    this.#requests.set(summary.id, summary);
  }

  async list(merchantId: string): Promise<readonly RefundRequestSummary[]> {
    return [...this.#requests.values()].filter((r) => r.merchantId === merchantId);
  }

  async approve(
    merchantId: string,
    refundRequestId: string,
    decidedBy: string,
  ): Promise<RefundRequestSummary> {
    this.lastDecidedBy = decidedBy;
    const existing = this.#requests.get(refundRequestId);
    if (
      existing === undefined ||
      existing.merchantId !== merchantId ||
      existing.status !== "pending"
    ) {
      throw new RefundRequestNotFoundError(refundRequestId);
    }
    if (this.shouldFailExecution) {
      throw new RefundExecutionFailedError("Razorpay refund declined: gateway_error");
    }
    const updated: RefundRequestSummary = {
      ...existing,
      status: "executed",
      providerReference: "rfnd_fake001",
      decidedAt: new Date().toISOString(),
      decidedBy,
    };
    this.#requests.set(refundRequestId, updated);
    return updated;
  }

  async deny(
    merchantId: string,
    refundRequestId: string,
    decidedBy: string,
  ): Promise<RefundRequestSummary> {
    this.lastDecidedBy = decidedBy;
    const existing = this.#requests.get(refundRequestId);
    if (
      existing === undefined ||
      existing.merchantId !== merchantId ||
      existing.status !== "pending"
    ) {
      throw new RefundRequestNotFoundError(refundRequestId);
    }
    const updated: RefundRequestSummary = {
      ...existing,
      status: "denied",
      decidedAt: new Date().toISOString(),
      decidedBy,
    };
    this.#requests.set(refundRequestId, updated);
    return updated;
  }
}

// --- Tests ---

describe("refund-request routes", () => {
  let server: FastifyInstance | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  describe("GET /merchants/:merchantId/refund-requests", () => {
    it("unauthenticated request returns 401", async () => {
      const { jwks } = await getTestKeys();
      server = createServer({
        jwks,
        environment: "test",
        refundRequestStore: new FakeRefundRequestStore(),
      });
      await server.ready();

      const response = await server.inject({
        method: "GET",
        url: `/control/v1/merchants/${TEST_MERCHANT_ID}/refund-requests`,
      });
      expect(response.statusCode).toBe(401);
    });

    it("a merchant token for a DIFFERENT merchant gets 403", async () => {
      const { jwks } = await getTestKeys();
      server = createServer({
        jwks,
        environment: "test",
        refundRequestStore: new FakeRefundRequestStore(),
      });
      await server.ready();

      const token = await createMerchantOwnerToken(OTHER_MERCHANT_ID);
      const response = await server.inject({
        method: "GET",
        url: `/control/v1/merchants/${TEST_MERCHANT_ID}/refund-requests`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(403);
    });

    it("lists the merchant's refund requests, accessible at plain session assurance (read-only)", async () => {
      const { jwks } = await getTestKeys();
      const store = new FakeRefundRequestStore();
      store.seed(makeSummary({ id: "ctr_refund-request_r1" }));
      server = createServer({ jwks, environment: "test", refundRequestStore: store });
      await server.ready();

      const sessionToken = await createMerchantOwnerToken(TEST_MERCHANT_ID, {
        [`${CLAIMS_NAMESPACE}assurance`]: "session",
      });
      const response = await server.inject({
        method: "GET",
        url: `/control/v1/merchants/${TEST_MERCHANT_ID}/refund-requests`,
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { refundRequests: readonly RefundRequestSummary[] };
      expect(body.refundRequests).toHaveLength(1);
      expect(body.refundRequests[0]?.status).toBe("pending");
    });
  });

  describe("POST /merchants/:merchantId/refund-requests/:id/approve", () => {
    it("a plain-session token is denied (approving a refund requires step-up assurance)", async () => {
      const { jwks } = await getTestKeys();
      const store = new FakeRefundRequestStore();
      store.seed(makeSummary({ id: "ctr_refund-request_r1" }));
      server = createServer({ jwks, environment: "test", refundRequestStore: store });
      await server.ready();

      const token = await createMerchantOwnerToken(TEST_MERCHANT_ID, {
        [`${CLAIMS_NAMESPACE}assurance`]: "session",
      });
      const response = await server.inject({
        method: "POST",
        url: `/control/v1/merchants/${TEST_MERCHANT_ID}/refund-requests/ctr_refund-request_r1/approve`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(403);
    });

    it("a step-up merchant-owner token approves a pending request — Razorpay executes it", async () => {
      const { jwks } = await getTestKeys();
      const store = new FakeRefundRequestStore();
      store.seed(makeSummary({ id: "ctr_refund-request_r1" }));
      server = createServer({ jwks, environment: "test", refundRequestStore: store });
      await server.ready();

      const token = await createMerchantOwnerToken(TEST_MERCHANT_ID);
      const response = await server.inject({
        method: "POST",
        url: `/control/v1/merchants/${TEST_MERCHANT_ID}/refund-requests/ctr_refund-request_r1/approve`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as RefundRequestSummary;
      expect(body.status).toBe("executed");
      expect(body.providerReference).toBe("rfnd_fake001");
      expect(store.lastDecidedBy).toBe("ctr_merchant-user_AAAAAAAAAAAAAAAAAAAAAA");
    });

    it("returns 404 for a refund request that doesn't exist", async () => {
      const { jwks } = await getTestKeys();
      const store = new FakeRefundRequestStore();
      server = createServer({ jwks, environment: "test", refundRequestStore: store });
      await server.ready();

      const token = await createMerchantOwnerToken(TEST_MERCHANT_ID);
      const response = await server.inject({
        method: "POST",
        url: `/control/v1/merchants/${TEST_MERCHANT_ID}/refund-requests/ctr_refund-request_nope/approve`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(404);
    });

    it("returns 502 when the provider declines the refund", async () => {
      const { jwks } = await getTestKeys();
      const store = new FakeRefundRequestStore();
      store.shouldFailExecution = true;
      store.seed(makeSummary({ id: "ctr_refund-request_r1" }));
      server = createServer({ jwks, environment: "test", refundRequestStore: store });
      await server.ready();

      const token = await createMerchantOwnerToken(TEST_MERCHANT_ID);
      const response = await server.inject({
        method: "POST",
        url: `/control/v1/merchants/${TEST_MERCHANT_ID}/refund-requests/ctr_refund-request_r1/approve`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as { error: { code: string } };
      expect(body.error.code).toBe("UPSTREAM_ERROR");
    });

    it("a wrong-merchant token gets 403 before the store is ever consulted", async () => {
      const { jwks } = await getTestKeys();
      const store = new FakeRefundRequestStore();
      store.seed(makeSummary({ id: "ctr_refund-request_r1" }));
      server = createServer({ jwks, environment: "test", refundRequestStore: store });
      await server.ready();

      const token = await createMerchantOwnerToken(OTHER_MERCHANT_ID);
      const response = await server.inject({
        method: "POST",
        url: `/control/v1/merchants/${TEST_MERCHANT_ID}/refund-requests/ctr_refund-request_r1/approve`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(403);
    });
  });

  describe("POST /merchants/:merchantId/refund-requests/:id/deny", () => {
    it("denies a pending request — no provider call", async () => {
      const { jwks } = await getTestKeys();
      const store = new FakeRefundRequestStore();
      store.seed(makeSummary({ id: "ctr_refund-request_r1" }));
      server = createServer({ jwks, environment: "test", refundRequestStore: store });
      await server.ready();

      const token = await createMerchantOwnerToken(TEST_MERCHANT_ID);
      const response = await server.inject({
        method: "POST",
        url: `/control/v1/merchants/${TEST_MERCHANT_ID}/refund-requests/ctr_refund-request_r1/deny`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as RefundRequestSummary;
      expect(body.status).toBe("denied");
      expect(body.providerReference).toBeNull();
    });

    it("returns 404 for a refund request that doesn't exist", async () => {
      const { jwks } = await getTestKeys();
      const store = new FakeRefundRequestStore();
      server = createServer({ jwks, environment: "test", refundRequestStore: store });
      await server.ready();

      const token = await createMerchantOwnerToken(TEST_MERCHANT_ID);
      const response = await server.inject({
        method: "POST",
        url: `/control/v1/merchants/${TEST_MERCHANT_ID}/refund-requests/ctr_refund-request_nope/deny`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(404);
    });
  });
});
