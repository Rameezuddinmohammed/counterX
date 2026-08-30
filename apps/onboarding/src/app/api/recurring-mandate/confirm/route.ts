/**
 * Thin server-side proxy: confirms a mandate registration after Razorpay's
 * checkout widget completes. Forwards the widget's callback payload to
 * control-plane-api, which independently verifies the signature against
 * Razorpay before activating the mandate — this route trusts nothing about
 * the callback itself, only relays it.
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

  const body = (await request.json().catch(() => undefined)) as
    | {
        referenceId?: string;
        razorpayOrderId?: string;
        razorpayPaymentId?: string;
        razorpaySignature?: string;
      }
    | undefined;
  if (
    typeof body?.referenceId !== "string" ||
    typeof body.razorpayOrderId !== "string" ||
    typeof body.razorpayPaymentId !== "string" ||
    typeof body.razorpaySignature !== "string"
  ) {
    return NextResponse.json(
      { error: { code: "INVALID_FORMAT", message: "Missing required fields." } },
      { status: 400 },
    );
  }

  const { token } = await auth0.getAccessToken();

  const upstream = await fetch(
    `${CONTROL_PLANE_URL}/control/v1/wallets/${encodeURIComponent(walletId)}/recurring-mandates/${encodeURIComponent(body.referenceId)}/confirm`,
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

  if (!upstream.ok) {
    const errorBody = (await upstream.json().catch(() => undefined)) as
      | { error?: { message?: string } }
      | undefined;
    return NextResponse.json(
      {
        error: {
          code: "UPSTREAM_ERROR",
          message: errorBody?.error?.message ?? "Could not confirm mandate registration.",
        },
      },
      { status: upstream.status },
    );
  }

  const result = await upstream.json();
  return NextResponse.json(result, { status: 200 });
}
