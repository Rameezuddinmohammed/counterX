/**
 * Auth0 access-token verification for the OAuth provider's
 * `verifyAccessToken` interface method.
 *
 * WHY NOT REUSE @counter/http-api-kit DIRECTLY: that package's `authPlugin`
 * is the thing that actually guards the /mcp route, and it is used unchanged
 * here (see index.ts) — but it is a Fastify plugin, not a callable verifier,
 * and http-api-kit exports no standalone verify function to import. Rather
 * than widen a shared package for one caller, this file repeats authPlugin's
 * EXACT verification (jose `createRemoteJWKSet` + `jwtVerify`, same issuer,
 * same audience, RS256 only) in the few lines it takes. If http-api-kit ever
 * grows a standalone verifier, delete this and delegate.
 *
 * This path is not what protects /mcp. It exists because
 * `OAuthServerProvider.verifyAccessToken` is part of a security interface,
 * and a stubbed-out security method is worse than an honest one.
 */
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { Auth0Config } from "./config.js";

export interface TokenVerifierOptions {
  readonly auth0: Auth0Config;
  /** Injectable key source so tests never touch the network. */
  readonly jwks?: JWTVerifyGetKey;
}

export function createAuth0TokenVerifier(
  options: TokenVerifierOptions,
): (token: string) => Promise<AuthInfo> {
  const getKey: JWTVerifyGetKey =
    options.jwks ??
    createRemoteJWKSet(new URL(`${options.auth0.issuerBaseUrl}/.well-known/jwks.json`));

  return async (token: string): Promise<AuthInfo> => {
    let payload: Record<string, unknown>;
    try {
      const verified = await jwtVerify(token, getKey, {
        issuer: options.auth0.tokenIssuer,
        audience: options.auth0.audience,
        algorithms: ["RS256"],
      });
      payload = verified.payload as Record<string, unknown>;
    } catch {
      // Never echo the underlying jose failure — it distinguishes "expired"
      // from "bad signature" from "wrong audience", which is a probing oracle.
      throw new InvalidTokenError("Access token is invalid or has expired");
    }

    const scope = payload["scope"];
    const clientId = payload["azp"];
    const expiresAt = payload["exp"];

    return {
      token,
      clientId: typeof clientId === "string" ? clientId : "",
      scopes: typeof scope === "string" && scope.length > 0 ? scope.split(" ") : [],
      ...(typeof expiresAt === "number" ? { expiresAt } : {}),
    };
  };
}
