import { describe, expect, it, afterEach } from "vitest";
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from "jose";
import { createServer } from "./index.js";
import type { CounterId } from "@counter/domain";
import type { MandateRepository, WalletMandate } from "@counter/wallet-domain";
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

/** A minimal fake matching the methods this route's handlers call. */
class FakeMandateRepository
  implements Pick<MandateRepository, "findActive" | "findById" | "updateStatus">
{
  #byWallet = new Map<string, WalletMandate[]>();
  #byId = new Map<string, WalletMandate>();

  seed(walletId: string, mandates: readonly WalletMandate[]): void {
    this.#byWallet.set(walletId, [...mandates]);
    for (const m of mandates) this.#byId.set(m.mandateId, m);
  }

  async findActive(walletId: CounterId<"wallet">): Promise<readonly WalletMandate[]> {
    return (this.#byWallet.get(walletId) ?? []).filter((m) => m.status === "active");
  }

  async findById(mandateId: CounterId<"mandate">): Promise<WalletMandate | undefined> {
    return this.#byId.get(mandateId);
  }

  async updateStatus(
    mandateId: CounterId<"mandate">,
    status: WalletMandate["status"],
  ): Promise<void> {
    const existing = this.#byId.get(mandateId);
    if (existing === undefined) return;
    const updated = { ...existing, status };
    this.#byId.set(mandateId, updated);
    for (const [walletId, list] of this.#byWallet) {
      const idx = list.findIndex((m) => m.mandateId === mandateId);
      if (idx >= 0) {
        list[idx] = updated;
        this.#byWallet.set(walletId, list);
      }
    }
  }
}

function mandate(overrides: Partial<WalletMandate> = {}): WalletMandate {
  return {
    mandateId: "ctr_mandate_AAAAAAAAAAAAAAAAAAAAAA" as CounterId<"mandate">,
    walletId: TEST_WALLET_ID as CounterId<"wallet">,
    principalId: "ctr_actor_AAAAAAAAAAAAAAAAAAAAAA" as CounterId<"actor">,
    agentId: "ctr_agent_AAAAAAAAAAAAAAAAAAAAAA" as CounterId<"agent">,
    kid: "kid-1",
    constraints: {
      merchantAllowlist: { allowedMerchantIds: [], allowedDomains: [] },
      geography: { allowedMerchantCountries: ["IN"], allowedDeliveryCountries: ["IN"] },
      category: { allowedCategories: [] },
      currency: { allowedCurrencies: ["INR"] },
      amountLimits: { perTransactionMaxPaise: 500_000n },
      countLimits: {},
      operations: { allowedOperations: ["purchase"] },
      timeConstraints: {},
      approvalThreshold: { thresholdPaise: 1_000_000n },
      paymentReferences: { allowedReferenceIds: [] },
    },
    paymentReferenceId: `prepaid-balance:${TEST_WALLET_ID}`,
    validFrom: new Date().toISOString(),
    validUntil: new Date(Date.now() + 3_600_000).toISOString(),
    issuedAt: new Date().toISOString(),
    consentAttestationDigest: "sha256:deadbeef",
    status: "active",
    revocationLocator: "ctr_mandate_AAAAAAAAAAAAAAAAAAAAAA",
    policyVersionId: "v1",
    ...overrides,
  };
}

describe("wallet-mandate routes", () => {
  let server: FastifyInstance | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("returns the wallet's own active mandates (200), with bigint fields stringified", async () => {
    const { jwks } = await getTestKeys();
    const repo = new FakeMandateRepository();
    repo.seed(TEST_WALLET_ID, [mandate()]);
    server = createServer({
      jwks,
      environment: "test",
      mandateRepository: repo as unknown as MandateRepository,
    });
    await server.ready();

    const token = await createWalletOwnerToken(TEST_WALLET_ID);
    const response = await server.inject({
      method: "GET",
      url: `/control/v1/wallets/${TEST_WALLET_ID}/mandates`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      total: number;
      mandates: Array<{
        status: string;
        constraints: { amountLimits: { perTransactionMaxPaise: string } };
      }>;
    };
    expect(body.total).toBe(1);
    expect(body.mandates[0]!.status).toBe("active");
    expect(body.mandates[0]!.constraints.amountLimits.perTransactionMaxPaise).toBe("500000");
  });

  it("returns an empty list for a wallet with no active mandates", async () => {
    const { jwks } = await getTestKeys();
    const repo = new FakeMandateRepository();
    server = createServer({
      jwks,
      environment: "test",
      mandateRepository: repo as unknown as MandateRepository,
    });
    await server.ready();

    const token = await createWalletOwnerToken(TEST_WALLET_ID);
    const response = await server.inject({
      method: "GET",
      url: `/control/v1/wallets/${TEST_WALLET_ID}/mandates`,
      headers: { authorization: `Bearer ${token}` },
    });

    const body = JSON.parse(response.body) as { total: number };
    expect(body.total).toBe(0);
  });

  it("a DIFFERENT wallet's token gets 404, not 403 or the other wallet's data (existence-hiding + isolation)", async () => {
    const { jwks } = await getTestKeys();
    const repo = new FakeMandateRepository();
    repo.seed(TEST_WALLET_ID, [mandate()]);
    server = createServer({
      jwks,
      environment: "test",
      mandateRepository: repo as unknown as MandateRepository,
    });
    await server.ready();

    const token = await createWalletOwnerToken(OTHER_WALLET_ID);
    const response = await server.inject({
      method: "GET",
      url: `/control/v1/wallets/${TEST_WALLET_ID}/mandates`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(404);
  });

  it("requires authentication (401)", async () => {
    const { jwks } = await getTestKeys();
    const repo = new FakeMandateRepository();
    server = createServer({
      jwks,
      environment: "test",
      mandateRepository: repo as unknown as MandateRepository,
    });
    await server.ready();

    const response = await server.inject({
      method: "GET",
      url: `/control/v1/wallets/${TEST_WALLET_ID}/mandates`,
    });

    expect(response.statusCode).toBe(401);
  });
});

describe("wallet-mandate revoke route", () => {
  let server: FastifyInstance | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("revokes an active mandate (200) with step-up assurance", async () => {
    const { jwks } = await getTestKeys();
    const repo = new FakeMandateRepository();
    repo.seed(TEST_WALLET_ID, [mandate()]);
    server = createServer({
      jwks,
      environment: "test",
      mandateRepository: repo as unknown as MandateRepository,
    });
    await server.ready();

    const token = await createWalletOwnerToken(TEST_WALLET_ID, "step_up");
    const response = await server.inject({
      method: "POST",
      url: `/control/v1/wallets/${TEST_WALLET_ID}/mandates/ctr_mandate_AAAAAAAAAAAAAAAAAAAAAA/revoke`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { mandate: { status: string } };
    expect(body.mandate.status).toBe("revoked");

    // Takes effect immediately against the SAME read path checkMandateAuthority uses.
    const active = await repo.findActive(TEST_WALLET_ID as CounterId<"wallet">);
    expect(active).toHaveLength(0);
  });

  it("rejects a plain session token — revoke requires the same step-up bar as issuing a mandate (403)", async () => {
    const { jwks } = await getTestKeys();
    const repo = new FakeMandateRepository();
    repo.seed(TEST_WALLET_ID, [mandate()]);
    server = createServer({
      jwks,
      environment: "test",
      mandateRepository: repo as unknown as MandateRepository,
    });
    await server.ready();

    const token = await createWalletOwnerToken(TEST_WALLET_ID, "session");
    const response = await server.inject({
      method: "POST",
      url: `/control/v1/wallets/${TEST_WALLET_ID}/mandates/ctr_mandate_AAAAAAAAAAAAAAAAAAAAAA/revoke`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(403);
    const active = await repo.findActive(TEST_WALLET_ID as CounterId<"wallet">);
    expect(active).toHaveLength(1);
  });

  it("returns 409 for a mandate that is already revoked, without erasing its status", async () => {
    const { jwks } = await getTestKeys();
    const repo = new FakeMandateRepository();
    repo.seed(TEST_WALLET_ID, [mandate({ status: "revoked" })]);
    server = createServer({
      jwks,
      environment: "test",
      mandateRepository: repo as unknown as MandateRepository,
    });
    await server.ready();

    const token = await createWalletOwnerToken(TEST_WALLET_ID, "step_up");
    const response = await server.inject({
      method: "POST",
      url: `/control/v1/wallets/${TEST_WALLET_ID}/mandates/ctr_mandate_AAAAAAAAAAAAAAAAAAAAAA/revoke`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(409);
  });

  it("returns 409 for an expired mandate rather than silently relabeling it revoked", async () => {
    const { jwks } = await getTestKeys();
    const repo = new FakeMandateRepository();
    repo.seed(TEST_WALLET_ID, [mandate({ status: "expired" })]);
    server = createServer({
      jwks,
      environment: "test",
      mandateRepository: repo as unknown as MandateRepository,
    });
    await server.ready();

    const token = await createWalletOwnerToken(TEST_WALLET_ID, "step_up");
    const response = await server.inject({
      method: "POST",
      url: `/control/v1/wallets/${TEST_WALLET_ID}/mandates/ctr_mandate_AAAAAAAAAAAAAAAAAAAAAA/revoke`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(409);
  });

  it("a mandate id that belongs to a DIFFERENT wallet gets 404, not 403 (existence-hiding)", async () => {
    const { jwks } = await getTestKeys();
    const repo = new FakeMandateRepository();
    repo.seed(TEST_WALLET_ID, [mandate()]);
    server = createServer({
      jwks,
      environment: "test",
      mandateRepository: repo as unknown as MandateRepository,
    });
    await server.ready();

    const token = await createWalletOwnerToken(OTHER_WALLET_ID, "step_up");
    const response = await server.inject({
      method: "POST",
      url: `/control/v1/wallets/${OTHER_WALLET_ID}/mandates/ctr_mandate_AAAAAAAAAAAAAAAAAAAAAA/revoke`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(404);
  });

  it("an unknown mandate id gets 404", async () => {
    const { jwks } = await getTestKeys();
    const repo = new FakeMandateRepository();
    server = createServer({
      jwks,
      environment: "test",
      mandateRepository: repo as unknown as MandateRepository,
    });
    await server.ready();

    const token = await createWalletOwnerToken(TEST_WALLET_ID, "step_up");
    const response = await server.inject({
      method: "POST",
      url: `/control/v1/wallets/${TEST_WALLET_ID}/mandates/ctr_mandate_doesnotexist000000000/revoke`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(404);
  });

  it("requires authentication (401)", async () => {
    const { jwks } = await getTestKeys();
    const repo = new FakeMandateRepository();
    repo.seed(TEST_WALLET_ID, [mandate()]);
    server = createServer({
      jwks,
      environment: "test",
      mandateRepository: repo as unknown as MandateRepository,
    });
    await server.ready();

    const response = await server.inject({
      method: "POST",
      url: `/control/v1/wallets/${TEST_WALLET_ID}/mandates/ctr_mandate_AAAAAAAAAAAAAAAAAAAAAA/revoke`,
    });

    expect(response.statusCode).toBe(401);
  });
});
