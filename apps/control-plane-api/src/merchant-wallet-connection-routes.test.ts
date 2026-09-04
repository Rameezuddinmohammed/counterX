import { describe, expect, it, afterEach } from "vitest";
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from "jose";
import { createServer } from "./index.js";
import type {
  MerchantWalletConnectionStoreLike,
  WalletConnectionInput,
  WalletConnectionStatus,
} from "./merchant-wallet-connection-store.js";
import { WalletConnectionError } from "./merchant-wallet-connection-store.js";
import type { FastifyInstance } from "fastify";

const TEST_ISSUER = "https://dev-jzw3etjxnn3svs56.us.auth0.com/";
const TEST_AUDIENCE = "https://api.counter.dev";
const CLAIMS_NAMESPACE = "https://counter.dev/";
const TEST_MERCHANT_ID = "ctr_merchant_AAAAAAAAAAAAAAAAAAAAAA";
const OTHER_MERCHANT_ID = "ctr_merchant_BBBBBBBBBBBBBBBBBBBBBB";

// A real, well-formed Solana devnet address (base58, decodes to 32 bytes) —
// the well-known System Program id, chosen because it's public and
// unambiguous, not because it's owned by anyone relevant to this test.
const VALID_SOLANA_ADDRESS = "11111111111111111111111111111111";

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

class FakeMerchantWalletConnectionStore implements MerchantWalletConnectionStoreLike {
  #status = new Map<string, WalletConnectionStatus>();
  rejectAddress = false;

  async connect(
    merchantId: string,
    input: WalletConnectionInput,
  ): Promise<WalletConnectionStatus> {
    if (this.rejectAddress) {
      throw new WalletConnectionError("address is not a well-formed Solana address");
    }
    const status: WalletConnectionStatus = {
      connected: true,
      chain: input.chain,
      address: input.address,
      connectedAt: new Date().toISOString(),
    };
    this.#status.set(merchantId, status);
    return status;
  }

  async getConnection(merchantId: string): Promise<WalletConnectionStatus> {
    return this.#status.get(merchantId) ?? { connected: false };
  }
}

describe("merchant-wallet-connection routes", () => {
  let server: FastifyInstance | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("connects with a valid address (200)", async () => {
    const { jwks } = await getTestKeys();
    const store = new FakeMerchantWalletConnectionStore();
    server = createServer({ jwks, environment: "test", merchantWalletConnectionStore: store });
    await server.ready();

    const token = await createMerchantOwnerToken(TEST_MERCHANT_ID);
    const response = await server.inject({
      method: "POST",
      url: `/control/v1/merchant-applications/${TEST_MERCHANT_ID}/wallet-connection`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { chain: "solana-devnet", address: VALID_SOLANA_ADDRESS },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { connected: boolean; address: string };
    expect(body.connected).toBe(true);
    expect(body.address).toBe(VALID_SOLANA_ADDRESS);
  });

  it("returns 400 when the store rejects a malformed address", async () => {
    const { jwks } = await getTestKeys();
    const store = new FakeMerchantWalletConnectionStore();
    store.rejectAddress = true;
    server = createServer({ jwks, environment: "test", merchantWalletConnectionStore: store });
    await server.ready();

    const token = await createMerchantOwnerToken(TEST_MERCHANT_ID);
    const response = await server.inject({
      method: "POST",
      url: `/control/v1/merchant-applications/${TEST_MERCHANT_ID}/wallet-connection`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { chain: "solana-devnet", address: "not-a-real-address" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("returns 400 for a missing address", async () => {
    const { jwks } = await getTestKeys();
    const store = new FakeMerchantWalletConnectionStore();
    server = createServer({ jwks, environment: "test", merchantWalletConnectionStore: store });
    await server.ready();

    const token = await createMerchantOwnerToken(TEST_MERCHANT_ID);
    const response = await server.inject({
      method: "POST",
      url: `/control/v1/merchant-applications/${TEST_MERCHANT_ID}/wallet-connection`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { chain: "solana-devnet" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("returns 400 for an unsupported chain", async () => {
    const { jwks } = await getTestKeys();
    const store = new FakeMerchantWalletConnectionStore();
    server = createServer({ jwks, environment: "test", merchantWalletConnectionStore: store });
    await server.ready();

    const token = await createMerchantOwnerToken(TEST_MERCHANT_ID);
    const response = await server.inject({
      method: "POST",
      url: `/control/v1/merchant-applications/${TEST_MERCHANT_ID}/wallet-connection`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { chain: "ethereum-mainnet", address: VALID_SOLANA_ADDRESS },
    });
    expect(response.statusCode).toBe(400);
  });

  it("a DIFFERENT merchant's token gets 404, not 403 (existence-hiding)", async () => {
    const { jwks } = await getTestKeys();
    const store = new FakeMerchantWalletConnectionStore();
    server = createServer({ jwks, environment: "test", merchantWalletConnectionStore: store });
    await server.ready();

    const token = await createMerchantOwnerToken(OTHER_MERCHANT_ID);
    const response = await server.inject({
      method: "POST",
      url: `/control/v1/merchant-applications/${TEST_MERCHANT_ID}/wallet-connection`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { chain: "solana-devnet", address: VALID_SOLANA_ADDRESS },
    });
    expect(response.statusCode).toBe(404);
  });

  it("returns 401 with no auth token", async () => {
    const { jwks } = await getTestKeys();
    const store = new FakeMerchantWalletConnectionStore();
    server = createServer({ jwks, environment: "test", merchantWalletConnectionStore: store });
    await server.ready();

    const response = await server.inject({
      method: "GET",
      url: `/control/v1/merchant-applications/${TEST_MERCHANT_ID}/wallet-connection`,
    });
    expect(response.statusCode).toBe(401);
  });

  it("GET reports disconnected before any connection is made", async () => {
    const { jwks } = await getTestKeys();
    const store = new FakeMerchantWalletConnectionStore();
    server = createServer({ jwks, environment: "test", merchantWalletConnectionStore: store });
    await server.ready();

    const token = await createMerchantOwnerToken(TEST_MERCHANT_ID);
    const response = await server.inject({
      method: "GET",
      url: `/control/v1/merchant-applications/${TEST_MERCHANT_ID}/wallet-connection`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { connected: boolean };
    expect(body.connected).toBe(false);
  });

  it("GET after a successful connect reports connected (200)", async () => {
    const { jwks } = await getTestKeys();
    const store = new FakeMerchantWalletConnectionStore();
    server = createServer({ jwks, environment: "test", merchantWalletConnectionStore: store });
    await server.ready();

    const token = await createMerchantOwnerToken(TEST_MERCHANT_ID);
    await server.inject({
      method: "POST",
      url: `/control/v1/merchant-applications/${TEST_MERCHANT_ID}/wallet-connection`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { chain: "solana-devnet", address: VALID_SOLANA_ADDRESS },
    });
    const response = await server.inject({
      method: "GET",
      url: `/control/v1/merchant-applications/${TEST_MERCHANT_ID}/wallet-connection`,
      headers: { authorization: `Bearer ${token}` },
    });
    const body = JSON.parse(response.body) as { connected: boolean };
    expect(body.connected).toBe(true);
  });
});
