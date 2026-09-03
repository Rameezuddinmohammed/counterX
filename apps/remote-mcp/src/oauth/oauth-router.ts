/**
 * Mounts the OAuth 2.1 authorization-server surface onto the Fastify app.
 *
 * ---------------------------------------------------------------------------
 * Why the MCP SDK's Express routers instead of hand-written Fastify routes
 * ---------------------------------------------------------------------------
 * The SDK ships battle-tested handlers for /authorize, /token, /register and
 * /revoke: PKCE verification, RFC 8252 §7.3 loopback-port-relaxed
 * redirect_uri matching, client authentication, rate limiting, and the exact
 * pre-redirect vs post-redirect error split OAuth requires. Reimplementing
 * that in Fastify would mean reimplementing security-critical validation for
 * no benefit. They are Express routers, so we mount them through
 * @fastify/express and keep the validation for free.
 *
 * `mcpAuthRouter` wires all of it — including the RFC 8414 authorization
 * server metadata at /.well-known/oauth-authorization-server and the RFC 9728
 * protected-resource metadata at /.well-known/oauth-protected-resource/mcp —
 * into one router, so the whole surface is a single `fastify.use()`.
 *
 * ---------------------------------------------------------------------------
 * Registration order matters
 * ---------------------------------------------------------------------------
 * @fastify/express adds two `onRequest` hooks that run for EVERY request, not
 * just the OAuth ones. One of them redefines `reply.raw.headersSent`. The
 * /mcp route writes to the raw Node response directly, so it undoes that one
 * property before handing over — see mcp-route.ts's `restoreRawHeadersSent`.
 * That is the only interaction between the two, and it is deliberate.
 *
 * ---------------------------------------------------------------------------
 * /oauth/callback is OURS, not the SDK's
 * ---------------------------------------------------------------------------
 * It is the fixed URI registered in the Auth0 application and is pure
 * plumbing between us and Auth0 — no MCP client ever calls it. It is a plain
 * Fastify route.
 */
import type { FastifyInstance } from "fastify";
import fastifyExpress from "@fastify/express";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import type { CounterOAuthServerProvider } from "./provider.js";

/**
 * Every path the OAuth dance itself lives on. These MUST be in the Fastify
 * app's `skipAuthRoutes`: a client that has not authenticated yet is exactly
 * who is calling them, so requiring a Bearer JWT would make the flow
 * impossible to start.
 *
 * Note what is NOT here: /mcp. That stays behind authPlugin +
 * actorExtractionPlugin.
 */
export const OAUTH_PUBLIC_ROUTES: readonly string[] = [
  "/authorize",
  "/token",
  "/register",
  "/revoke",
  "/oauth/callback",
  "/.well-known/oauth-authorization-server",
  "/.well-known/oauth-protected-resource",
];

export interface OAuthRoutesOptions {
  readonly provider: CounterOAuthServerProvider;
  /** This app's public origin, e.g. "https://counter-remote-mcp.fly.dev". */
  readonly publicBaseUrl: string;
  /** The MCP endpoint path, used to build the protected-resource identifier. */
  readonly mcpPath: string;
}

export async function registerOAuthRoutes(
  server: FastifyInstance,
  options: OAuthRoutesOptions,
): Promise<void> {
  const { provider, publicBaseUrl, mcpPath } = options;
  const issuerUrl = new URL(publicBaseUrl);

  await server.register(fastifyExpress);

  server.use(
    mcpAuthRouter({
      provider,
      // We are BOTH the authorization server and the resource server, but at
      // different identifiers: the AS is this origin, the RS is the /mcp
      // endpoint. Passing them separately is what makes the SDK publish the
      // protected-resource metadata at the RFC 9728 path-suffixed location
      // (/.well-known/oauth-protected-resource/mcp) that MCP clients probe.
      issuerUrl,
      baseUrl: issuerUrl,
      resourceServerUrl: new URL(mcpPath, publicBaseUrl),
      resourceName: "Counter Agent Wallet",
      clientRegistrationOptions: {
        // Our clientsStore generates the client_id (an opaque random string;
        // see client-repository.ts). Left at the SDK default of `true`, the
        // handler would mint a bare crypto.randomUUID() instead and hand it
        // to registerClient, which contradicts the store's own typed
        // contract (`Omit<..., 'client_id' | 'client_id_issued_at'>`).
        clientIdGeneration: false,
      },
    }),
  );

  // ---------------------------------------------------------------------
  // Leg 2 of the two-legged proxy: Auth0 redirects the browser back here.
  // ---------------------------------------------------------------------
  server.get<{
    Querystring: {
      code?: string;
      state?: string;
      error?: string;
      error_description?: string;
    };
  }>("/oauth/callback", async (request, reply) => {
    const outcome = await provider.handleUpstreamCallback({
      code: request.query.code,
      state: request.query.state,
      error: request.query.error,
      error_description: request.query.error_description,
    });

    if (outcome.kind === "redirect") {
      return reply.redirect(outcome.url, 302);
    }

    // A terse page is the right answer here: this is a browser landing on a
    // dead flow, there is no MCP client to hand a structured error back to,
    // and this repo has no shared error-page component to reuse.
    return reply
      .status(outcome.status)
      .header("content-type", "text/plain; charset=utf-8")
      .header("cache-control", "no-store")
      .send(`${outcome.message}\n`);
  });
}
