import { describe, expect, it, afterEach } from "vitest";
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from "jose";
import { createServer } from "./index.js";
import type {
  AsyncKillSwitchStore,
  KillSwitchActivateInput,
  KillSwitchRow,
  KillSwitchScope,
} from "@counter/data";
import type { CanonicalError } from "@counter/domain";
import type { Instant } from "@counter/domain";
import type { FastifyInstance } from "fastify";

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

function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

class FakeKillSwitchStore implements AsyncKillSwitchStore {
  #rows = new Map<string, KillSwitchRow>();
  rejectNextCall = false;

  #key(scope: KillSwitchScope, entityId: string | undefined): string {
    return `${scope}:${entityId ?? ""}`;
  }

  async recordActivate(
    input: KillSwitchActivateInput,
    now: Instant,
  ): Promise<{ ok: true; value: KillSwitchRow } | { ok: false; error: CanonicalError }> {
    if (this.rejectNextCall) {
      return { ok: false, error: { kind: "canonical_error", code: "INTERNAL", category: "internal", message: "boom" } };
    }
    const row: KillSwitchRow = {
      scope: input.scope,
      entityId: input.entityId,
      status: "active",
      reason: input.reason,
      activatedBy: input.activatedBy,
      activatedAt: now,
      expiresAt: input.expiresAt,
    };
    this.#rows.set(this.#key(input.scope, input.entityId), row);
    return ok(row);
  }

  async deactivate(
    scope: KillSwitchScope,
    entityId: string | undefined,
  ): Promise<{ ok: true; value: undefined } | { ok: false; error: CanonicalError }> {
    this.#rows.delete(this.#key(scope, entityId));
    return ok(undefined);
  }

  async listActive(
    _now: Instant,
  ): Promise<{ ok: true; value: readonly KillSwitchRow[] } | { ok: false; error: CanonicalError }> {
    return ok([...this.#rows.values()]);
  }

  async isActive(
    scope: KillSwitchScope,
    entityId: string | undefined,
    _now: Instant,
  ): Promise<{ ok: true; value: boolean } | { ok: false; error: CanonicalError }> {
    return ok(this.#rows.has(this.#key(scope, entityId)));
  }
}

describe("merchant-kill-switch routes", () => {
  let server: FastifyInstance | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("GET reports inactive before any activation", async () => {
    const { jwks } = await getTestKeys();
    server = createServer({ jwks, environment: "test", merchantKillSwitchStore: new FakeKillSwitchStore() });
    await server.ready();

    const token = await createMerchantOwnerToken(TEST_MERCHANT_ID);
    const response = await server.inject({
      method: "GET",
      url: `/control/v1/merchants/${TEST_MERCHANT_ID}/kill-switch`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ active: false, reason: null, activatedAt: null });
  });

  it("POST activate then GET reports active with the given reason", async () => {
    const { jwks } = await getTestKeys();
    server = createServer({ jwks, environment: "test", merchantKillSwitchStore: new FakeKillSwitchStore() });
    await server.ready();

    const token = await createMerchantOwnerToken(TEST_MERCHANT_ID);
    const activateResponse = await server.inject({
      method: "POST",
      url: `/control/v1/merchants/${TEST_MERCHANT_ID}/kill-switch`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { active: true, reason: "Fraud spike" },
    });
    expect(activateResponse.statusCode).toBe(200);
    const activateBody = JSON.parse(activateResponse.body) as { active: boolean; reason: string };
    expect(activateBody.active).toBe(true);
    expect(activateBody.reason).toBe("Fraud spike");

    const getResponse = await server.inject({
      method: "GET",
      url: `/control/v1/merchants/${TEST_MERCHANT_ID}/kill-switch`,
      headers: { authorization: `Bearer ${token}` },
    });
    const getBody = JSON.parse(getResponse.body) as { active: boolean; reason: string };
    expect(getBody.active).toBe(true);
    expect(getBody.reason).toBe("Fraud spike");
  });

  it("POST deactivate turns it back off", async () => {
    const { jwks } = await getTestKeys();
    server = createServer({ jwks, environment: "test", merchantKillSwitchStore: new FakeKillSwitchStore() });
    await server.ready();

    const token = await createMerchantOwnerToken(TEST_MERCHANT_ID);
    await server.inject({
      method: "POST",
      url: `/control/v1/merchants/${TEST_MERCHANT_ID}/kill-switch`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { active: true },
    });
    const deactivateResponse = await server.inject({
      method: "POST",
      url: `/control/v1/merchants/${TEST_MERCHANT_ID}/kill-switch`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { active: false },
    });
    expect(deactivateResponse.statusCode).toBe(200);
    expect(JSON.parse(deactivateResponse.body)).toEqual({ active: false, reason: null, activatedAt: null });
  });

  it("rejects a body with a non-boolean 'active' field (400)", async () => {
    const { jwks } = await getTestKeys();
    server = createServer({ jwks, environment: "test", merchantKillSwitchStore: new FakeKillSwitchStore() });
    await server.ready();

    const token = await createMerchantOwnerToken(TEST_MERCHANT_ID);
    const response = await server.inject({
      method: "POST",
      url: `/control/v1/merchants/${TEST_MERCHANT_ID}/kill-switch`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { active: "yes" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("a DIFFERENT merchant's token gets 403, never touching this merchant's switch", async () => {
    const { jwks } = await getTestKeys();
    server = createServer({ jwks, environment: "test", merchantKillSwitchStore: new FakeKillSwitchStore() });
    await server.ready();

    const token = await createMerchantOwnerToken(OTHER_MERCHANT_ID);
    const response = await server.inject({
      method: "POST",
      url: `/control/v1/merchants/${TEST_MERCHANT_ID}/kill-switch`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { active: true },
    });
    expect(response.statusCode).toBe(403);
  });

  it("a store failure surfaces as 400, not a silent success", async () => {
    const { jwks } = await getTestKeys();
    const store = new FakeKillSwitchStore();
    store.rejectNextCall = true;
    server = createServer({ jwks, environment: "test", merchantKillSwitchStore: store });
    await server.ready();

    const token = await createMerchantOwnerToken(TEST_MERCHANT_ID);
    const response = await server.inject({
      method: "POST",
      url: `/control/v1/merchants/${TEST_MERCHANT_ID}/kill-switch`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { active: true },
    });
    expect(response.statusCode).toBe(400);
  });

  it("the route is not registered at all when no store is configured (deny-by-default, not a 404)", async () => {
    const { jwks } = await getTestKeys();
    server = createServer({ jwks, environment: "test" });
    await server.ready();

    const token = await createMerchantOwnerToken(TEST_MERCHANT_ID);
    const response = await server.inject({
      method: "GET",
      url: `/control/v1/merchants/${TEST_MERCHANT_ID}/kill-switch`,
      headers: { authorization: `Bearer ${token}` },
    });
    // Same convention as every other unregistered route in this codebase:
    // scope-enforcement's global onRequest hook denies-by-default (403)
    // before Fastify's router ever gets to report a plain 404.
    expect(response.statusCode).toBe(403);
  });
});
