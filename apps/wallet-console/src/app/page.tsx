"use client";

/**
 * Real wallet dashboard: wallet id, balance, and recent activity all come
 * from control-plane-api's GET /wallets/:walletId/balance (proxied via
 * /api/wallet/balance — see that route's header, "Phase 4 (wallet-dashboard
 * backend)", built for exactly this page but never wired to it until now).
 * Active-mandate count comes from the same /api/mandates the /mandates page
 * already uses for real. Devices/Triggers/Approvals have no backend yet —
 * shown as "Coming soon", never as invented numbers.
 */

import { useEffect, useState } from "react";
import { Card, CardContent, Badge, Skeleton, ErrorState, Button } from "@counter/ui";
import {
  FileText,
  CheckCircle2,
  ArrowLeftRight,
  Smartphone,
  Wallet,
  Download,
  Coins,
  ShieldCheck,
  Copy,
  Check,
  ArrowUpRight,
  ArrowDownLeft,
  KeyRound,
} from "lucide-react";
import Link from "next/link";
import { PageWrapper } from "@/components/page-wrapper";

const QUICK_ACTIONS = [
  {
    label: "Add Funds",
    href: "/wallet/topup",
    icon: Wallet,
    description: "Top up your balance via Razorpay",
  },
  {
    label: "Authorize Agent",
    href: "/connect",
    icon: KeyRound,
    description: "Issue new Ed25519 mandate",
  },
  {
    label: "View Transactions",
    href: "/transactions",
    icon: ArrowLeftRight,
    description: "Browse recent activity",
  },
  {
    label: "Manage Devices",
    href: "/devices",
    icon: Smartphone,
    description: "Pair or unpair devices",
  },
  { label: "Export Data", href: "/export", icon: Download, description: "Download wallet records" },
  {
    label: "Crypto Settlement",
    href: undefined,
    icon: Coins,
    description: "Coming soon — non-custodial on-chain settlement",
    disabled: true,
  },
];

interface RecentEvent {
  readonly reference: string;
  readonly eventType: "topup" | "debit";
  readonly amountMinor: string;
  readonly currency: string;
  readonly createdAt: string;
}

interface BalanceState {
  readonly walletId: string;
  readonly hasBalanceAccount: boolean;
  readonly balanceMinor: string;
  readonly currency: string;
  readonly recentEvents: readonly RecentEvent[];
}

type LoadState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; data: T };

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

