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
 */
function isSkipped(request: FastifyRequest, skipRoutes: readonly string[]): boolean {
  const path = request.url;
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
    const { issuer, audience } = options;
    const skipRoutes = options.skipRoutes ?? [];

    fastify.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
      if (isSkipped(request, skipRoutes)) {
        return;
      }

      const authorization = request.headers.authorization;
      if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) {
        const error = createCanonicalError("UNAUTHENTICATED");
        void reply.status(401).send({
          error: { code: error.code, message: error.message },
        });
        return reply;
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
        const error = createCanonicalError("UNAUTHENTICATED");
        void reply.status(401).send({
          error: { code: error.code, message: error.message },
        });
        return reply;
      }
    });
  },
  { name: "counter-auth" },
);
