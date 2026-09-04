/**
 * Thin server-side proxy: revokes one of this wallet's own mandates.
 *
 * Gated by payment.mandate.manage server-side (control-plane-api's
 * wallet-mandate-routes.ts) — the SAME step-up-assurance bar as issuing a
 * mandate in the first place, since revoking is the same authority grant in
 * reverse. The caller must have completed mfa.challengeWithPopup() in THIS
 * request's own flow (see mandates-list.tsx) — see lib/step-up-token.ts for
 * why a plain auth0.getAccessToken() call would silently hand back a
 * stale, non-elevated token instead.
 */
import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { decodeIdTokenClaims } from "@/lib/id-token-claims";
import { getStepUpAccessToken } from "@/lib/step-up-token";

const CONTROL_PLANE_URL =
  process.env["CONTROL_PLANE_URL"] ?? "https://counter-control-plane-api.fly.dev";
const NAMESPACE = "https://counter.dev/";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ mandateId: string }> },
) {
  const session = await auth0.getSession();
  if (session === null) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Please log in first." } },
      { status: 401 },
    );
  }

  const claims = decodeIdTokenClaims(session.tokenSet.idToken);
  const scope = claims[`${NAMESPACE}scope`] as { walletId?: string } | undefined;
  const walletId = scope?.walletId;
  if (walletId === undefined) {
    return NextResponse.json(
      { error: { code: "NO_WALLET", message: "No wallet is associated with this session." } },
      { status: 400 },
    );
  }

  const { mandateId } = await params;
  const { token, source, assurance } = await getStepUpAccessToken(session);
  console.info(
    `[mandates.revoke] token source=${source} assurance=${assurance} wallet=${walletId} mandate=${mandateId}`,
  );

  const upstream = await fetch(
    `${CONTROL_PLANE_URL}/control/v1/wallets/${encodeURIComponent(walletId)}/mandates/${encodeURIComponent(mandateId)}/revoke`,
    { method: "POST", headers: { authorization: `Bearer ${token}` } },
  );

  const result = await upstream.json().catch(() => ({}));
  return NextResponse.json(result, { status: upstream.status });
}
