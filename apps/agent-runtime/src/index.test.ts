import { describe, expect, it, afterEach } from "vitest";
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from "jose";
import { APP_NAME, createServer } from "./index.js";
import type { FastifyInstance } from "fastify";
import type { WebhookHandler } from "@counter/http-api-kit";

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
    [`${CLAIMS_NAMESPACE}scope`]: { kind: "merchant", merchantId: "ctr_merchant_AAAAAAAAAAAAAAAAAAAAAA" },
    [`${CLAIMS_NAMESPACE}roles`]: ["merchant.owner"],
    [`${CLAIMS_NAMESPACE}assurance`]: "session",
    permissions: ["identity.scope.read"],
    ...claims,
  })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(TEST_ISSUER)
    .setAudience(TEST_AUDIENCE)
    .setExpirationTime(now + 3600)
    .setIssuedAt(now)
    .sign(privateKey);
}

// --- Tests ---

describe("@counter/agent-runtime", () => {
  let server: FastifyInstance | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("exposes its app identity", () => {
    expect(APP_NAME).toBe("@counter/agent-runtime");
  });

  it("GET /health returns 200 with status, version, and environment", async () => {
    const { jwks } = await getTestKeys();
    server = createServer({ jwks, environment: "test", version: "2.0.0" });
    await server.ready();

    const response = await server.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { status: string; version: string; environment: string };
    expect(body.status).toBe("healthy");
    expect(body.version).toBe("2.0.0");
    expect(body.environment).toBe("test");
  });

  it("GET /ready returns 200 with readiness structure", async () => {
    const { jwks } = await getTestKeys();
    server = createServer({ jwks, environment: "test" });
    await server.ready();

    const response = await server.inject({ method: "GET", url: "/ready" });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { ready: boolean };
    expect(body.ready).toBe(true);
  });

  it("unauthenticated GET /runtime/v1/status returns 401", async () => {
    const { jwks } = await getTestKeys();
    server = createServer({ jwks, environment: "test" });
    await server.ready();

    const response = await server.inject({ method: "GET", url: "/runtime/v1/status" });
    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe("UNAUTHENTICATED");
  });

  it("authenticated GET /runtime/v1/status with valid JWT returns 200", async () => {
    const { jwks } = await getTestKeys();
    server = createServer({ jwks, environment: "test" });
    await server.ready();

    const token = await createTestToken();
    const response = await server.inject({
      method: "GET",
      url: "/runtime/v1/status",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { status: string };
    expect(body.status).toBe("operational");
  });

  it("POST /webhooks/v1/test-adapter accepts raw body without auth", async () => {
    const { jwks } = await getTestKeys();
    const testHandler: WebhookHandler = async (_request, reply) => {
      void reply.send({ received: true });
    };
    const adapters = new Map<string, WebhookHandler>();
    adapters.set("test-adapter", testHandler);

    server = createServer({ jwks, environment: "test", webhooks: { adapters } });
    await server.ready();

    const response = await server.inject({
      method: "POST",
      url: "/webhooks/v1/test-adapter",
      payload: Buffer.from('{"event":"payment.completed"}'),
      headers: { "content-type": "application/json" },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { received: boolean };
    expect(body.received).toBe(true);
  });

  it("POST /webhooks/v1/unknown-adapter returns 404", async () => {
    const { jwks } = await getTestKeys();
    server = createServer({ jwks, environment: "test" });
    await server.ready();

    const response = await server.inject({
      method: "POST",
      url: "/webhooks/v1/unknown-adapter",
      payload: "raw-bytes",
      headers: { "content-type": "application/octet-stream" },
    });
    expect(response.statusCode).toBe(404);
  });

  it("serves OpenAPI spec in non-production environment", async () => {
    const { jwks } = await getTestKeys();
    server = createServer({ jwks, environment: "test" });
    await server.ready();

    const response = await server.inject({ method: "GET", url: "/docs/openapi.json" });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { openapi: string; info: { title: string } };
    expect(body.openapi).toBe("3.1.0");
    expect(body.info.title).toBe("Counter Agent Runtime API");
  });

  it("unauthenticated GET /runtime/v1/merchants/:merchantId/capabilities returns 401", async () => {
    const { jwks } = await getTestKeys();
    server = createServer({ jwks, environment: "test" });
    await server.ready();

    const response = await server.inject({
      method: "GET",
      url: "/runtime/v1/merchants/ctr_merchant_AAAAAAAAAAAAAAAAAAAAAA/capabilities",
    });
    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe("UNAUTHENTICATED");
  });

  it("authenticated GET /runtime/v1/merchants/:merchantId/capabilities returns placeholder response", async () => {
    const { jwks } = await getTestKeys();
    server = createServer({ jwks, environment: "test" });
    await server.ready();

    const token = await createTestToken();
    const response = await server.inject({
      method: "GET",
      url: "/runtime/v1/merchants/ctr_merchant_AAAAAAAAAAAAAAAAAAAAAA/capabilities",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { placeholder: boolean; message: string };
    expect(body.placeholder).toBe(true);
    expect(body.message).toBe("Merchant runtime routes - to be implemented in later tasks");
  });
});
