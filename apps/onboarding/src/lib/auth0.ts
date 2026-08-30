/**
 * Auth0 client for the Counter Onboarding site.
 *
 * Requests the https://api.counter.dev audience during login so the access
 * token stored in the session is a real JWT carrying the wallet-owner claims
 * stamped by the "Counter Onboarding: provision wallet + stamp session"
 * Post-Login Action — not an opaque default token. That JWT is what
 * /api/setup-token forwards to control-plane-api.
 */
import { Auth0Client } from "@auth0/nextjs-auth0/server";

export const auth0 = new Auth0Client({
  authorizationParameters: {
    audience: "https://api.counter.dev",
    scope: "openid profile email wallet-users:self-serve",
  },
});
