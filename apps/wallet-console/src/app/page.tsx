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
import { StatCard, Card, CardContent, Badge, Skeleton, ErrorState } from "@counter/ui";
import {
  FileText,
  CheckCircle2,
  ArrowLeftRight,
  Smartphone,
  Zap,
  Wallet,
  Download,
  Coins,
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

  return (
    <PageWrapper>
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Wallet Overview</h1>
          <p className="mt-1 text-[var(--foreground-secondary)]">
            Monitor your wallet status, recent activity, and pending actions.
          </p>
        </div>

        {balance.status === "loading" ? (
          <Skeleton className="h-24 w-full" />
        ) : balance.status === "error" ? (
          <ErrorState message={balance.message} />
        ) : (
          <Card className="border-[var(--brand-orange)]/20 bg-gradient-to-r from-[var(--brand-orange)]/5 to-transparent">
            <CardContent className="p-5">
              <div className="flex items-center gap-4">
                <div className="rounded-xl bg-[var(--brand-orange)]/10 p-3">
                  <Wallet className="h-6 w-6 text-[var(--brand-orange)]" />
                </div>
                <div className="flex-1">
                  <p className="text-sm text-[var(--foreground-secondary)]">Wallet ID</p>
                  <p className="text-lg font-mono font-semibold text-[var(--foreground)]">
                    {balance.data.walletId}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-[var(--foreground-secondary)]">Balance</p>
                  <p className="text-lg font-semibold text-[var(--foreground)]">
                    {formatAmount(balance.data.balanceMinor, balance.data.currency)}
                  </p>
                </div>
                <Badge variant={balance.data.hasBalanceAccount ? "success" : "secondary"}>
                  {balance.data.hasBalanceAccount ? "Active" : "Not funded yet"}
                </Badge>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard
            icon={<FileText className="h-4 w-4" />}
            label="Active Mandates"
            value={mandateCount !== undefined ? String(mandateCount) : "—"}
            description="Standing authorizations"
          />
          <StatCard
            icon={<ArrowLeftRight className="h-4 w-4" />}
            label="Recent Activity"
            value={
              balance.status === "loaded" ? String(balance.data.recentEvents.length) : "—"
            }
            description="Balance events"
          />
          <StatCard
            icon={<CheckCircle2 className="h-4 w-4" />}
            label="Pending Approvals"
            value="—"
            description="Coming soon"
          />
          <StatCard
            icon={<Smartphone className="h-4 w-4" />}
            label="Paired Devices"
            value="—"
            description="Coming soon"
          />
          <StatCard
            icon={<Zap className="h-4 w-4" />}
            label="Active Triggers"
            value="—"
            description="Coming soon"
          />
        </div>

        <div>
          <h2 className="mb-4 text-lg font-semibold text-[var(--foreground)]">Quick Actions</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {QUICK_ACTIONS.map((action) => {
              const cardBody = (
                <Card
                  className={
                    action.disabled
                      ? "h-full opacity-50"
                      : "h-full transition-all duration-200 hover:border-[var(--brand-orange)]/30 hover:shadow-lg hover:shadow-[var(--brand-orange)]/5 cursor-pointer"
                  }
                >
                  <CardContent className="p-5">
                    <div className="flex items-start gap-3">
                      <div className="rounded-lg bg-[var(--brand-orange)]/10 p-2">
                        <action.icon className="h-4 w-4 text-[var(--brand-orange)]" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-[var(--foreground)]">{action.label}</p>
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

        <div>
          <h2 className="mb-4 text-lg font-semibold text-[var(--foreground)]">Recent Activity</h2>
          <Card>
            <CardContent className="p-0">
              {balance.status === "loaded" && balance.data.recentEvents.length > 0 ? (
                <div className="divide-y divide-[var(--border)]">
                  {balance.data.recentEvents.map((event) => (
                    <div
                      key={event.reference}
                      className="flex items-center justify-between px-5 py-3.5"
                    >
                      <div>
                        <p className="text-sm font-medium text-[var(--foreground)]">
                          {event.eventType === "topup" ? "Wallet top-up" : "Purchase debit"}
                        </p>
                        <p className="text-xs text-[var(--foreground-muted)]">
                          {formatAmount(event.amountMinor, event.currency)}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge variant="secondary">{event.eventType}</Badge>
                        <span className="text-xs text-[var(--foreground-muted)]">
                          {formatDate(event.createdAt)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="p-5 text-sm text-[var(--foreground-muted)]">
                  {balance.status === "loading" ? "Loading…" : "No activity yet."}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </PageWrapper>
  );
}
