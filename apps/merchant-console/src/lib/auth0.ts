/**
 * Auth0 client for the Counter Merchant Console.
 *
 * Requests the REAL https://api.counter.dev audience — the same audience
 * control-plane-api's JWT verification actually checks
 * (apps/control-plane-api/src/index.ts, AUTH_AUDIENCE) — so the access token
 * stored in the session is a JWT control-plane-api will accept, not an
 * opaque default token.
 *
 * DO NOT add `acr_values` here to force a step-up at login. It was tried on
 * 2026-09-05 and REVERTED the same day because it broke sign-in outright:
 * MFA did run (Auth0's logs show a real TOTP enrolment and success), but the
 * shared "Counter Console" Post-Login Action then returned WITHOUT stamping
 * any identity claims, so the session came back with no merchant scope at
 * all and the console reported "Your session isn't scoped to a merchant
 * account" — strictly worse than the problem it was meant to fix.
 *
 * That Action triggers the challenge and returns early, relying on Auth0
 * re-running it afterwards to stamp claims on the second pass. That resume
 * works for wallet-console (which asks for the step-up via
 * mfa.challengeWithPopup against an ALREADY-authenticated session) but not
 * for a first-time login that also has to enrol a factor. Until the Action
 * itself is made resume-safe, this app must not request a step-up at login.
 *
 * The underlying problem this was trying to solve is still open and real:
 * nearly every write in this console is a tenant mutation, and
 * packages/authorization/src/assurance.ts requires multi_factor/step_up for
 * those, while a plain social login stamps "session". So a brand-new
 * merchant is refused on every save — surfaced honestly as STEP_UP_REQUIRED
 * ("sign out and sign in again") by scope-enforcement, rather than the old
 * opaque "Access denied". See that fix in
 * packages/http-api-kit/src/scope-enforcement.ts.
 */
import { Auth0Client } from "@auth0/nextjs-auth0/server";

export const auth0 = new Auth0Client({
  authorizationParameters: {
    audience: process.env["AUTH0_AUDIENCE"] ?? "https://api.counter.dev",
    scope: "openid profile email merchant:read merchant:write",
  },
});
