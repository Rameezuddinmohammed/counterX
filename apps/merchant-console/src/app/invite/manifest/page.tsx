"use client";

/**
 * Onboarding wizard Step 6: manifest confirmation — the last step this
 * wizard builds. Once SANDBOX_READY, generates and persists the merchant's
 * CapabilityManifest (the record of exactly what this merchant is set up to
 * do), then shows it back in plain language.
 *
 * This is a NEW page for the self-serve wizard, distinct from
 * apps/merchant-console/src/app/manifest/page.tsx (the OLD operator-facing
 * demo view) — different concern, not touched here.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, Button, Badge, Skeleton } from "@counter/ui";
import { FileCheck2, PartyPopper } from "lucide-react";
import { PageWrapper } from "@/components/page-wrapper";
import { getApiClient, useWizardMerchantId } from "@/hooks/use-api";
import { pilotCapabilityLabel, fulfillmentCapabilityLabel } from "@/lib/onboarding-labels";
import type { WizardManifest } from "@/lib/types";

const PERMISSIONS_NOT_READY_MESSAGE =
  "Your session isn't authorized for this merchant account. Sign out and sign back in — " +
  "merchant permissions are attached at login, so a session that started before your account " +
  "was set up won't have them until you log in again.";

export default function ManifestPage() {
  const { merchantId, loading: merchantLoading } = useWizardMerchantId();
  const [manifest, setManifest] = useState<WizardManifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (merchantId !== undefined) {
      void loadManifest(merchantId);
    } else if (!merchantLoading) {
      setLoading(false);
    }
  }, [merchantId, merchantLoading]);

  async function loadManifest(id: string) {
    setLoading(true);
    const result = await getApiClient().getWizardManifest(id);
    setLoading(false);
    if (result.ok) {
      setManifest(result.data);
    }
    // A 404 here just means no manifest yet — not an error state, the
    // "Confirm your capabilities" button below is the expected next action.
  }

  async function handleGenerate() {
    if (merchantId === undefined) return;
    setGenerating(true);
    setError(null);
    const result = await getApiClient().confirmWizardManifest(merchantId);
    setGenerating(false);

    if (!result.ok) {
      setError(
        result.error.code === "UNAUTHORIZED" || result.error.code === "FORBIDDEN"
          ? PERMISSIONS_NOT_READY_MESSAGE
          : result.error.message,
      );
      return;
    }
    setManifest(result.data);
  }

  if (!merchantLoading && merchantId === undefined) {
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

  return (
    <PageWrapper>
      <div className="space-y-6">
        <div className="border-b border-[var(--border-secondary)] pb-5">
          <p
            className="font-mono text-xs uppercase tracking-widest text-[var(--foreground-muted)] mb-2"
            data-manifest-figure
          >
            Onboarding · Step 5 of 5
          </p>
          <h1 className="font-display text-2xl font-semibold text-[var(--foreground)]">
            Confirm what you can do
          </h1>
          <p className="mt-1 text-[var(--foreground-secondary)]">
            This is the record of exactly what your store is set up to handle.
          </p>
        </div>

        {loading ? (
          <Skeleton className="h-40 w-full" />
        ) : manifest !== null ? (
          <>
            <Card>
              <CardContent className="flex items-center gap-4 p-6">
                <div className="border border-[var(--clearance-teal)]/30 bg-[var(--clearance-teal)]/10 p-3">
                  <PartyPopper className="h-6 w-6 text-[var(--clearance-teal)]" />
                </div>
                <div>
                  <p className="font-semibold text-[var(--foreground)]">You&apos;re set up</p>
                  <p className="text-sm text-[var(--foreground-muted)]">
                    Confirmed {new Date(manifest.generatedAt).toLocaleString("en-IN")}
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>What you can do</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {manifest.capabilities.map((capability) => (
                  <Badge key={capability} variant="secondary">
                    {pilotCapabilityLabel(capability)}
                  </Badge>
                ))}
              </CardContent>
            </Card>

            {manifest.fulfillmentCapabilities.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>How you fulfill orders</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  {manifest.fulfillmentCapabilities.map((capability) => (
                    <Badge key={capability} variant="secondary">
                      {fulfillmentCapabilityLabel(capability)}
                    </Badge>
                  ))}
                </CardContent>
              </Card>
            )}

            <p className="text-xs text-[var(--foreground-muted)]">
              Counter will review your account next before you can accept real, live purchases —
              you&apos;ll hear from us.
            </p>
          </>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>
                <div className="flex items-center gap-2">
                  <FileCheck2 className="h-4 w-4 text-[var(--brand-red)]" />
                  Ready to confirm
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-[var(--foreground-secondary)]">
                You&apos;ve passed the readiness check. Confirm to generate your capability record.
              </p>
              {error && <p className="text-sm text-[var(--brand-red)]">{error}</p>}
              <Button onClick={() => void handleGenerate()} disabled={generating}>
                {generating ? "Confirming…" : "Confirm your capabilities"}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </PageWrapper>
  );
}
