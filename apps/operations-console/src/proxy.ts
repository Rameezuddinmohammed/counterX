/**
 * Real, enforced auth boundary for the Operations Console (Next.js 16 proxy
 * convention — mirrors apps/merchant-console/src/proxy.ts and
 * apps/wallet-console/src/proxy.ts). Replaces the previous middleware.ts,
 * which only checked that AN `x-operator-session` header or
 * `counter_operator_session` cookie was PRESENT — any value, including a
 * completely fabricated one, passed. Confirmed by execution: a request
 * with no cookie got 401, but `Cookie: counter_operator_session=anything`
 * got 200 and full access to every page.
 *
 * This is a private, fully-authenticated surface (like Merchant Console),
 * so every route is protected except Auth0's own /auth/* routes (login,
 * logout, callback — handled internally by auth0.middleware, no separate
 * route.ts needed under the v4 SDK) and static assets excluded via the
 * matcher below.
 *
 * See lib/auth0.ts for the known, disclosed gap this does NOT close: a
 * real Auth0 login is now required, but nothing here yet proves the
 * logged-in person is specifically an operator (that needs an Auth0
 * Post-Login Action this session can't add) — only that backend
 * operator-gated actions independently still require it.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth0 } from "./lib/auth0";

export async function proxy(request: NextRequest) {
  const authResponse = await auth0.middleware(request);
  if (request.nextUrl.pathname.startsWith("/auth/")) {
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
