/**
 * Real, enforced auth boundary for the Merchant Console (Next.js 16 proxy
 * convention — mirrors apps/onboarding/src/proxy.ts). This closes the
 * known, long-standing gap where this app's middleware was a literal
 * pass-through that let every route through unauthenticated.
 *
 * Unlike Onboarding (a public site with a couple of protected sub-paths),
 * the whole Merchant Console is a private, authenticated surface, so every
 * route is protected except Auth0's own /auth/* routes (login, logout,
 * callback, etc., handled internally by auth0.middleware) and static
 * assets excluded via the matcher below.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth0 } from "./lib/auth0";

export async function proxy(request: NextRequest) {
  const authResponse = await auth0.middleware(request);
  if (
    request.nextUrl.pathname.startsWith("/auth/") ||
    request.nextUrl.pathname.startsWith("/control/")
  ) {
    return authResponse;
  }

  const session = await auth0.getSession(request);
  if (session === null) {
    const loginUrl = new URL("/auth/login", request.nextUrl.origin);
    loginUrl.searchParams.set("returnTo", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return authResponse;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)"],
};
