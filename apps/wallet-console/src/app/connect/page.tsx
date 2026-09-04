import { PageWrapper } from "@/components/page-wrapper";
import { auth0 } from "@/lib/auth0";
import { decodeIdTokenClaims } from "@/lib/id-token-claims";
import { ConnectPanel } from "./connect-panel";

const NAMESPACE = "https://counter.dev/";

export default async function ConnectPage() {
  const session = await auth0.getSession();
  // proxy.ts already redirects unauthenticated requests to /auth/login
  // before this ever renders; session is non-null here except in a race
  // with logout.
  if (session === null) {
    return null;
  }

  const claims = decodeIdTokenClaims(session.tokenSet.idToken);
  const scope = claims[`${NAMESPACE}scope`] as { walletId?: string } | undefined;
  const walletId = scope?.walletId;

  return (
    <PageWrapper>
      <div className="max-w-2xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Connect your agent</h1>
          <p className="mt-1 text-[var(--foreground-secondary)]">
            Set spending guardrails and authorize an already-connected AI agent to spend within
            them.
          </p>
        </div>

        {walletId === undefined ? (
          <p className="text-sm text-[var(--foreground-muted)]">
            We couldn&apos;t find your wallet yet — try logging out and back in.
          </p>
        ) : (
          <>
            <p className="text-sm text-[var(--foreground-muted)]">
              Haven&apos;t connected your AI tool yet? Do that first at the onboarding site&apos;s{" "}
              <span className="font-mono">/connect</span> page — it walks you through generating a
              real signing key on your own machine and registering it. Come back here once you have
              your agent ID.
            </p>
            <ConnectPanel walletId={walletId} />
          </>
        )}
      </div>
    </PageWrapper>
  );
}
