/**
 * Auth0 client for the Counter Merchant Console.
 *
 * Requests the REAL https://api.counter.dev audience — the same audience
 * control-plane-api's JWT verification actually checks
 * (apps/control-plane-api/src/index.ts, AUTH_AUDIENCE) — so the access token
 * stored in the session is a JWT control-plane-api will accept, not an
 * opaque default token.
 *
 * STEP-UP AT LOGIN (added 2026-09-05, fixing a total onboarding blocker):
 * every consequential thing this console does — saving business basics,
 * connecting a catalog, confirming a manifest, connecting Shopify, editing
 * policy, flipping the kill switch — is a tenant mutation, and
 * packages/authorization/src/assurance.ts requires multi_factor/step_up for
 * those. A plain social login stamps assurance "session", so a brand-new
 * merchant was refused on EVERY save with an opaque "Access denied", while
 * accounts that happened to have completed an MFA challenge in
 * wallet-console (which triggers one explicitly for mandate creation) sailed
 * through — making the failure look random. Confirmed against the real
 * tenant: Auth0's own login log for a fresh merchant shows a Google login
 * with no MFA prompt at all, and that session's writes 403'd while its reads
 * succeeded.
 *
 * Requesting the multi-factor ACR here makes the shared "Counter Console"
 * Post-Login Action run its existing challenge/enrollment branch (it already
 * reads event.transaction.acr_values and calls challengeWithAny /
 * enrollWithAny), so the session is stamped "step_up" and the merchant can
 * actually complete onboarding. Chosen over lowering the assurance bar on
 * these routes, which would have weakened a real money-adjacent
 * authorization boundary for every caller rather than fixing the sign-in.
 *
 * wallet-console solves the same problem differently — a targeted
 * mfa.challengeWithPopup() at the moment of the sensitive action — because
 * it runs the browser SPA SDK and only two of its actions need step-up. This
 * app is server-rendered and nearly all of its actions need it, so asking
 * once at login is both simpler and less interruptive here.
 */
import { Auth0Client } from "@auth0/nextjs-auth0/server";

/** Auth0's standard "multi-factor" ACR policy URI. */
const MFA_POLICY_ACR = "http://schemas.openid.net/pape/policies/2007/06/multi-factor";

export const auth0 = new Auth0Client({
  authorizationParameters: {
    audience: process.env["AUTH0_AUDIENCE"] ?? "https://api.counter.dev",
    scope: "openid profile email merchant:read merchant:write",
    acr_values: MFA_POLICY_ACR,
  },
});
