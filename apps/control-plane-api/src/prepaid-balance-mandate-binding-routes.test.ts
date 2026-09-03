import { describe, expect, it, afterEach } from "vitest";
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from "jose";
import {
  buildUnsignedEnvelope,
  signEnvelope,
  InMemoryKeyRegistry,
  TEST_KID_A,
  TEST_KEY_RECORD_A,
  createTestSignerA,
  type MandatePayload,
} from "@counter/trust-protocol";
import { InMemoryMandateRepository } from "@counter/wallet-domain";
import type { FastifyInstance } from "fastify";
import { createServer } from "./index.js";
import {
  PrepaidBalanceMandateBindingService,
  prepaidBalancePaymentReference,
  type WalletBalanceAccountLookup,
} from "./prepaid-balance-mandate-binding-store.js";

const TEST_ISSUER = "https://dev-jzw3etjxnn3svs56.us.auth0.com/";
const TEST_AUDIENCE = "https://api.counter.dev";
const CLAIMS_NAMESPACE = "https://counter.dev/";
const WALLET_ID = "ctr_wallet_AAAAAAAAAAAAAAAAAAAAAA";
const OTHER_WALLET_ID = "ctr_wallet_BBBBBBBBBBBBBBBBBBBBBB";
const AGENT_ID = "ctr_agent_AAAAAAAAAAAAAAAAAAAAAAA";
const PRINCIPAL_ID = "ctr_actor_AAAAAAAAAAAAAAAAAAAAAA";
const MANDATE_ID = "ctr_mandate_AAAAAAAAAAAAAAAAAAAA";
const REFERENCE_ID = prepaidBalancePaymentReference(WALLET_ID);

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

