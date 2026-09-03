import { describe, expect, it, afterEach } from "vitest";
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from "jose";
import { createServer } from "./index.js";
import type { PostgresBuyerNotificationStore, BuyerNotification } from "@counter/data";
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

/** A minimal fake matching the one method this route calls. */
class FakeBuyerNotificationStore {
  #byWallet = new Map<string, BuyerNotification[]>();

  seed(walletId: string, notifications: readonly BuyerNotification[]): void {
    this.#byWallet.set(walletId, [...notifications]);
  }

  async listForWallet(
    walletId: string,
    options: { readonly limit?: number; readonly notificationType?: string } = {},
  ): Promise<readonly BuyerNotification[]> {
    const all = this.#byWallet.get(walletId) ?? [];
    const filtered =
      options.notificationType !== undefined
        ? all.filter((n) => n.notificationType === options.notificationType)
        : all;
    return filtered.slice(0, options.limit ?? 20);
  }
}

function notification(overrides: Partial<BuyerNotification> = {}): BuyerNotification {
  return {
    id: "ctr_buyer-notification_AAAAAAAAAAAAAAAAAAAAAA",
    walletId: TEST_WALLET_ID,
    notificationType: "merchant.order.created.v1",
    transactionId: "ctr_transaction_AAAAAAAAAAAAAAAAAAAAAA",
    payload: { amountMinor: 122882 },
    createdAt: 1_000 as never,
    ...overrides,
  };
}

describe("buyer-notification routes", () => {
  let server: FastifyInstance | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("returns the wallet's own notifications (200)", async () => {
    const { jwks } = await getTestKeys();
    const store = new FakeBuyerNotificationStore();
    store.seed(TEST_WALLET_ID, [notification()]);
    server = createServer({
      jwks,
      environment: "test",
      buyerNotificationStore: store as unknown as PostgresBuyerNotificationStore,
    });
    await server.ready();

    const token = await createWalletOwnerToken(TEST_WALLET_ID);
    const response = await server.inject({
      method: "GET",
      url: `/control/v1/wallets/${TEST_WALLET_ID}/notifications`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { total: number; notifications: unknown[] };
    expect(body.total).toBe(1);
    expect(body.notifications).toHaveLength(1);
  });

  it("returns an empty list for a wallet with no notifications", async () => {
    const { jwks } = await getTestKeys();
    const store = new FakeBuyerNotificationStore();
    server = createServer({
      jwks,
      environment: "test",
      buyerNotificationStore: store as unknown as PostgresBuyerNotificationStore,
    });
    await server.ready();

    const token = await createWalletOwnerToken(TEST_WALLET_ID);
    const response = await server.inject({
      method: "GET",
      url: `/control/v1/wallets/${TEST_WALLET_ID}/notifications`,
      headers: { authorization: `Bearer ${token}` },
    });

    const body = JSON.parse(response.body) as { total: number };
    expect(body.total).toBe(0);
  });

  it("a DIFFERENT wallet's token gets 404, not 403 or the other wallet's data (existence-hiding + isolation)", async () => {
    const { jwks } = await getTestKeys();
    const store = new FakeBuyerNotificationStore();
    store.seed(TEST_WALLET_ID, [notification()]);
    server = createServer({
      jwks,
      environment: "test",
      buyerNotificationStore: store as unknown as PostgresBuyerNotificationStore,
    });
    await server.ready();

    const token = await createWalletOwnerToken(OTHER_WALLET_ID);
    const response = await server.inject({
      method: "GET",
      url: `/control/v1/wallets/${TEST_WALLET_ID}/notifications`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(404);
  });

  it("filters by notification type when ?type= is passed", async () => {
    const { jwks } = await getTestKeys();
    const store = new FakeBuyerNotificationStore();
    store.seed(TEST_WALLET_ID, [
      notification({ notificationType: "merchant.order.created.v1" }),
      notification({ notificationType: "merchant.order.fulfilled.v1" }),
    ]);
    server = createServer({
      jwks,
      environment: "test",
      buyerNotificationStore: store as unknown as PostgresBuyerNotificationStore,
    });
    await server.ready();

    const token = await createWalletOwnerToken(TEST_WALLET_ID);
    const response = await server.inject({
      method: "GET",
      url: `/control/v1/wallets/${TEST_WALLET_ID}/notifications?type=merchant.order.fulfilled.v1`,
      headers: { authorization: `Bearer ${token}` },
    });

    const body = JSON.parse(response.body) as {
      total: number;
      notifications: Array<{ notificationType: string }>;
    };
    expect(body.total).toBe(1);
    expect(body.notifications[0]!.notificationType).toBe("merchant.order.fulfilled.v1");
  });

  it("requires authentication (401)", async () => {
    const { jwks } = await getTestKeys();
    const store = new FakeBuyerNotificationStore();
    server = createServer({
      jwks,
      environment: "test",
      buyerNotificationStore: store as unknown as PostgresBuyerNotificationStore,
    });
    await server.ready();

    const response = await server.inject({
      method: "GET",
      url: `/control/v1/wallets/${TEST_WALLET_ID}/notifications`,
    });

    expect(response.statusCode).toBe(401);
  });
});
