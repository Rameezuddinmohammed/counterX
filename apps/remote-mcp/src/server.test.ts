/**
 * Live-server tests: a REAL Fastify instance listening on a real port,
 * driven with real HTTP requests.
 *
 * These exist because the interesting failure modes of this app are all in
 * the wiring, not the units:
 *   - do the MCP SDK's Express routers actually work mounted through
 *     @fastify/express, including the genuine Express Response our provider's
 *     authorize() writes a redirect to?
 *   - does the SDK's own token handler really run PKCE against the challenge
 *     our provider stored?
 *   - does /mcp stay behind authPlugin while every OAuth path stays open?
 *   - does reply.hijack() + the raw-response handover actually produce a
 *     working Streamable HTTP session?
 *
 * Only Auth0 itself is faked (an injected fetch + a local JWKS). Everything
 * else here is the real code path.
 */
import { createHash, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from "jose";
import { InMemorySecureKeyStore, type SecureKeyStore } from "@counter/wallet-domain";
import type { Auth0Config } from "./config.js";
import { createServer, type RemoteMcpServer } from "./index.js";
import { InMemoryRemoteMcpClientRepository } from "./oauth/client-repository.js";
import type { WalletKeyStoreFactory } from "./key-store-factory.js";

const AUTH0: Auth0Config = {
  issuerBaseUrl: "https://counter-test.us.auth0.com",
  tokenIssuer: "https://counter-test.us.auth0.com/",
  clientId: "fixed-auth0-app-client-id",
  clientSecret: "fixed-auth0-app-client-secret",
  audience: "https://api.counter.dev",
};
const PUBLIC_BASE_URL = "https://counter-remote-mcp.fly.dev";
const CLAIMS_NAMESPACE = "https://counter.dev/";
const MCP_REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback";
const WALLET_A = "ctr_wallet_AAAAAAAAAAAAAAAAAAAAAA";
const WALLET_B = "ctr_wallet_BBBBBBBBBBBBBBBBBBBBBB";
const MERCHANT_A = "ctr_merchant_AAAAAAAAAAAAAAAAAAAAAA";

const AUTH0_TOKENS = {
  access_token: "auth0-access-token",
  refresh_token: "auth0-refresh-token",
  token_type: "Bearer",
  expires_in: 86_400,
};

interface TestKeys {
  privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
  jwks: ReturnType<typeof createLocalJWKSet>;
}
let testKeys: TestKeys | undefined;

async function getTestKeys(): Promise<TestKeys> {
  if (testKeys !== undefined) return testKeys;
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(publicKey);
  testKeys = {
    privateKey,
    jwks: createLocalJWKSet({ keys: [{ ...publicJwk, alg: "RS256", use: "sig" }] }),
  };
  return testKeys;
}

async function mintToken(claims: Record<string, unknown>): Promise<string> {
  const { privateKey } = await getTestKeys();
  const now = Math.floor(Date.now() / 1_000);
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(AUTH0.tokenIssuer)
    .setAudience(AUTH0.audience)
    .setExpirationTime(now + 3_600)
    .setIssuedAt(now)
    .sign(privateKey);
}

function walletToken(walletId: string): Promise<string> {
  return mintToken({
    sub: "auth0|test-wallet-user",
    [`${CLAIMS_NAMESPACE}actor_kind`]: "wallet_user",
    [`${CLAIMS_NAMESPACE}environment`]: "test",
    [`${CLAIMS_NAMESPACE}scope`]: { kind: "wallet", walletId },
    [`${CLAIMS_NAMESPACE}roles`]: ["wallet.owner"],
    [`${CLAIMS_NAMESPACE}assurance`]: "session",
  });
}

function merchantToken(): Promise<string> {
  return mintToken({
    sub: "auth0|test-merchant-user",
    [`${CLAIMS_NAMESPACE}actor_kind`]: "merchant_user",
    [`${CLAIMS_NAMESPACE}environment`]: "test",
    [`${CLAIMS_NAMESPACE}scope`]: { kind: "merchant", merchantId: MERCHANT_A },
    [`${CLAIMS_NAMESPACE}roles`]: ["merchant.owner"],
    [`${CLAIMS_NAMESPACE}assurance`]: "session",
  });
}

/** RFC 7636 S256: challenge = base64url(sha256(ascii(verifier))). */
function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/**
 * The real InMemorySecureKeyStore from @counter/wallet-domain, one per
 * wallet. Standing in for VaultSecureKeyStore, whose own tenant isolation is
 * tested in packages/wallet-domain — what THIS suite tests is that the route
 * builds exactly one store per session bound to the token's wallet.
 */
class RecordingKeyStoreFactory implements WalletKeyStoreFactory {
  readonly tenants: string[] = [];

  create(request: { walletId: string }): SecureKeyStore {
    this.tenants.push(request.walletId);
    const store = new InMemorySecureKeyStore();
    store.unlockStore("default-credential");
    return store;
  }
}

interface Harness {
  built: RemoteMcpServer;
  baseUrl: string;
  clients: InMemoryRemoteMcpClientRepository;
  keyStores: RecordingKeyStoreFactory;
  auth0Calls: Array<{ url: string; body: URLSearchParams }>;
}

async function startHarness(): Promise<Harness> {
  const { jwks } = await getTestKeys();
  const clients = new InMemoryRemoteMcpClientRepository();
  const keyStores = new RecordingKeyStoreFactory();
  const auth0Calls: Array<{ url: string; body: URLSearchParams }> = [];

  const fetchImpl = (async (input: string | URL, init?: RequestInit): Promise<Response> => {
    auth0Calls.push({
      url: String(input),
      body: new URLSearchParams((init?.body as string | undefined) ?? ""),
    });
    return new Response(JSON.stringify(AUTH0_TOKENS), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;

  const built = await createServer({
    auth0: AUTH0,
    publicBaseUrl: PUBLIC_BASE_URL,
    clients,
    keyStoreFactory: keyStores,
    agentRuntimeUrl: "https://agent-runtime.invalid",
    environment: "test",
    jwks,
    fetchImpl,
  });

  await built.server.listen({ port: 0, host: "127.0.0.1" });
  const address = built.server.server.address() as AddressInfo;
  return {
    built,
    baseUrl: `http://127.0.0.1:${address.port}`,
    clients,
    keyStores,
    auth0Calls,
  };
}

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.built.server.close();
  harness = undefined;
});

async function registerViaDcr(h: Harness): Promise<string> {
  const response = await fetch(`${h.baseUrl}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      redirect_uris: [MCP_REDIRECT_URI],
      client_name: "Claude",
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { client_id: string };
  return body.client_id;
}

describe("OAuth metadata (unauthenticated)", () => {
  it("serves RFC 8414 authorization server metadata", async () => {
    harness = await startHarness();
    const response = await fetch(`${harness.baseUrl}/.well-known/oauth-authorization-server`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;

    expect(body["issuer"]).toBe(`${PUBLIC_BASE_URL}/`);
    expect(body["authorization_endpoint"]).toBe(`${PUBLIC_BASE_URL}/authorize`);
    expect(body["token_endpoint"]).toBe(`${PUBLIC_BASE_URL}/token`);
    // DCR must be advertised — an MCP host that cannot find this cannot connect.
    expect(body["registration_endpoint"]).toBe(`${PUBLIC_BASE_URL}/register`);
    expect(body["revocation_endpoint"]).toBe(`${PUBLIC_BASE_URL}/revoke`);
    expect(body["code_challenge_methods_supported"]).toEqual(["S256"]);
  });

  it("serves RFC 9728 protected-resource metadata at the /mcp-suffixed path", async () => {
    harness = await startHarness();
    const response = await fetch(`${harness.baseUrl}/.well-known/oauth-protected-resource/mcp`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body["resource"]).toBe(`${PUBLIC_BASE_URL}/mcp`);
    expect(body["authorization_servers"]).toEqual([`${PUBLIC_BASE_URL}/`]);
  });
});

describe("dynamic client registration", () => {
  it("registers a public client without any authentication", async () => {
    harness = await startHarness();
    const clientId = await registerViaDcr(harness);
    expect(clientId).toMatch(/^mcpc_/u);
    await expect(harness.clients.findById(clientId)).resolves.toMatchObject({
      redirectUris: [MCP_REDIRECT_URI],
      clientName: "Claude",
    });
  });

  it("rejects a registration with a non-http redirect_uri", async () => {
    harness = await startHarness();
    const response = await fetch(`${harness.baseUrl}/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        redirect_uris: ["javascript:alert(1)"],
        token_endpoint_auth_method: "none",
      }),
    });
    expect(response.status).toBe(400);
  });
});

