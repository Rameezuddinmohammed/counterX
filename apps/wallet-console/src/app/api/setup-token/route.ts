/**
 * Thin server-side proxy: mints a one-time wallet setup token for the
 * logged-in person's own wallet. The browser never sees the Auth0 access
 * token — only the resulting setup token, which is itself single-use and
 * expires in 15 minutes (apps/control-plane-api/src/wallet-user-store.ts).
 *
 * Gated by identity.agent_key.manage server-side, which requires step-up
 * assurance (packages/authorization/src/assurance.ts) — the caller must
 * have completed mfa.challengeWithPopup() before this succeeds; see
 * connect-panel.tsx. Mirrors apps/onboarding's identical route.
 */
import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { decodeIdTokenClaims } from "@/lib/id-token-claims";
import { getStepUpAccessToken } from "@/lib/step-up-token";

const CONTROL_PLANE_URL =
  process.env["CONTROL_PLANE_URL"] ?? "https://counter-control-plane-api.fly.dev";
const NAMESPACE = "https://counter.dev/";

export async function POST() {
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

  // NOT auth0.getAccessToken() — that returns the login-time token, never the
  // step-up one the popup just produced. See lib/step-up-token.ts.
  const { token, source, assurance } = await getStepUpAccessToken(session);
  console.info(`[setup-token] token source=${source} assurance=${assurance}`);

  const upstream = await fetch(
    `${CONTROL_PLANE_URL}/control/v1/wallet-users/${encodeURIComponent(walletId)}/setup-tokens`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    },
  );

  if (!upstream.ok) {
    const body = (await upstream.json().catch(() => undefined)) as
      | { error?: { message?: string } }
      | undefined;
    return NextResponse.json(
      {
        error: {
          code: "UPSTREAM_ERROR",
          message: body?.error?.message ?? "Could not mint a setup token.",
        },
      },
      { status: upstream.status },
    );
  }

  const result = await upstream.json();
  return NextResponse.json(result, { status: 201 });
}
