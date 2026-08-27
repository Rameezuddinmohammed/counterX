import { describe, expect, it, afterEach } from "vitest";
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from "jose";
import type { FastifyInstance } from "fastify";
import { createServer } from "./index.js";
import {
  buildTransitions,
  createInMemoryTransactionStore,
  deriveTransactionState,
  isClaimStep,
  type OrderedStep,
  type Transaction,
} from "./transaction-routes.js";

// --- Test helpers (mirrors policy-routes.test.ts) ---

const TEST_ISSUER = "https://dev-jzw3etjxnn3svs56.us.auth0.com/";
const TEST_AUDIENCE = "https://api.counter.dev";
const CLAIMS_NAMESPACE = "https://counter.dev/";
const MERCHANT_A = "ctr_merchant_AAAAAAAAAAAAAAAAAAAAAA";
const MERCHANT_B = "ctr_merchant_BBBBBBBBBBBBBBBBBBBBBB";

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

async function createTokenForMerchant(merchantId: string): Promise<string> {
  const { privateKey } = await getTestKeys();
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    sub: "ctr_merchant-user_AAAAAAAAAAAAAAAAAAAAAA",
    [`${CLAIMS_NAMESPACE}actor_kind`]: "merchant_user",
    [`${CLAIMS_NAMESPACE}environment`]: "test",
    [`${CLAIMS_NAMESPACE}scope`]: { kind: "merchant", merchantId },
    [`${CLAIMS_NAMESPACE}roles`]: ["merchant.owner"],
    [`${CLAIMS_NAMESPACE}assurance`]: "session",
    permissions: ["identity.scope.read"],
  })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(TEST_ISSUER)
    .setAudience(TEST_AUDIENCE)
    .setExpirationTime(now + 3600)
    .setIssuedAt(now)
    .sign(privateKey);
}

function txn(overrides: Partial<Transaction> & { transactionId: string; merchantId: string }): Transaction {
  return {
    amount: 1500,
    currency: "INR",
    currentState: "settled",
    buyerRef: "(unavailable)",
    method: "unknown",
    createdAt: "2025-01-20T10:00:00.000Z",
    transitions: [],
    ...overrides,
  } as Transaction;
}

// Merchant A owns two transactions; merchant B owns one.
const SEED: Transaction[] = [
  txn({ transactionId: "txn-a-1", merchantId: MERCHANT_A, amount: 1500, createdAt: "2025-01-20T10:00:00.000Z" }),
  txn({ transactionId: "txn-a-2", merchantId: MERCHANT_A, amount: 2499, createdAt: "2025-01-21T10:00:00.000Z" }),
  txn({ transactionId: "txn-b-1", merchantId: MERCHANT_B, amount: 999, createdAt: "2025-01-19T10:00:00.000Z" }),
];

function serverWithSeed(jwks: ReturnType<typeof createLocalJWKSet>): FastifyInstance {
  return createServer({
    jwks,
    environment: "test",
    transactionStore: createInMemoryTransactionStore(SEED),
  });
}

// --- Route tests ---

