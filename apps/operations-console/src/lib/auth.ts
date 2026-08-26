/**
 * Auth0 configuration for the Operations Console.
 *
 * Uses the shared Counter Auth0 tenant but scoped to operator access.
 * Environment variables are read at runtime by @auth0/nextjs-auth0.
 *
 * Required env vars:
 *   AUTH0_SECRET - Random session encryption key
 *   AUTH0_BASE_URL - App base URL (e.g. http://localhost:3002)
 *   AUTH0_ISSUER_BASE_URL - https://dev-jzw3etjxnn3svs56.us.auth0.com
 *   AUTH0_CLIENT_ID - MjT42KkgioYeyoM5EqgjCk8Mbz5atj7n
 *   AUTH0_CLIENT_SECRET - Auth0 client secret
 */

export const AUTH0_CONFIG = {
  domain: "dev-jzw3etjxnn3svs56.us.auth0.com",
  clientId: "MjT42KkgioYeyoM5EqgjCk8Mbz5atj7n",
  audience: "https://counter-control-plane-api.fly.dev",
  scope: "openid profile email operator:read operator:write",
} as const;