describe("the full authorization-code dance over real HTTP", () => {
  it("authorize -> Auth0 -> callback -> token, with real PKCE verification", async () => {
    harness = await startHarness();
    const clientId = await registerViaDcr(harness);
    const { verifier, challenge } = pkcePair();

    // --- Leg 1: the browser hits OUR /authorize ---------------------------
    const authorizeUrl = new URL(`${harness.baseUrl}/authorize`);
    authorizeUrl.searchParams.set("client_id", clientId);
    authorizeUrl.searchParams.set("redirect_uri", MCP_REDIRECT_URI);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("code_challenge", challenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");
    authorizeUrl.searchParams.set("state", "downstream-state");
    authorizeUrl.searchParams.set("scope", "openid profile");

    const authorizeResponse = await fetch(authorizeUrl, { redirect: "manual" });
    expect(authorizeResponse.status).toBe(302);
    const upstream = new URL(authorizeResponse.headers.get("location") as string);
    expect(upstream.origin + upstream.pathname).toBe(`${AUTH0.issuerBaseUrl}/authorize`);
    expect(upstream.searchParams.get("client_id")).toBe(AUTH0.clientId);
    expect(upstream.searchParams.get("redirect_uri")).toBe(`${PUBLIC_BASE_URL}/oauth/callback`);
    const upstreamState = upstream.searchParams.get("state") as string;

    // --- Leg 2: Auth0 sends the browser back to OUR callback -------------
    const callbackResponse = await fetch(
      `${harness.baseUrl}/oauth/callback?code=auth0-code&state=${encodeURIComponent(upstreamState)}`,
      { redirect: "manual" },
    );
    expect(callbackResponse.status).toBe(302);
    const back = new URL(callbackResponse.headers.get("location") as string);
    expect(back.origin + back.pathname).toBe(MCP_REDIRECT_URI);
    expect(back.searchParams.get("state")).toBe("downstream-state");
    const ourCode = back.searchParams.get("code") as string;
    expect(ourCode).toBeTruthy();

    expect(harness.auth0Calls).toHaveLength(1);
    expect(harness.auth0Calls[0]?.url).toBe(`${AUTH0.issuerBaseUrl}/oauth/token`);

    // --- Redemption: the MCP client POSTs our code to /token -------------
    const tokenResponse = await fetch(`${harness.baseUrl}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        code: ourCode,
        code_verifier: verifier,
        redirect_uri: MCP_REDIRECT_URI,
      }).toString(),
    });
    expect(tokenResponse.status).toBe(200);
    await expect(tokenResponse.json()).resolves.toEqual(AUTH0_TOKENS);
    // Auth0 was NOT called a second time: the tokens were already held.
    expect(harness.auth0Calls).toHaveLength(1);

    // --- Replay must fail ------------------------------------------------
    const replay = await fetch(`${harness.baseUrl}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        code: ourCode,
        code_verifier: verifier,
        redirect_uri: MCP_REDIRECT_URI,
      }).toString(),
    });
    expect(replay.status).toBe(400);
    await expect(replay.json()).resolves.toMatchObject({ error: "invalid_grant" });
  });

  it("rejects a token request whose PKCE verifier does not match (SDK-side check)", async () => {
    harness = await startHarness();
    const clientId = await registerViaDcr(harness);
    const { challenge } = pkcePair();
    const wrong = pkcePair();

    const authorizeUrl = new URL(`${harness.baseUrl}/authorize`);
    authorizeUrl.searchParams.set("client_id", clientId);
    authorizeUrl.searchParams.set("redirect_uri", MCP_REDIRECT_URI);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("code_challenge", challenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");
    const authorizeResponse = await fetch(authorizeUrl, { redirect: "manual" });
    const upstreamState = new URL(
      authorizeResponse.headers.get("location") as string,
    ).searchParams.get("state") as string;

    const callbackResponse = await fetch(
      `${harness.baseUrl}/oauth/callback?code=auth0-code&state=${encodeURIComponent(upstreamState)}`,
      { redirect: "manual" },
    );
    const ourCode = new URL(callbackResponse.headers.get("location") as string).searchParams.get(
      "code",
    ) as string;

    const tokenResponse = await fetch(`${harness.baseUrl}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        code: ourCode,
        code_verifier: wrong.verifier,
        redirect_uri: MCP_REDIRECT_URI,
      }).toString(),
    });
    expect(tokenResponse.status).toBe(400);
    await expect(tokenResponse.json()).resolves.toMatchObject({ error: "invalid_grant" });
  });

  it("refuses an unregistered redirect_uri before any redirect happens", async () => {
    harness = await startHarness();
    const clientId = await registerViaDcr(harness);
    const url = new URL(`${harness.baseUrl}/authorize`);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", "https://evil.example/steal");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("code_challenge", pkcePair().challenge);
    url.searchParams.set("code_challenge_method", "S256");

    const response = await fetch(url, { redirect: "manual" });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_request" });
  });

  it("refuses an unknown client_id", async () => {
    harness = await startHarness();
    const url = new URL(`${harness.baseUrl}/authorize`);
    url.searchParams.set("client_id", "mcpc_never-registered");
    url.searchParams.set("redirect_uri", MCP_REDIRECT_URI);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("code_challenge", pkcePair().challenge);
    url.searchParams.set("code_challenge_method", "S256");

    const response = await fetch(url, { redirect: "manual" });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_client" });
  });

  it("renders a terse page (not a redirect) for an unrecognised callback state", async () => {
    harness = await startHarness();
    const response = await fetch(`${harness.baseUrl}/oauth/callback?code=x&state=never-issued`, {
      redirect: "manual",
    });
    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("content-type")).toContain("text/plain");
  });
});

describe("/mcp authentication and wallet gating", () => {
  async function postMcp(
    h: Harness,
    body: unknown,
    headers: Record<string, string> = {},
  ): Promise<Response> {
    return fetch(`${h.baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...headers,
      },
      body: JSON.stringify(body),
    });
  }

  const initializeRequest = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    },
  };

  it("rejects a request with no bearer token (401)", async () => {
    harness = await startHarness();
    const response = await postMcp(harness, initializeRequest);
    expect(response.status).toBe(401);
  });

  it("rejects a merchant_user token (403) — a non-wallet actor has no MCP session", async () => {
    harness = await startHarness();
    const response = await postMcp(harness, initializeRequest, {
      authorization: `Bearer ${await merchantToken()}`,
    });
    expect(response.status).toBe(403);
    expect(harness.keyStores.tenants).toEqual([]);
  });

  it("rejects a non-initialize request that carries no session id (400)", async () => {
    harness = await startHarness();
    const response = await postMcp(
      harness,
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      { authorization: `Bearer ${await walletToken(WALLET_A)}` },
    );
    expect(response.status).toBe(400);
    expect(harness.keyStores.tenants).toEqual([]);
  });

  it("opens a session for a wallet token and binds the key store to that wallet", async () => {
    harness = await startHarness();
    const response = await postMcp(harness, initializeRequest, {
      authorization: `Bearer ${await walletToken(WALLET_A)}`,
    });

    expect(response.status).toBe(200);
    const sessionId = response.headers.get("mcp-session-id");
    expect(sessionId).toBeTruthy();
    // Exactly one key store, bound to the wallet in the verified token.
    expect(harness.keyStores.tenants).toEqual([WALLET_A]);
    await response.body?.cancel();
  });

  it("hides another wallet's live session behind a 404, not a 403", async () => {
    harness = await startHarness();
    const opened = await postMcp(harness, initializeRequest, {
      authorization: `Bearer ${await walletToken(WALLET_A)}`,
    });
    const sessionId = opened.headers.get("mcp-session-id") as string;
    await opened.body?.cancel();

    const stolen = await postMcp(
      harness,
      { jsonrpc: "2.0", id: 3, method: "tools/list", params: {} },
      {
        authorization: `Bearer ${await walletToken(WALLET_B)}`,
        "mcp-session-id": sessionId,
      },
    );
    expect(stolen.status).toBe(404);

    const unknown = await postMcp(
      harness,
      { jsonrpc: "2.0", id: 4, method: "tools/list", params: {} },
      {
        authorization: `Bearer ${await walletToken(WALLET_B)}`,
        "mcp-session-id": "00000000-0000-4000-8000-000000000000",
      },
    );
    // Byte-identical to the cross-tenant answer: nothing is learnable.
    expect(unknown.status).toBe(404);
    expect(await unknown.text()).toBe(await stolen.text());

    // No key store was ever built for wallet B.
    expect(harness.keyStores.tenants).toEqual([WALLET_A]);
  });

  it("serves tools/list on an established session (the real MCP tool surface)", async () => {
    harness = await startHarness();
    const opened = await postMcp(harness, initializeRequest, {
      authorization: `Bearer ${await walletToken(WALLET_A)}`,
    });
    const sessionId = opened.headers.get("mcp-session-id") as string;
    await opened.body?.cancel();

    const notify = await postMcp(
      harness,
      { jsonrpc: "2.0", method: "notifications/initialized" },
      {
        authorization: `Bearer ${await walletToken(WALLET_A)}`,
        "mcp-session-id": sessionId,
      },
    );
    expect(notify.status).toBe(202);
    await notify.body?.cancel();

    const listed = await postMcp(
      harness,
      { jsonrpc: "2.0", id: 5, method: "tools/list", params: {} },
      {
        authorization: `Bearer ${await walletToken(WALLET_A)}`,
        "mcp-session-id": sessionId,
      },
    );
    expect(listed.status).toBe(200);
    const text = await listed.text();
    // The response is an SSE frame; the payload is the JSON-RPC result.
    expect(text).toContain("purchase.propose");
    expect(text).toContain("merchant.search");
  });
});
