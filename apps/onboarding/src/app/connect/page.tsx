import { auth0 } from "@/lib/auth0";
import { decodeIdTokenClaims } from "@/lib/id-token-claims";
import { ConnectPanel } from "./connect-panel";

const NAMESPACE = "https://counter.dev/";

export default async function ConnectPage() {
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
      <h1>Connect your AI</h1>
      <p className="lede">
        You&apos;re signed in as {session.user.email ?? session.user.name ?? session.user.sub}.
        {walletId
          ? " Generate a one-time command below to connect an AI tool to your wallet."
          : " We couldn't find your wallet yet — try logging out and back in."}
      </p>
      {walletId !== undefined && <ConnectPanel walletId={walletId} />}
      <p style={{ marginTop: "2rem" }}>
        <a href="/auth/logout" style={{ color: "var(--muted)" }}>
          Log out
        </a>
      </p>
    </main>
  );
}
