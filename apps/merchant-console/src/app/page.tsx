"use client";

import { StatCard, Card, CardContent, Badge } from "@counter/ui";
import {
  Receipt,
  Shield,
  Search,
  ShoppingBag,
  CreditCard,
  FileText,
  IndianRupee,
} from "lucide-react";
import Link from "next/link";
import { PageWrapper } from "@/components/page-wrapper";
import { useApi, useCurrentMerchantId } from "@/hooks/use-api";
import type { PolicyConfigView, SettlementSummary, Transaction } from "@/lib/types";

// control-plane-api's transaction list endpoint has no separate "total count"
// field — it returns a page of transactions (default limit 50, hard max 200;
// see apps/control-plane-api/src/transaction-routes.ts's MAX_LIMIT). We fetch
// the max page size for the dashboard so the count is as complete as a single
// request can make it, and label it "200+" rather than claim exactness when
// there could be more.
const TRANSACTIONS_FETCH_LIMIT = 200;

const QUICK_ACTIONS = [
  {
    label: "Connect Shopify",
    href: "/shopify",
    icon: ShoppingBag,
    description: "Set up your store integration",
  },
  {
    label: "Configure Razorpay",
    href: "/razorpay",
    icon: CreditCard,
    description: "Payment processing setup",
  },
  {
    label: "Configure Policy",
    href: "/policy",
    icon: Shield,
    description: "What your agent can sell",
  },
  {
    label: "View Manifest",
    href: "/manifest",
    icon: FileText,
    description: "Activation capabilities",
  },
];

function formatCappedCount(count: number, cap: number): string {
  return count >= cap ? `${count}+` : count.toLocaleString();
}

/**
 * Formats integer INR paise for display.
 *
 * Parses with BigInt, not Number: the server sends minor units as a string
 * precisely so a money total never round-trips through a float, and undoing that
 * here with Number() would reintroduce the drift the API was shaped to avoid.
 */
function formatInrFromMinor(minor: string): string {
  let value: bigint;
  try {
    value = BigInt(minor);
  } catch {
    return "—";
  }
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const rupees = abs / 100n;
  const paise = abs % 100n;
  return `${negative ? "-" : ""}₹${rupees.toLocaleString("en-IN")}.${paise.toString().padStart(2, "0")}`;
}

