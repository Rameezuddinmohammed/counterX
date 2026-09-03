/**
 * JWT authentication plugin for Fastify.
 *
 * Validates Auth0-issued RS256 JWTs using JWKS. Supports injecting a custom
 * JWK set for testing (no network calls required in tests).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { createCanonicalError } from "@counter/domain";

export interface AuthPluginOptions {
  readonly issuer: string;
  readonly audience: string;
  readonly jwks: JWTVerifyGetKey | string;
  readonly skipRoutes?: readonly string[];
  /**
   * When set, every 401 response carries a
   * `WWW-Authenticate: Bearer resource_metadata="<url>"` header (RFC 9728 /
   * RFC 6750) pointing at this server's own OAuth Protected Resource
   * Metadata document. Only meaningful for a server that IS an MCP resource
   * server (currently just apps/remote-mcp) — an MCP client's discovery flow
   * starts by hitting the resource unauthenticated and reading this header
   * to find out where the metadata (and from there, the authorization
   * server) lives; without it, discovery has nothing to follow and silently
   * falls back to asking a human to configure the connector by hand. Found
   * by actually pointing a real Claude.ai Connector at the deployed server —
   * every other check (the metadata endpoints themselves, the 401 status
   * code) was already correct in isolation, but this header was missing.
   */
  readonly resourceMetadataUrl?: string;
}

export interface JwtPayload {
  readonly sub: string;
  readonly iss: string;
  readonly aud: string | readonly string[];
  readonly exp: number;
  readonly iat: number;
  readonly azp?: string;
  readonly scope?: string;
  readonly email?: string;
  readonly acr?: string;
  readonly amr?: readonly string[];
  readonly [key: string]: unknown;
}

const jwtPayloads = new WeakMap<FastifyRequest, JwtPayload>();

export function getJwtPayload(request: FastifyRequest): JwtPayload | undefined {
  return jwtPayloads.get(request);
}

function resolveJwks(jwks: JWTVerifyGetKey | string): JWTVerifyGetKey {
  if (typeof jwks === "string") {
    return createRemoteJWKSet(new URL(jwks));
  }
  return jwks;
}

/**
 * Matches a skip-route entry against either the literal request path (for
 * static routes, e.g. the wallet-user agent-keys route) or the request's
 * matched route PATTERN (request.routeOptions.url, e.g.
 * "/control/v1/merchants/:merchantId/shopify/callback") for routes whose
 * path has a dynamic segment that can't be listed literally. The pattern
 * check only ever matches a route Fastify has already resolved to an
 * explicitly-registered path, so this can't be used to bypass auth on an
 * arbitrary URL an attacker constructs — it's an exact match against the
 * server's own declared route table, same trust level as the literal-path
 * check already used here.
 *
 * request.url is the raw request target and includes the query string
 * (e.g. "/authorize?client_id=..." for an OAuth authorize redirect), so the
 * literal-path checks compare against the pathname only — otherwise any
 * skip-listed route that legitimately receives query parameters (an OAuth
 * callback, an authorize redirect) would never match and would be
 * incorrectly authenticated.
 */
function isSkipped(request: FastifyRequest, skipRoutes: readonly string[]): boolean {
  const path = request.url.split("?")[0] ?? request.url;
  const routePattern = request.routeOptions?.url;
  for (const route of skipRoutes) {
    if (path === route || path.startsWith(route + "/") || routePattern === route) {
      return true;
    }
  }
  return false;
}

export const authPlugin = fp(
  async (fastify: FastifyInstance, options: AuthPluginOptions): Promise<void> => {
    const getKey = resolveJwks(options.jwks);
    const { issuer, audience, resourceMetadataUrl } = options;
    const skipRoutes = options.skipRoutes ?? [];

    const sendUnauthenticated = (reply: FastifyReply, wwwAuthErrorParam?: string): FastifyReply => {
      const error = createCanonicalError("UNAUTHENTICATED");
      if (resourceMetadataUrl !== undefined) {
        const params = [
          wwwAuthErrorParam !== undefined ? `error="${wwwAuthErrorParam}"` : undefined,
          `resource_metadata="${resourceMetadataUrl}"`,
        ].filter((part): part is string => part !== undefined);
        void reply.header("WWW-Authenticate", `Bearer ${params.join(", ")}`);
      }
      void reply.status(401).send({
        error: { code: error.code, message: error.message },
      });
      return reply;
    };

    fastify.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
      if (isSkipped(request, skipRoutes)) {
        return;
      }

      const authorization = request.headers.authorization;
      if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) {
        return sendUnauthenticated(reply);
      }

      const token = authorization.slice(7);

      try {
        const { payload } = await jwtVerify(token, getKey, {
          issuer,
          audience,
          algorithms: ["RS256"],
        });

        jwtPayloads.set(request, payload as unknown as JwtPayload);
      } catch {
        return sendUnauthenticated(reply, "invalid_token");
      }
    });
  },
  { name: "counter-auth" },
);
