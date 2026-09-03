import { describe, expect, it, afterEach, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from "jose";
import { createCanonicalError } from "@counter/domain";
import {
  correlationPlugin,
  getCorrelationId,
  idempotencyPlugin,
  getIdempotencyKey,
  errorHandlerPlugin,
  mapCanonicalErrorToStatus,
  CanonicalHttpError,
  authPlugin,
  actorExtractionPlugin,
  getActorContext,
  scopeEnforcementPlugin,
  registerRoutePermission,
  clearRoutePermissions,
  healthPlugin,
  webhookIngressPlugin,
  openApiPlugin,
  createHttpServer,
} from "./index.js";

// --- Test helpers ---

const TEST_ISSUER = "https://dev-jzw3etjxnn3svs56.us.auth0.com/";
const TEST_AUDIENCE = "https://api.counter.dev";
const CLAIMS_NAMESPACE = "https://counter.dev/";

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

async function createTestToken(claims: Record<string, unknown> = {}): Promise<string> {
  const { privateKey } = await getTestKeys();
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    sub: "ctr_merchant-user_AAAAAAAAAAAAAAAAAAAAAA",
    [`${CLAIMS_NAMESPACE}actor_kind`]: "merchant_user",
    [`${CLAIMS_NAMESPACE}environment`]: "test",
    [`${CLAIMS_NAMESPACE}scope`]: {
      kind: "merchant",
      merchantId: "ctr_merchant_AAAAAAAAAAAAAAAAAAAAAA",
    },
    [`${CLAIMS_NAMESPACE}roles`]: ["merchant.owner"],
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

async function createExpiredToken(): Promise<string> {
  const { privateKey } = await getTestKeys();
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    sub: "ctr_merchant-user_AAAAAAAAAAAAAAAAAAAAAA",
    [`${CLAIMS_NAMESPACE}actor_kind`]: "merchant_user",
    [`${CLAIMS_NAMESPACE}environment`]: "test",
    [`${CLAIMS_NAMESPACE}scope`]: {
      kind: "merchant",
      merchantId: "ctr_merchant_AAAAAAAAAAAAAAAAAAAAAA",
    },
    [`${CLAIMS_NAMESPACE}roles`]: ["merchant.owner"],
    [`${CLAIMS_NAMESPACE}assurance`]: "session",
  })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(TEST_ISSUER)
    .setAudience(TEST_AUDIENCE)
    .setExpirationTime(now - 3600) // expired
    .setIssuedAt(now - 7200)
    .sign(privateKey);
}

async function createWrongAudienceToken(): Promise<string> {
  const { privateKey } = await getTestKeys();
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ sub: "user123" })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(TEST_ISSUER)
    .setAudience("https://wrong.audience.com")
    .setExpirationTime(now + 3600)
    .setIssuedAt(now)
    .sign(privateKey);
}

// --- Tests ---

describe("correlationPlugin", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = Fastify();
    await server.register(correlationPlugin);
    server.get("/test", async (request, reply) => {
      const id = getCorrelationId(request);
      void reply.send({ correlationId: id });
    });
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  it("generates a correlation ID when none provided", async () => {
    const response = await server.inject({ method: "GET", url: "/test" });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { correlationId: string };
    expect(body.correlationId).toMatch(/^ctr_correlation_[A-Za-z0-9_-]{22}$/);
    expect(response.headers["x-correlation-id"]).toBe(body.correlationId);
  });

  it("uses existing valid correlation ID from header", async () => {
    const existingId = "ctr_correlation_AAAAAAAAAAAAAAAAAAAAAA";
    const response = await server.inject({
      method: "GET",
      url: "/test",
      headers: { "x-correlation-id": existingId },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { correlationId: string };
    expect(body.correlationId).toBe(existingId);
    expect(response.headers["x-correlation-id"]).toBe(existingId);
  });

  it("generates new ID for invalid correlation header", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/test",
      headers: { "x-correlation-id": "invalid-format" },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { correlationId: string };
    expect(body.correlationId).toMatch(/^ctr_correlation_[A-Za-z0-9_-]{22}$/);
    expect(body.correlationId).not.toBe("invalid-format");
  });
});

