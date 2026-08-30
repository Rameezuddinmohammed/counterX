import { describe, expect, it, afterEach } from "vitest";
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from "jose";
import { createServer } from "./index.js";
import type {
  RecurringMandateProvisionerLike,
  BeginRegistrationParams,
  BeginRegistrationResult,
  ConfirmRegistrationParams,
  RecurringMandateSummary,
} from "./recurring-mandate-store.js";
import type { FastifyInstance } from "fastify";

// --- Test helpers ---

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

/**
 * Mirrors the wallet-owner claims the "provision wallet + stamp session"
 * Post-Login Action stamps. Defaults to "step_up" assurance, NOT "session":
 * payment.mandate.manage requires tenantMutationAssurances (see
 * packages/authorization/src/assurance.ts) — a plain browser session is not
 * enough to register or revoke a standing recurring-payment authorization.
 */
async function createWalletOwnerToken(
  walletId: string,
  claims: Record<string, unknown> = {},
): Promise<string> {
  const { privateKey } = await getTestKeys();
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    sub: "auth0|test-wallet-user",
    [`${CLAIMS_NAMESPACE}actor_kind`]: "wallet_user",
    [`${CLAIMS_NAMESPACE}environment`]: "test",
    [`${CLAIMS_NAMESPACE}scope`]: { kind: "wallet", walletId },
    [`${CLAIMS_NAMESPACE}roles`]: ["wallet.owner"],
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

class FakeRecurringMandateProvisioner implements RecurringMandateProvisionerLike {
  #mandates = new Map<string, RecurringMandateSummary & { walletId: string }>();
  #counter = 0;
  lastBeginParams: BeginRegistrationParams | undefined;
  lastConfirmParams: ConfirmRegistrationParams | undefined;
  shouldFailConfirm = false;

  async beginRegistration(params: BeginRegistrationParams): Promise<BeginRegistrationResult> {
    this.lastBeginParams = params;
    const referenceId = `ctr_payment-reference_generated_${this.#counter++}`;
    this.#mandates.set(referenceId, {
      referenceId,
      walletId: params.walletId,
      status: "pending",
      ceilingMinor: params.ceilingMinor.toString(),
      currency: "INR",
      validFrom: new Date().toISOString(),
      validUntil: params.validUntil,
      eligibleMerchants: params.eligibleMerchants,
      eligibleOperations: params.eligibleOperations,
    });
    return {
      referenceId,
      checkout: {
        razorpayOrderId: "order_fake001",
        razorpayKeyId: "rzp_test_fakekey",
        razorpayCustomerId: "cust_fake001",
        amountMinor: params.ceilingMinor.toString(),
        currency: "INR",
      },
    };
  }

  async confirmRegistration(params: ConfirmRegistrationParams): Promise<RecurringMandateSummary> {
    this.lastConfirmParams = params;
    if (this.shouldFailConfirm) {
      throw new Error("Mandate registration callback signature could not be verified");
    }
    const existing = this.#mandates.get(params.referenceId);
    if (existing === undefined || existing.walletId !== params.walletId) {
      throw new Error("No such pending mandate registration");
    }
    const updated = { ...existing, status: "active" as const };
    this.#mandates.set(params.referenceId, updated);
    return updated;
  }

  async revoke(walletId: string, referenceId: string): Promise<void> {
    const existing = this.#mandates.get(referenceId);
    if (existing === undefined || existing.walletId !== walletId) {
      throw new Error("No such mandate");
    }
    this.#mandates.set(referenceId, { ...existing, status: "revoked" });
  }

  async list(walletId: string): Promise<readonly RecurringMandateSummary[]> {
    return [...this.#mandates.values()].filter((m) => m.walletId === walletId);
  }
}

const VALID_BODY = {
  contactName: "Test Buyer",
  contactEmail: "buyer@example.com",
  contactPhone: "+911234567890",
  validUntil: "2027-01-01T00:00:00Z",
  ceilingMinor: "500000",
  eligibleMerchants: ["ctr_merchant_test"],
  eligibleOperations: ["purchase"],
};

// --- Tests ---

