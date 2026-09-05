"use client";

/**
 * Onboarding wizard Step 1: business basics (legal entity name, contact
 * info, and the goods-type multi-select). Submits PATCH
 * /control/v1/merchant-applications/:merchantId/business-basics, which
 * transitions the application DRAFT -> CONNECTING through the real
 * lifecycle state machine (packages/merchant-application/src/lifecycle.ts).
 *
 * This route requires a REAL merchant-scoped, step-up-assured session token
 * — unlike Step 0's provision route, it is not self-authorizing. The Auth0
 * Post-Login Action that stamps merchant_user claims IS live (verified
 * against the real tenant, 2026-09-05), so a normal login reaches here with
 * working claims; a 401/403 now means a genuinely unauthorized session
 * (typically one that predates the account's setup), which is what
 * PERMISSIONS_NOT_READY_MESSAGE below tells the merchant to resolve by
 * signing in again.
 */

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, Button, Input } from "@counter/ui";
import { PageWrapper } from "@/components/page-wrapper";
import { ensureStepUp, getApiClient, useWizardMerchantId } from "@/hooks/use-api";
import { FULFILLMENT_CAPABILITY_OPTIONS } from "@/lib/onboarding-labels";
import type { FulfillmentCapability } from "@/lib/types";

const PERMISSIONS_NOT_READY_MESSAGE =
  "Your session isn't authorized for this merchant account. Sign out and sign back in — " +
  "merchant permissions are attached at login, so a session that started before your account " +
  "was set up won't have them until you log in again.";

export default function BusinessBasicsPage() {
  const router = useRouter();
  const { merchantId, loading: merchantLoading } = useWizardMerchantId();
  const [legalEntityName, setLegalEntityName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [goodsTypes, setGoodsTypes] = useState<Set<FulfillmentCapability>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  function toggleGoodsType(value: FulfillmentCapability) {
    setGoodsTypes((current) => {
      const next = new Set(current);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return next;
    });
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (merchantId === undefined) {
      setError("No application found yet — start from the previous step.");
      return;
    }
    if (legalEntityName.trim().length === 0) {
      setError("Legal entity name is required.");
      return;
    }
    if (contactEmail.trim().length === 0) {
      setError("Contact email is required.");
      return;
    }
    if (goodsTypes.size === 0) {
      setError("Select at least one way you fulfill orders.");
      return;
    }

    // Raise the session's assurance before the write. Every save here is a
    // tenant mutation, which the API gates behind a second factor; without
    // this a normal login is refused with no way forward. Must precede any
    // other await so the popup stays attributable to the user's click.
    try {
      await ensureStepUp();
    } catch {
      setError("Verification was not completed, so nothing was saved. Please try again.");

      return;
    }
    setSubmitting(true);
    const result = await getApiClient().updateBusinessBasics(merchantId, {
      legalEntityName: legalEntityName.trim(),
      contactEmail: contactEmail.trim(),
      ...(contactPhone.trim().length > 0 ? { contactPhone: contactPhone.trim() } : {}),
      goodsTypes: [...goodsTypes],
    });
    setSubmitting(false);

    if (!result.ok) {
      setError(
        result.error.code === "UNAUTHORIZED" || result.error.code === "FORBIDDEN"
          ? PERMISSIONS_NOT_READY_MESSAGE
          : result.error.message,
      );
      return;
    }
    router.push("/invite/catalog-connect");
  }

  return (
    <PageWrapper>
      <div className="space-y-6">
        <div className="border-b border-[var(--border-secondary)] pb-5">
          <p
            className="font-mono text-xs uppercase tracking-widest text-[var(--foreground-muted)] mb-2"
            data-manifest-figure
          >
            Onboarding · Step 1 of 5
          </p>
          <h1 className="font-display text-2xl font-semibold text-[var(--foreground)]">
            Business basics
          </h1>
          <p className="mt-1 text-[var(--foreground-secondary)]">
            Tell us about your business and how you fulfill orders.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>About your business</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-5" onSubmit={(event) => void handleSubmit(event)}>
              <div className="space-y-1.5">
                <label
                  className="text-sm font-medium text-[var(--foreground)]"
                  htmlFor="legalEntityName"
                >
                  Legal entity name
                </label>
                <Input
                  id="legalEntityName"
                  value={legalEntityName}
                  onChange={(event) => setLegalEntityName(event.target.value)}
                  placeholder="Acme Private Limited"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  className="text-sm font-medium text-[var(--foreground)]"
                  htmlFor="contactEmail"
                >
                  Contact email
                </label>
                <Input
                  id="contactEmail"
                  type="email"
                  value={contactEmail}
                  onChange={(event) => setContactEmail(event.target.value)}
                  placeholder="owner@acme.example"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  className="text-sm font-medium text-[var(--foreground)]"
                  htmlFor="contactPhone"
                >
                  Contact phone (optional)
                </label>
                <Input
                  id="contactPhone"
                  value={contactPhone}
                  onChange={(event) => setContactPhone(event.target.value)}
                  placeholder="+91 98765 43210"
                />
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium text-[var(--foreground)]">
                  How do you fulfill orders? (select all that apply)
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {FULFILLMENT_CAPABILITY_OPTIONS.map((option) => (
                    <label
                      key={option.value}
                      className="flex items-start gap-2 border border-[var(--border)] p-3 text-sm text-[var(--foreground)] hover:border-[var(--brand-red)]/40"
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={goodsTypes.has(option.value)}
                        onChange={() => toggleGoodsType(option.value)}
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {error && <p className="text-sm text-[var(--brand-red)]">{error}</p>}

              <Button type="submit" disabled={submitting}>
                {submitting ? "Saving…" : "Continue"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </PageWrapper>
  );
}
