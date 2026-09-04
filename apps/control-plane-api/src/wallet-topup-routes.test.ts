import { createHmac } from "node:crypto";
import { describe, expect, it, afterEach } from "vitest";
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from "jose";
import { createServer } from "./index.js";
import { MockRazorpayHttp, RazorpayTestProvider } from "@counter/razorpay-adapter";
import type {
  RazorpayOrder,
  RazorpayPayment,
  RazorpayTestAdapterConfig,
} from "@counter/razorpay-adapter";
import type { Result, CanonicalError } from "@counter/domain";
import type { FastifyInstance } from "fastify";

const TEST_ISSUER = "https://dev-jzw3etjxnn3svs56.us.auth0.com/";
const TEST_AUDIENCE = "https://api.counter.dev";
const CLAIMS_NAMESPACE = "https://counter.dev/";
const TEST_WALLET_ID = "ctr_wallet_AAAAAAAAAAAAAAAAAAAAAA";
const OTHER_WALLET_ID = "ctr_wallet_BBBBBBBBBBBBBBBBBBBBBB";

const RAZORPAY_CONFIG: RazorpayTestAdapterConfig = {
  keyId: "rzp_test_key123",
  keySecret: "rzp_test_secret456",
  webhookSecret: "whsec_test_secret789",
  environment: "test",
  baseUrl: "https://api.razorpay.com",
};

function computeSignature(orderId: string, paymentId: string): string {
  return createHmac("sha256", RAZORPAY_CONFIG.keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
}

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

async function createWalletOwnerToken(walletId: string, assurance = "session"): Promise<string> {
  const { privateKey } = await getTestKeys();
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    sub: "auth0|test-wallet-user",
    [`${CLAIMS_NAMESPACE}actor_kind`]: "wallet_user",
    [`${CLAIMS_NAMESPACE}environment`]: "test",
    [`${CLAIMS_NAMESPACE}scope`]: { kind: "wallet", walletId },
    [`${CLAIMS_NAMESPACE}roles`]: ["wallet.owner"],
    [`${CLAIMS_NAMESPACE}assurance`]: assurance,
  })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(TEST_ISSUER)
    .setAudience(TEST_AUDIENCE)
    .setExpirationTime(now + 3600)
    .setIssuedAt(now)
    .sign(privateKey);
}

/** A minimal fake matching the one method this route calls. */
class FakeWalletBalanceStore {
  #balances = new Map<string, bigint>();
  #applied = new Set<string>();