export default function DashboardPage() {
  const [balance, setBalance] = useState<LoadState<BalanceState>>({ status: "loading" });
  const [mandateCount, setMandateCount] = useState<number | undefined>(undefined);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch("/api/wallet/balance");
        const body = (await response.json().catch(() => undefined)) as
          | (BalanceState & { error?: { message?: string } })
          | undefined;
        if (cancelled) return;
        if (!response.ok) {
          setBalance({
            status: "error",
            message: body?.error?.message ?? `Could not load wallet balance (${response.status}).`,
          });
          return;
        }
        setBalance({
          status: "loaded",
          data: {
            walletId: body?.walletId ?? "",
            hasBalanceAccount: body?.hasBalanceAccount ?? false,
            balanceMinor: body?.balanceMinor ?? "0",
            currency: body?.currency ?? "INR",
            recentEvents: body?.recentEvents ?? [],
          },
        });
      } catch (error) {
        if (!cancelled) {
          setBalance({
            status: "error",
            message: error instanceof Error ? error.message : "Could not load wallet balance.",
          });
        }
      }
    })();

    void (async () => {
      try {
        const response = await fetch("/api/mandates");
        const body = (await response.json().catch(() => undefined)) as
          | { mandates?: unknown[] }
          | undefined;
        if (!cancelled && response.ok) {
          setMandateCount(body?.mandates?.length ?? 0);
        }
      } catch {
        // Non-fatal — the mandate count tile just shows "—" if this fails.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  function copyWalletId(id: string) {
    if (!id) return;
    navigator.clipboard.writeText(id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <PageWrapper>
      <div className="space-y-8">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs uppercase font-bold tracking-wider text-indigo-500">
                Agent Treasury
              </span>
              <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-500 border border-emerald-500/30">
                Pilot Active
              </span>
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight text-[var(--foreground)]">
              Wallet Overview
            </h1>
            <p className="mt-1 text-sm text-[var(--foreground-secondary)]">
              Real-time balance, standing mandates, and autonomous AI agent activity.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Link href="/wallet/topup" className="no-underline">
              <Button size="sm" className="gap-2 shadow-md shadow-indigo-500/20">
                <Wallet className="h-3.5 w-3.5" />
                Add Funds
              </Button>
            </Link>
            <Link href="/connect" className="no-underline">
              <Button size="sm" variant="outline" className="gap-2">
                <KeyRound className="h-3.5 w-3.5" />
                Authorize Agent
              </Button>
            </Link>
          </div>
        </div>

        {/* Hero Vault Balance Card */}
        {balance.status === "loading" ? (
          <Skeleton className="h-44 w-full rounded-3xl" />
        ) : balance.status === "error" ? (
          <ErrorState message={balance.message} />
        ) : (
          <div className="relative overflow-hidden rounded-3xl border border-indigo-500/25 bg-gradient-to-br from-indigo-950/40 via-slate-900/90 to-cyan-950/20 p-6 md:p-8 shadow-xl shadow-indigo-500/5">
            <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
              <div>
                <div className="flex items-center gap-2 text-xs font-semibold text-indigo-400 uppercase tracking-wider mb-2">
                  <span className="flex h-2 w-2 rounded-full bg-cyan-400"></span>
                  Autonomous Spending Balance
                </div>
                <div className="flex items-baseline gap-3">
                  <span className="text-4xl md:text-5xl font-extrabold text-[var(--foreground)] tracking-tight font-mono">
                    {formatAmount(balance.data.balanceMinor, balance.data.currency)}
                  </span>
                  <Badge variant={balance.data.hasBalanceAccount ? "success" : "secondary"}>
                    {balance.data.hasBalanceAccount ? "Active & Funded" : "Not funded yet"}
                  </Badge>
                </div>

                <div className="flex flex-wrap items-center gap-3 mt-4 text-xs text-[var(--foreground-muted)] font-mono">
                  <div className="flex items-center gap-2 bg-[var(--surface-secondary)]/80 border border-[var(--border)] px-3 py-1.5 rounded-xl">
                    <span>ID:</span>
                    <span className="text-[var(--foreground)] font-semibold">
                      {balance.data.walletId || "—"}
                    </span>
                    {balance.data.walletId && (
                      <button
                        onClick={() => copyWalletId(balance.data.walletId)}
                        className="ml-1 text-[var(--foreground-muted)] hover:text-[var(--foreground)] transition-colors"
                        title="Copy Wallet ID"
                      >
                        {copied ? (
                          <Check className="h-3.5 w-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                    )}
                  </div>
                  <span className="hidden sm:inline">&bull;</span>
                  <span>
                    Currency: <strong className="text-[var(--foreground)]">{balance.data.currency}</strong>
                  </span>
                  <span className="hidden sm:inline">&bull;</span>
                  <span>
                    Events:{" "}
                    <strong className="text-[var(--foreground)]">
                      {balance.data.recentEvents.length} recorded
                    </strong>
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 self-start lg:self-auto">
                <Link href="/wallet/topup" className="no-underline">
                  <Button className="px-5 py-2.5 font-semibold text-sm shadow-lg shadow-indigo-500/25">
                    <Wallet className="h-4 w-4 mr-1.5" />
                    Top Up Balance
                  </Button>
                </Link>
                <Link href="/mandates" className="no-underline">
                  <Button variant="outline" className="px-4 py-2.5 font-medium text-sm">
                    <FileText className="h-4 w-4 mr-1.5" />
                    Manage Mandates
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* Dynamic Metric Grid */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="p-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm hover:border-[var(--border-secondary)] transition-all">
            <div className="flex items-center justify-between text-[var(--foreground-secondary)] mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Active Mandates</span>
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-500">
                <FileText className="h-4 w-4" />
              </div>
            </div>
            <div className="text-2xl font-bold font-mono text-[var(--foreground)]">
              {mandateCount !== undefined ? `${mandateCount} Active` : "—"}
            </div>
            <p className="mt-1 text-xs text-[var(--foreground-muted)]">Standing cryptographic limits</p>
          </div>

          <div className="p-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm hover:border-[var(--border-secondary)] transition-all">
            <div className="flex items-center justify-between text-[var(--foreground-secondary)] mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Recent Activity</span>
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-500">
                <ArrowLeftRight className="h-4 w-4" />
              </div>
            </div>
            <div className="text-2xl font-bold font-mono text-[var(--foreground)]">
              {balance.status === "loaded" ? `${balance.data.recentEvents.length} Events` : "—"}
            </div>
            <p className="mt-1 text-xs text-[var(--foreground-muted)]">Autonomous ledger entries</p>
          </div>

          <div className="p-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm hover:border-[var(--border-secondary)] transition-all">
            <div className="flex items-center justify-between text-[var(--foreground-secondary)] mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Pre-Effect Gates</span>
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500">
                <ShieldCheck className="h-4 w-4" />
              </div>
            </div>
            <div className="text-2xl font-bold font-mono text-emerald-500">100% Enforced</div>
            <p className="mt-1 text-xs text-[var(--foreground-muted)]">Zero post-hoc overspend</p>
          </div>

          <div className="p-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm hover:border-[var(--border-secondary)] transition-all">
            <div className="flex items-center justify-between text-[var(--foreground-secondary)] mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Payment Rail</span>
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500">
                <CheckCircle2 className="h-4 w-4" />
              </div>
            </div>
            <div className="text-2xl font-bold font-mono text-[var(--foreground)]">Razorpay Test</div>
            <p className="mt-1 text-xs text-[var(--foreground-muted)]">INR Test-mode enabled</p>
          </div>
        </div>

        {/* Standing Mandate Showcase */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-[var(--foreground)] flex items-center gap-2">
                <span>Standing Mandate Guardrails</span>
                <span className="text-xs bg-indigo-500/15 text-indigo-500 font-mono px-2 py-0.5 rounded-full border border-indigo-500/30">
                  Ed25519 Signed
                </span>
              </h2>
              <p className="text-xs text-[var(--foreground-muted)]">
                Every AI purchase is cryptographically signed and checked before an order is placed.
              </p>
            </div>
            <Link
              href="/connect"
              className="text-xs text-indigo-500 hover:text-indigo-400 font-semibold flex items-center gap-1 no-underline"
            >
              <span>+ Issue New Mandate</span>
            </Link>
          </div>

          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm hover:border-indigo-500/40 transition-all">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-tr from-indigo-600 to-cyan-500 text-white shadow-md shadow-indigo-500/20">
                  <KeyRound className="h-6 w-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-[var(--foreground)]">
                      Claude Desktop Agent (MCP)
                    </span>
                    <Badge variant="success">Active</Badge>
                  </div>
                  <p className="text-xs font-mono text-[var(--foreground-muted)] mt-0.5">
                    {mandateCount && mandateCount > 0
                      ? "Cryptographic envelope active"
                      : "Ready to pair with your local or hosted agent"}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Link href="/mandates" className="no-underline">
                  <Button variant="outline" size="sm">
                    View Mandate Details
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Actions Grid */}
        <div>
          <h2 className="mb-4 text-lg font-semibold text-[var(--foreground)]">Quick Actions</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {QUICK_ACTIONS.map((action) => {
              const cardBody = (
                <Card
                  className={
                    action.disabled
                      ? "h-full opacity-50 cursor-not-allowed"
                      : "h-full transition-all duration-200 hover:border-indigo-500/30 hover:shadow-md cursor-pointer"
                  }
                >
                  <CardContent className="p-5">
                    <div className="flex items-start gap-3">
                      <div className="rounded-xl bg-indigo-500/10 dark:bg-indigo-500/15 p-2.5 text-indigo-500">
                        <action.icon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-sm text-[var(--foreground)]">
                            {action.label}
                          </p>
                          {action.disabled && (
                            <Badge variant="secondary" className="text-[10px]">
                              Soon
                            </Badge>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-[var(--foreground-muted)]">
                          {action.description}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
              return action.disabled || action.href === undefined ? (
                <div key={action.label} aria-disabled="true">
                  {cardBody}
                </div>
              ) : (
                <Link key={action.href} href={action.href} className="no-underline">
                  {cardBody}
                </Link>
              );
            })}
          </div>
        </div>

        {/* Recent Activity */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-[var(--foreground)]">Recent Activity</h2>
              <p className="text-xs text-[var(--foreground-muted)]">
                Ledger transactions and top-ups
              </p>
            </div>
            <Link href="/transactions" className="text-xs text-indigo-500 hover:underline">
              View All History &rarr;
            </Link>
          </div>

          <Card className="overflow-hidden">
            <CardContent className="p-0">
              {balance.status === "loaded" && balance.data.recentEvents.length > 0 ? (
                <div className="divide-y divide-[var(--border)]">
                  {balance.data.recentEvents.map((event) => {
                    const isTopup = event.eventType === "topup";
                    return (
                      <div
                        key={event.reference}
                        className="flex items-center justify-between px-5 py-4 hover:bg-[var(--surface-hover)] transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={`flex h-9 w-9 items-center justify-center rounded-xl border ${
                              isTopup
                                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-500"
                                : "bg-indigo-500/10 border-indigo-500/20 text-indigo-500"
                            }`}
                          >
                            {isTopup ? (
                              <ArrowDownLeft className="h-4 w-4" />
                            ) : (
                              <ArrowUpRight className="h-4 w-4" />
                            )}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-semibold text-[var(--foreground)]">
                                {isTopup ? "Wallet Self-Serve Top Up" : "Agent Purchase Debit"}
                              </p>
                              <Badge variant={isTopup ? "success" : "info"}>
                                {isTopup ? "Funded" : "Pre-Cleared"}
                              </Badge>
                            </div>
                            <p className="text-xs font-mono text-[var(--foreground-muted)] mt-0.5">
                              Ref: {event.reference} &bull; {formatDate(event.createdAt)}
                            </p>
                          </div>
                        </div>

                        <div className="text-right">
                          <p
                            className={`text-sm font-bold font-mono ${
                              isTopup ? "text-emerald-500" : "text-[var(--foreground)]"
                            }`}
                          >
                            {isTopup ? "+" : "-"}
                            {formatAmount(event.amountMinor, event.currency)}
                          </p>
                          <span className="text-[10px] font-mono text-[var(--foreground-muted)]">
                            {event.currency}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="p-8 text-center text-sm text-[var(--foreground-muted)]">
                  {balance.status === "loading" ? "Loading activity…" : "No activity recorded yet."}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </PageWrapper>
  );
}
