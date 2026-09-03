/**
 * Unit tests for the two-legged OAuth proxy.
 *
 * Auth0 is faked at the HTTP layer (an injected `fetch`), so every assertion
 * here is about OUR logic: what we send upstream, what we store, what we hand
 * back, and — most importantly — what we refuse.
 */
import { describe, expect, it, vi } from "vitest";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { Response as ExpressResponse } from "express";
import type { Auth0Config } from "../config.js";
import { InMemoryRemoteMcpClientRepository } from "./client-repository.js";
import { CounterOAuthServerProvider, isAcceptableRedirectUri } from "./provider.js";

const AUTH0: Auth0Config = {
  issuerBaseUrl: "https://counter-test.us.auth0.com",
  tokenIssuer: "https://counter-test.us.auth0.com/",
  clientId: "fixed-auth0-app-client-id",
  clientSecret: "fixed-auth0-app-client-secret",
  audience: "https://api.counter.dev",
};
const PUBLIC_BASE_URL = "https://counter-remote-mcp.fly.dev";
const CALLBACK_URL = `${PUBLIC_BASE_URL}/oauth/callback`;
const MCP_REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback";

const AUTH0_TOKENS = {
  access_token: "auth0-access-token",
  refresh_token: "auth0-refresh-token",
  token_type: "Bearer",
  expires_in: 86_400,
  scope: "openid profile email",
};

/**
 * Minimal stand-in for the Express Response the SDK's authorize handler
 * supplies. `redirect` is the only member `authorize()` ever touches — that
 * is verified by reading the handler, and by the live-server test in
 * ../server.test.ts which drives the REAL Express response.
 */
