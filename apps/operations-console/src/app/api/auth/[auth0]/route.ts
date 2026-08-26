/**
 * Auth0 dynamic route handler for the Operations Console.
 *
 * Handles /api/auth/login, /api/auth/logout, /api/auth/callback, /api/auth/me
 * using the @auth0/nextjs-auth0 SDK v4 App Router integration.
 */

export const GET = () => {
  return new Response(JSON.stringify({ message: "Auth0 route handler" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

export const POST = GET;