/** Mirrors mandate-binding-routes.test.ts: payment.mandate.manage requires step-up. */
async function createWalletOwnerToken(walletId: string, assurance = "step_up"): Promise<string> {
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

class FakeWalletBalance implements WalletBalanceAccountLookup {
  async hasBalanceAccount(): Promise<boolean> {
    return true;
  }
}

function buildBindingService(): PrepaidBalanceMandateBindingService {
  return new PrepaidBalanceMandateBindingService(
    new InMemoryMandateRepository(),
    new InMemoryKeyRegistry([TEST_KEY_RECORD_A]),
    new FakeWalletBalance(),
  );
}

async function signedMandateEnvelope() {
  const payload: MandatePayload = {
    mandate_id: MANDATE_ID,
    principal_id: PRINCIPAL_ID,
    wallet_id: WALLET_ID,
    agent_id: AGENT_ID,
    kid: TEST_KID_A,
    allowed_merchants: ["ctr_merchant_allowed"],
    currencies: ["INR"],
    per_transaction_limit: { amount: 100_000, currency: "INR" },
    allowed_operations: ["purchase"],
    payment_authorization_ref: REFERENCE_ID,
    // Wide window: the route handler uses the REAL system clock (new
    // Date()), not an injectable one — must safely cover "now" whenever
    // this suite runs, but stay within the service's default 365-day
    // max-validity policy relative to whenever that "now" actually is.
    // Using a window that starts recently and lasts under a year keeps
    // this safe without hardcoding a specific "now".
    validity_start: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    validity_end: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(),
    policy_version: "v1",
    policy_digest: "sha256:v1",
  };
  const unsignedResult = buildUnsignedEnvelope<MandatePayload>({
    type: "counter.mandate.v1",
    id: `mandate-${MANDATE_ID}`,
    issuer: `counter://wallet/${WALLET_ID}`,
    subject: `counter://agent/${AGENT_ID}`,
    audience: [`counter://wallet/${WALLET_ID}`, `counter://agent/${AGENT_ID}`],
    environment: "pilot",
    issued_at: new Date().toISOString(),
    not_before: payload.validity_start,
    expires_at: payload.validity_end,
    nonce: "prepaid-mandate-nonce-test-001",
    correlation_id: "corr-test-001",
    payload,
    kid: TEST_KID_A,
  });
  if (!unsignedResult.ok) throw new Error("fixture setup failed");
  const signedResult = await signEnvelope(unsignedResult.value, createTestSignerA());
  if (!signedResult.ok) throw new Error("fixture setup failed");
  return signedResult.value;
}

describe("prepaid-balance-mandate-binding routes", () => {
  let server: FastifyInstance | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("unauthenticated request returns 401", async () => {
    const { jwks } = await getTestKeys();
    server = createServer({
      jwks,
      environment: "test",
      prepaidBalanceMandateBindingService: buildBindingService(),
    });
    await server.ready();

    const envelope = await signedMandateEnvelope();
    const response = await server.inject({
      method: "POST",
      url: `/control/v1/wallets/${WALLET_ID}/prepaid-mandates`,
      payload: { envelope },
    });
    expect(response.statusCode).toBe(401);
  });

  it("a wallet-owner token for a DIFFERENT wallet gets 404, not 403 (existence-hiding)", async () => {
    const { jwks } = await getTestKeys();
    server = createServer({
      jwks,
      environment: "test",
      prepaidBalanceMandateBindingService: buildBindingService(),
    });
    await server.ready();

    const envelope = await signedMandateEnvelope();
    const token = await createWalletOwnerToken(OTHER_WALLET_ID);
    const response = await server.inject({
      method: "POST",
      url: `/control/v1/wallets/${WALLET_ID}/prepaid-mandates`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { envelope },
    });
    expect(response.statusCode).toBe(404);
  });

  it("a plain-session (non-step-up) wallet-owner token is denied — granting spending authority requires step-up", async () => {
    const { jwks } = await getTestKeys();
    server = createServer({
      jwks,
      environment: "test",
      prepaidBalanceMandateBindingService: buildBindingService(),
    });
    await server.ready();

    const envelope = await signedMandateEnvelope();
    const token = await createWalletOwnerToken(WALLET_ID, "session");
    const response = await server.inject({
      method: "POST",
      url: `/control/v1/wallets/${WALLET_ID}/prepaid-mandates`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { envelope },
    });
    expect(response.statusCode).toBe(403);
  });

  it("a step-up wallet-owner token with a valid, in-bounds signed mandate envelope succeeds (201)", async () => {
    const { jwks } = await getTestKeys();
    server = createServer({
      jwks,
      environment: "test",
      prepaidBalanceMandateBindingService: buildBindingService(),
    });
    await server.ready();

    const envelope = await signedMandateEnvelope();
    const token = await createWalletOwnerToken(WALLET_ID);
    const response = await server.inject({
      method: "POST",
      url: `/control/v1/wallets/${WALLET_ID}/prepaid-mandates`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { envelope },
    });
    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body) as {
      mandateId: string;
      status: string;
      bindingKind: string;
    };
    expect(body.mandateId).toBe(MANDATE_ID);
    expect(body.status).toBe("active");
    expect(body.bindingKind).toBe("prepaid-balance");
  });

  it("missing envelope field is a 400, not a 500", async () => {
    const { jwks } = await getTestKeys();
    server = createServer({
      jwks,
      environment: "test",
      prepaidBalanceMandateBindingService: buildBindingService(),
    });
    await server.ready();

    const token = await createWalletOwnerToken(WALLET_ID);
    const response = await server.inject({
      method: "POST",
      url: `/control/v1/wallets/${WALLET_ID}/prepaid-mandates`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: {},
    });
    expect(response.statusCode).toBe(400);
  });

  it("never succeeds when no binding service is wired (route/permission not registered)", async () => {
    const { jwks } = await getTestKeys();
    server = createServer({ jwks, environment: "test" });
    await server.ready();

    const token = await createWalletOwnerToken(WALLET_ID);
    const response = await server.inject({
      method: "POST",
      url: `/control/v1/wallets/${WALLET_ID}/prepaid-mandates`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: {},
    });
    expect(response.statusCode).not.toBe(201);
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("does not affect the SEPARATE recurring-mandate route when only the prepaid service is wired", async () => {
    const { jwks } = await getTestKeys();
    server = createServer({
      jwks,
      environment: "test",
      prepaidBalanceMandateBindingService: buildBindingService(),
    });
    await server.ready();

    const token = await createWalletOwnerToken(WALLET_ID);
    const response = await server.inject({
      method: "POST",
      url: `/control/v1/wallets/${WALLET_ID}/mandates`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: {},
    });
    // The recurring-mandate route is not registered (mandateBindingService
    // was never wired in this test's server), so this must NOT succeed —
    // proving the two authority models' routes are genuinely independent.
    expect(response.statusCode).not.toBe(201);
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
  });
});
