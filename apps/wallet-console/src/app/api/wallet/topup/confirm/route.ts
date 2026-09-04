/**
 * Server-side proxy: confirms a top-up after Razorpay's checkout widget
 * completes. Forwards the widget's callback payload to control-plane-api,
 * which independently re-verifies it against Razorpay (HMAC signature +
 * authoritative GET /v1/payments/:id) before crediting anything — this
 * route trusts nothing about the callback itself, only relays it, and never
 * sends an amount (control-plane-api credits the amount IT recorded when it
 * created the order, never a client-supplied figure).
 *
 * Same step-up-token requirement as ./route.ts's POST — see that file's
 * header.
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
    | {
        razorpayOrderId?: string;
        razorpayPaymentId?: string;
        razorpaySignature?: string;
      }
    | undefined;
  if (
    typeof body?.razorpayOrderId !== "string" ||
    typeof body.razorpayPaymentId !== "string" ||
    typeof body.razorpaySignature !== "string"
  ) {
    return NextResponse.json(
      { error: { code: "INVALID_FORMAT", message: "Missing required fields." } },
      { status: 400 },
    );
  }

  const { token } = await getStepUpAccessToken(session);

  const upstream = await fetch(
    `${CONTROL_PLANE_URL}/control/v1/wallets/${encodeURIComponent(walletId)}/topup/confirm`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        razorpayOrderId: body.razorpayOrderId,
        razorpayPaymentId: body.razorpayPaymentId,
        razorpaySignature: body.razorpaySignature,
      }),
    },
  );

  const result = await upstream.json().catch(() => ({}));
  return NextResponse.json(result, { status: upstream.status });
}
