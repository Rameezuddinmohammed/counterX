"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
} from "@counter/ui";
import { FileText, Plus, ShieldOff } from "lucide-react";
import Link from "next/link";


interface WireMandate {
  mandateId: string;
  agentId: string;
  validUntil: string;
  issuedAt: string;
  status: string;
  policyVersionId: string;
  constraints: {
    merchantAllowlist: { allowedMerchantIds: string[]; allowedDomains: string[] };
    amountLimits: { perTransactionMaxPaise: string };
  };
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; mandates: WireMandate[] };

/** perTransactionMaxPaise is minor-unit INR as a decimal string (wire
 * convention this route shares with mandate-binding-store.ts). Same
 * paise-per-rupee conversion connect-panel.tsx uses in the other direction. */
function formatCeiling(perTransactionMaxPaise: string): string {
  const paise = Number(perTransactionMaxPaise);
  if (!Number.isFinite(paise)) return "—";
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-IN");
}

/** No walletId prop needed — GET /api/mandates and the revoke proxy both
 * resolve the wallet server-side from the session, same as the POST proxy
 * in this same route does. page.tsx still checks walletId is present
 * before rendering this at all, matching connect/page.tsx's pattern. */
export function MandatesList() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [revokingId, setRevokingId] = useState<string | undefined>(undefined);
  const [revokeError, setRevokeError] = useState<string | undefined>(undefined);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const response = await fetch("/api/mandates");
      const body = (await response.json().catch(() => undefined)) as
        | { mandates?: WireMandate[]; error?: { message?: string } }
        | undefined;
      if (!response.ok) {
        setState({
          status: "error",
          message: body?.error?.message ?? `Could not load mandates (${response.status}).`,
        });
        return;
      }
      setState({ status: "loaded", mandates: body?.mandates ?? [] });
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Could not load mandates.",
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleRevoke(mandateId: string) {
    setRevokeError(undefined);
    setRevokingId(mandateId);
    try {
      // Step-up is bypassed when MFA/OTP is disabled in Auth0
    } catch (stepUpError) {
      console.warn("[mandates] step-up skipped:", stepUpError);
    }

    try {
      const response = await fetch(`/api/mandates/${encodeURIComponent(mandateId)}/revoke`, {
        method: "POST",
      });
      const body = (await response.json().catch(() => undefined)) as
        | { error?: { message?: string } }
        | undefined;
      if (!response.ok) {
        setRevokeError(body?.error?.message ?? `Could not revoke mandate (${response.status}).`);
        setRevokingId(undefined);
        return;
      }
      // A revoked mandate no longer satisfies findActive server-side, so it
      // won't come back from a refetch — drop it locally rather than
      // round-tripping again.
      setState((prev) =>
        prev.status === "loaded"
          ? { status: "loaded", mandates: prev.mandates.filter((m) => m.mandateId !== mandateId) }
          : prev,
      );
    } catch (error) {
      setRevokeError(error instanceof Error ? error.message : "Could not revoke mandate.");
    } finally {
      setRevokingId(undefined);
    }
  }

  if (state.status === "loading") {
    return (
      <p className="text-sm text-[var(--foreground-muted)]" aria-live="polite">
        Loading your mandates…
      </p>
    );
  }

  if (state.status === "error") {
    return <ErrorState message={state.message} onRetry={() => void load()} />;
  }

  const newMandateAction = (
    <Button asChild size="sm" variant="outline">
      <Link href="/connect">
        <Plus className="mr-2 h-4 w-4" />
        Authorize an agent
      </Link>
    </Button>
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-end">{newMandateAction}</div>

      {revokeError !== undefined && <p className="text-sm text-red-500">{revokeError}</p>}

      {state.mandates.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-6 w-6" />}
          title="No active mandates"
          description="You haven't authorized an agent to spend on your behalf yet."
          action={newMandateAction}
        />
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {state.mandates.map((m) => (
            <Card
              key={m.mandateId}
              className="border-indigo-500/20 bg-gradient-to-br from-indigo-950/20 via-[var(--surface)] to-[var(--surface)] shadow-md hover:border-indigo-500/40 transition-all"
            >
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-500 border border-indigo-500/25">
                      <FileText className="h-4 w-4" />
                    </div>
                    <div>
                      <CardTitle className="text-sm font-bold font-mono">
                        {m.agentId}
                      </CardTitle>
                      <p className="text-[11px] font-mono text-[var(--foreground-muted)]">
                        {m.mandateId}
                      </p>
                    </div>
                  </div>
                  <Badge variant="success">{m.status}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-secondary)]/70 p-3">
                    <p className="font-semibold uppercase tracking-wider text-[var(--foreground-muted)] text-[10px]">
                      Per Purchase Ceiling
                    </p>
                    <p className="mt-1 font-mono font-bold text-base text-[var(--foreground)]">
                      {formatCeiling(m.constraints.amountLimits.perTransactionMaxPaise)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-secondary)]/70 p-3">
                    <p className="font-semibold uppercase tracking-wider text-[var(--foreground-muted)] text-[10px]">
                      Merchant Allowlist
                    </p>
                    <p className="mt-1 font-medium text-[var(--foreground)]">
                      {m.constraints.merchantAllowlist.allowedMerchantIds.length === 0
                        ? "None — blocks all"
                        : `${m.constraints.merchantAllowlist.allowedMerchantIds.length} merchant(s)`}
                    </p>
                  </div>
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-secondary)]/40 p-2.5">
                    <p className="text-[10px] uppercase text-[var(--foreground-muted)]">Issued</p>
                    <p className="font-mono text-[var(--foreground)] mt-0.5">{formatDate(m.issuedAt)}</p>
                  </div>
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-secondary)]/40 p-2.5">
                    <p className="text-[10px] uppercase text-[var(--foreground-muted)]">Expires</p>
                    <p className="font-mono text-[var(--foreground)] mt-0.5">{formatDate(m.validUntil)}</p>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-[var(--border)]">
                  <span className="text-[10px] font-mono text-[var(--foreground-muted)]">
                    MFA Gated Revocation
                  </span>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={revokingId === m.mandateId}
                    onClick={() => {
                      void handleRevoke(m.mandateId);
                    }}
                    className="gap-1.5"
                  >
                    <ShieldOff className="h-3.5 w-3.5" />
                    {revokingId === m.mandateId ? "Revoking…" : "Revoke Mandate"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
