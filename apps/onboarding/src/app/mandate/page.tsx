import { auth0 } from "@/lib/auth0";
import { decodeIdTokenClaims } from "@/lib/id-token-claims";
import { MandatePanel } from "./mandate-panel";

const NAMESPACE = "https://counter.dev/";

export default async function MandatePage() {
  const session = await auth0.getSession();
  // proxy.ts already redirects unauthenticated requests to /auth/login before
  // this ever renders; session is non-null here except in a race with logout.
  if (session === null) {
    return null;
  }

  const claims = decodeIdTokenClaims(session.tokenSet.idToken);
  const scope = claims[`${NAMESPACE}scope`] as { kind?: string; walletId?: string } | undefined;
  const walletId = scope?.walletId;

  return (
    <main>
      <span className="badge">TEST MODE</span>
      <h1>Set up a standing payment authorization</h1>
      <p className="lede">
        Approve a spending ceiling once, through your own UPI app, and your AI can then make
        repeated purchases against it — up to your own spend-limit policy — without a fresh checkout
        every time.
        {walletId === undefined &&
          " We couldn't find your wallet yet — try logging out and back in."}
      </p>
      {walletId !== undefined && (
        <MandatePanel walletId={walletId} contactEmail={session.user.email ?? ""} />
      )}
      <p style={{ marginTop: "2rem" }}>
        <a href="/connect" style={{ color: "var(--muted)" }}>
          Back to connect
        </a>
      </p>
    </main>
  );
}