  async topUp(request: {
    walletId: string;
    reference: string;
    amountMinor: bigint;
    currency: string;
    providerPaymentId: string;
  }): Promise<Result<{ alreadyApplied: boolean; balanceMinor: bigint }, CanonicalError>> {
    const key = `${request.walletId}:${request.reference}`;
    if (this.#applied.has(key)) {
      return {
        ok: true,
        value: { alreadyApplied: true, balanceMinor: this.#balances.get(request.walletId) ?? 0n },
      };
    }
    this.#applied.add(key);
    const balanceMinor = (this.#balances.get(request.walletId) ?? 0n) + request.amountMinor;
    this.#balances.set(request.walletId, balanceMinor);
    return { ok: true, value: { alreadyApplied: false, balanceMinor } };
  }

  balanceFor(walletId: string): bigint {
    return this.#balances.get(walletId) ?? 0n;
  }
}

function makeOrder(overrides: Partial<RazorpayOrder> = {}): RazorpayOrder {
  return {
    id: "order_test123",
    entity: "order",
    amount: 200000,
    amount_paid: 0,
    amount_due: 200000,
    currency: "INR",
    receipt: "receipt_1",
    status: "created",
    notes: {},
    created_at: 1700000000,
    ...overrides,
  };
}

function makePayment(overrides: Partial<RazorpayPayment> = {}): RazorpayPayment {
  return {
    id: "pay_test456",
    entity: "payment",
    amount: 200000,
    currency: "INR",
    status: "captured",
    order_id: "order_test123",
    method: "card",
    description: null,
    error_code: null,
    error_description: null,
    created_at: 1700000000,
    ...overrides,
  };
}

describe("wallet-topup routes", () => {
  let server: FastifyInstance | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("creates a real Razorpay order (201) with step-up assurance, never exposing the key secret", async () => {
    const { jwks } = await getTestKeys();
    const http = new MockRazorpayHttp();
    http.onCreateOrder(makeOrder());
    const razorpayProvider = new RazorpayTestProvider({
      config: RAZORPAY_CONFIG,
      httpClient: http,
    });
    const store = new FakeWalletBalanceStore();

    server = createServer({
      jwks,
      environment: "test",
      walletTopupRoutes: {
        store: store as any,
        razorpayProvider,
        merchantId: "ctr_merchant_test" as any,
      },
    });
    await server.ready();

    const token = await createWalletOwnerToken(TEST_WALLET_ID, "step_up");
    const response = await server.inject({
      method: "POST",
      url: `/control/v1/wallets/${TEST_WALLET_ID}/topup/order`,
      headers: { authorization: `Bearer ${token}` },
      payload: { amountMinor: "200000" },
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body) as {
      referenceId: string;
      checkout: {
        razorpayOrderId: string;
        razorpayKeyId: string;
        amountMinor: string;
        currency: string;
      };
    };
    expect(body.checkout.razorpayOrderId).toBe("order_test123");
    expect(body.checkout.razorpayKeyId).toBe("rzp_test_key123");
    expect(response.body).not.toContain("rzp_test_secret456");
  });

  it("rejects a plain-session token for order creation (403) — this is a real money-affecting mutation", async () => {
    const { jwks } = await getTestKeys();
    const http = new MockRazorpayHttp();
    http.onCreateOrder(makeOrder());
    const razorpayProvider = new RazorpayTestProvider({
      config: RAZORPAY_CONFIG,
      httpClient: http,
    });
    const store = new FakeWalletBalanceStore();

    server = createServer({
      jwks,
      environment: "test",
      walletTopupRoutes: {
        store: store as any,
        razorpayProvider,
        merchantId: "ctr_merchant_test" as any,
      },
    });
    await server.ready();

    const token = await createWalletOwnerToken(TEST_WALLET_ID, "session");
    const response = await server.inject({
      method: "POST",
      url: `/control/v1/wallets/${TEST_WALLET_ID}/topup/order`,
      headers: { authorization: `Bearer ${token}` },
      payload: { amountMinor: "200000" },
    });

    expect(response.statusCode).toBe(403);
  });

  it("a DIFFERENT wallet's token gets 404 creating an order (existence-hiding)", async () => {
    const { jwks } = await getTestKeys();
    const http = new MockRazorpayHttp();
    http.onCreateOrder(makeOrder());
    const razorpayProvider = new RazorpayTestProvider({
      config: RAZORPAY_CONFIG,
      httpClient: http,
    });
    const store = new FakeWalletBalanceStore();

    server = createServer({
      jwks,
      environment: "test",
      walletTopupRoutes: {
        store: store as any,
        razorpayProvider,
        merchantId: "ctr_merchant_test" as any,
      },
    });
    await server.ready();

    const token = await createWalletOwnerToken(OTHER_WALLET_ID, "step_up");
    const response = await server.inject({
      method: "POST",
      url: `/control/v1/wallets/${TEST_WALLET_ID}/topup/order`,
      headers: { authorization: `Bearer ${token}` },
      payload: { amountMinor: "200000" },
    });

    expect(response.statusCode).toBe(404);
  });

  it("rejects a non-positive or malformed amountMinor (400)", async () => {
    const { jwks } = await getTestKeys();
    const http = new MockRazorpayHttp();
    http.onCreateOrder(makeOrder());
    const razorpayProvider = new RazorpayTestProvider({
      config: RAZORPAY_CONFIG,
      httpClient: http,
    });
    const store = new FakeWalletBalanceStore();

    server = createServer({
      jwks,
      environment: "test",
      walletTopupRoutes: {
        store: store as any,
        razorpayProvider,
        merchantId: "ctr_merchant_test" as any,
      },
    });
    await server.ready();

    const token = await createWalletOwnerToken(TEST_WALLET_ID, "step_up");
    for (const amountMinor of ["0", "-100", "abc", "12.5"]) {
      const response = await server.inject({
        method: "POST",
        url: `/control/v1/wallets/${TEST_WALLET_ID}/topup/order`,
        headers: { authorization: `Bearer ${token}` },
        payload: { amountMinor },
      });
      expect(response.statusCode).toBe(400);
    }
  });

  it("rejects an amountMinor above the demo ceiling (400)", async () => {
    const { jwks } = await getTestKeys();
    const http = new MockRazorpayHttp();
    http.onCreateOrder(makeOrder());
    const razorpayProvider = new RazorpayTestProvider({
      config: RAZORPAY_CONFIG,
      httpClient: http,
    });
    const store = new FakeWalletBalanceStore();

    server = createServer({
      jwks,
      environment: "test",
      walletTopupRoutes: {
        store: store as any,
        razorpayProvider,
        merchantId: "ctr_merchant_test" as any,
      },
    });
    await server.ready();

    const token = await createWalletOwnerToken(TEST_WALLET_ID, "step_up");
    const response = await server.inject({
      method: "POST",
      url: `/control/v1/wallets/${TEST_WALLET_ID}/topup/order`,
      headers: { authorization: `Bearer ${token}` },
      payload: { amountMinor: "50000001" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("end to end: order → real signature verification → confirm credits the exact server-recorded amount", async () => {
    const { jwks } = await getTestKeys();
    const http = new MockRazorpayHttp();
    http.onCreateOrder(makeOrder({ id: "order_e2e", amount: 200000 }));
    http.onQueryPayment(
      "pay_e2e",
      makePayment({ id: "pay_e2e", order_id: "order_e2e", amount: 200000 }),
    );
    const razorpayProvider = new RazorpayTestProvider({
      config: RAZORPAY_CONFIG,
      httpClient: http,
    });
    const store = new FakeWalletBalanceStore();

    server = createServer({
      jwks,
      environment: "test",
      walletTopupRoutes: {
        store: store as any,
        razorpayProvider,
        merchantId: "ctr_merchant_test" as any,
      },
    });
    await server.ready();

    const token = await createWalletOwnerToken(TEST_WALLET_ID, "step_up");

    const orderResponse = await server.inject({
      method: "POST",
      url: `/control/v1/wallets/${TEST_WALLET_ID}/topup/order`,
      headers: { authorization: `Bearer ${token}` },
      payload: { amountMinor: "200000" },
    });
    expect(orderResponse.statusCode).toBe(201);
    const order = JSON.parse(orderResponse.body) as { checkout: { razorpayOrderId: string } };
    expect(order.checkout.razorpayOrderId).toBe("order_e2e");

    const signature = computeSignature("order_e2e", "pay_e2e");
    const confirmResponse = await server.inject({
      method: "POST",
      url: `/control/v1/wallets/${TEST_WALLET_ID}/topup/confirm`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        razorpayOrderId: "order_e2e",
        razorpayPaymentId: "pay_e2e",
        razorpaySignature: signature,
      },
    });

    expect(confirmResponse.statusCode).toBe(200);
    const confirmed = JSON.parse(confirmResponse.body) as {
      balanceMinor: string;
      alreadyApplied: boolean;
    };
    expect(confirmed.balanceMinor).toBe("200000");
    expect(confirmed.alreadyApplied).toBe(false);
    expect(store.balanceFor(TEST_WALLET_ID)).toBe(200000n);
  });

  it("a forged signature is rejected (400) and never credits the balance", async () => {
    const { jwks } = await getTestKeys();
    const http = new MockRazorpayHttp();
    http.onCreateOrder(makeOrder({ id: "order_forged", amount: 200000 }));
    const razorpayProvider = new RazorpayTestProvider({
      config: RAZORPAY_CONFIG,
      httpClient: http,
    });
    const store = new FakeWalletBalanceStore();

    server = createServer({
      jwks,
      environment: "test",
      walletTopupRoutes: {
        store: store as any,
        razorpayProvider,
        merchantId: "ctr_merchant_test" as any,
      },
    });
    await server.ready();

    const token = await createWalletOwnerToken(TEST_WALLET_ID, "step_up");
    await server.inject({
      method: "POST",
      url: `/control/v1/wallets/${TEST_WALLET_ID}/topup/order`,
      headers: { authorization: `Bearer ${token}` },
      payload: { amountMinor: "200000" },
    });

    const confirmResponse = await server.inject({
      method: "POST",
      url: `/control/v1/wallets/${TEST_WALLET_ID}/topup/confirm`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        razorpayOrderId: "order_forged",
        razorpayPaymentId: "pay_forged",
        razorpaySignature: "not_a_real_signature",
      },
    });

    expect(confirmResponse.statusCode).toBe(400);
    expect(store.balanceFor(TEST_WALLET_ID)).toBe(0n);
  });

  it("confirming an order this process never created is rejected (409), not guessed at", async () => {
    const { jwks } = await getTestKeys();
    const http = new MockRazorpayHttp();
    http.onQueryPayment(
      "pay_unknown",
      makePayment({ id: "pay_unknown", order_id: "order_unknown" }),
    );
    const razorpayProvider = new RazorpayTestProvider({
      config: RAZORPAY_CONFIG,
      httpClient: http,
    });
    const store = new FakeWalletBalanceStore();

    server = createServer({
      jwks,
      environment: "test",
      walletTopupRoutes: {
        store: store as any,
        razorpayProvider,
        merchantId: "ctr_merchant_test" as any,
      },
    });
    await server.ready();

    const token = await createWalletOwnerToken(TEST_WALLET_ID, "step_up");
    const signature = computeSignature("order_unknown", "pay_unknown");
    const confirmResponse = await server.inject({
      method: "POST",
      url: `/control/v1/wallets/${TEST_WALLET_ID}/topup/confirm`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        razorpayOrderId: "order_unknown",
        razorpayPaymentId: "pay_unknown",
        razorpaySignature: signature,
      },
    });

    expect(confirmResponse.statusCode).toBe(409);
    expect(store.balanceFor(TEST_WALLET_ID)).toBe(0n);
  });

  it("requires authentication (401)", async () => {
    const { jwks } = await getTestKeys();
    const http = new MockRazorpayHttp();
    const razorpayProvider = new RazorpayTestProvider({
      config: RAZORPAY_CONFIG,
      httpClient: http,
    });
    const store = new FakeWalletBalanceStore();

    server = createServer({
      jwks,
      environment: "test",
      walletTopupRoutes: {
        store: store as any,
        razorpayProvider,
        merchantId: "ctr_merchant_test" as any,
      },
    });
    await server.ready();

    const response = await server.inject({
      method: "POST",
      url: `/control/v1/wallets/${TEST_WALLET_ID}/topup/order`,
      payload: { amountMinor: "200000" },
    });

    expect(response.statusCode).toBe(401);
  });
});
