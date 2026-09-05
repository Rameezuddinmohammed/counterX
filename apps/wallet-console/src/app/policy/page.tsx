"use client";

/**
 * Real policy view: in this product, spending policy IS the mandate — a
 * signed ceiling, merchant allowlist, and expiry (see TRUST-PROTOCOL.md /
 * HANDOFF.md: "a mandate is rail-agnostic... binds a ceiling, a merchant
 * allowlist, categories, currencies, an expiry... it never binds a payment
 * mechanism"). There is no separate "policy engine" surface for a buyer
 * beyond their own mandates, so this page reuses the same real
 * GET /api/mandates the /mandates page already calls, rather than showing
 * generic invented rules ("Geofencing restriction", "New device cooling
 * period") that were never real settings anywhere in this product.
 */

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, Badge, Skeleton, ErrorState } from "@counter/ui";
import { Shield, CheckCircle2 } from "lucide-react";
import { PageWrapper } from "@/components/page-wrapper";

interface WireMandate {
  mandateId: string;
  agentId: string;
  validUntil: string;
  status: string;
  constraints: {
    merchantAllowlist: { allowedMerchantIds: string[]; allowedDomains: string[] };
    amountLimits: { perTransactionMaxPaise: string };
  };
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; mandates: WireMandate[] };

function formatCeiling(perTransactionMaxPaise: string): string {
  const paise = Number(perTransactionMaxPaise);
  if (!Number.isFinite(paise)) return "—";
  return `₹${(paise / 100).toLocaleString("en-IN")} per transaction`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-IN");
}

export default function PolicyPage() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/mandates");
        const body = (await response.json().catch(() => undefined)) as
          | { mandates?: WireMandate[]; error?: { message?: string } }
          | undefined;
        if (cancelled) return;
        if (!response.ok) {
          setState({
            status: "error",
            message: body?.error?.message ?? `Could not load policy (${response.status}).`,
          });
          return;
        }
        setState({ status: "loaded", mandates: body?.mandates ?? [] });
      } catch (error) {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Could not load policy.",
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
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Policy</h1>
          <p className="mt-1 text-[var(--foreground-secondary)]">
            Your spending policy is your mandates — a signed ceiling, merchant allowlist, and expiry
            per agent. Manage them from{" "}
            <a href="/mandates" className="underline">
              Mandates
            </a>
            .
          </p>
        </div>

        {state.status === "loading" ? (
          <Skeleton className="h-32 w-full" />
        ) : state.status === "error" ? (
          <ErrorState message={state.message} />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Active Mandates</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {state.mandates.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Shield className="h-8 w-8 text-[var(--foreground-muted)] mb-3" />
                  <p className="text-sm text-[var(--foreground-muted)]">
                    No mandates yet — nothing is authorized to spend from this wallet.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-[var(--border)]">
                  {state.mandates.map((m) => (
                    <div
                      key={m.mandateId}
                      className="px-5 py-4 hover:bg-[var(--surface-secondary)] transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-[var(--foreground)]">
                              {formatCeiling(m.constraints.amountLimits.perTransactionMaxPaise)}
                            </p>
                            <Badge
                              variant={m.status === "active" ? "success" : "secondary"}
                              className="text-[10px]"
                            >
                              {m.status}
                            </Badge>
                          </div>
                          <p className="mt-1 text-xs text-[var(--foreground-muted)]">
                            Agent {m.agentId} · expires {formatDate(m.validUntil)}
                          </p>
                          {m.constraints.merchantAllowlist.allowedMerchantIds.length > 0 && (
                            <p className="mt-1 text-[10px] text-[var(--foreground-muted)] uppercase tracking-wide">
                              {m.constraints.merchantAllowlist.allowedMerchantIds.length} merchant
                              {m.constraints.merchantAllowlist.allowedMerchantIds.length === 1
                                ? ""
                                : "s"}{" "}
                              allowed
                            </p>
                          )}
                        </div>
                        <CheckCircle2 className="h-4 w-4 text-[var(--foreground-muted)]" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </PageWrapper>
  );
}
