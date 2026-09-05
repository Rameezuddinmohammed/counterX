"use client";

/**
 * Real balance-ledger history: top-ups and debits from control-plane-api's
 * GET /wallets/:walletId/balance (proxied via /api/wallet/balance — same
 * source the dashboard's "Recent Activity" card uses).
 *
 * This is NOT full merchant-purchase transaction history (merchant name,
 * payment method, per-order status) — no backend endpoint for that exists
 * yet (agent-runtime's TransactionReadModel only supports looking up ONE
 * transaction given its merchant id, not listing all of a wallet's
 * transactions across merchants). Showing the real ledger events honestly
 * is the correct scope for this page today, replacing what used to be 8
 * entirely invented rows (fake merchant names, a fake "Mandate" payment
 * method, fake settled/pending/failed statuses).
 */

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, Badge, Skeleton, ErrorState } from "@counter/ui";
import { ArrowLeftRight } from "lucide-react";
import { PageWrapper } from "@/components/page-wrapper";

interface RecentEvent {
  readonly reference: string;
  readonly eventType: "topup" | "debit";
  readonly amountMinor: string;
  readonly currency: string;
  readonly providerPaymentId?: string | null;
  readonly createdAt: string;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; events: readonly RecentEvent[] };

function formatAmount(minor: string, currency: string): string {
  const value = Number(minor);
  if (!Number.isFinite(value)) return "—";
  const symbol = currency === "INR" ? "₹" : `${currency} `;
  return `${symbol}${(value / 100).toLocaleString("en-IN")}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-IN");
}

export default function TransactionsPage() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/wallet/balance");
        const body = (await response.json().catch(() => undefined)) as
          | { recentEvents?: RecentEvent[]; error?: { message?: string } }
          | undefined;
        if (cancelled) return;
        if (!response.ok) {
          setState({
            status: "error",
            message: body?.error?.message ?? `Could not load activity (${response.status}).`,
          });
          return;
        }
        setState({ status: "loaded", events: body?.recentEvents ?? [] });
      } catch (error) {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Could not load activity.",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <PageWrapper>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Transactions</h1>
          <p className="mt-1 text-[var(--foreground-secondary)]">
            Your wallet&apos;s balance activity — top-ups and debits.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ArrowLeftRight className="h-4 w-4" />
              Balance Activity
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {state.status === "loading" ? (
              <div className="p-5">
                <Skeleton className="h-24 w-full" />
              </div>
            ) : state.status === "error" ? (
              <div className="p-5">
                <ErrorState message={state.message} />
              </div>
            ) : state.events.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <ArrowLeftRight className="h-8 w-8 text-[var(--foreground-muted)] mb-3" />
                <p className="text-sm text-[var(--foreground-muted)]">No activity yet.</p>
              </div>
            ) : (
              <div className="divide-y divide-[var(--border)]">
                <div className="grid grid-cols-4 gap-4 px-5 py-3 text-xs font-medium text-[var(--foreground-muted)] uppercase tracking-wider">
                  <span>Type</span>
                  <span>Amount</span>
                  <span>Reference</span>
                  <span>Date</span>
                </div>
                {state.events.map((event) => (
                  <div
                    key={event.reference}
                    className="grid grid-cols-4 gap-4 px-5 py-3.5 items-center hover:bg-[var(--surface-secondary)] transition-colors"
                  >
                    <Badge variant={event.eventType === "topup" ? "success" : "secondary"}>
                      {event.eventType === "topup" ? "Top-up" : "Debit"}
                    </Badge>
                    <span className="text-sm font-mono text-[var(--foreground)]">
                      {formatAmount(event.amountMinor, event.currency)}
                    </span>
                    <span className="text-sm text-[var(--foreground-secondary)] truncate">
                      {event.reference}
                    </span>
                    <span className="text-sm text-[var(--foreground-muted)]">
                      {formatDate(event.createdAt)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </PageWrapper>
  );
}
