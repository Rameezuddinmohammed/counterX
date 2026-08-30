/**
 * Real, enforced auth boundary for the Onboarding app (Next.js 16 proxy
 * convention). Unlike merchant-console/wallet-console's known pass-through
 * gap, this app's protected routes are actually gated here — /connect
 * requires a session; everything else (marketing pages, the SDK's own
 * /auth/* routes) is left alone.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth0 } from "./lib/auth0";

const PROTECTED_PATHS = ["/connect"];

export async function proxy(request: NextRequest) {
  const authResponse = await auth0.middleware(request);
  if (request.nextUrl.pathname.startsWith("/auth/")) {
    return authResponse;
  }

  const isProtected = PROTECTED_PATHS.some((path) => request.nextUrl.pathname.startsWith(path));
  if (isProtected) {
    const session = await auth0.getSession(request);
    if (session === null) {
      const loginUrl = new URL("/auth/login", request.nextUrl.origin);
      loginUrl.searchParams.set("returnTo", request.nextUrl.pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  return authResponse;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)"],
};