describe("idempotencyPlugin", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = Fastify();
    await server.register(idempotencyPlugin);
    server.post("/test", async (request, reply) => {
      const key = getIdempotencyKey(request);
      void reply.send({ idempotencyKey: key ?? null });
    });
    server.get("/test", async (request, reply) => {
      const key = getIdempotencyKey(request);
      void reply.send({ idempotencyKey: key ?? null });
    });
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  it("extracts valid idempotency key from POST request", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/test",
      headers: { "idempotency-key": "my-unique-key-123" },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { idempotencyKey: string | null };
    expect(body.idempotencyKey).toBe("my-unique-key-123");
  });

  it("ignores idempotency key on GET requests", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/test",
      headers: { "idempotency-key": "my-key" },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { idempotencyKey: string | null };
    expect(body.idempotencyKey).toBeNull();
  });

  it("rejects idempotency key exceeding max length", async () => {
    const longKey = "a".repeat(129);
    const response = await server.inject({
      method: "POST",
      url: "/test",
      headers: { "idempotency-key": longKey },
    });
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_FORMAT");
  });

  it("returns null when no idempotency key provided", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/test",
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { idempotencyKey: string | null };
    expect(body.idempotencyKey).toBeNull();
  });
});

describe("errorHandlerPlugin", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = Fastify();
    await server.register(errorHandlerPlugin);
  });

  afterEach(async () => {
    await server.close();
  });

  it("maps validation errors to 400", async () => {
    server.get("/test", async () => {
      throw new CanonicalHttpError(createCanonicalError("INVALID_FORMAT"));
    });
    await server.ready();

    const response = await server.inject({ method: "GET", url: "/test" });
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("INVALID_FORMAT");
  });

  it("maps authentication errors to 401", async () => {
    server.get("/test", async () => {
      throw new CanonicalHttpError(createCanonicalError("UNAUTHENTICATED"));
    });
    await server.ready();

    const response = await server.inject({ method: "GET", url: "/test" });
    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe("UNAUTHENTICATED");
  });

  it("maps authorization errors to 403", async () => {
    server.get("/test", async () => {
      throw new CanonicalHttpError(createCanonicalError("UNAUTHORIZED"));
    });
    await server.ready();

    const response = await server.inject({ method: "GET", url: "/test" });
    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("maps conflict errors to 409", async () => {
    server.get("/test", async () => {
      throw new CanonicalHttpError(createCanonicalError("CONFLICT"));
    });
    await server.ready();

    const response = await server.inject({ method: "GET", url: "/test" });
    expect(response.statusCode).toBe(409);
  });

  it("maps policy_denial errors to 422", async () => {
    server.get("/test", async () => {
      throw new CanonicalHttpError(createCanonicalError("POLICY_DENIED"));
    });
    await server.ready();

    const response = await server.inject({ method: "GET", url: "/test" });
    expect(response.statusCode).toBe(422);
  });

  it("maps unavailable errors to 503", async () => {
    server.get("/test", async () => {
      throw new CanonicalHttpError(createCanonicalError("UNAVAILABLE"));
    });
    await server.ready();

    const response = await server.inject({ method: "GET", url: "/test" });
    expect(response.statusCode).toBe(503);
  });

  it("maps indeterminate errors to 202", async () => {
    server.get("/test", async () => {
      throw new CanonicalHttpError(createCanonicalError("INDETERMINATE"));
    });
    await server.ready();

    const response = await server.inject({ method: "GET", url: "/test" });
    expect(response.statusCode).toBe(202);
  });

  it("maps internal errors to 500 without exposing details", async () => {
    server.get("/test", async () => {
      throw new Error("secret internal details");
    });
    await server.ready();

    const response = await server.inject({ method: "GET", url: "/test" });
    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("INTERNAL");
    expect(body.error.message).toBe("An internal error occurred");
    expect(response.body).not.toContain("secret internal details");
  });

  it("mapCanonicalErrorToStatus covers all categories", () => {
    expect(mapCanonicalErrorToStatus("validation")).toBe(400);
    expect(mapCanonicalErrorToStatus("authentication")).toBe(401);
    expect(mapCanonicalErrorToStatus("authorization")).toBe(403);
    expect(mapCanonicalErrorToStatus("policy_denial")).toBe(422);
    expect(mapCanonicalErrorToStatus("conflict")).toBe(409);
    expect(mapCanonicalErrorToStatus("stale")).toBe(409);
    expect(mapCanonicalErrorToStatus("review_required")).toBe(422);
    expect(mapCanonicalErrorToStatus("unavailable")).toBe(503);
    expect(mapCanonicalErrorToStatus("retryable")).toBe(503);
    expect(mapCanonicalErrorToStatus("indeterminate")).toBe(202);
    expect(mapCanonicalErrorToStatus("internal")).toBe(500);
  });
});

