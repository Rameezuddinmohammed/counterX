/**
 * Operations Console authentication middleware.
 *
 * Ensures every page request carries a valid operator session.
 * Checks for either:
 *   - An `x-operator-session` request header, or
 *   - A `counter_operator_session` cookie
 *
 * If neither is present, returns a 401 JSON response.
 * Static assets and internal Next.js routes are excluded via the matcher config.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SESSION_HEADER = "x-operator-session";
const SESSION_COOKIE = "counter_operator_session";

export function middleware(request: NextRequest): NextResponse {
  const headerSession = request.headers.get(SESSION_HEADER);
  const cookieSession = request.cookies.get(SESSION_COOKIE)?.value;

  if (!headerSession && !cookieSession) {
    return NextResponse.json({ error: "Operator authentication required" }, { status: 401 });
  }

  return NextResponse.next();
}

/**
 * Only apply to page routes. Exclude static assets, Next.js internals,
 * and common static files like favicon.
 */
export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - /_next (Next.js internals: static files, HMR, etc.)
     * - /favicon.ico
     */
    "/((?!_next|favicon\\.ico).*)",
  ],
};
