"use client";

/**
 * Real self-serve "request access" + application status landing page —
 * replaces the old fully-static demo (hardcoded "Merchant Pilot-001", a
 * lifecycle vocabulary that didn't match the real state machine).
 *
 * Calls POST /control/v1/merchant-applications/provision, which is
 * deliberately self-authorizing for a plain logged-in session (no merchant
 * scope needed yet) — see apps/control-plane-api/src/
 * merchant-application-routes.ts's header for the full judgment call this
 * makes and why. That route is also idempotent, so this page uses IT (not
 * GET /merchant-applications/:id, which needs real merchant-scoped claims a
 * fresh session doesn't have) both to create the application on first click
 * AND to refresh status on every later visit — see
 * lib/merchant-application-storage.ts for why a cached merchantId, not a
 * server lookup, is what decides whether this page shows "Request Access"
 * or the current status.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
  Button,
  Skeleton,
  ErrorState,
} from "@counter/ui";
import { UserPlus, ArrowRight } from "lucide-react";
import { PageWrapper } from "@/components/page-wrapper";
import { getApiClient } from "@/hooks/use-api";
import { getStoredMerchantId, setStoredMerchantId } from "@/lib/merchant-application-storage";
import { lifecycleStateLabel } from "@/lib/onboarding-labels";
import type { ProvisionMerchantApplicationResponse } from "@/lib/types";

function nextStepHref(
  state: ProvisionMerchantApplicationResponse["lifecycleState"],
): string | null {
  switch (state) {
    case "DRAFT":
      return "/invite/business-basics";
    case "CONNECTING":
      return "/invite/catalog-connect";
    default:
      // MAPPING and beyond: Steps 3+ (catalog review, payment connect,
      // readiness, manifest confirmation) are a later pass — nothing to
      // link to yet from here.
      return null;
  }
}

function nextStepLabel(state: ProvisionMerchantApplicationResponse["lifecycleState"]): string {
  switch (state) {
    case "DRAFT":
      return "Add your business details";
    case "CONNECTING":
      return "Connect your catalog";
    default:
      return "Continue";
  }
}

export default function InvitePage() {
  const router = useRouter();
  const [status, setStatus] = useState<ProvisionMerchantApplicationResponse | null>(null);
  const [hasRequestedBefore, setHasRequestedBefore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const cachedMerchantId = getStoredMerchantId();
    if (cachedMerchantId === undefined) {
      return; // Show the "Request Access" button — no local record of a prior request.
    }
    setHasRequestedBefore(true);
    void refreshStatus();
  }, []);

  async function refreshStatus() {
    setLoading(true);
    setError(null);
    const result = await getApiClient().provisionMerchantApplication();
    setLoading(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setStoredMerchantId(result.data.merchantId);
    setHasRequestedBefore(true);
    setStatus(result.data);
  }

  async function handleRequestAccess() {
    await refreshStatus();
  }

  const href = status !== null ? nextStepHref(status.lifecycleState) : null;

  return (
    <PageWrapper>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Sell on Counter</h1>
          <p className="mt-1 text-[var(--foreground-secondary)]">
            Set up your business to accept AI-agent purchases.
          </p>
        </div>

        {!hasRequestedBefore && !loading ? (
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="rounded-lg bg-[var(--brand-orange)]/10 p-3">
                  <UserPlus className="h-6 w-6 text-[var(--brand-orange)]" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-[var(--foreground)]">Get started</p>
                  <p className="text-sm text-[var(--foreground-muted)]">
                    Request access to start selling — this creates your merchant account
                    immediately, no waiting for an invitation.
                  </p>
                </div>
                <Button onClick={() => void handleRequestAccess()}>Request Access</Button>
              </div>
              {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
            </CardContent>
          </Card>
        ) : loading && status === null ? (
          <Skeleton className="h-24 w-full" />
        ) : error && status === null ? (
          <ErrorState message={error} onRetry={() => void refreshStatus()} />
        ) : status !== null ? (
          <>
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="rounded-lg bg-[var(--brand-orange)]/10 p-3">
                      <UserPlus className="h-6 w-6 text-[var(--brand-orange)]" />
                    </div>
                    <div>
                      <p className="font-semibold text-[var(--foreground)]">Your application</p>
                      <p className="text-sm text-[var(--foreground-muted)]">{status.merchantId}</p>
                    </div>
                  </div>
                  <Badge variant={status.approvalStatus === "rejected" ? "error" : "success"}>
                    {status.approvalStatus === "pending"
                      ? "Under review"
                      : status.approvalStatus === "approved"
                        ? "Approved"
                        : "Not approved"}
                  </Badge>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Setup progress</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-[var(--foreground-secondary)]">
                  {lifecycleStateLabel(status.lifecycleState)}
                </p>
                {href !== null && (
                  <Button className="mt-4" onClick={() => router.push(href)}>
                    {nextStepLabel(status.lifecycleState)}
                    <ArrowRight className="ml-2 h-3.5 w-3.5" />
                  </Button>
                )}
              </CardContent>
            </Card>

            <p className="text-xs text-[var(--foreground-muted)]">
              Being under review does not block setup — you can keep completing the steps above
              while Counter reviews your application.
            </p>
          </>
        ) : null}
      </div>
    </PageWrapper>
  );
}
