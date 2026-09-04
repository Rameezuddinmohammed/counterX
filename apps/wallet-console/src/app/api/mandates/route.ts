/**
 * Server-side proxy for the wallet's own mandates.
 *
 * GET  — lists this wallet's currently-active mandates
 *   (control-plane-api's GET /control/v1/wallets/:walletId/mandates). Gated
 *   there by identity.scope.read only (packages/authorization/src/assurance.ts
 *   — authenticatedAssurances), so a plain session token is enough; no
 *   step-up popup needed just to look at what already exists.
 *
 * POST — submits an already-signed counter.mandate.v1 envelope (built and
 *   signed client-side in connect-panel.tsx, using a disposable consent key
 *   that never leaves the browser) to control-plane-api's real
 *   verify-and-persist route. The browser never sees the Auth0 access
 *   token — only whether the submission succeeded.
 *
 *   Gated by payment.mandate.manage server-side, which requires step-up
 *   assurance — the caller must have completed mfa.challengeWithPopup()
 *   earlier in the same flow (see connect-panel.tsx); lib/step-up-token.ts
 *   explains why that elevated token is NOT what auth0.getAccessToken()
 *   returns, and where it actually lives.
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

  // Plain session token is enough — see this file's header.
  const { token } = await auth0.getAccessToken();

  const upstream = await fetch(
    `${CONTROL_PLANE_URL}/control/v1/wallets/${encodeURIComponent(walletId)}/mandates`,
    { headers: { authorization: `Bearer ${token}` } },
  );

  const result = await upstream.json().catch(() => ({}));
  return NextResponse.json(result, { status: upstream.status });
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

  const body = (await request.json().catch(() => undefined)) as { envelope?: unknown } | undefined;
  if (body?.envelope === undefined) {
    return NextResponse.json(
      { error: { code: "INVALID_FORMAT", message: "Field 'envelope' is required" } },
      { status: 400 },
    );
  }

  // NOT auth0.getAccessToken() — same reason as setup-token/route.ts; the
  // step-up token lives in session.accessTokens[]. See lib/step-up-token.ts.
  const { token, source, assurance } = await getStepUpAccessToken(session);
  // agent_id is the one field the server can reject for reasons the buyer
  // can't see (it must be an active agent owned by THIS wallet), so log which
  // agent the browser actually asked to authorize. Public identifiers only.
  const submittedAgentId = (body.envelope as { payload?: { agent_id?: unknown } } | undefined)
    ?.payload?.agent_id;
  console.info(
    `[mandates] token source=${source} assurance=${assurance} wallet=${walletId} agent=${String(submittedAgentId)}`,
  );

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
