"use client";

import { StatCard, Card, CardContent, Badge, Button } from "@counter/ui";
import {
  Receipt,
  ShieldCheck,
  ShoppingBag,
  Landmark,
  IndianRupee,
  UserPlus,
  ArrowRight,
} from "lucide-react";
import Link from "next/link";
import { PageWrapper } from "@/components/page-wrapper";
import { useApi, useCurrentMerchantId } from "@/hooks/use-api";
import type {
  MerchantApplicationStatus,
  PolicyConfigView,
  SettlementSummary,
  Transaction,
} from "@/lib/types";

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
    label: "Settlement account",
    href: "/razorpay",
    icon: Landmark,
    description: "Connect where you get paid",
  },
  {
    label: "Selling policy",
    href: "/policy",
    icon: ShieldCheck,
    description: "What your agent can sell",
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
  const applicationState = useApi<MerchantApplicationStatus | null>(
    (client) =>
      merchantId
        ? client.getMerchantApplication(merchantId)
        : Promise.resolve({ ok: true, data: null as MerchantApplicationStatus | null }),
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
        {/* Command Center Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs uppercase font-bold tracking-wider text-cyan-600 dark:text-cyan-400">
                Merchant Gateway
              </span>
              <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Store Live
              </span>
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight text-[var(--foreground)]">
              Store Command Center
            </h1>
            <p className="mt-1 text-sm text-[var(--foreground-secondary)]">
              Real-time monitoring of autonomous AI agent orders and store guardrails.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Link href="/policy" className="no-underline">
              <Button size="sm" variant="outline" className="gap-2">
                <ShieldCheck className="h-3.5 w-3.5" />
                Selling Policy
              </Button>
            </Link>
            <Link href="/shopify" className="no-underline">
              <Button size="sm" className="gap-2 shadow-md shadow-indigo-500/20">
                <ShoppingBag className="h-3.5 w-3.5" />
                Shopify Store
              </Button>
            </Link>
          </div>
        </div>

        {applicationState.data && applicationState.data.lifecycleState !== "ACTIVE" && (
          <div className="rounded-2xl border border-indigo-500/30 bg-indigo-500/10 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm">
            <div className="flex items-center gap-3.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-500 border border-indigo-500/30">
                <UserPlus className="h-5 w-5" />
              </div>
              <div>
                <p className="font-bold text-sm text-[var(--foreground)]">
                  Complete Store Onboarding
                </p>
                <p className="text-xs text-[var(--foreground-secondary)] mt-0.5">
                  Finish setting up your catalog and capabilities to start accepting AI-agent purchases.
                </p>
              </div>
            </div>
            <Link href="/invite" className="no-underline shrink-0">
              <Button size="sm" className="gap-1.5 shadow-sm">
                Continue Setup
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>
        )}

        {/* Hero Settlement Summary Banner */}
        <div className="relative overflow-hidden rounded-3xl border border-cyan-500/25 bg-gradient-to-br from-cyan-950/30 via-slate-900/90 to-indigo-950/30 p-6 md:p-8 shadow-xl shadow-cyan-500/5">
          <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold text-cyan-400 uppercase tracking-wider mb-2">
                <span className="flex h-2 w-2 rounded-full bg-cyan-400"></span>
                Accounts Payable &bull; Escrowed by Counter
              </div>
              <div className="flex items-baseline gap-3">
                <span className="text-4xl md:text-5xl font-extrabold text-[var(--foreground)] tracking-tight font-mono">
                  {settlementValue}
                </span>
                <Badge variant="warning">Payout Pipeline Active</Badge>
              </div>
              <p className="mt-2.5 max-w-2xl text-xs text-[var(--foreground-secondary)] leading-relaxed">
                {settlementValue === "—"
                  ? "Amounts collected on your behalf will appear here once agents make purchases."
                  : `Counter has collected ${settlementValue} on your behalf from completed agent purchases. Automated payouts to your own settlement account are being prepared — this is accounts payable owed to you.`}
              </p>
            </div>

            <div className="flex items-center gap-3 self-start lg:self-auto">
              <button
                type="button"
                disabled
                aria-disabled="true"
                title="Automated payouts are coming soon"
                className="cursor-not-allowed rounded-xl border border-[var(--border)] bg-[var(--surface)]/60 px-4 py-2.5 text-xs font-semibold text-[var(--foreground-muted)] opacity-70"
              >
                Request Payout (Coming Soon)
              </button>
            </div>
          </div>
        </div>

        {/* Metric Cards Grid */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            icon={<Receipt className="h-4 w-4" />}
            label="Total transactions"
            value={transactionsValue}
            description={transactionsError || "Agent purchases executed"}
          />
          <StatCard
            icon={<IndianRupee className="h-4 w-4" />}
            label="Pending settlement"
            value={settlementValue}
            {...(settlementDescription ? { description: settlementDescription } : {})}
          />
          <StatCard
            icon={<ShieldCheck className="h-4 w-4" />}
            label="Active policy rules"
            value={activePoliciesValue}
            description={activePoliciesDescription || "Pre-order enforcement rules"}
          />
        </div>

        {/* Quick Actions */}
        <div>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-[var(--foreground-secondary)]">
            Store Controls &amp; Integrations
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {QUICK_ACTIONS.map((action) => (
              <Link key={action.href} href={action.href} className="no-underline">
                <Card className="h-full cursor-pointer hover:border-indigo-500/40 hover:shadow-md transition-all">
                  <CardContent className="p-5">
                    <div className="flex items-start gap-3.5">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-500 border border-indigo-500/20">
                        <action.icon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm text-[var(--foreground)]">{action.label}</p>
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
      </div>
    </PageWrapper>
  );
}
