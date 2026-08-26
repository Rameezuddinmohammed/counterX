/**
 * Auth0 configuration for the Operations Console.
 *
 * Uses the shared Counter Auth0 tenant but scoped to operator access.
 * All sensitive values are read from environment variables at runtime.
 *
 * Required environment variables:
 *   AUTH0_SECRET - Random session encryption key
 *   AUTH0_BASE_URL - App base URL (e.g. http://localhost:3002)
 *   AUTH0_ISSUER_BASE_URL - Auth0 tenant URL
 *   AUTH0_CLIENT_ID - Application client ID
 *   AUTH0_CLIENT_SECRET - Auth0 client secret
 *   AUTH0_AUDIENCE - API audience for operator scope
 */

export const AUTH0_CONFIG = {
  domain: process.env["AUTH0_DOMAIN"] ?? "dev-jzw3etjxnn3svs56.us.auth0.com",
  clientId: process.env["AUTH0_CLIENT_ID"] ?? "",
  issuerBaseUrl:
    process.env["AUTH0_ISSUER_BASE_URL"] ??
    `https://${process.env["AUTH0_DOMAIN"] ?? "dev-jzw3etjxnn3svs56.us.auth0.com"}`,
  audience: process.env["AUTH0_AUDIENCE"] ?? "https://counter-control-plane-api.fly.dev/operator",
  scope: "openid profile email operator:read operator:write",
} as const;
