import { PageWrapper } from "@/components/page-wrapper";
import { auth0 } from "@/lib/auth0";
import { decodeIdTokenClaims } from "@/lib/id-token-claims";
import { TopupPanel } from "./topup-panel";

const NAMESPACE = "https://counter.dev/";

/**
 * Real self-serve Razorpay top-up of the wallet's prepaid balance — the
 * demo-scoped revival of Phase 2's custodial model (see
 * revert/phase2-prepaid-balance's PR description for why). Same
 * server-resolves-walletId, client-component-does-the-work split as
 * connect/page.tsx and mandates/page.tsx.
 */
export default async function TopupPage() {
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
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Add funds</h1>
          <p className="mt-1 text-[var(--foreground-secondary)]">
            Top up your wallet with a real Razorpay test-mode payment. Your AI agent draws down this
            balance for purchases within the guardrails you&apos;ve set.
          </p>
        </div>

        {walletId === undefined ? (
          <p className="text-sm text-[var(--foreground-muted)]">
            We couldn&apos;t find your wallet yet — try logging out and back in.
          </p>
        ) : (
          <TopupPanel walletId={walletId} />
        )}
      </div>
    </PageWrapper>
  );
}