function captureRedirect(): { res: ExpressResponse; url: () => string } {
  let captured: string | undefined;
  const res = {
    redirect: (url: string): void => {
      captured = url;
    },
  } as unknown as ExpressResponse;
  return {
    res,
    url: () => {
      if (captured === undefined) throw new Error("no redirect was issued");
      return captured;
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface Harness {
  provider: CounterOAuthServerProvider;
  clients: InMemoryRemoteMcpClientRepository;
  fetchMock: ReturnType<typeof vi.fn>;
  now: { value: number };
}

function harness(
  overrides: {
    pendingFlowTtlMs?: number;
    grantTtlMs?: number;
    onUpstreamCallbackError?: (error: unknown) => void;
    onUpstreamDenied?: (details: { error: string; errorDescription: string | undefined }) => void;
  } = {},
): Harness {
  const clients = new InMemoryRemoteMcpClientRepository();
  const fetchMock = vi.fn(async () => jsonResponse(AUTH0_TOKENS));
  const now = { value: 1_700_000_000_000 };
  const provider = new CounterOAuthServerProvider({
    auth0: AUTH0,
    publicBaseUrl: PUBLIC_BASE_URL,
    clients,
    verifyAccessToken: async (token) => ({ token, clientId: "", scopes: [] }),
    fetchImpl: fetchMock as unknown as typeof fetch,
    now: () => now.value,
    ...overrides,
  });
  return { provider, clients, fetchMock, now };
}

async function registerClient(
  provider: CounterOAuthServerProvider,
  redirectUris: string[] = [MCP_REDIRECT_URI],
): Promise<OAuthClientInformationFull> {
  const store = provider.clientsStore;
  if (store.registerClient === undefined) throw new Error("registerClient missing");
  return store.registerClient({
    redirect_uris: redirectUris,
    client_name: "Claude",
    token_endpoint_auth_method: "none",
  });
}

/**
 * Drives the whole dance up to (but not including) redemption, returning the
 * authorization code we issued to the MCP client.
 */
async function danceToOurCode(
  h: Harness,
  client: OAuthClientInformationFull,
  params: { state?: string; codeChallenge?: string; redirectUri?: string } = {},
): Promise<string> {
  const capture = captureRedirect();
  await h.provider.authorize(
    client,
    {
      codeChallenge: params.codeChallenge ?? "downstream-challenge",
      redirectUri: params.redirectUri ?? MCP_REDIRECT_URI,
      ...(params.state !== undefined ? { state: params.state } : {}),
      scopes: ["openid", "profile"],
    },
    capture.res,
  );
  const upstreamState = new URL(capture.url()).searchParams.get("state");
  expect(upstreamState).toBeTruthy();

  const outcome = await h.provider.handleUpstreamCallback({
    code: "auth0-authorization-code",
    state: upstreamState as string,
  });
  if (outcome.kind !== "redirect") {
    throw new Error(`expected a redirect, got: ${JSON.stringify(outcome)}`);
  }
  const ourCode = new URL(outcome.url).searchParams.get("code");
  if (ourCode === null) throw new Error("no code in the downstream redirect");
  return ourCode;
}

describe("isAcceptableRedirectUri", () => {
  it("accepts absolute http(s) URLs without a fragment", () => {
    expect(isAcceptableRedirectUri("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(isAcceptableRedirectUri("http://127.0.0.1:33418/oauth/callback")).toBe(true);
  });

  it("rejects non-http schemes, relative URLs, fragments and non-strings", () => {
    expect(isAcceptableRedirectUri("javascript:alert(1)")).toBe(false);
    expect(isAcceptableRedirectUri("data:text/html,<script>")).toBe(false);
    expect(isAcceptableRedirectUri("/relative/callback")).toBe(false);
    expect(isAcceptableRedirectUri("https://claude.ai/cb#fragment")).toBe(false);
    expect(isAcceptableRedirectUri("")).toBe(false);
    expect(isAcceptableRedirectUri(42)).toBe(false);
    expect(isAcceptableRedirectUri(undefined)).toBe(false);
  });
});

describe("clientsStore (dynamic client registration)", () => {
  it("registers a public client and reads it back", async () => {
    const h = harness();
    const registered = await registerClient(h.provider);

    expect(registered.client_id).toMatch(/^mcpc_/u);
    expect(registered.redirect_uris).toEqual([MCP_REDIRECT_URI]);
    expect(registered.token_endpoint_auth_method).toBe("none");
    expect(registered.client_name).toBe("Claude");
    // A public client must have NO secret at all — not even an undefined one,
    // because the SDK's client authentication branches on truthiness.
    expect(Object.prototype.hasOwnProperty.call(registered, "client_secret")).toBe(false);

    const fetched = await h.provider.clientsStore.getClient(registered.client_id);
    expect(fetched?.client_id).toBe(registered.client_id);
    expect(fetched?.redirect_uris).toEqual([MCP_REDIRECT_URI]);
  });

  it("returns undefined (never throws) for an unknown client_id", async () => {
    const h = harness();
    await expect(h.provider.clientsStore.getClient("mcpc_nope")).resolves.toBeUndefined();
  });

  it("rejects an empty redirect_uris array", async () => {
    const h = harness();
    await expect(registerClient(h.provider, [])).rejects.toThrow(/non-empty/iu);
  });

  it("rejects a redirect_uri that is not an absolute http(s) URL", async () => {
    const h = harness();
    await expect(registerClient(h.provider, ["javascript:alert(1)"])).rejects.toThrow(
      /absolute http/iu,
    );
    await expect(
      registerClient(h.provider, [MCP_REDIRECT_URI, "https://ok.example/cb#frag"]),
    ).rejects.toThrow(/absolute http/iu);
  });

  it("does not persist a client whose redirect_uris were rejected", async () => {
    const h = harness();
    await expect(registerClient(h.provider, ["ftp://bad.example/cb"])).rejects.toThrow();
    // Nothing was written: the validation runs before the repository call.
    await expect(h.provider.clientsStore.getClient("mcpc_anything")).resolves.toBeUndefined();
  });
});

describe("authorize (leg 1: downstream -> us -> Auth0)", () => {
  it("redirects to Auth0 with the FIXED app client_id and OUR callback, not the client's", async () => {
    const h = harness();
    const client = await registerClient(h.provider);
    const capture = captureRedirect();

    await h.provider.authorize(
      client,
      {
        codeChallenge: "downstream-challenge",
        redirectUri: MCP_REDIRECT_URI,
        state: "downstream-state",
        scopes: ["openid", "profile"],
        resource: new URL(`${PUBLIC_BASE_URL}/mcp`),
      },
      capture.res,
    );

    const url = new URL(capture.url());
    expect(url.origin + url.pathname).toBe(`${AUTH0.issuerBaseUrl}/authorize`);
    expect(url.searchParams.get("client_id")).toBe(AUTH0.clientId);
    // THE central assertion: the downstream client's own redirect_uri is NOT
    // forwarded upstream (which is exactly what the SDK's stock
    // ProxyOAuthServerProvider does, and why it cannot be used with Auth0).
    expect(url.searchParams.get("redirect_uri")).toBe(CALLBACK_URL);
    expect(url.searchParams.get("redirect_uri")).not.toBe(MCP_REDIRECT_URI);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("audience")).toBe(AUTH0.audience);
    expect(url.searchParams.get("scope")).toBe("openid profile");
    // Our own opaque state, never the client's.
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(url.searchParams.get("state")).not.toBe("downstream-state");

    expect(h.provider.pendingFlowCount).toBe(1);
  });

  it("falls back to a default scope set when the client requests none", async () => {
    const h = harness();
    const client = await registerClient(h.provider);
    const capture = captureRedirect();

    await h.provider.authorize(
      client,
      { codeChallenge: "c", redirectUri: MCP_REDIRECT_URI, scopes: [] },
      capture.res,
    );

    expect(new URL(capture.url()).searchParams.get("scope")).toContain("openid");
  });
});

describe("handleUpstreamCallback (leg 2: Auth0 -> us -> downstream)", () => {
  it("redeems the upstream code with the FIXED app credentials and redirects back to the MCP client", async () => {
    const h = harness();
    const client = await registerClient(h.provider);
    const capture = captureRedirect();
    await h.provider.authorize(
      client,
      { codeChallenge: "downstream-challenge", redirectUri: MCP_REDIRECT_URI, state: "s-123" },
      capture.res,
    );
    const upstreamState = new URL(capture.url()).searchParams.get("state") as string;

    const outcome = await h.provider.handleUpstreamCallback({
      code: "auth0-code",
      state: upstreamState,
    });

    expect(h.fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = h.fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${AUTH0.issuerBaseUrl}/oauth/token`);
    const body = new URLSearchParams(init.body as string);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("client_id")).toBe(AUTH0.clientId);
    expect(body.get("client_secret")).toBe(AUTH0.clientSecret);
    expect(body.get("code")).toBe("auth0-code");
    // Must byte-match what leg 1 sent, or Auth0 rejects the exchange.
    expect(body.get("redirect_uri")).toBe(CALLBACK_URL);

    expect(outcome.kind).toBe("redirect");
    if (outcome.kind !== "redirect") return;
    const redirect = new URL(outcome.url);
    expect(redirect.origin + redirect.pathname).toBe(MCP_REDIRECT_URI);
    expect(redirect.searchParams.get("code")).toBeTruthy();
    // The client gets ITS OWN state back, not our upstream one.
    expect(redirect.searchParams.get("state")).toBe("s-123");
    expect(redirect.searchParams.get("code")).not.toBe("auth0-code");

    // The pending flow is single-use.
    expect(h.provider.pendingFlowCount).toBe(0);
    expect(h.provider.grantCount).toBe(1);
  });

  it("omits state entirely when the MCP client did not send one", async () => {
    const h = harness();
    const client = await registerClient(h.provider);
    const code = await danceToOurCode(h, client);
    expect(code).toBeTruthy();
  });

  it("renders an error page (never an open redirect) for an unknown state", async () => {
    const h = harness();
    const outcome = await h.provider.handleUpstreamCallback({
      code: "x",
      state: "never-issued",
    });
    expect(outcome.kind).toBe("error_page");
    if (outcome.kind !== "error_page") return;
    expect(outcome.status).toBe(400);
  });

  it("renders an error page when state is missing altogether", async () => {
    const h = harness();
    const outcome = await h.provider.handleUpstreamCallback({ code: "x" });
    expect(outcome.kind).toBe("error_page");
  });

  it("rejects a pending flow that has outlived its TTL", async () => {
    const h = harness({ pendingFlowTtlMs: 1_000 });
    const client = await registerClient(h.provider);
    const capture = captureRedirect();
    await h.provider.authorize(
      client,
      { codeChallenge: "c", redirectUri: MCP_REDIRECT_URI },
      capture.res,
    );
    const upstreamState = new URL(capture.url()).searchParams.get("state") as string;

    h.now.value += 5_000;

    const outcome = await h.provider.handleUpstreamCallback({
      code: "auth0-code",
      state: upstreamState,
    });
    expect(outcome.kind).toBe("error_page");
    // Auth0 was never called for an expired flow.
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it("forwards an Auth0-reported error back to the MCP client's redirect_uri", async () => {
    const h = harness();
    const client = await registerClient(h.provider);
    const capture = captureRedirect();
    await h.provider.authorize(
      client,
      { codeChallenge: "c", redirectUri: MCP_REDIRECT_URI, state: "s-9" },
      capture.res,
    );
    const upstreamState = new URL(capture.url()).searchParams.get("state") as string;

    const outcome = await h.provider.handleUpstreamCallback({
      state: upstreamState,
      error: "access_denied",
      error_description: "User cancelled",
    });

    expect(outcome.kind).toBe("redirect");
    if (outcome.kind !== "redirect") return;
    const url = new URL(outcome.url);
    expect(url.origin + url.pathname).toBe(MCP_REDIRECT_URI);
    expect(url.searchParams.get("error")).toBe("access_denied");
    expect(url.searchParams.get("error_description")).toBe("User cancelled");
    expect(url.searchParams.get("state")).toBe("s-9");
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it("reports a real Auth0-side denial to onUpstreamDenied, server-side only", async () => {
    // Before this hook existed, this exact branch (Auth0 redirecting back
    // with its OWN error, before we ever see a code) had no server-side
    // trace at all — combined with disableRequestLogging, a real
    // access_denied from Auth0 (e.g. from Attack Protection or a Post-Login
    // Action) was silently forwarded to the browser and never logged
    // anywhere, which is exactly what made a real "Authorization failed"
    // report undiagnosable.
    const onUpstreamDenied = vi.fn();
    const h = harness({ onUpstreamDenied });
    const client = await registerClient(h.provider);
    const capture = captureRedirect();
    await h.provider.authorize(
      client,
      { codeChallenge: "c", redirectUri: MCP_REDIRECT_URI, state: "s-9" },
      capture.res,
    );
    const upstreamState = new URL(capture.url()).searchParams.get("state") as string;

    await h.provider.handleUpstreamCallback({
      state: upstreamState,
      error: "access_denied",
      error_description: "some real Auth0-side reason",
    });

    expect(onUpstreamDenied).toHaveBeenCalledTimes(1);
    expect(onUpstreamDenied).toHaveBeenCalledWith({
      error: "access_denied",
      errorDescription: "some real Auth0-side reason",
    });
  });

  it("redirects with a generic server_error (leaking nothing) when Auth0's token call fails", async () => {
    const h = harness();
    h.fetchMock.mockResolvedValue(
      jsonResponse({ error: "invalid_grant", error_description: "secret detail" }, 403),
    );
    const client = await registerClient(h.provider);
    const capture = captureRedirect();
    await h.provider.authorize(
      client,
      { codeChallenge: "c", redirectUri: MCP_REDIRECT_URI },
      capture.res,
    );
    const upstreamState = new URL(capture.url()).searchParams.get("state") as string;

    const outcome = await h.provider.handleUpstreamCallback({
      code: "bad",
      state: upstreamState,
    });

    expect(outcome.kind).toBe("redirect");
    if (outcome.kind !== "redirect") return;
    const url = new URL(outcome.url);
    expect(url.searchParams.get("error")).toBe("server_error");
    expect(url.searchParams.get("error_description")).not.toContain("secret detail");
    expect(h.provider.grantCount).toBe(0);
  });

  it("reports the real cause of a failed Auth0 token exchange to onUpstreamCallbackError, server-side only", async () => {
    // The browser-facing redirect above stays generic on purpose - this is
    // what makes that failure diagnosable at all instead of leaving zero
    // trace anywhere (the gap that made a real "Authorization failed"
    // report untraceable in the deployed server's logs).
    const onUpstreamCallbackError = vi.fn();
    const h = harness({ onUpstreamCallbackError });
    h.fetchMock.mockResolvedValue(
      jsonResponse({ error: "invalid_grant", error_description: "secret detail" }, 403),
    );
    const client = await registerClient(h.provider);
    const capture = captureRedirect();
    await h.provider.authorize(
      client,
      { codeChallenge: "c", redirectUri: MCP_REDIRECT_URI },
      capture.res,
    );
    const upstreamState = new URL(capture.url()).searchParams.get("state") as string;

    await h.provider.handleUpstreamCallback({ code: "bad", state: upstreamState });

    expect(onUpstreamCallbackError).toHaveBeenCalledTimes(1);
    const [reportedError] = onUpstreamCallbackError.mock.calls[0] as [unknown];
    expect(String(reportedError)).toContain("403");
  });
});

describe("redemption", () => {
  it("returns the Auth0 tokens verbatim and does NOT call Auth0 again", async () => {
    const h = harness();
    const client = await registerClient(h.provider);
    const ourCode = await danceToOurCode(h, client, { codeChallenge: "the-challenge" });

    const callsAfterCallback = h.fetchMock.mock.calls.length;

    await expect(h.provider.challengeForAuthorizationCode(client, ourCode)).resolves.toBe(
      "the-challenge",
    );

    const tokens = await h.provider.exchangeAuthorizationCode(
      client,
      ourCode,
      undefined,
      MCP_REDIRECT_URI,
    );
    expect(tokens).toEqual(AUTH0_TOKENS);
    expect(h.fetchMock.mock.calls.length).toBe(callsAfterCallback);
  });

  it("rejects a replayed authorization code", async () => {
    const h = harness();
    const client = await registerClient(h.provider);
    const ourCode = await danceToOurCode(h, client);

    await h.provider.exchangeAuthorizationCode(client, ourCode, undefined, MCP_REDIRECT_URI);
    await expect(
      h.provider.exchangeAuthorizationCode(client, ourCode, undefined, MCP_REDIRECT_URI),
    ).rejects.toThrow(/already been used/iu);
    // And the PKCE lookup fails too, so a replay cannot even reach the
    // exchange a second time through the SDK's handler.
    await expect(h.provider.challengeForAuthorizationCode(client, ourCode)).rejects.toThrow();
  });

  it("rejects a redirect_uri that differs from the one the code was issued for", async () => {
    const h = harness();
    const client = await registerClient(h.provider, [
      MCP_REDIRECT_URI,
      "https://claude.ai/other/cb",
    ]);
    const ourCode = await danceToOurCode(h, client, { redirectUri: MCP_REDIRECT_URI });

    await expect(
      h.provider.exchangeAuthorizationCode(
        client,
        ourCode,
        undefined,
        "https://claude.ai/other/cb",
      ),
    ).rejects.toThrow(/redirect_uri/iu);
    // The code is still unconsumed, so an honest retry with the right URI works.
    await expect(
      h.provider.exchangeAuthorizationCode(client, ourCode, undefined, MCP_REDIRECT_URI),
    ).resolves.toEqual(AUTH0_TOKENS);
  });

  it("accepts an omitted redirect_uri (the SDK only forwards one when the client sent it)", async () => {
    const h = harness();
    const client = await registerClient(h.provider);
    const ourCode = await danceToOurCode(h, client);
    await expect(
      h.provider.exchangeAuthorizationCode(client, ourCode, undefined, undefined),
    ).resolves.toEqual(AUTH0_TOKENS);
  });

  it("rejects a code presented by a DIFFERENT registered client", async () => {
    const h = harness();
    const clientA = await registerClient(h.provider);
    const clientB = await registerClient(h.provider, ["https://evil.example/cb"]);
    const ourCode = await danceToOurCode(h, clientA);

    await expect(
      h.provider.exchangeAuthorizationCode(clientB, ourCode, undefined, MCP_REDIRECT_URI),
    ).rejects.toThrow(/invalid or has expired/iu);
    // Same message as "not found", so client B learns nothing about whether
    // that code exists.
    await expect(h.provider.challengeForAuthorizationCode(clientB, ourCode)).rejects.toThrow(
      /invalid or has expired/iu,
    );
  });

  it("rejects a grant that has outlived its TTL", async () => {
    const h = harness({ grantTtlMs: 1_000 });
    const client = await registerClient(h.provider);
    const ourCode = await danceToOurCode(h, client);

    h.now.value += 5_000;

    await expect(h.provider.challengeForAuthorizationCode(client, ourCode)).rejects.toThrow(
      /invalid or has expired/iu,
    );
    await expect(
      h.provider.exchangeAuthorizationCode(client, ourCode, undefined, MCP_REDIRECT_URI),
    ).rejects.toThrow(/invalid or has expired/iu);
  });

  it("rejects an authorization code that was never issued", async () => {
    const h = harness();
    const client = await registerClient(h.provider);
    await expect(
      h.provider.exchangeAuthorizationCode(client, "made-up-code", undefined, MCP_REDIRECT_URI),
    ).rejects.toThrow(/invalid or has expired/iu);
  });
});

describe("exchangeRefreshToken", () => {
  it("sends the FIXED Auth0 app credentials upstream, never the local public client's", async () => {
    const h = harness();
    const client = await registerClient(h.provider);

    const tokens = await h.provider.exchangeRefreshToken(client, "a-refresh-token", [
      "openid",
      "profile",
    ]);

    expect(tokens).toEqual(AUTH0_TOKENS);
    const [url, init] = h.fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${AUTH0.issuerBaseUrl}/oauth/token`);
    const body = new URLSearchParams(init.body as string);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("client_id")).toBe(AUTH0.clientId);
    expect(body.get("client_id")).not.toBe(client.client_id);
    expect(body.get("client_secret")).toBe(AUTH0.clientSecret);
    expect(body.get("refresh_token")).toBe("a-refresh-token");
    expect(body.get("scope")).toBe("openid profile");
  });

  it("throws when Auth0 rejects the refresh", async () => {
    const h = harness();
    h.fetchMock.mockResolvedValue(jsonResponse({ error: "invalid_grant" }, 401));
    const client = await registerClient(h.provider);
    await expect(h.provider.exchangeRefreshToken(client, "stale")).rejects.toThrow(/refresh/iu);
  });
});

describe("revokeToken", () => {
  it("posts to Auth0's revocation endpoint with the fixed app credentials", async () => {
    const h = harness();
    h.fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    const client = await registerClient(h.provider);

    await h.provider.revokeToken(client, {
      token: "a-refresh-token",
      token_type_hint: "refresh_token",
    });

    const [url, init] = h.fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${AUTH0.issuerBaseUrl}/oauth/revoke`);
    const body = new URLSearchParams(init.body as string);
    expect(body.get("client_id")).toBe(AUTH0.clientId);
    expect(body.get("client_secret")).toBe(AUTH0.clientSecret);
    expect(body.get("token")).toBe("a-refresh-token");
    expect(body.get("token_type_hint")).toBe("refresh_token");
  });
});

describe("ephemeral state hygiene", () => {
  it("keeps local PKCE validation ON so the SDK verifies the challenge for us", () => {
    const h = harness();
    expect(h.provider.skipLocalPkceValidation).toBe(false);
  });

  it("sweeps expired pending flows and grants", async () => {
    const h = harness({ pendingFlowTtlMs: 1_000, grantTtlMs: 1_000 });
    const client = await registerClient(h.provider);
    await danceToOurCode(h, client);
    const capture = captureRedirect();
    await h.provider.authorize(
      client,
      { codeChallenge: "c", redirectUri: MCP_REDIRECT_URI },
      capture.res,
    );

    expect(h.provider.grantCount).toBe(1);
    expect(h.provider.pendingFlowCount).toBe(1);

    h.now.value += 10_000;
    h.provider.sweepExpired();

    expect(h.provider.grantCount).toBe(0);
    expect(h.provider.pendingFlowCount).toBe(0);
  });

  it("does not leave the process alive on its sweep timer", () => {
    const h = harness();
    h.provider.startSweeping(10);
    // Idempotent: a second call must not create a second timer.
    h.provider.startSweeping(10);
    h.provider.stopSweeping();
    h.provider.stopSweeping();
  });
});
