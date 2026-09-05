"use client";

/**
 * Own-gateway Razorpay connect (a merchant configuring their own payment
 * account to accept charges) is explicitly out of scope for now — the only
 * real Razorpay usage in this product today is a BUYER topping up their own
 * wallet balance in test mode (apps/wallet-console), unrelated to this page.
 * Settlement figures for a merchant live on the main dashboard
 * (apps/merchant-console/src/app/page.tsx), which already pulls real data.
 *
 * This page is a deliberate placeholder, not a stub pretending to be real —
 * no fake "Connected" status, no fake account id.
 */

import { Card, CardContent, Badge } from "@counter/ui";
import { CreditCard } from "lucide-react";
import { PageWrapper } from "@/components/page-wrapper";

export default function RazorpayPage() {
  return (
    <PageWrapper>
      <div className="space-y-6 opacity-60">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Payment configuration</h1>
          <p className="mt-1 text-[var(--foreground-secondary)]">
            Connecting your own payment gateway.
          </p>
        </div>
        <Card>
          <CardContent className="flex items-center gap-4 p-6">
            <div className="rounded-lg bg-[var(--foreground-muted)]/10 p-3">
              <CreditCard className="h-6 w-6 text-[var(--foreground-muted)]" />
            </div>
            <div>
              <p className="font-semibold text-[var(--foreground)]">Payment configuration</p>
              <Badge variant="secondary" className="mt-1">
                Coming soon
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>
    </PageWrapper>
  );
}
