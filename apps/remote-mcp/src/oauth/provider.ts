/**
 * CounterOAuthServerProvider — a real OAuth 2.1 authorization server that
 * TWO-LEG PROXIES Counter's Auth0 tenant.
 *
 * ---------------------------------------------------------------------------
 * Why not the SDK's stock ProxyOAuthServerProvider
 * ---------------------------------------------------------------------------
 * `@modelcontextprotocol/sdk`'s ProxyOAuthServerProvider.authorize() redirects
 * the browser straight at the upstream IdP, forwarding the DOWNSTREAM MCP
 * client's own `redirect_uri` verbatim. That only works when the upstream IdP
 * will accept and redirect back to that arbitrary, per-caller URI. Auth0
 * applications have a fixed, admin-configured allowlist of callback URLs and
 * cannot. Its exchangeAuthorizationCode() has the same defect in the other
 * direction: it sends `client.client_id`/`client.client_secret` (the LOCAL,
 * dynamically-registered public client) upstream, where only the fixed Auth0
 * application's credentials are meaningful.
 *
 * So the stock class is correct for a 1:1 proxy (one fixed downstream client)
 * and wrong for ours: many DCR'd downstream MCP clients, ONE fixed upstream
 * Auth0 application.
 *
 * ---------------------------------------------------------------------------
 * The two legs
 * ---------------------------------------------------------------------------
 *   Leg 1 (downstream -> us -> Auth0):
 *     MCP client hits /authorize with ITS client_id, ITS redirect_uri and ITS
 *     PKCE challenge. We mint a fresh random `upstreamState`, remember all of
 *     that against it, and redirect the browser to Auth0 using the FIXED
 *     Auth0 client_id and OUR OWN fixed callback (PUBLIC_BASE_URL +
 *     /oauth/callback) — the one URI a human pre-registered in Auth0.
 *
 *   Leg 2 (Auth0 -> us -> downstream):
 *     Auth0 redirects the browser back to /oauth/callback with its code +
 *     our state. We redeem that code with Auth0 (fixed client credentials,
 *     server-to-server), mint OUR OWN authorization code, park the resulting
 *     Auth0 tokens against it, and redirect the browser back to the ORIGINAL
 *     MCP client's redirect_uri with our code and the client's own state.
 *
 *   Redemption:
 *     The MCP client POSTs our code to /token. The SDK's own token handler
 *     verifies PKCE against the challenge we return from
 *     challengeForAuthorizationCode(), then calls
 *     exchangeAuthorizationCode(), which hands back the Auth0 tokens we
 *     already hold. Auth0 is NOT called again at this point.
 *
 * The access token the MCP client ends up with is therefore a GENUINE
 * Auth0-issued token for Counter's own API audience — not a token we minted.
 * That is what lets the /mcp route be guarded by the repo's existing
 * `authPlugin` + `actorExtractionPlugin` with zero changes.
 *
 * ---------------------------------------------------------------------------
 * v1 SIMPLIFICATION — ACCEPTED, AND WHERE IT BREAKS
 * ---------------------------------------------------------------------------
 * `pendingUpstreamFlows` and `grants` are IN-PROCESS Maps with a TTL sweep.
 * Both hold only short-lived (seconds-to-minutes) intermediate OAuth-dance
 * state, never a long-lived credential, and this is a low-traffic pilot on a
 * single Fly machine. If apps/remote-mcp is ever scaled to MORE THAN ONE
 * concurrent machine, this breaks: the browser can land on machine B for
 * /oauth/callback after machine A issued the state, and the token request can
 * land on machine C. At that point both Maps must move to Postgres (or a
 * shared store) behind the same two method-pairs used here — the seam is
 * deliberately narrow: #pendingUpstreamFlows and #grants are touched in
 * exactly four places (authorize, handleUpstreamCallback,
 * challengeForAuthorizationCode, exchangeAuthorizationCode).
 */
