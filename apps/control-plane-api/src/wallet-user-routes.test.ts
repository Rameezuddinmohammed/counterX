import { describe, expect, it, afterEach } from "vitest";
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from "jose";
import { createServer } from "./index.js";
import type {
  WalletUserProvisionerLike,
  ProvisionResult,
  SetupTokenResult,
  AgentKeyResult,
  RuntimeCredentialResult,
} from "./wallet-user-store.js";
import type { FastifyInstance } from "fastify";

// --- Test helpers ---

const TEST_ISSUER = "https://dev-jzw3etjxnn3svs56.us.auth0.com/";
const TEST_AUDIENCE = "https://api.counter.dev";
const CLAIMS_NAMESPACE = "https://counter.dev/";
const TEST_WALLET_ID = "ctr_wallet_AAAAAAAAAAAAAAAAAAAAAA";
const OTHER_WALLET_ID = "ctr_wallet_BBBBBBBBBBBBBBBBBBBBBB";
const TEST_KEY_ID = "ctr_key_AAAAAAAAAAAAAAAAAAAAAA";

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

/** Mirrors the claims the "stamp provisioner token" Credentials Exchange Action stamps. */
async function createOnboardingServiceToken(claims: Record<string, unknown> = {}): Promise<string> {
  const { privateKey } = await getTestKeys();
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    sub: "counter-onboarding-provisioner@clients",
    [`${CLAIMS_NAMESPACE}actor_kind`]: "service",
    [`${CLAIMS_NAMESPACE}environment`]: "test",
    [`${CLAIMS_NAMESPACE}scope`]: { kind: "platform" },
    [`${CLAIMS_NAMESPACE}roles`]: ["service.onboarding"],
    [`${CLAIMS_NAMESPACE}assurance`]: "service_authenticated",
    ...claims,
  })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(TEST_ISSUER)
    .setAudience(TEST_AUDIENCE)
    .setExpirationTime(now + 3600)
    .setIssuedAt(now)
    .sign(privateKey);
}

/** Mirrors the wallet-owner claims the "provision wallet + stamp session" Post-Login Action stamps. */
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
    [`${CLAIMS_NAMESPACE}assurance`]: "session",
    ...claims,
  })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(TEST_ISSUER)
    .setAudience(TEST_AUDIENCE)
    .setExpirationTime(now + 3600)
    .setIssuedAt(now)
    .sign(privateKey);
}

class FakeWalletUserProvisioner implements WalletUserProvisionerLike {
  #walletsBySubject = new Map<string, string>();
  #setupTokens = new Map<string, { walletId: string; used: boolean }>();
  #registeredKeys: Array<{ walletId: string; keyId: string; publicKeyBase64Url: string }> = [];
  #tokenCounter = 0;
  /** undefined = simulate "no runtime credential configured" (the real class's default). */
  runtimeCredential: RuntimeCredentialResult | undefined = undefined;

  async provisionForAuth0Subject(auth0Subject: string): Promise<ProvisionResult> {
    const existing = this.#walletsBySubject.get(auth0Subject);
    if (existing !== undefined) {
      return { walletId: existing, walletUserActorId: `actor_${existing}`, created: false };
    }
    const walletId = `ctr_wallet_generated_${this.#walletsBySubject.size}`;
    this.#walletsBySubject.set(auth0Subject, walletId);
    return { walletId, walletUserActorId: `actor_${walletId}`, created: true };
  }

  async mintSetupToken(walletId: string): Promise<SetupTokenResult> {
    const setupToken = `token_${this.#tokenCounter++}`;
    this.#setupTokens.set(setupToken, { walletId, used: false });
    return { setupToken, expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString() };
  }

  async redeemSetupToken(rawToken: string): Promise<string | undefined> {
    const entry = this.#setupTokens.get(rawToken);
    if (entry === undefined || entry.used) {
      return undefined;
    }
    entry.used = true;
    return entry.walletId;
  }

  async registerAgentKey(
    walletId: string,
    keyId: string,
    publicKeyBase64Url: string,
  ): Promise<AgentKeyResult> {
    this.#registeredKeys.push({ walletId, keyId, publicKeyBase64Url });
    return {
      agentId: `ctr_agent_generated_${this.#registeredKeys.length}`,
      keyId,
    };
  }

  async mintRuntimeCredential(_walletId: string, _agentId: string): Promise<RuntimeCredentialResult> {
    if (this.runtimeCredential === undefined) {
      throw new Error("No runtime credential is configured for this deployment");
    }
    return this.runtimeCredential;
  }
}

// --- Tests ---

