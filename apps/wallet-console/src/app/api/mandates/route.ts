/**
 * Thin server-side proxy: submits an already-signed counter.mandate.v1
 * envelope (built and signed client-side in connect-panel.tsx, using a
 * disposable consent key that never leaves the browser) to
 * control-plane-api's real verify-and-persist route. The browser never
 * sees the Auth0 access token — only whether the submission succeeded.
 *
 * Gated by payment.mandate.manage server-side, which requires step-up
 * assurance — the caller must have completed mfa.challengeWithPopup()
 * earlier in the same flow (see connect-panel.tsx); the resulting elevated
 * token is what auth0.getAccessToken() returns here.
 */
import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { decodeIdTokenClaims } from "@/lib/id-token-claims";

const CONTROL_PLANE_URL =
  process.env["CONTROL_PLANE_URL"] ?? "https://counter-control-plane-api.fly.dev";
const NAMESPACE = "https://counter.dev/";

export async function POST(request: Request) {
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

  const body = (await request.json().catch(() => undefined)) as { envelope?: unknown } | undefined;
  if (body?.envelope === undefined) {
    return NextResponse.json(
      { error: { code: "INVALID_FORMAT", message: "Field 'envelope' is required" } },
      { status: 400 },
    );
  }

  const { token } = await auth0.getAccessToken();

  const upstream = await fetch(
    `${CONTROL_PLANE_URL}/control/v1/wallets/${encodeURIComponent(walletId)}/mandates`,
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ envelope: body.envelope }),
    },
  );

  const result = await upstream.json().catch(() => ({}));
  return NextResponse.json(result, { status: upstream.status });
}
