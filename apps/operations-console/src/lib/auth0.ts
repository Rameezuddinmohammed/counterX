/**
 * Auth0 client for the Counter Operations Console.
 *
 * Mirrors apps/merchant-console/src/lib/auth0.ts and
 * apps/wallet-console/src/lib/auth0.ts — same shared "Counter Console"
 * Auth0 application (this app's own AUTH0_CLIENT_ID, already configured in
 * .env.local, IS that same client id), same real https://api.counter.dev
 * audience.
 *
 * KNOWN GAP, not fixed here (needs live Auth0 tenant access this session
 * doesn't have): unlike merchant-console (`merchant:read merchant:write`)
 * and wallet-console (`wallet:read wallet:write`), there is no registered
 * `operator:*` permission on the Counter Platform API yet, and the shared
 * Post-Login Action has no branch that stamps `actor_kind: "operator"` /
 * `scope: {kind: "platform"}` for a login here. So this DOES require a
 * real Auth0 login (closing the "any cookie value works" hole — see
 * proxy.ts) but does NOT yet prove the logged-in person is specifically an
 * operator, only that they're a real, authenticated user of this shared
 * tenant. Requesting `openid profile email` only (no domain-specific
 * scope) rather than inventing an unregistered one. Any operator-gated
 * BACKEND action (e.g. POST /control/v1/merchant-applications/:id/approve)
 * already independently requires real actor_kind==='operator' claims this
 * session's login can't produce — so this gap does not let a non-operator
 * actually perform an operator action, only view this console's own pages.
 */
import { Auth0Client } from "@auth0/nextjs-auth0/server";

export const auth0 = new Auth0Client({
  authorizationParameters: {
    audience: process.env["AUTH0_AUDIENCE"] ?? "https://api.counter.dev",
    scope: "openid profile email",
  },
});