describe("wallet-user routes", () => {
  let server: FastifyInstance | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  describe("POST /wallet-users/provision", () => {
    it("unauthenticated request returns 401", async () => {
      const { jwks } = await getTestKeys();
      server = createServer({
        jwks,
        environment: "test",
        walletUserProvisioner: new FakeWalletUserProvisioner(),
      });
      await server.ready();

      const response = await server.inject({
        method: "POST",
        url: "/control/v1/wallet-users/provision",
        payload: { auth0Subject: "auth0|someone" },
      });
      expect(response.statusCode).toBe(401);
    });

    it("a token without identity.scope.manage (e.g. wallet.owner) is denied 403", async () => {
      const { jwks } = await getTestKeys();
      server = createServer({
        jwks,
        environment: "test",
        walletUserProvisioner: new FakeWalletUserProvisioner(),
      });
      await server.ready();

      const token = await createWalletOwnerToken(TEST_WALLET_ID);
      const response = await server.inject({
        method: "POST",
        url: "/control/v1/wallet-users/provision",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: { auth0Subject: "auth0|someone" },
      });
      expect(response.statusCode).toBe(403);
    });

    it("a service.onboarding token provisions a wallet (201) and is idempotent (200) on repeat", async () => {
      const { jwks } = await getTestKeys();
      server = createServer({
        jwks,
        environment: "test",
        walletUserProvisioner: new FakeWalletUserProvisioner(),
      });
      await server.ready();

      const token = await createOnboardingServiceToken();
      const first = await server.inject({
        method: "POST",
        url: "/control/v1/wallet-users/provision",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: { auth0Subject: "auth0|someone" },
      });
      expect(first.statusCode).toBe(201);
      const firstBody = JSON.parse(first.body) as { walletId: string; created: boolean };
      expect(firstBody.created).toBe(true);

      const second = await server.inject({
        method: "POST",
        url: "/control/v1/wallet-users/provision",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: { auth0Subject: "auth0|someone" },
      });
      expect(second.statusCode).toBe(200);
      const secondBody = JSON.parse(second.body) as { walletId: string; created: boolean };
      expect(secondBody.created).toBe(false);
      expect(secondBody.walletId).toBe(firstBody.walletId);
    });

    it("missing auth0Subject returns 400", async () => {
      const { jwks } = await getTestKeys();
      server = createServer({
        jwks,
        environment: "test",
        walletUserProvisioner: new FakeWalletUserProvisioner(),
      });
      await server.ready();

      const token = await createOnboardingServiceToken();
      const response = await server.inject({
        method: "POST",
        url: "/control/v1/wallet-users/provision",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        payload: {},
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe("POST /wallet-users/:walletId/setup-tokens", () => {
    it("a wallet-owner token scoped to a DIFFERENT wallet gets 404, not 403 (existence-hiding)", async () => {
      const { jwks } = await getTestKeys();
      server = createServer({
        jwks,
        environment: "test",
        walletUserProvisioner: new FakeWalletUserProvisioner(),
      });
      await server.ready();

      // identity.agent_key.manage requires step-up assurance (scope-enforcement
      // now actually checks this, not just role-derived permission) — the
      // route's own existence-hiding logic is only reached once that gate
      // passes.
      const token = await createWalletOwnerToken(OTHER_WALLET_ID, {
        [`${CLAIMS_NAMESPACE}assurance`]: "step_up",
      });
      const response = await server.inject({
        method: "POST",
        url: `/control/v1/wallet-users/${TEST_WALLET_ID}/setup-tokens`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body) as { error: { code: string } };
      expect(body.error.code).toBe("NOT_FOUND");
    });

    it("a wallet-owner token scoped to its OWN wallet mints a setup token (201)", async () => {
      const { jwks } = await getTestKeys();
      server = createServer({
        jwks,
        environment: "test",
        walletUserProvisioner: new FakeWalletUserProvisioner(),
      });
      await server.ready();

      const token = await createWalletOwnerToken(TEST_WALLET_ID, {
        [`${CLAIMS_NAMESPACE}assurance`]: "step_up",
      });
      const response = await server.inject({
        method: "POST",
        url: `/control/v1/wallet-users/${TEST_WALLET_ID}/setup-tokens`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body) as { setupToken: string; expiresAt: string };
      expect(body.setupToken.length).toBeGreaterThan(0);
    });

    it("a service.onboarding token cannot mint setup tokens (its only permission is identity.scope.manage)", async () => {
      const { jwks } = await getTestKeys();
      server = createServer({
        jwks,
        environment: "test",
        walletUserProvisioner: new FakeWalletUserProvisioner(),
      });
      await server.ready();

      const token = await createOnboardingServiceToken();
      const response = await server.inject({
        method: "POST",
        url: `/control/v1/wallet-users/${TEST_WALLET_ID}/setup-tokens`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(403);
    });
  });

  describe("POST /wallet-users/agent-keys (deliberately unauthenticated)", () => {
    it("works without any Authorization header at all, and degrades gracefully with no runtime credential configured", async () => {
      const { jwks } = await getTestKeys();
      const provisioner = new FakeWalletUserProvisioner();
      server = createServer({ jwks, environment: "test", walletUserProvisioner: provisioner });
      await server.ready();

      const { setupToken } = await provisioner.mintSetupToken(TEST_WALLET_ID);
      const response = await server.inject({
        method: "POST",
        url: "/control/v1/wallet-users/agent-keys",
        headers: { "content-type": "application/json" },
        payload: { setupToken, keyId: TEST_KEY_ID, publicKeyBase64Url: "ZmFrZS1wdWJsaWMta2V5" },
      });
      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body) as {
        walletId: string;
        agentId: string;
        keyId: string;
        runtimeUrl?: string;
        runtimeAuthToken?: string;
      };
      expect(body.walletId).toBe(TEST_WALLET_ID);
      expect(body.keyId).toBe(TEST_KEY_ID);
      // Key registration must still succeed even though no runtime credential
      // is configured on this fake — that's the graceful-degradation contract.
      expect(body.runtimeUrl).toBeUndefined();
      expect(body.runtimeAuthToken).toBeUndefined();
    });

    it("includes a runtime credential in the response when the deployment has one configured", async () => {
      const { jwks } = await getTestKeys();
      const provisioner = new FakeWalletUserProvisioner();
      provisioner.runtimeCredential = {
        runtimeUrl: "https://counter-agent-runtime.fly.dev",
        runtimeAuthToken: "fake-runtime-token",
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      };
      server = createServer({ jwks, environment: "test", walletUserProvisioner: provisioner });
      await server.ready();

      const { setupToken } = await provisioner.mintSetupToken(TEST_WALLET_ID);
      const response = await server.inject({
        method: "POST",
        url: "/control/v1/wallet-users/agent-keys",
        headers: { "content-type": "application/json" },
        payload: { setupToken, keyId: TEST_KEY_ID, publicKeyBase64Url: "ZmFrZS1wdWJsaWMta2V5" },
      });
      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body) as {
        runtimeUrl?: string;
        runtimeAuthToken?: string;
      };
      expect(body.runtimeUrl).toBe("https://counter-agent-runtime.fly.dev");
      expect(body.runtimeAuthToken).toBe("fake-runtime-token");
    });

    it("rejects a reused setup token", async () => {
      const { jwks } = await getTestKeys();
      const provisioner = new FakeWalletUserProvisioner();
      server = createServer({ jwks, environment: "test", walletUserProvisioner: provisioner });
      await server.ready();

      const { setupToken } = await provisioner.mintSetupToken(TEST_WALLET_ID);
      const payload = {
        setupToken,
        keyId: TEST_KEY_ID,
        publicKeyBase64Url: "ZmFrZS1wdWJsaWMta2V5",
      };

      const first = await server.inject({
        method: "POST",
        url: "/control/v1/wallet-users/agent-keys",
        headers: { "content-type": "application/json" },
        payload,
      });
      expect(first.statusCode).toBe(201);

      const second = await server.inject({
        method: "POST",
        url: "/control/v1/wallet-users/agent-keys",
        headers: { "content-type": "application/json" },
        payload,
      });
      expect(second.statusCode).toBe(401);
    });

    it("rejects an unknown setup token", async () => {
      const { jwks } = await getTestKeys();
      server = createServer({
        jwks,
        environment: "test",
        walletUserProvisioner: new FakeWalletUserProvisioner(),
      });
      await server.ready();

      const response = await server.inject({
        method: "POST",
        url: "/control/v1/wallet-users/agent-keys",
        headers: { "content-type": "application/json" },
        payload: {
          setupToken: "not-a-real-token",
          keyId: TEST_KEY_ID,
          publicKeyBase64Url: "ZmFrZS1wdWJsaWMta2V5",
        },
      });
      expect(response.statusCode).toBe(401);
    });

    it("missing keyId returns 400", async () => {
      const { jwks } = await getTestKeys();
      const provisioner = new FakeWalletUserProvisioner();
      server = createServer({ jwks, environment: "test", walletUserProvisioner: provisioner });
      await server.ready();

      const { setupToken } = await provisioner.mintSetupToken(TEST_WALLET_ID);
      const response = await server.inject({
        method: "POST",
        url: "/control/v1/wallet-users/agent-keys",
        headers: { "content-type": "application/json" },
        payload: { setupToken, publicKeyBase64Url: "ZmFrZS1wdWJsaWMta2V5" },
      });
      expect(response.statusCode).toBe(400);
    });

    it("missing publicKeyBase64Url returns 400", async () => {
      const { jwks } = await getTestKeys();
      const provisioner = new FakeWalletUserProvisioner();
      server = createServer({ jwks, environment: "test", walletUserProvisioner: provisioner });
      await server.ready();

      const { setupToken } = await provisioner.mintSetupToken(TEST_WALLET_ID);
      const response = await server.inject({
        method: "POST",
        url: "/control/v1/wallet-users/agent-keys",
        headers: { "content-type": "application/json" },
        payload: { setupToken, keyId: TEST_KEY_ID },
      });
      expect(response.statusCode).toBe(400);
    });
  });
});