export default function DashboardPage() {
  const { merchantId, loading: merchantLoading, error: merchantError } = useCurrentMerchantId();

  const transactionsState = useApi<readonly Transaction[]>(
    (client) =>
      merchantId
        ? client.listTransactions(merchantId, { limit: TRANSACTIONS_FETCH_LIMIT })
        : Promise.resolve({ ok: true, data: [] as readonly Transaction[] }),
    [merchantId],
  );
  const policyState = useApi<PolicyConfigView | null>(
    (client) =>
      merchantId
        ? client.getPolicyConfig(merchantId)
        : Promise.resolve({ ok: true, data: null as PolicyConfigView | null }),
    [merchantId],
  );
  const settlementState = useApi<SettlementSummary | null>(
    (client) =>
      merchantId
        ? client.getSettlementSummary(merchantId)
        : Promise.resolve({ ok: true, data: null as SettlementSummary | null }),
    [merchantId],
  );

  const transactions = transactionsState.data ?? [];
  const policyRuleCount = policyState.data?.policy.rules.length ?? 0;

  const transactionsLoading = merchantLoading || transactionsState.loading;
  const transactionsError = merchantError ?? transactionsState.error;
  const policyLoading = merchantLoading || policyState.loading;
  const policyError = merchantError ?? policyState.error;
  const settlementLoading = merchantLoading || settlementState.loading;
  const settlementError = merchantError ?? settlementState.error;
  const settlement = settlementState.data;

  const transactionsValue = transactionsLoading
    ? "…"
    : transactionsError
      ? "—"
      : formatCappedCount(transactions.length, TRANSACTIONS_FETCH_LIMIT);
  const settlementValue = settlementLoading
    ? "…"
    : settlementError || settlement === null
      ? "—"
      : formatInrFromMinor(settlement.pendingMinor);
  // Never present a capped scan as an exact figure — see SettlementSummary.truncated.
  const settlementDescription = settlementError
    ? "Could not load"
    : settlement === null
      ? undefined
      : settlement.truncated
        ? `At least ${settlement.orderCount.toLocaleString()} orders — total is a floor`
        : `From ${settlement.orderCount.toLocaleString()} ${settlement.orderCount === 1 ? "order" : "orders"}`;
  const activePoliciesValue = policyLoading
    ? "…"
    : policyError
      ? "—"
      : policyRuleCount.toLocaleString();
  const activePoliciesDescription = policyError
    ? "Could not load"
    : !policyLoading && policyState.data === null
      ? "No policy configured yet"
      : undefined;

  return (
    <PageWrapper>
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Welcome back</h1>
          <p className="mt-1 text-[var(--foreground-secondary)]">
            Here is an overview of your merchant account.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={<Receipt className="h-4 w-4" />}
            label="Total Transactions"
            value={transactionsValue}
            {...(transactionsError ? { description: transactionsError } : {})}
          />
          <StatCard
            icon={<IndianRupee className="h-4 w-4" />}
            label="Pending Settlement"
            value={settlementValue}
            {...(settlementDescription ? { description: settlementDescription } : {})}
          />
          <StatCard
            icon={<Shield className="h-4 w-4" />}
            label="Active Policies"
            value={activePoliciesValue}
            {...(activePoliciesDescription ? { description: activePoliciesDescription } : {})}
          />
          <StatCard
            icon={<Search className="h-4 w-4" />}
            label="Open Findings"
            value="—"
            description="Not yet available"
          />
        </div>

        {/*
          Deliberately worded as an amount OWED, not a balance the merchant
          holds. Counter collects the buyer's payment into its own Razorpay
          account today (wallet-topup-routes.ts uses the platform credentials),
          so this is accounts payable, not stored value — calling it a "wallet"
          would assert a custody relationship that does not exist and would need
          a regulated partner to be true.
        */}
        <Card>
          <CardContent className="p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold text-[var(--foreground)]">Settlement</h2>
                  <Badge variant="secondary">coming soon</Badge>
                </div>
                <p className="mt-1 max-w-2xl text-sm text-[var(--foreground-secondary)]">
                  {settlementValue === "—"
                    ? "Amounts collected on your behalf will appear here once you have completed orders."
                    : `Counter has collected ${settlementValue} on your behalf from completed agent purchases. Automated payouts to your own Razorpay account are not enabled yet.`}
                </p>
              </div>
              <button
                type="button"
                disabled
                aria-disabled="true"
                title="Automated payouts are not available yet"
                className="shrink-0 cursor-not-allowed rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--foreground-muted)] opacity-60"
              >
                Request payout
              </button>
            </div>
          </CardContent>
        </Card>

        <div>
          <h2 className="mb-4 text-lg font-semibold text-[var(--foreground)]">Quick Actions</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {QUICK_ACTIONS.map((action) => (
              <Link key={action.href} href={action.href} className="no-underline">
                <Card className="h-full transition-all duration-200 hover:border-[var(--brand-orange)]/30 hover:shadow-lg hover:shadow-[var(--brand-orange)]/5 cursor-pointer">
                  <CardContent className="p-5">
                    <div className="flex items-start gap-3">
                      <div className="rounded-lg bg-[var(--brand-orange)]/10 p-2">
                        <action.icon className="h-4 w-4 text-[var(--brand-orange)]" />
                      </div>
                      <div>
                        <p className="font-medium text-[var(--foreground)]">{action.label}</p>
                        <p className="mt-0.5 text-xs text-[var(--foreground-muted)]">
                          {action.description}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>

        <div>
          <h2 className="mb-4 text-lg font-semibold text-[var(--foreground)]">Recent Activity</h2>
          <Card>
            <CardContent className="p-0">
              <div className="divide-y divide-[var(--border)]">
                {[
                  {
                    action: "Transaction settled",
                    detail: "INR 1,500 via UPI",
                    time: "2 min ago",
                    badge: "settled",
                  },
                  {
                    action: "Policy simulation passed",
                    detail: "All rules satisfied",
                    time: "15 min ago",
                    badge: "passed",
                  },
                  {
                    action: "Shopify sync completed",
                    detail: "42 products synced",
                    time: "1 hour ago",
                    badge: "synced",
                  },
                  {
                    action: "Readiness check passed",
                    detail: "All blocking checks cleared",
                    time: "3 hours ago",
                    badge: "ready",
                  },
                ].map((item, i) => (
                  <div key={i} className="flex items-center justify-between px-5 py-3.5">
                    <div>
                      <p className="text-sm font-medium text-[var(--foreground)]">{item.action}</p>
                      <p className="text-xs text-[var(--foreground-muted)]">{item.detail}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant="secondary">{item.badge}</Badge>
                      <span className="text-xs text-[var(--foreground-muted)]">{item.time}</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </PageWrapper>
  );
}
