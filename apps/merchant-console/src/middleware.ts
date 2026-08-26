/**
 * Middleware for the Merchant Console.
 *
 * In production, this protects all routes except /api/auth/* using Auth0.
 * Currently a pass-through for build compatibility.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(_request: NextRequest) {
  // When AUTH0_SECRET is configured, use withMiddlewareAuthRequired from @auth0/nextjs-auth0
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
