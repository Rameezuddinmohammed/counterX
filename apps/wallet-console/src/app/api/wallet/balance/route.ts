/**
 * Server-side proxy for the wallet's own balance and recent activity.
 *
 * GET — control-plane-api's GET /control/v1/wallets/:walletId/balance
 *   (apps/control-plane-api/src/wallet-balance-routes.ts), gated there by
 *   identity.scope.read only — a plain session token is enough. Built for
 *   exactly this dashboard ("Phase 4 (wallet-dashboard backend)" per that
 *   route's own header comment) but never wired to it until now.
 *
 * Same walletId-from-session-claims pattern as ../../mandates/route.ts.
 */
import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { decodeIdTokenClaims } from "@/lib/id-token-claims";

const CONTROL_PLANE_URL =
  process.env["CONTROL_PLANE_URL"] ?? "https://counter-control-plane-api.fly.dev";
const NAMESPACE = "https://counter.dev/";

function resolveWalletId(idToken: string | undefined): string | undefined {
  const claims = decodeIdTokenClaims(idToken);
  const scope = claims[`${NAMESPACE}scope`] as { walletId?: string } | undefined;
  return scope?.walletId;
}

export async function GET() {
  const session = await auth0.getSession();
  if (session === null) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Please log in first." } },
      { status: 401 },
    );
  }

  const walletId = resolveWalletId(session.tokenSet.idToken);
  if (walletId === undefined) {
    return NextResponse.json(
      { error: { code: "NO_WALLET", message: "No wallet is associated with this session." } },
      { status: 400 },
    );
  }

  const { token } = await auth0.getAccessToken();

  const upstream = await fetch(
    `${CONTROL_PLANE_URL}/control/v1/wallets/${encodeURIComponent(walletId)}/balance`,
    { headers: { authorization: `Bearer ${token}` } },
  );

  const result = await upstream.json().catch(() => ({}));
  return NextResponse.json(result, { status: upstream.status });
}
