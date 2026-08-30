/**
 * Auth0 client for the Counter Merchant Console.
 *
 * Mirrors apps/onboarding/src/lib/auth0.ts. Requests the REAL
 * https://api.counter.dev audience — the same audience control-plane-api's
 * JWT verification actually checks (apps/control-plane-api/src/index.ts,
 * AUTH_AUDIENCE) — so the access token stored in the session is a JWT
 * control-plane-api will accept, not an opaque default token. The old
 * per-app audience in ./auth.ts's (dead, unused) AUTH0_CONFIG was never
 * wired to anything and does not match what the API actually verifies.
 */
import { Auth0Client } from "@auth0/nextjs-auth0/server";

export const auth0 = new Auth0Client({
  authorizationParameters: {
    audience: process.env["AUTH0_AUDIENCE"] ?? "https://api.counter.dev",
    scope: "openid profile email merchant:read merchant:write",
  },
});
