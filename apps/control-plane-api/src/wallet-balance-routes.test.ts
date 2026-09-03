import { describe, expect, it, afterEach } from "vitest";
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from "jose";
import { createServer } from "./index.js";
import type { PostgresWalletBalanceStore, BalanceEventSummary } from "@counter/data";
import type { FastifyInstance } from "fastify";

const TEST_ISSUER = "https://dev-jzw3etjxnn3svs56.us.auth0.com/";
const TEST_AUDIENCE = "https://api.counter.dev";
const CLAIMS_NAMESPACE = "https://counter.dev/";
const TEST_WALLET_ID = "ctr_wallet_AAAAAAAAAAAAAAAAAAAAAA";
const OTHER_WALLET_ID = "ctr_wallet_BBBBBBBBBBBBBBBBBBBBBB";

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

async function createWalletOwnerToken(walletId: string): Promise<string> {
  const { privateKey } = await getTestKeys();
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    sub: "auth0|test-wallet-user",
    [`${CLAIMS_NAMESPACE}actor_kind`]: "wallet_user",
    [`${CLAIMS_NAMESPACE}environment`]: "test",
    [`${CLAIMS_NAMESPACE}scope`]: { kind: "wallet", walletId },
    [`${CLAIMS_NAMESPACE}roles`]: ["wallet.owner"],
    [`${CLAIMS_NAMESPACE}assurance`]: "session",
  })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(TEST_ISSUER)
    .setAudience(TEST_AUDIENCE)
    .setExpirationTime(now + 3600)
    .setIssuedAt(now)
    .sign(privateKey);
}

/** A minimal fake matching the three methods this route calls. */
class FakeWalletBalanceStore {
  #balances = new Map<string, bigint>();
  #events = new Map<string, BalanceEventSummary[]>();

  seed(walletId: string, balanceMinor: bigint, events: readonly BalanceEventSummary[]): void {
    this.#balances.set(walletId, balanceMinor);
    this.#events.set(walletId, [...events]);
  }

  async getBalance(walletId: string): Promise<bigint> {
    return this.#balances.get(walletId) ?? 0n;
  }

  async hasBalanceAccount(walletId: string): Promise<boolean> {
    return this.#balances.has(walletId);
  }

  async listRecentEvents(walletId: string, limit: number): Promise<readonly BalanceEventSummary[]> {
    return (this.#events.get(walletId) ?? []).slice(0, limit);
  }
}

function event(overrides: Partial<BalanceEventSummary> = {}): BalanceEventSummary {
  return {
    reference: "pay_test_topup1",
    eventType: "topup",
    amountMinor: 500_000n,
    currency: "INR",
    providerPaymentId: "pay_test_topup1",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("wallet-balance routes", () => {
  let server: FastifyInstance | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("returns the wallet's own real balance and recent events (200)", async () => {
    const { jwks } = await getTestKeys();
    const store = new FakeWalletBalanceStore();
    store.seed(TEST_WALLET_ID, 450_100n, [
      event({ reference: "txn_1", eventType: "debit", amountMinor: 49_900n }),
      event(),
    ]);
    server = createServer({
      jwks,
      environment: "test",
      walletBalanceStore: store as unknown as PostgresWalletBalanceStore,
    });
    await server.ready();

    const token = await createWalletOwnerToken(TEST_WALLET_ID);
    const response = await server.inject({
      method: "GET",
      url: `/control/v1/wallets/${TEST_WALLET_ID}/balance`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      hasBalanceAccount: boolean;
      balanceMinor: string;
      currency: string;
      recentEvents: unknown[];
    };
    expect(body.hasBalanceAccount).toBe(true);
    expect(body.balanceMinor).toBe("450100");
    expect(body.currency).toBe("INR");
    expect(body.recentEvents).toHaveLength(2);
  });

  it("reports hasBalanceAccount: false and a zero balance for a never-funded wallet", async () => {
    const { jwks } = await getTestKeys();
    const store = new FakeWalletBalanceStore();
    server = createServer({
      jwks,
      environment: "test",
      walletBalanceStore: store as unknown as PostgresWalletBalanceStore,
    });
    await server.ready();

    const token = await createWalletOwnerToken(TEST_WALLET_ID);
    const response = await server.inject({
      method: "GET",
      url: `/control/v1/wallets/${TEST_WALLET_ID}/balance`,
      headers: { authorization: `Bearer ${token}` },
    });

    const body = JSON.parse(response.body) as { hasBalanceAccount: boolean; balanceMinor: string };
    expect(body.hasBalanceAccount).toBe(false);
    expect(body.balanceMinor).toBe("0");
  });

  it("a DIFFERENT wallet's token gets 404, not 403 or the other wallet's data (existence-hiding + isolation)", async () => {
    const { jwks } = await getTestKeys();
    const store = new FakeWalletBalanceStore();
    store.seed(TEST_WALLET_ID, 500_000n, [event()]);
    server = createServer({
      jwks,
      environment: "test",
      walletBalanceStore: store as unknown as PostgresWalletBalanceStore,
    });
    await server.ready();

    const token = await createWalletOwnerToken(OTHER_WALLET_ID);
    const response = await server.inject({
      method: "GET",
      url: `/control/v1/wallets/${TEST_WALLET_ID}/balance`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(404);
  });

  it("clamps an out-of-range limit rather than erroring", async () => {
    const { jwks } = await getTestKeys();
    const store = new FakeWalletBalanceStore();
    store.seed(
      TEST_WALLET_ID,
      1_000_000n,
      Array.from({ length: 150 }, (_, i) => event({ reference: `pay_${i}` })),
    );
    server = createServer({
      jwks,
      environment: "test",
      walletBalanceStore: store as unknown as PostgresWalletBalanceStore,
    });
    await server.ready();

    const token = await createWalletOwnerToken(TEST_WALLET_ID);
    const response = await server.inject({
      method: "GET",
      url: `/control/v1/wallets/${TEST_WALLET_ID}/balance?limit=9999`,
      headers: { authorization: `Bearer ${token}` },
    });

    const body = JSON.parse(response.body) as { recentEvents: unknown[] };
    expect(body.recentEvents.length).toBeLessThanOrEqual(100);
  });

  it("requires authentication (401)", async () => {
    const { jwks } = await getTestKeys();
    const store = new FakeWalletBalanceStore();
    server = createServer({
      jwks,
      environment: "test",
      walletBalanceStore: store as unknown as PostgresWalletBalanceStore,
    });
    await server.ready();

    const response = await server.inject({
      method: "GET",
      url: `/control/v1/wallets/${TEST_WALLET_ID}/balance`,
    });

    expect(response.statusCode).toBe(401);
  });
});
