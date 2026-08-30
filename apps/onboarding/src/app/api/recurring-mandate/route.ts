/**
 * Thin server-side proxy: begins recurring-mandate registration for the
 * logged-in person's own wallet. The browser never sees the Auth0 access
 * token — only the checkout config (Razorpay order id + public key id)
 * needed to open Razorpay's own checkout widget, which is where the actual
 * UPI Autopay authorization happens (never on a Counter server).
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
        contactName?: string;
        contactEmail?: string;
        contactPhone?: string;
        ceilingMinor?: string;
        validUntil?: string;
      }
    | undefined;
  if (
    typeof body?.contactName !== "string" ||
    typeof body.contactEmail !== "string" ||
    typeof body.contactPhone !== "string" ||
    typeof body.ceilingMinor !== "string" ||
    typeof body.validUntil !== "string"
  ) {
    return NextResponse.json(
      { error: { code: "INVALID_FORMAT", message: "Missing required fields." } },
      { status: 400 },
    );
  }

  const { token } = await auth0.getAccessToken();

  const upstream = await fetch(
    `${CONTROL_PLANE_URL}/control/v1/wallets/${encodeURIComponent(walletId)}/recurring-mandates`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        contactName: body.contactName,
        contactEmail: body.contactEmail,
        contactPhone: body.contactPhone,
        ceilingMinor: body.ceilingMinor,
        validUntil: body.validUntil,
        // No merchant/operation scoping UI yet — an empty list means "no
        // restriction" per checkPaymentReference's existing convention.
        eligibleMerchants: [],
        eligibleOperations: ["purchase"],
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
          message: errorBody?.error?.message ?? "Could not begin mandate registration.",
        },
      },
      { status: upstream.status },
    );
  }

  const result = await upstream.json();
  return NextResponse.json(result, { status: 201 });
}
