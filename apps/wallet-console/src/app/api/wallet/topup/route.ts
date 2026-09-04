/**
 * Server-side proxy: begins a real Razorpay top-up order for the logged-in
 * person's own wallet.
 *
 * Gated server-side by identity.scope.manage, which requires step-up
 * assurance (packages/authorization/src/assurance.ts — tenantMutationAssurances)
 * — the caller must have completed mfa.challengeWithPopup() earlier in the
 * same flow (see topup-panel.tsx), same as /api/mandates's POST. Uses
 * lib/step-up-token.ts, NOT plain auth0.getAccessToken() — see that file's
 * header for why the plain call would silently return a stale, non-elevated
 * token and get a 403.
 */
import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { decodeIdTokenClaims } from "@/lib/id-token-claims";
import { getStepUpAccessToken } from "@/lib/step-up-token";

const CONTROL_PLANE_URL =
  process.env["CONTROL_PLANE_URL"] ?? "https://counter-control-plane-api.fly.dev";
const NAMESPACE = "https://counter.dev/";

function resolveWalletId(idToken: string | undefined): string | undefined {
  const claims = decodeIdTokenClaims(idToken);
  const scope = claims[`${NAMESPACE}scope`] as { walletId?: string } | undefined;
  return scope?.walletId;
}

export async function POST(request: Request) {
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

  const body = (await request.json().catch(() => undefined)) as
    | { amountMinor?: string }
    | undefined;
  if (typeof body?.amountMinor !== "string") {
    return NextResponse.json(
      { error: { code: "INVALID_FORMAT", message: "Field 'amountMinor' is required" } },
      { status: 400 },
    );
  }

  const { token } = await getStepUpAccessToken(session);

  const upstream = await fetch(
    `${CONTROL_PLANE_URL}/control/v1/wallets/${encodeURIComponent(walletId)}/topup/order`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ amountMinor: body.amountMinor }),
    },
  );

  const result = await upstream.json().catch(() => ({}));
  return NextResponse.json(result, { status: upstream.status });
}
