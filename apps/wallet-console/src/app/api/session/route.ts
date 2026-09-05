/**
 * Lightweight session identity for client components that need the real
 * wallet id / user identity but aren't already a server component with
 * direct session access (e.g. app-sidebar.tsx, mounted on every page).
 * Decodes the LOCAL session only — no upstream control-plane-api call.
 */
import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { decodeIdTokenClaims } from "@/lib/id-token-claims";

const NAMESPACE = "https://counter.dev/";

export async function GET() {
  const session = await auth0.getSession();
  if (session === null) {
    return NextResponse.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 });
  }

  const claims = decodeIdTokenClaims(session.tokenSet.idToken);
  const scope = claims[`${NAMESPACE}scope`] as { walletId?: string } | undefined;

  return NextResponse.json({
    walletId: scope?.walletId,
    email: session.user.email ?? null,
    name: session.user.name ?? null,
  });
}