describe("transaction routes", () => {
  let server: FastifyInstance | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("unauthenticated list returns 401", async () => {
    const { jwks } = await getTestKeys();
    server = serverWithSeed(jwks);
    await server.ready();

    const response = await server.inject({
      method: "GET",
      url: `/control/v1/merchants/${MERCHANT_A}/transactions`,
    });
    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe("UNAUTHENTICATED");
  });

  it("unauthenticated getTransaction returns 401", async () => {
    const { jwks } = await getTestKeys();
    server = serverWithSeed(jwks);
    await server.ready();

    const response = await server.inject({
      method: "GET",
      url: `/control/v1/transactions/txn-a-1`,
    });
    expect(response.statusCode).toBe(401);
  });

  it("lists the owning merchant's transactions as a raw array (newest first)", async () => {
    const { jwks } = await getTestKeys();
    server = serverWithSeed(jwks);
    await server.ready();

    const token = await createTokenForMerchant(MERCHANT_A);
    const response = await server.inject({
      method: "GET",
      url: `/control/v1/merchants/${MERCHANT_A}/transactions`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as Transaction[];
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);
    expect(body.map((t) => t.transactionId)).toEqual(["txn-a-2", "txn-a-1"]);
    // amount is in MAJOR units (seeded directly as MAJOR).
    expect(body[0]!.amount).toBe(2499);
  });

  it("cross-merchant list is blocked with 403", async () => {
    const { jwks } = await getTestKeys();
    server = serverWithSeed(jwks);
    await server.ready();

    // token scoped to A tries to list B's transactions.
    const token = await createTokenForMerchant(MERCHANT_A);
    const response = await server.inject({
      method: "GET",
      url: `/control/v1/merchants/${MERCHANT_B}/transactions`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("getTransaction for an owned id returns it", async () => {
    const { jwks } = await getTestKeys();
    server = serverWithSeed(jwks);
    await server.ready();

    const token = await createTokenForMerchant(MERCHANT_A);
    const response = await server.inject({
      method: "GET",
      url: `/control/v1/transactions/txn-a-1`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as Transaction;
    expect(body.transactionId).toBe("txn-a-1");
    expect(body.merchantId).toBe(MERCHANT_A);
  });

  it("getTransaction for another merchant's id returns 404 (tenant isolation, no disclosure)", async () => {
    const { jwks } = await getTestKeys();
    server = serverWithSeed(jwks);
    await server.ready();

    // Merchant A asks for B's transaction by id.
    const token = await createTokenForMerchant(MERCHANT_A);
    const response = await server.inject({
      method: "GET",
      url: `/control/v1/transactions/txn-b-1`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("getTransaction for an unknown id returns 404", async () => {
    const { jwks } = await getTestKeys();
    server = serverWithSeed(jwks);
    await server.ready();

    const token = await createTokenForMerchant(MERCHANT_A);
    const response = await server.inject({
      method: "GET",
      url: `/control/v1/transactions/does-not-exist`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(404);
  });

  it("respects limit and offset", async () => {
    const { jwks } = await getTestKeys();
    server = serverWithSeed(jwks);
    await server.ready();

    const token = await createTokenForMerchant(MERCHANT_A);
    const limited = await server.inject({
      method: "GET",
      url: `/control/v1/merchants/${MERCHANT_A}/transactions?limit=1&offset=0`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(limited.statusCode).toBe(200);
    const first = JSON.parse(limited.body) as Transaction[];
    expect(first).toHaveLength(1);
    expect(first[0]!.transactionId).toBe("txn-a-2");

    const offsetted = await server.inject({
      method: "GET",
      url: `/control/v1/merchants/${MERCHANT_A}/transactions?limit=1&offset=1`,
      headers: { authorization: `Bearer ${token}` },
    });
    const second = JSON.parse(offsetted.body) as Transaction[];
    expect(second).toHaveLength(1);
    expect(second[0]!.transactionId).toBe("txn-a-1");
  });

  it("platform scope may list any merchant", async () => {
    const { jwks, privateKey } = await getTestKeys();
    server = serverWithSeed(jwks);
    await server.ready();

    const now = Math.floor(Date.now() / 1000);
    const platformToken = await new SignJWT({
      sub: "ctr_platform-user_AAAAAAAAAAAAAAAAAAAAAA",
      [`${CLAIMS_NAMESPACE}actor_kind`]: "operator",
      [`${CLAIMS_NAMESPACE}environment`]: "test",
      [`${CLAIMS_NAMESPACE}scope`]: { kind: "platform" },
      [`${CLAIMS_NAMESPACE}roles`]: ["platform.operator"],
      [`${CLAIMS_NAMESPACE}assurance`]: "session",
      permissions: ["identity.scope.read"],
    })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(TEST_ISSUER)
      .setAudience(TEST_AUDIENCE)
      .setExpirationTime(now + 3600)
      .setIssuedAt(now)
      .sign(privateKey);

    const response = await server.inject({
      method: "GET",
      url: `/control/v1/merchants/${MERCHANT_B}/transactions`,
      headers: { authorization: `Bearer ${platformToken}` },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as Transaction[];
    expect(body).toHaveLength(1);
    expect(body[0]!.transactionId).toBe("txn-b-1");
  });
});

// --- Pure derivation tests ---

function step(step: string, status: string, ref: string | null, ts: string): OrderedStep {
  return { step, status, reference: ref, timestamp: ts };
}

describe("deriveTransactionState", () => {
  it("returns initiated when no completed leg exists", () => {
    expect(deriveTransactionState("pending", [])).toBe("initiated");
  });

  it("returns authorized for a completed draft only", () => {
    const steps = [step("shopify.draft", "completed", "ord_1", "2025-01-20T10:01:00.000Z")];
    expect(deriveTransactionState("executing", steps)).toBe("authorized");
  });

  it("returns captured for completed draft + finalize", () => {
    const steps = [
      step("shopify.draft", "completed", "ord_1", "2025-01-20T10:01:00.000Z"),
      step("shopify.finalize", "completed", "ord_1", "2025-01-20T10:02:00.000Z"),
    ];
    expect(deriveTransactionState("executing", steps)).toBe("captured");
  });

  it("returns settled for the full draft/finalize/markPaid sequence", () => {
    const steps = [
      step("shopify.draft", "completed", "ord_1", "2025-01-20T10:01:00.000Z"),
      step("shopify.finalize", "completed", "ord_1", "2025-01-20T10:02:00.000Z"),
      step("shopify.markPaid", "completed", "ord_1", "2025-01-20T10:03:00.000Z"),
    ];
    expect(deriveTransactionState("completed", steps)).toBe("settled");
  });

  it("returns failed when the intent status is failed", () => {
    const steps = [step("shopify.draft", "completed", "ord_1", "2025-01-20T10:01:00.000Z")];
    expect(deriveTransactionState("failed", steps)).toBe("failed");
  });

  it("returns failed when any step is declined", () => {
    const steps = [step("shopify.draft", "declined", null, "2025-01-20T10:01:00.000Z")];
    expect(deriveTransactionState("executing", steps)).toBe("failed");
  });

  it("ignores .claim rows when deriving state", () => {
    const steps = [
      step("shopify.draft.claim", "completed", null, "2025-01-20T10:00:30.000Z"),
      step("shopify.draft", "completed", "ord_1", "2025-01-20T10:01:00.000Z"),
    ];
    expect(isClaimStep("shopify.draft.claim")).toBe(true);
    expect(deriveTransactionState("executing", steps)).toBe("authorized");
  });
});

describe("buildTransitions", () => {
  it("always anchors with a synthetic initiated transition", () => {
    const transitions = buildTransitions([], "2025-01-20T10:00:00.000Z");
    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toEqual({
      from: null,
      to: "initiated",
      timestamp: "2025-01-20T10:00:00.000Z",
      actor: "system",
      evidenceRef: null,
    });
  });

  it("emits ordered transitions for the full sequence and excludes .claim rows", () => {
    const steps = [
      step("shopify.draft.claim", "completed", null, "2025-01-20T10:00:30.000Z"),
      step("shopify.draft", "completed", "ord_1", "2025-01-20T10:01:00.000Z"),
      step("shopify.finalize", "completed", "ord_1", "2025-01-20T10:02:00.000Z"),
      step("shopify.markPaid", "completed", "ord_1", "2025-01-20T10:03:00.000Z"),
    ];
    const transitions = buildTransitions(steps, "2025-01-20T10:00:00.000Z");
    expect(transitions.map((t) => t.to)).toEqual([
      "initiated",
      "authorized",
      "captured",
      "settled",
    ]);
    // from links to the previous to.
    expect(transitions[1]!.from).toBe("initiated");
    expect(transitions[3]!.from).toBe("captured");
    // evidenceRef carries the step reference; actor is the provider.
    expect(transitions[1]!.evidenceRef).toBe("ord_1");
    expect(transitions[1]!.actor).toBe("shopify");
  });

  it("emits a failed transition for a declined step", () => {
    const steps = [step("shopify.draft", "declined", null, "2025-01-20T10:01:00.000Z")];
    const transitions = buildTransitions(steps, "2025-01-20T10:00:00.000Z");
    expect(transitions.map((t) => t.to)).toEqual(["initiated", "failed"]);
  });
});