describe("authPlugin", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    const { jwks } = await getTestKeys();
    server = Fastify();
    await server.register(authPlugin, {
      issuer: TEST_ISSUER,
      audience: TEST_AUDIENCE,
      jwks,
      skipRoutes: ["/health"],
    });
    server.get("/protected", async (_request, reply) => {
      void reply.send({ ok: true });
    });
    server.get("/health", async (_request, reply) => {
      void reply.send({ status: "healthy" });
    });
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  it("allows valid JWT", async () => {
    const token = await createTestToken();
    const response = await server.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
  });

  it("rejects missing token with 401", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/protected",
    });
    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects expired token with 401", async () => {
    const token = await createExpiredToken();
    const response = await server.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(401);
  });

  it("rejects wrong audience with 401", async () => {
    const token = await createWrongAudienceToken();
    const response = await server.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(401);
  });

  it("skips auth for configured skip routes", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/health",
    });
    expect(response.statusCode).toBe(200);
  });

  it("skips auth for a skip-listed route even when it carries a query string", async () => {
    // e.g. an OAuth authorize redirect or callback, which always carries
    // query parameters (client_id, code, state, ...) - request.url includes
    // them, so the skip check must compare against the pathname only.
    const response = await server.inject({
      method: "GET",
      url: "/health?probe=1&another=value",
    });
    expect(response.statusCode).toBe(200);
  });
});

