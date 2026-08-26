/**
 * Auth0 configuration for the Counter Merchant Console.
 *
 * Uses @auth0/nextjs-auth0 v4 for authentication.
 * All sensitive values are read from environment variables at runtime.
 *
 * Required environment variables:
 *   AUTH0_SECRET - random session encryption key
 *   AUTH0_BASE_URL - app base URL (e.g., http://localhost:3000)
 *   AUTH0_ISSUER_BASE_URL - Auth0 tenant URL
 *   AUTH0_CLIENT_ID - application client ID
 *   AUTH0_CLIENT_SECRET - application client secret
 *   AUTH0_AUDIENCE - API audience for merchant scope
 */

export const AUTH0_CONFIG = {
  domain: process.env["AUTH0_DOMAIN"] ?? "dev-jzw3etjxnn3svs56.us.auth0.com",
  clientId: process.env["AUTH0_CLIENT_ID"] ?? "",
  issuerBaseUrl:
    process.env["AUTH0_ISSUER_BASE_URL"] ??
    `https://${process.env["AUTH0_DOMAIN"] ?? "dev-jzw3etjxnn3svs56.us.auth0.com"}`,
  audience: process.env["AUTH0_AUDIENCE"] ?? "https://counter-control-plane-api.fly.dev/merchant",
  scope: "openid profile email merchant:read merchant:write",
} as const;
