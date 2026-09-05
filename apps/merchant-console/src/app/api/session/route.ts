import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { decodeAccessTokenClaims } from "@/lib/access-token-claims";

export interface SessionIdentity {
  readonly merchantId?: string | null;
  readonly email?: string | null;
  readonly name?: string | null;
  readonly picture?: string | null;
  readonly sub?: string | null;
  readonly roles?: readonly string[];
  readonly assurance?: string;
}

export async function GET() {
  const session = await auth0.getSession();
  if (session === null) {
    return NextResponse.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 });
  }

  const idToken = session.tokenSet?.idToken;
  const accessToken = session.tokenSet?.accessToken;
  const claims =
    (idToken ? decodeAccessTokenClaims(idToken) : undefined) ??
    (accessToken ? decodeAccessTokenClaims(accessToken) : undefined);

  const merchantId = claims?.scope?.merchantId ?? null;

  return NextResponse.json<SessionIdentity>({
    merchantId,
    email: session.user.email ?? null,
    name: session.user.name ?? null,
    picture: (session.user.picture as string | undefined) ?? null,
    sub: session.user.sub ?? null,
    roles: claims?.roles ?? ["merchant.owner"],
    assurance: claims?.assurance ?? "step_up",
  });
}