describe("actorExtractionPlugin", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    const { jwks } = await getTestKeys();
    server = Fastify();
    await server.register(correlationPlugin);
    await server.register(authPlugin, {
      issuer: TEST_ISSUER,
      audience: TEST_AUDIENCE,
      jwks,
      skipRoutes: ["/health"],
    });
    await server.register(actorExtractionPlugin, { skipRoutes: ["/health"] });
    server.get("/test", async (request, reply) => {
      const ctx = getActorContext(request);
      void reply.send({
        hasContext: ctx !== undefined,
        actorKind: ctx?.actor.kind ?? null,
        environment: ctx?.environment ?? null,
      });
    });
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  it("extracts actor context from valid JWT claims", async () => {
    const token = await createTestToken();
    const response = await server.inject({
      method: "GET",
      url: "/test",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      hasContext: boolean;
      actorKind: string;
      environment: string;
    };
    expect(body.hasContext).toBe(true);
    expect(body.actorKind).toBe("merchant_user");
    expect(body.environment).toBe("test");
  });

  it("returns 401 when claims are missing actor_kind", async () => {
    const token = await createTestToken({ [`${CLAIMS_NAMESPACE}actor_kind`]: undefined });
    const response = await server.inject({
      method: "GET",
      url: "/test",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe("scopeEnforcementPlugin", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    clearRoutePermissions();
    const { jwks } = await getTestKeys();
    server = Fastify();
    await server.register(correlationPlugin);
    await server.register(authPlugin, {
      issuer: TEST_ISSUER,
      audience: TEST_AUDIENCE,
      jwks,
      skipRoutes: ["/health"],
    });
    await server.register(actorExtractionPlugin, { skipRoutes: ["/health"] });
    await server.register(scopeEnforcementPlugin, { skipRoutes: ["/health"], denyByDefault: true });

    registerRoutePermission("GET:/allowed", { permission: "identity.scope.read" });
    registerRoutePermission("GET:/restricted", { permission: "identity.support_grant.issue" });

    server.get("/allowed", async (_request, reply) => {
      void reply.send({ ok: true });
    });
    server.get("/restricted", async (_request, reply) => {
      void reply.send({ ok: true });
    });
    server.get("/no-permission-defined", async (_request, reply) => {
      void reply.send({ ok: true });
    });
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
    clearRoutePermissions();
  });

  it("allows access when actor has required permission", async () => {
    const token = await createTestToken();
    const response = await server.inject({
      method: "GET",
      url: "/allowed",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
  });

  it("denies access when actor lacks required permission", async () => {
    const token = await createTestToken();
    const response = await server.inject({
      method: "GET",
      url: "/restricted",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("denies by default when no permission is registered for route", async () => {
    const token = await createTestToken();
    const response = await server.inject({
      method: "GET",
      url: "/no-permission-defined",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(403);
  });

  it("returns same 403 error format regardless of existence (anti-leak)", async () => {
    const token = await createTestToken();
    const r1 = await server.inject({
      method: "GET",
      url: "/restricted",
      headers: { authorization: `Bearer ${token}` },
    });
    const r2 = await server.inject({
      method: "GET",
      url: "/no-permission-defined",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r1.statusCode).toBe(403);
    expect(r2.statusCode).toBe(403);
    // Same error format for both
    const body1 = JSON.parse(r1.body) as { error: { code: string; message: string } };
    const body2 = JSON.parse(r2.body) as { error: { code: string; message: string } };
    expect(body1.error.code).toBe(body2.error.code);
    expect(body1.error.message).toBe(body2.error.message);
  });
});

describe("healthPlugin", () => {
  let server: FastifyInstance;

  afterEach(async () => {
    await server.close();
  });

  it("responds with healthy status on /health", async () => {
    server = Fastify();
    await server.register(healthPlugin, { version: "1.0.0", environment: "test" });
    await server.ready();

    const response = await server.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      status: string;
      version: string;
      environment: string;
    };
    expect(body.status).toBe("healthy");
    expect(body.version).toBe("1.0.0");
    expect(body.environment).toBe("test");
  });

  it("responds with ready status on /ready when all checks pass", async () => {
    server = Fastify();
    await server.register(healthPlugin, {
      version: "1.0.0",
      environment: "test",
      readinessChecker: async () => ({ database: true }),
    });
    await server.ready();

    const response = await server.inject({ method: "GET", url: "/ready" });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { ready: boolean; checks: { database: boolean } };
    expect(body.ready).toBe(true);
    expect(body.checks.database).toBe(true);
  });

  it("responds with 503 on /ready when a check fails", async () => {
    server = Fastify();
    await server.register(healthPlugin, {
      version: "1.0.0",
      environment: "test",
      readinessChecker: async () => ({ database: false }),
    });
    await server.ready();

    const response = await server.inject({ method: "GET", url: "/ready" });
    expect(response.statusCode).toBe(503);
    const body = JSON.parse(response.body) as { ready: boolean };
    expect(body.ready).toBe(false);
  });
});

describe("webhookIngressPlugin", () => {
  let server: FastifyInstance;

  afterEach(async () => {
    await server.close();
  });

  it("routes to registered adapter handler", async () => {
    server = Fastify();
    const adapters = new Map();
    adapters.set("stripe", async (_request: unknown, reply: { send: (data: unknown) => void }) => {
      reply.send({ received: true });
    });
    await server.register(webhookIngressPlugin, { adapters });
    await server.ready();

    const response = await server.inject({
      method: "POST",
      url: "/webhooks/v1/stripe",
      payload: Buffer.from('{"event":"test"}'),
      headers: { "content-type": "application/json" },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { received: boolean };
    expect(body.received).toBe(true);
  });

  it("returns 404 for unknown adapter", async () => {
    server = Fastify();
    await server.register(webhookIngressPlugin);
    await server.ready();

    const response = await server.inject({
      method: "POST",
      url: "/webhooks/v1/unknown",
      payload: "test",
      headers: { "content-type": "application/octet-stream" },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("openApiPlugin", () => {
  let server: FastifyInstance;

  afterEach(async () => {
    await server.close();
  });

  it("serves OpenAPI spec in non-production", async () => {
    server = Fastify();
    await server.register(openApiPlugin, {
      info: { title: "Test API", version: "1.0.0" },
      environment: "test",
    });
    server.get("/test-route", async (_request, reply) => {
      void reply.send({ ok: true });
    });
    await server.ready();

    const response = await server.inject({ method: "GET", url: "/docs/openapi.json" });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { openapi: string; info: { title: string } };
    expect(body.openapi).toBe("3.1.0");
    expect(body.info.title).toBe("Test API");
  });

  it("does not serve OpenAPI spec in production", async () => {
    server = Fastify();
    await server.register(openApiPlugin, {
      info: { title: "Test API", version: "1.0.0" },
      environment: "production",
    });
    await server.ready();

    const response = await server.inject({ method: "GET", url: "/docs/openapi.json" });
    expect(response.statusCode).toBe(404);
  });
});

describe("createHttpServer", () => {
  let server: FastifyInstance;

  afterEach(async () => {
    await server.close();
  });

  it("creates a fully configured server", async () => {
    const { jwks } = await getTestKeys();
    server = createHttpServer({
      name: "test-server",
      version: "1.0.0",
      environment: "test",
      auth: {
        issuer: TEST_ISSUER,
        audience: TEST_AUDIENCE,
        jwks,
      },
      openApi: { title: "Test", version: "1.0.0" },
    });
    await server.ready();

    // Health endpoint should work without auth
    const healthResponse = await server.inject({ method: "GET", url: "/health" });
    expect(healthResponse.statusCode).toBe(200);
    const healthBody = JSON.parse(healthResponse.body) as { status: string };
    expect(healthBody.status).toBe("healthy");
  });
});
