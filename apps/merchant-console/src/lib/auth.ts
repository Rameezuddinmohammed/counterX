/**
 * Auth0 configuration for the Counter Merchant Console.
 *
 * Uses @auth0/nextjs-auth0 v4 for authentication.
 * Environment variables:
 *   AUTH0_SECRET - random session encryption key
 *   AUTH0_BASE_URL - app base URL (e.g., http://localhost:3000)
 *   AUTH0_ISSUER_BASE_URL - Auth0 tenant URL
 *   AUTH0_CLIENT_ID - application client ID
 *   AUTH0_CLIENT_SECRET - application client secret
 */

export const AUTH0_CONFIG = {
  domain: "dev-jzw3etjxnn3svs56.us.auth0.com",
  clientId: "MjT42KkgioYeyoM5EqgjCk8Mbz5atj7n",
  issuerBaseUrl: "https://dev-jzw3etjxnn3svs56.us.auth0.com",
} as const;
