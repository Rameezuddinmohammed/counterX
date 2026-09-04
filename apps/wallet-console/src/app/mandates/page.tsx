import { PageWrapper } from "@/components/page-wrapper";
import { auth0 } from "@/lib/auth0";
import { decodeIdTokenClaims } from "@/lib/id-token-claims";
import { MandatesList } from "./mandates-list";

const NAMESPACE = "https://counter.dev/";

/**
 * Real mandate listing, replacing what used to be MOCK_MANDATES with four
 * hardcoded rows and "Pause"/"New Mandate" buttons that did nothing. Same
 * server-resolves-walletId, client-component-does-the-work split as
 * connect/page.tsx.
 */
export default async function MandatesPage() {
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
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Mandates</h1>
          <p className="mt-1 text-[var(--foreground-secondary)]">
            Spending authority you&apos;ve granted an agent — what it can spend, where, and until
            when.
          </p>
        </div>

        {walletId === undefined ? (
          <p className="text-sm text-[var(--foreground-muted)]">
            We couldn&apos;t find your wallet yet — try logging out and back in.
          </p>
        ) : (
          <MandatesList />
        )}
      </div>
    </PageWrapper>
  );
}
