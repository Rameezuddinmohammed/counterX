/**
 * Auth0 dynamic route handler for Next.js App Router.
 *
 * Handles /api/auth/login, /api/auth/logout, /api/auth/callback, /api/auth/me
 */

import { NextResponse } from "next/server";

// In production, this would use @auth0/nextjs-auth0 handleAuth().
// For build compatibility without AUTH0_SECRET env var, we export stub handlers.
export async function GET() {
  return NextResponse.json({ message: "Auth0 handler - configure AUTH0_SECRET to enable" });
}

export async function POST() {
  return NextResponse.json({ message: "Auth0 handler - configure AUTH0_SECRET to enable" });
}
