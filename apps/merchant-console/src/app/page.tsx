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
        <div className="border-b border-[var(--border-secondary)] pb-5">
          <p
            className="font-mono text-xs uppercase tracking-widest text-[var(--foreground-muted)] mb-2"
            data-manifest-figure
          >
            Merchant console
          </p>
          <h1 className="font-display text-2xl font-semibold text-[var(--foreground)]">
            Welcome back
          </h1>
          <p className="mt-1 text-[var(--foreground-secondary)]">
            Here is an overview of your store's agent-facing account.
          </p>
        </div>

        {applicationState.data && applicationState.data.lifecycleState !== "ACTIVE" && (
          <div className="border border-[var(--brand-red)]/30 bg-[var(--brand-red)]/5 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="border border-[var(--brand-red)]/40 p-2 text-[var(--brand-red)] bg-[var(--surface)]">
                <UserPlus className="h-5 w-5" />
              </div>
              <div>
                <p className="font-semibold text-sm text-[var(--foreground)]">
                  Complete store onboarding
                </p>
                <p className="text-xs text-[var(--foreground-muted)]">
                  Finish setting up your catalog and capabilities to start accepting AI-agent
                  purchases.
                </p>
              </div>
            </div>
            <Link href="/invite" className="no-underline shrink-0">
              <Button size="sm">
                Continue Setup
                <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            icon={<Receipt className="h-4 w-4" />}
            label="Total transactions"
            value={transactionsValue}
            {...(transactionsError ? { description: transactionsError } : {})}
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
            {...(activePoliciesDescription ? { description: activePoliciesDescription } : {})}
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
                  <Badge variant="warning">payout coming soon</Badge>
                </div>
                <p className="mt-1 max-w-2xl text-sm text-[var(--foreground-secondary)]">
                  {settlementValue === "—"
                    ? "Amounts collected on your behalf will appear here once you have completed orders."
                    : `Counter has collected ${settlementValue} on your behalf from completed agent purchases. Automated payouts to your own account are not enabled yet — this is what you're owed, not a stored balance.`}
                </p>
              </div>
              <button
                type="button"
                disabled
                aria-disabled="true"
                title="Automated payouts are not available yet"
                className="shrink-0 cursor-not-allowed border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--foreground-muted)] opacity-60"
              >
                Request payout
              </button>
            </div>
          </CardContent>
        </Card>

        <div>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-[var(--foreground-secondary)]">
            Quick actions
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {QUICK_ACTIONS.map((action) => (
              <Link key={action.href} href={action.href} className="no-underline">
                <Card className="h-full cursor-pointer hover:border-[var(--brand-red)]/40">
                  <CardContent className="p-5">
                    <div className="flex items-start gap-3">
                      <div className="border border-[var(--border)] p-2 text-[var(--brand-red)]">
                        <action.icon className="h-4 w-4" />
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
      </div>
    </PageWrapper>
  );
}