import { randomBytes } from "node:crypto";
import type { Response } from "express";
import type {
  AuthorizationParams,
  OAuthServerProvider,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import {
  InvalidClientMetadataError,
  InvalidGrantError,
  ServerError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import {
  OAuthTokensSchema,
  type OAuthClientInformationFull,
  type OAuthTokenRevocationRequest,
  type OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { Auth0Config } from "../config.js";
import {
  generateMcpClientId,
  type RemoteMcpClientRecord,
  type RemoteMcpClientRepository,
} from "./client-repository.js";

/** A browser is currently sitting at Auth0 for this flow. */
export interface PendingUpstreamFlow {
  readonly mcpClientId: string;
  readonly mcpRedirectUri: string;
  readonly mcpCodeChallenge: string;
  readonly mcpState: string | undefined;
  readonly resource: string | undefined;
  readonly createdAt: number;
}

/** The Auth0 leg completed; waiting for the MCP client to redeem our code. */
export interface StoredGrant {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly codeChallenge: string;
  consumed: boolean;
  readonly createdAt: number;
  readonly auth0Tokens: OAuthTokens;
}

export type UpstreamCallbackOutcome =
  /** Send the browser here (back to the originating MCP client). */
  | { readonly kind: "redirect"; readonly url: string }
  /**
   * No safe redirect target exists (unknown/expired state means we do not
   * know which MCP client asked, so redirecting anywhere would be an open
   * redirect). Render a terse page instead.
   */
  | { readonly kind: "error_page"; readonly status: number; readonly message: string };

export interface CounterOAuthServerProviderOptions {
  readonly auth0: Auth0Config;
  /** This app's public origin; the Auth0 callback is `${publicBaseUrl}/oauth/callback`. */
  readonly publicBaseUrl: string;
  readonly clients: RemoteMcpClientRepository;
  /**
   * Verifies an Auth0-issued access token. Injected rather than built here so
   * this class stays free of network/JWKS concerns and is unit-testable.
   */
  readonly verifyAccessToken: (token: string) => Promise<AuthInfo>;
  /** Injectable for tests; defaults to the global fetch. */
  readonly fetchImpl?: typeof fetch;
  /** Injectable clock for tests; defaults to Date.now. */
  readonly now?: () => number;
  readonly pendingFlowTtlMs?: number;
  readonly grantTtlMs?: number;
  /**
   * Called with the real cause whenever redeeming Auth0's code fails —
   * server-side only, never part of the browser response (the redirect the
   * browser gets stays the same generic "server_error" regardless; see the
   * catch site). Without this the failure was completely invisible: no log,
   * no metric, nothing — a real "Authorization failed" report had no server-
   * side trace to diagnose it from. Optional and defaults to a no-op so
   * tests that intentionally exercise this path stay quiet unless they ask.
   */
  readonly onUpstreamCallbackError?: (error: unknown) => void;
  /**
   * Called whenever Auth0 itself redirects back to /oauth/callback with an
   * `error` param — i.e. Auth0 (or a Post-Login Action it ran) denied the
   * request before ever issuing a code. This is a DIFFERENT failure class
   * from onUpstreamCallbackError above (which only fires once we already
   * have a code and the redemption call itself fails): a genuine upstream
   * denial never reaches that path at all. Before this hook existed, this
   * branch had ZERO server-side trace — combined with disableRequestLogging
   * on this app's Fastify instance, a real `access_denied` from Auth0 (with
   * its actual error_description — the one thing that would explain WHY)
   * was silently forwarded to the browser and discarded, never logged
   * anywhere. Optional and defaults to a no-op, same reasoning as above.
   */
  readonly onUpstreamDenied?: (details: {
    readonly error: string;
    readonly errorDescription: string | undefined;
  }) => void;
  /**
   * Called whenever the DOWNSTREAM MCP client's own code redemption
   * (POST /token, the SDK's handler calling challengeForAuthorizationCode /
   * exchangeAuthorizationCode) is rejected — code not found, already
   * consumed, expired, or issued to a different client. The reason sent
   * back to the client stays the same generic "invalid_grant" either way
   * (see #requireLiveGrant's own comment on why); this is server-side only.
   * Same motivation as onUpstreamDenied: this app has disableRequestLogging
   * on, so without this hook a real client (e.g. Claude's backend) failing
   * to redeem a code we issued — for instance because our single-machine,
   * in-process #grants Map lost it to a scale-to-zero restart, or the
   * client simply took longer than DEFAULT_GRANT_TTL_MS to call back — was
   * invisible here even though Auth0's OWN side had already reported success.
   */
  readonly onGrantRejected?: (reason: string) => void;
}

/** A browser round-trip through a login page. Generous but bounded. */
export const DEFAULT_PENDING_FLOW_TTL_MS = 5 * 60 * 1_000;
/** Redeemed within seconds in the happy path; minutes is already generous. */
export const DEFAULT_GRANT_TTL_MS = 2 * 60 * 1_000;
const SWEEP_INTERVAL_MS = 60 * 1_000;
const DEFAULT_UPSTREAM_SCOPES = "openid profile email offline_access";

function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * A redirect_uri is only acceptable if it parses as an absolute URL with an
 * http/https scheme and carries no fragment (RFC 6749 §3.1.2). Rejecting
 * anything else at REGISTRATION time is what keeps the authorize-time
 * redirect (and the callback-time redirect back to the client) from becoming
 * an open redirect into e.g. `javascript:` or `data:`.
 */
export function isAcceptableRedirectUri(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return false;
  }
  return parsed.hash === "";
}

export class CounterOAuthServerProvider implements OAuthServerProvider {
  readonly #auth0: Auth0Config;
  readonly #callbackUrl: string;
  readonly #clients: RemoteMcpClientRepository;
  readonly #verifyAccessToken: (token: string) => Promise<AuthInfo>;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #pendingFlowTtlMs: number;
  readonly #grantTtlMs: number;
  readonly #onUpstreamCallbackError: (error: unknown) => void;
  readonly #onUpstreamDenied: (details: {
    error: string;
    errorDescription: string | undefined;
  }) => void;
  readonly #onGrantRejected: (reason: string) => void;

  readonly #pendingUpstreamFlows = new Map<string, PendingUpstreamFlow>();
  readonly #grants = new Map<string, StoredGrant>();

  #sweepTimer: ReturnType<typeof setInterval> | undefined;

  /**
   * We WANT the SDK's own token handler to run its PKCE check against what
   * challengeForAuthorizationCode() returns — that is the whole reason we
   * store the downstream client's code_challenge. Left false explicitly so a
   * future reader does not "helpfully" flip it.
   */
  readonly skipLocalPkceValidation = false;

  constructor(options: CounterOAuthServerProviderOptions) {
    this.#auth0 = options.auth0;
    this.#callbackUrl = `${options.publicBaseUrl}/oauth/callback`;
    this.#clients = options.clients;
    this.#verifyAccessToken = options.verifyAccessToken;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#now = options.now ?? Date.now;
    this.#pendingFlowTtlMs = options.pendingFlowTtlMs ?? DEFAULT_PENDING_FLOW_TTL_MS;
    this.#grantTtlMs = options.grantTtlMs ?? DEFAULT_GRANT_TTL_MS;
    this.#onUpstreamCallbackError = options.onUpstreamCallbackError ?? (() => {});
    this.#onUpstreamDenied = options.onUpstreamDenied ?? (() => {});
    this.#onGrantRejected = options.onGrantRejected ?? (() => {});
  }

  /** The fixed callback URI a human must allowlist in the Auth0 application. */
  get auth0CallbackUrl(): string {
    return this.#callbackUrl;
  }

  // -------------------------------------------------------------------------
  // Ephemeral-state lifecycle
  // -------------------------------------------------------------------------

  /**
   * Starts the periodic TTL sweep. `unref()` so an idle timer never holds the
   * process open (matters for tests and for a clean SIGTERM).
   */
  startSweeping(intervalMs: number = SWEEP_INTERVAL_MS): void {
    if (this.#sweepTimer !== undefined) {
      return;
    }
    const timer = setInterval(() => {
      this.sweepExpired();
    }, intervalMs);
    timer.unref?.();
    this.#sweepTimer = timer;
  }

  stopSweeping(): void {
    if (this.#sweepTimer !== undefined) {
      clearInterval(this.#sweepTimer);
      this.#sweepTimer = undefined;
    }
  }

  /**
   * Drops expired entries from both Maps. Also called lazily on read, so
   * correctness never depends on the timer having fired.
   */
  sweepExpired(): void {
    const now = this.#now();
    for (const [state, flow] of this.#pendingUpstreamFlows) {
      if (now - flow.createdAt > this.#pendingFlowTtlMs) {
        this.#pendingUpstreamFlows.delete(state);
      }
    }
    for (const [code, grant] of this.#grants) {
      if (now - grant.createdAt > this.#grantTtlMs) {
        this.#grants.delete(code);
      }
    }
  }

  /** Test/diagnostic accessor — never used on a request path. */
  get pendingFlowCount(): number {
    return this.#pendingUpstreamFlows.size;
  }

  /** Test/diagnostic accessor — never used on a request path. */
  get grantCount(): number {
    return this.#grants.size;
  }

  // -------------------------------------------------------------------------
  // OAuthServerProvider: client registry
  // -------------------------------------------------------------------------

  get clientsStore(): OAuthRegisteredClientsStore {
    return {
      getClient: async (clientId: string): Promise<OAuthClientInformationFull | undefined> => {
        const record = await this.#clients.findById(clientId);
        // Deliberately `undefined`, never a throw: an unregistered client_id
        // and a client_id belonging to another environment must be
        // indistinguishable to the caller (the SDK turns this into the
        // standard `invalid_client` response).
        return record === undefined ? undefined : toClientInformation(record);
      },
      registerClient: async (
        metadata: Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">,
      ): Promise<OAuthClientInformationFull> => {
        const redirectUris = metadata.redirect_uris;
        if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
          throw new InvalidClientMetadataError("redirect_uris must be a non-empty array");
        }
        for (const uri of redirectUris) {
          if (!isAcceptableRedirectUri(uri)) {
            throw new InvalidClientMetadataError(
              "redirect_uris entries must be absolute http(s) URLs without a fragment",
            );
          }
        }

        const record = await this.#clients.create({
          clientId: generateMcpClientId(),
          redirectUris,
          clientName: metadata.client_name,
        });
        return toClientInformation(record);
      },
    };
  }

  // -------------------------------------------------------------------------
  // OAuthServerProvider: leg 1
  // -------------------------------------------------------------------------

  /**
   * `res` is typed as an Express Response by the SDK interface, and the only
   * member ever touched here is `.redirect()`.
   *
   * This is the one place Express-shaped typing leaks into this app, and it
   * is honest rather than a shim: the caller is the SDK's own authorize
   * handler, mounted through @fastify/express, which passes Fastify's raw
   * Node ServerResponse to Express's `app.handle()`. Express installs its
   * own response prototype on that object, so this really is a working
   * Express Response by the time it reaches here — verified by exercising
   * the live /authorize endpoint, not assumed. See oauth-router.ts.
   */
  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    const upstreamState = randomToken();
    this.#pendingUpstreamFlows.set(upstreamState, {
      mcpClientId: client.client_id,
      mcpRedirectUri: params.redirectUri,
      mcpCodeChallenge: params.codeChallenge,
      mcpState: params.state,
      resource: params.resource?.href,
      createdAt: this.#now(),
    });

    const target = new URL(`${this.#auth0.issuerBaseUrl}/authorize`);
    target.searchParams.set("client_id", this.#auth0.clientId);
    target.searchParams.set("redirect_uri", this.#callbackUrl);
    target.searchParams.set("response_type", "code");
    target.searchParams.set(
      "scope",
      params.scopes !== undefined && params.scopes.length > 0
        ? params.scopes.join(" ")
        : DEFAULT_UPSTREAM_SCOPES,
    );
    target.searchParams.set("audience", this.#auth0.audience);
    target.searchParams.set("state", upstreamState);

    res.redirect(target.toString());
  }

  // -------------------------------------------------------------------------
  // Leg 2: our own /oauth/callback (NOT part of the SDK router)
  // -------------------------------------------------------------------------

  /**
   * Handles Auth0's redirect back to us. Returns what the HTTP layer should
   * do, so the whole leg is unit-testable without a server.
   */
  async handleUpstreamCallback(query: {
    readonly code?: string | undefined;
    readonly state?: string | undefined;
    readonly error?: string | undefined;
    readonly error_description?: string | undefined;
  }): Promise<UpstreamCallbackOutcome> {
    this.sweepExpired();

    const state = query.state;
    if (typeof state !== "string" || state.length === 0) {
      return { kind: "error_page", status: 400, message: "Missing state parameter" };
    }

    const flow = this.#pendingUpstreamFlows.get(state);
    if (flow === undefined) {
      // Unknown or expired state: we do not know which MCP client this
      // belongs to, so there is NO safe redirect target. Redirecting to an
      // attacker-supplied URI here would be an open redirect.
      return {
        kind: "error_page",
        status: 400,
        message: "This login link has expired or is not recognised. Please start again.",
      };
    }
    // Single-use regardless of outcome.
    this.#pendingUpstreamFlows.delete(state);

    if (this.#now() - flow.createdAt > this.#pendingFlowTtlMs) {
      return {
        kind: "error_page",
        status: 400,
        message: "This login link has expired. Please start again.",
      };
    }

    if (typeof query.error === "string" && query.error.length > 0) {
      // Server-side only, same as onUpstreamCallbackError below — the
      // browser-facing redirect is unchanged, but this is otherwise the
      // ONLY place Auth0's real error_description (e.g. why a Post-Login
      // Action denied access) would ever be visible.
      this.#onUpstreamDenied({
        error: query.error,
        errorDescription: query.error_description,
      });
      return {
        kind: "redirect",
        url: buildErrorRedirect(flow, query.error, query.error_description),
      };
    }

    const code = query.code;
    if (typeof code !== "string" || code.length === 0) {
      return {
        kind: "redirect",
        url: buildErrorRedirect(flow, "invalid_request", "Authorization server returned no code"),
      };
    }

    let auth0Tokens: OAuthTokens;
    try {
      auth0Tokens = await this.#redeemUpstreamCode(code);
    } catch (error) {
      // Real cause goes server-side only via the injected callback - never
      // into the browser redirect below, which stays generic on purpose.
      this.#onUpstreamCallbackError(error);
      return {
        kind: "redirect",
        url: buildErrorRedirect(
          flow,
          "server_error",
          "Could not complete sign-in with the identity provider",
        ),
      };
    }

    const ourCode = randomToken();
    this.#grants.set(ourCode, {
      clientId: flow.mcpClientId,
      redirectUri: flow.mcpRedirectUri,
      codeChallenge: flow.mcpCodeChallenge,
      consumed: false,
      createdAt: this.#now(),
      auth0Tokens,
    });

    const target = new URL(flow.mcpRedirectUri);
    target.searchParams.set("code", ourCode);
    if (flow.mcpState !== undefined) {
      target.searchParams.set("state", flow.mcpState);
    }
    return { kind: "redirect", url: target.toString() };
  }

  async #redeemUpstreamCode(code: string): Promise<OAuthTokens> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: this.#auth0.clientId,
      client_secret: this.#auth0.clientSecret,
      code,
      // MUST byte-match the redirect_uri sent in leg 1.
      redirect_uri: this.#callbackUrl,
    });

    const response = await this.#fetch(`${this.#auth0.issuerBaseUrl}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!response.ok) {
      await response.body?.cancel();
      throw new ServerError(`Upstream token exchange failed: ${response.status}`);
    }
    return OAuthTokensSchema.parse(await response.json());
  }

  // -------------------------------------------------------------------------
  // OAuthServerProvider: redemption
  // -------------------------------------------------------------------------

  /**
   * Returning the stored challenge is what makes the SDK's token handler run
   * a REAL PKCE check (`verifyChallenge(code_verifier, codeChallenge)`) on
   * our behalf. We deliberately do not re-implement that check.
   */
  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const grant = this.#requireLiveGrant(client, authorizationCode);
    return grant.codeChallenge;
  }

  /**
   * Called only AFTER the SDK's PKCE check has already passed. Does NOT call
   * Auth0 — the tokens were obtained for real during the callback leg.
   */
  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    _resource?: URL,
  ): Promise<OAuthTokens> {
    const grant = this.#requireLiveGrant(client, authorizationCode);

    // Bind the code to the exact redirect_uri it was issued for (OAuth 2.1
    // §4.1.3). The SDK's token handler passes redirect_uri through when the
    // client sent one; a mismatch is a hard failure, not a warning.
    if (redirectUri !== undefined && redirectUri !== grant.redirectUri) {
      throw new InvalidGrantError("redirect_uri does not match the authorization request");
    }

    // Single use. Marked BEFORE returning so a replay of the same code — even
    // a concurrent one — cannot yield a second set of tokens.
    grant.consumed = true;
    return grant.auth0Tokens;
  }

  #requireLiveGrant(client: OAuthClientInformationFull, authorizationCode: string): StoredGrant {
    const grant = this.#grants.get(authorizationCode);
    if (grant === undefined) {
      this.#onGrantRejected("not_found");
      throw new InvalidGrantError("Authorization code is invalid or has expired");
    }
    if (grant.consumed) {
      this.#onGrantRejected("already_consumed");
      throw new InvalidGrantError("Authorization code has already been used");
    }
    if (this.#now() - grant.createdAt > this.#grantTtlMs) {
      this.#grants.delete(authorizationCode);
      this.#onGrantRejected("expired");
      throw new InvalidGrantError("Authorization code is invalid or has expired");
    }
    if (grant.clientId !== client.client_id) {
      // Same message as "not found" on purpose: a client must not be able to
      // probe for another client's outstanding codes.
      this.#onGrantRejected("client_mismatch");
      throw new InvalidGrantError("Authorization code is invalid or has expired");
    }
    return grant;
  }

  /**
   * Refresh is the one redemption path that DOES reach Auth0 — a refresh
   * token was never pre-redeemed. Note the credentials sent upstream are the
   * FIXED Auth0 application's, never `client`'s: `client` is a local public
   * client that Auth0 has never heard of.
   */
  async exchangeRefreshToken(
    _client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    _resource?: URL,
  ): Promise<OAuthTokens> {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: this.#auth0.clientId,
      client_secret: this.#auth0.clientSecret,
      refresh_token: refreshToken,
    });
    if (scopes !== undefined && scopes.length > 0) {
      body.set("scope", scopes.join(" "));
    }

    const response = await this.#fetch(`${this.#auth0.issuerBaseUrl}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new ServerError(`Token refresh failed: ${response.status}`);
    }
    return OAuthTokensSchema.parse(await response.json());
  }

  /**
   * Implemented honestly to satisfy the interface. The real /mcp route is
   * guarded by @counter/http-api-kit's authPlugin, not by this — but a
   * half-implemented verifier on a security interface is worse than none.
   */
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    return this.#verifyAccessToken(token);
  }

  /**
   * RFC 7009 revocation, forwarded to Auth0's real revocation endpoint with
   * the FIXED application credentials (same reasoning as
   * exchangeRefreshToken: `client` is a local public client Auth0 does not
   * know). Auth0's /oauth/revoke only accepts refresh tokens; a request for
   * an access token is accepted and ignored upstream, matching RFC 7009's
   * "the server responds 200 regardless".
   */
  async revokeToken(
    _client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ): Promise<void> {
    const body = new URLSearchParams({
      client_id: this.#auth0.clientId,
      client_secret: this.#auth0.clientSecret,
      token: request.token,
    });
    if (request.token_type_hint !== undefined) {
      body.set("token_type_hint", request.token_type_hint);
    }

    const response = await this.#fetch(`${this.#auth0.issuerBaseUrl}/oauth/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    await response.body?.cancel();
    if (!response.ok) {
      throw new ServerError(`Token revocation failed: ${response.status}`);
    }
  }
}

/**
 * Mirrors the SDK's own createErrorRedirect (handlers/authorize.js) so the
 * MCP client's existing error handling can take over instead of the user
 * hitting a dead-end page.
 */
function buildErrorRedirect(
  flow: PendingUpstreamFlow,
  error: string,
  errorDescription: string | undefined,
): string {
  const url = new URL(flow.mcpRedirectUri);
  url.searchParams.set("error", error);
  if (errorDescription !== undefined && errorDescription.length > 0) {
    url.searchParams.set("error_description", errorDescription);
  }
  if (flow.mcpState !== undefined) {
    url.searchParams.set("state", flow.mcpState);
  }
  return url.toString();
}

/**
 * Every client here is public: no `client_secret` key at all (not a key set
 * to undefined — the SDK's clientAuth middleware branches on truthiness, and
 * an absent key is the honest representation of "this client has no secret").
 */
function toClientInformation(record: RemoteMcpClientRecord): OAuthClientInformationFull {
  return {
    client_id: record.clientId,
    redirect_uris: [...record.redirectUris],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    client_id_issued_at: Math.floor(record.createdAt.getTime() / 1_000),
    ...(record.clientName !== undefined ? { client_name: record.clientName } : {}),
  };
}
