"use client";

import { useCallback, useEffect, useState } from "react";
import { mfa } from "@auth0/nextjs-auth0/client";
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

const API_AUDIENCE = "https://api.counter.dev";

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
      // Revoking requires the same step-up bar as issuing a mandate — see
      // wallet-mandate-routes.ts. Trigger it fresh for this action rather
      // than assuming an earlier /connect session is still elevated.
      await mfa.challengeWithPopup({ audience: API_AUDIENCE });
    } catch (stepUpError) {
      const detail = stepUpError instanceof Error ? stepUpError.message : String(stepUpError);
      setRevokeError(`Verification step failed: ${detail}`);
      setRevokingId(undefined);
      return;
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
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {state.mandates.map((m) => (
            <Card
              key={m.mandateId}
              className="transition-all hover:border-[var(--brand-orange)]/20"
            >
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <FileText className="h-4 w-4 text-[var(--brand-orange)]" />
                    <span className="font-mono text-sm">{m.agentId}</span>
                  </CardTitle>
                  <Badge variant="success">{m.status}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-[var(--foreground-muted)]">Max per purchase</p>
                    <p className="font-mono font-medium text-[var(--foreground)]">
                      {formatCeiling(m.constraints.amountLimits.perTransactionMaxPaise)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[var(--foreground-muted)]">Merchant allowlist</p>
                    <p className="text-[var(--foreground)]">
                      {/* Empty is deny-all, not "not configured yet" — see
                          connect-panel.tsx. Saying "None yet" made a mandate
                          that can authorize nothing read as merely
                          unfinished. */}
                      {m.constraints.merchantAllowlist.allowedMerchantIds.length === 0
                        ? "None — blocks all purchases"
                        : `${m.constraints.merchantAllowlist.allowedMerchantIds.length} merchant(s)`}
                    </p>
                  </div>
                  <div>
                    <p className="text-[var(--foreground-muted)]">Issued</p>
                    <p className="text-[var(--foreground)]">{formatDate(m.issuedAt)}</p>
                  </div>
                  <div>
                    <p className="text-[var(--foreground-muted)]">Expires</p>
                    <p className="text-[var(--foreground)]">{formatDate(m.validUntil)}</p>
                  </div>
                </div>
                <div className="mt-4 flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={revokingId === m.mandateId}
                    onClick={() => {
                      void handleRevoke(m.mandateId);
                    }}
                  >
                    <ShieldOff className="mr-2 h-4 w-4" />
                    {revokingId === m.mandateId ? "Revoking…" : "Revoke"}
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
