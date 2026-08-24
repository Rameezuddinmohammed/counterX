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

function isSkipped(path: string, skipRoutes: readonly string[]): boolean {
  for (const route of skipRoutes) {
    if (path === route || path.startsWith(route + "/")) {
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
      if (isSkipped(request.url, skipRoutes)) {
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
