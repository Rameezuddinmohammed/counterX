/**
 * Real profile: identity (name/email) comes straight from the Auth0
 * session; wallet id comes from the same id-token scope claim every other
 * real page in this app already reads (connect/page.tsx, the mandates and
 * balance API proxies). No "Linked Services" card — that had no real
 * backend behind it (a fabricated "Bank Account — Connected" row), so it's
 * dropped rather than dressed up as "coming soon" for a feature that was
 * never actually planned here.
 */
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Avatar,
  AvatarFallback,
  Badge,
  Separator,
} from "@counter/ui";
import { User, Mail, Wallet, Globe } from "lucide-react";
import { PageWrapper } from "@/components/page-wrapper";
import { auth0 } from "@/lib/auth0";
import { decodeIdTokenClaims } from "@/lib/id-token-claims";

const NAMESPACE = "https://counter.dev/";

export default async function ProfilePage() {
  const session = await auth0.getSession();
  if (session === null) {
    return null;
  }

  const claims = decodeIdTokenClaims(session.tokenSet.idToken);
  const scope = claims[`${NAMESPACE}scope`] as { walletId?: string } | undefined;
  const walletId = scope?.walletId;
  const displayName = session.user.name ?? session.user.email ?? session.user.sub;
  const initials = displayName.slice(0, 2).toUpperCase();

  return (
    <PageWrapper>
      <div className="space-y-6 max-w-3xl">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Profile</h1>
          <p className="mt-1 text-[var(--foreground-secondary)]">
            Your account information and wallet details.
          </p>
        </div>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-6">
              <Avatar className="h-20 w-20">
                <AvatarFallback className="bg-[var(--brand-orange)]/20 text-[var(--brand-orange)] text-2xl font-bold">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div>
                <h2 className="text-xl font-bold text-[var(--foreground)]">{displayName}</h2>
                {session.user.email && (
                  <p className="text-[var(--foreground-secondary)]">{session.user.email}</p>
                )}
                <div className="mt-2 flex items-center gap-2">
                  <Badge variant="default">Owner</Badge>
                  <Badge variant="success">Active</Badge>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Account Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <User className="h-4 w-4 text-[var(--foreground-muted)]" />
              <div className="flex-1">
                <p className="text-sm text-[var(--foreground-secondary)]">Name</p>
                <p className="text-sm font-medium text-[var(--foreground)]">{displayName}</p>
              </div>
            </div>
            {session.user.email && (
              <>
                <Separator />
                <div className="flex items-center gap-3">
                  <Mail className="h-4 w-4 text-[var(--foreground-muted)]" />
                  <div className="flex-1">
                    <p className="text-sm text-[var(--foreground-secondary)]">Email</p>
                    <p className="text-sm font-medium text-[var(--foreground)]">
                      {session.user.email}
                    </p>
                  </div>
                </div>
              </>
            )}
            <Separator />
            <div className="flex items-center gap-3">
              <Wallet className="h-4 w-4 text-[var(--foreground-muted)]" />
              <div className="flex-1">
                <p className="text-sm text-[var(--foreground-secondary)]">Wallet ID</p>
                <p className="text-sm font-mono font-medium text-[var(--foreground)]">
                  {walletId ?? "No wallet found for this account"}
                </p>
              </div>
            </div>
            <Separator />
            <div className="flex items-center gap-3">
              <Globe className="h-4 w-4 text-[var(--foreground-muted)]" />
              <div className="flex-1">
                <p className="text-sm text-[var(--foreground-secondary)]">Environment</p>
                <p className="text-sm font-medium text-[var(--foreground)]">Pilot (Test Mode)</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </PageWrapper>
  );
}
