"use client";

/**
 * Onboarding wizard Step 5: readiness check.
 *
 * Calling GET .../readiness itself both evaluates readiness AND — when
 * every check passes — advances the application VERIFYING -> SANDBOX_READY
 * server-side (see merchant-readiness-store.ts's header for why this
 * endpoint performs the transition itself rather than a second explicit
 * call). So simply loading this page re-checks and, once everything is in
 * place, unlocks Step 6 automatically — no separate "activate" button.
 *
 * This is a NEW page for the self-serve wizard, distinct from
 * apps/merchant-console/src/app/readiness/page.tsx (the OLD operator-facing
 * demo view of an already-onboarded merchant) — different concern, not
 * touched here.
 */

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, Button, Badge, Skeleton } from "@counter/ui";
import { ArrowRight, CheckCircle2, XCircle, RefreshCw } from "lucide-react";
import { PageWrapper } from "@/components/page-wrapper";
import { getApiClient } from "@/hooks/use-api";
import { getStoredMerchantId } from "@/lib/merchant-application-storage";
import { readinessCheckLabel, readinessCheckPassed } from "@/lib/onboarding-labels";
import type { WizardReadinessSummary } from "@/lib/types";

const PERMISSIONS_NOT_READY_MESSAGE =
  "Your session doesn't have merchant permissions yet. This step needs a one-time Auth0 " +
  "configuration change on Counter's side (not yet done) before it can check readiness — this " +
  "is a known, tracked gap.";

export default function ReadinessPage() {
  const router = useRouter();
  const [merchantId, setMerchantId] = useState<string | undefined>(undefined);
  const [checkedStorage, setCheckedStorage] = useState(false);
  const [summary, setSummary] = useState<WizardReadinessSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runCheck = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    const result = await getApiClient().getWizardReadiness(id);
    setLoading(false);
    if (!result.ok) {
      setError(
        result.error.code === "UNAUTHORIZED" || result.error.code === "FORBIDDEN"
          ? PERMISSIONS_NOT_READY_MESSAGE
          : result.error.message,
      );
      return;
    }
    setSummary(result.data);
  }, []);

  useEffect(() => {
    const id = getStoredMerchantId();
    setMerchantId(id);
    setCheckedStorage(true);
    if (id !== undefined) {
      void runCheck(id);
    }
  }, [runCheck]);

  if (checkedStorage && merchantId === undefined) {
    return (
      <PageWrapper>
        <Card>
          <CardContent className="p-6 text-sm text-[var(--foreground-secondary)]">
            No application found yet.{" "}
            <Link href="/invite" className="text-[var(--brand-red)] underline">
              Start from the beginning
            </Link>
            .
          </CardContent>
        </Card>
      </PageWrapper>
    );
  }

  // payment_configured is never Blocking now — see merchant-readiness-store.ts's
  // comment on why (no per-merchant settlement account is required for this
  // deployment). Kept out of this page's blocking-link logic accordingly;
  // AcceptedLimitation still renders correctly via readinessCheckPassed().
  const catalogBlocking = summary?.checks.some(
    (check) =>
      (check.checkKind === "connector_health" || check.checkKind === "mapping_freshness") &&
      check.status === "Blocking",
  );

  return (
    <PageWrapper>
      <div className="space-y-6">
        <div className="border-b border-[var(--border-secondary)] pb-5">
          <p className="font-mono text-xs uppercase tracking-widest text-[var(--foreground-muted)] mb-2" data-manifest-figure>
            Onboarding · Step 4 of 5
          </p>
          <h1 className="font-display text-2xl font-semibold text-[var(--foreground)]">
            Readiness check
          </h1>
          <p className="mt-1 text-[var(--foreground-secondary)]">
            Here&apos;s where things stand before you can run a test transaction.
          </p>
        </div>

        {loading && summary === null ? (
          <Skeleton className="h-32 w-full" />
        ) : error && summary === null ? (
          <Card>
            <CardContent className="p-6 text-sm text-[var(--brand-red)]">{error}</CardContent>
          </Card>
        ) : summary !== null ? (
          <>
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Status</CardTitle>
                  <Badge variant={summary.isReady ? "success" : "warning"}>
                    {summary.isReady ? "Ready" : "Not ready yet"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {summary.checks.map((check) => (
                  <div key={check.checkKind} className="flex items-center gap-3">
                    {readinessCheckPassed(check.status) ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
                    ) : (
                      <XCircle className="h-4 w-4 shrink-0 text-red-500" />
                    )}
                    <span className="text-sm text-[var(--foreground)]">
                      {readinessCheckLabel(check.checkKind)}
                    </span>
                  </div>
                ))}

                {catalogBlocking && (
                  <p className="text-sm text-[var(--foreground-secondary)]">
                    Your catalog isn&apos;t confirmed yet.{" "}
                    <Link
                      href="/invite/catalog-review"
                      className="text-[var(--brand-red)] underline"
                    >
                      Review your catalog
                    </Link>
                    .
                  </p>
                )}
              </CardContent>
            </Card>

            {error && <p className="text-sm text-[var(--brand-red)]">{error}</p>}

            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => merchantId !== undefined && void runCheck(merchantId)}
                disabled={loading}
              >
                <RefreshCw className="mr-2 h-3.5 w-3.5" />
                {loading ? "Checking…" : "Check again"}
              </Button>
              {summary.isReady && (
                <Button onClick={() => router.push("/invite/manifest")}>
                  Continue
                  <ArrowRight className="ml-2 h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </>
        ) : null}
      </div>
    </PageWrapper>
  );
}