describe("recurring-mandate routes", () => {
  let server: FastifyInstance | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  describe("POST /wallets/:walletId/recurring-mandates", () => {
    it("unauthenticated request returns 401", async () => {
      const { jwks } = await getTestKeys();
      server = createServer({
        jwks,
        environment: "test",
        recurringMandateProvisioner: new FakeRecurringMandateProvisioner(),
      });
      await server.ready();

      const response = await server.inject({
        method: "POST",
        url: `/control/v1/wallets/${TEST_WALLET_ID}/recurring-mandates`,
        payload: VALID_BODY,
      });
      expect(response.statusCode).toBe(401);
    });

    it("a wallet-owner token for a DIFFERENT wallet gets 404, not 403 (existence-hiding)", async () => {
      const { jwks } = await getTestKeys();
      server = createServer({
        jwks,
        environment: "test",
        recurringMandateProvisioner: new FakeRecurringMandateProvisioner(),
      });
      await server.ready();

      const token = await createWalletOwnerToken(OTHER_WALLET_ID);
      const response = await server.inject({
        method: "POST",
        url: `/control/v1/wallets/${TEST_WALLET_ID}/recurring-mandates`,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: VALID_BODY,
      });
      expect(response.statusCode).toBe(404);
    });

    // NOTE: payment.mandate.manage is declared to require step-up assurance
    // in packages/authorization/src/assurance.ts (tenantMutationAssurances),
    // and packages/authorization/src/authorize.ts's authorize() correctly
    // enforces that. But this app's actual HTTP permission gate
    // (packages/http-api-kit/src/scope-enforcement.ts) only checks
    // actorContext.permissions.includes(permission) — it never calls
    // authorize()/assurancePermits at all, for ANY route in this app, not
    // just this one. So a plain-session token currently succeeds here too.
    // This is a real, pre-existing gap (flagged to the founder when found,
    // not silently worked around) — out of scope to fix as part of adding
    // one new route; the catalog/assurance declaration above is still the
    // right foundation for when scope-enforcement.ts is wired to use it.
    it("a plain-session wallet-owner token currently still succeeds (documents the assurance-enforcement gap, not desired behavior)", async () => {
      const { jwks } = await getTestKeys();
      server = createServer({
        jwks,
        environment: "test",
        recurringMandateProvisioner: new FakeRecurringMandateProvisioner(),
      });
      await server.ready();

      const token = await createWalletOwnerToken(TEST_WALLET_ID, {
        [`${CLAIMS_NAMESPACE}assurance`]: "session",
      });
      const response = await server.inject({
        method: "POST",
        url: `/control/v1/wallets/${TEST_WALLET_ID}/recurring-mandates`,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: VALID_BODY,
      });
      expect(response.statusCode).toBe(201);
    });

    it("a step-up wallet-owner token successfully begins registration", async () => {
      const { jwks } = await getTestKeys();
      const provisioner = new FakeRecurringMandateProvisioner();
      server = createServer({
        jwks,
        environment: "test",
        recurringMandateProvisioner: provisioner,
      });
      await server.ready();

      const token = await createWalletOwnerToken(TEST_WALLET_ID);
      const response = await server.inject({
        method: "POST",
        url: `/control/v1/wallets/${TEST_WALLET_ID}/recurring-mandates`,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: VALID_BODY,
      });
      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body) as BeginRegistrationResult;
      expect(body.referenceId).toMatch(/^ctr_payment-reference_/);
      expect(body.checkout.razorpayKeyId).toBe("rzp_test_fakekey");
      expect(provisioner.lastBeginParams?.walletId).toBe(TEST_WALLET_ID);
      expect(provisioner.lastBeginParams?.ceilingMinor).toBe(500000n);
    });

    it("missing contactPhone returns 400", async () => {
      const { jwks } = await getTestKeys();
      server = createServer({
        jwks,
        environment: "test",
        recurringMandateProvisioner: new FakeRecurringMandateProvisioner(),
      });
      await server.ready();

      const token = await createWalletOwnerToken(TEST_WALLET_ID);
      const { contactPhone: _drop, ...bodyWithoutPhone } = VALID_BODY;
      const response = await server.inject({
        method: "POST",
        url: `/control/v1/wallets/${TEST_WALLET_ID}/recurring-mandates`,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: bodyWithoutPhone,
      });
      expect(response.statusCode).toBe(400);
    });

    it("a non-positive ceilingMinor returns 400", async () => {
      const { jwks } = await getTestKeys();
      server = createServer({
        jwks,
        environment: "test",
        recurringMandateProvisioner: new FakeRecurringMandateProvisioner(),
      });
      await server.ready();

      const token = await createWalletOwnerToken(TEST_WALLET_ID);
      const response = await server.inject({
        method: "POST",
        url: `/control/v1/wallets/${TEST_WALLET_ID}/recurring-mandates`,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: { ...VALID_BODY, ceilingMinor: "0" },
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe("POST /wallets/:walletId/recurring-mandates/:referenceId/confirm", () => {
    it("activates a pending mandate on a successful callback verification", async () => {
      const { jwks } = await getTestKeys();
      const provisioner = new FakeRecurringMandateProvisioner();
      server = createServer({
        jwks,
        environment: "test",
        recurringMandateProvisioner: provisioner,
      });
      await server.ready();

      const token = await createWalletOwnerToken(TEST_WALLET_ID);
      const begin = await server.inject({
        method: "POST",
        url: `/control/v1/wallets/${TEST_WALLET_ID}/recurring-mandates`,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: VALID_BODY,
      });
      const { referenceId } = JSON.parse(begin.body) as BeginRegistrationResult;

      const response = await server.inject({
        method: "POST",
        url: `/control/v1/wallets/${TEST_WALLET_ID}/recurring-mandates/${referenceId}/confirm`,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: {
          razorpayOrderId: "order_fake001",
          razorpayPaymentId: "pay_fake001",
          razorpaySignature: "sig_fake001",
        },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as RecurringMandateSummary;
      expect(body.status).toBe("active");
    });

    it("returns 400 when the provisioner rejects the callback", async () => {
      const { jwks } = await getTestKeys();
      const provisioner = new FakeRecurringMandateProvisioner();
      provisioner.shouldFailConfirm = true;
      server = createServer({
        jwks,
        environment: "test",
        recurringMandateProvisioner: provisioner,
      });
      await server.ready();

      const token = await createWalletOwnerToken(TEST_WALLET_ID);
      const response = await server.inject({
        method: "POST",
        url: `/control/v1/wallets/${TEST_WALLET_ID}/recurring-mandates/ctr_payment-reference_x/confirm`,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: {
          razorpayOrderId: "order_fake001",
          razorpayPaymentId: "pay_fake001",
          razorpaySignature: "bad-signature",
        },
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe("DELETE /wallets/:walletId/recurring-mandates/:referenceId", () => {
    it("revokes an existing mandate", async () => {
      const { jwks } = await getTestKeys();
      const provisioner = new FakeRecurringMandateProvisioner();
      server = createServer({
        jwks,
        environment: "test",
        recurringMandateProvisioner: provisioner,
      });
      await server.ready();

      const token = await createWalletOwnerToken(TEST_WALLET_ID);
      const begin = await server.inject({
        method: "POST",
        url: `/control/v1/wallets/${TEST_WALLET_ID}/recurring-mandates`,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: VALID_BODY,
      });
      const { referenceId } = JSON.parse(begin.body) as BeginRegistrationResult;

      const response = await server.inject({
        method: "DELETE",
        url: `/control/v1/wallets/${TEST_WALLET_ID}/recurring-mandates/${referenceId}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(204);

      const list = await server.inject({
        method: "GET",
        url: `/control/v1/wallets/${TEST_WALLET_ID}/recurring-mandates`,
        headers: { authorization: `Bearer ${token}` },
      });
      const { mandates } = JSON.parse(list.body) as {
        mandates: readonly RecurringMandateSummary[];
      };
      expect(mandates[0]?.status).toBe("revoked");
    });

    it("returns 404 for a mandate that doesn't exist", async () => {
      const { jwks } = await getTestKeys();
      server = createServer({
        jwks,
        environment: "test",
        recurringMandateProvisioner: new FakeRecurringMandateProvisioner(),
      });
      await server.ready();

      const token = await createWalletOwnerToken(TEST_WALLET_ID);
      const response = await server.inject({
        method: "DELETE",
        url: `/control/v1/wallets/${TEST_WALLET_ID}/recurring-mandates/ctr_payment-reference_nope`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe("GET /wallets/:walletId/recurring-mandates", () => {
    it("lists mandates for the wallet, accessible at plain session assurance (read-only)", async () => {
      const { jwks } = await getTestKeys();
      const provisioner = new FakeRecurringMandateProvisioner();
      server = createServer({
        jwks,
        environment: "test",
        recurringMandateProvisioner: provisioner,
      });
      await server.ready();

      const stepUpToken = await createWalletOwnerToken(TEST_WALLET_ID);
      await server.inject({
        method: "POST",
        url: `/control/v1/wallets/${TEST_WALLET_ID}/recurring-mandates`,
        headers: { authorization: `Bearer ${stepUpToken}`, "content-type": "application/json" },
        payload: VALID_BODY,
      });

      const sessionToken = await createWalletOwnerToken(TEST_WALLET_ID, {
        [`${CLAIMS_NAMESPACE}assurance`]: "session",
      });
      const response = await server.inject({
        method: "GET",
        url: `/control/v1/wallets/${TEST_WALLET_ID}/recurring-mandates`,
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      expect(response.statusCode).toBe(200);
      const { mandates } = JSON.parse(response.body) as {
        mandates: readonly RecurringMandateSummary[];
      };
      expect(mandates.length).toBe(1);
    });
  });
});
