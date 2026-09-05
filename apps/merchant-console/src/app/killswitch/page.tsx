"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  Switch,
  Skeleton,
  ErrorState,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Button,
  Input,
  Badge,
  toast,
} from "@counter/ui";
import { Power } from "lucide-react";
import { PageWrapper } from "@/components/page-wrapper";
import { getApiClient, useApi, useCurrentMerchantId } from "@/hooks/use-api";
import type { MerchantKillSwitchState } from "@/lib/types";

export default function KillSwitchPage() {
  const { merchantId, loading: merchantLoading, error: merchantError } = useCurrentMerchantId();
  const {
    data,
    loading: switchLoading,
    error: switchError,
    refetch,
  } = useApi<MerchantKillSwitchState | null>(
    (client) =>
      merchantId
        ? client.getKillSwitch(merchantId)
        : Promise.resolve({ ok: true, data: null as MerchantKillSwitchState | null }),
    [merchantId],
  );

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const loading = merchantLoading || switchLoading;
  const error = merchantError ?? switchError;
  const active = data?.active ?? false;

  async function applyToggle(nextActive: boolean) {
    if (merchantId === undefined) return;
    setSaving(true);
    try {
      const client = getApiClient();
      const result = await client.setKillSwitch(
        merchantId,
        nextActive,
        nextActive ? reason.trim() || undefined : undefined,
      );
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success(nextActive ? "Kill switch activated" : "Kill switch deactivated");
      setReason("");
      refetch();
    } finally {
      setSaving(false);
      setConfirmOpen(false);
    }
  }

  return (
    <PageWrapper>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs uppercase font-bold tracking-wider text-rose-600 dark:text-rose-400">
                Emergency Safeguards
              </span>
              <span
                className={`text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full border flex items-center gap-1.5 ${
                  active
                    ? "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30"
                    : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    active ? "bg-rose-500 animate-ping" : "bg-emerald-500"
                  }`}
                />
                {active ? "Emergency Halt Engaged" : "Purchasing Active"}
              </span>
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight text-[var(--foreground)]">
              Store Kill Switch
            </h1>
            <p className="mt-1 text-sm text-[var(--foreground-secondary)]">
              Instant circuit-breaker for your store. When active, all incoming agent purchases are
              halted before an order or payment is ever created.
            </p>
          </div>
        </div>

        {loading ? (
          <Skeleton className="h-28 w-full rounded-2xl" />
        ) : error ? (
          <ErrorState message={error} />
        ) : (
          <Card
            className={`transition-all duration-200 shadow-md ${
              active
                ? "border-rose-500/40 bg-gradient-to-br from-rose-950/20 via-[var(--surface)] to-[var(--surface)]"
                : "border-[var(--border)] hover:border-[var(--border-secondary)]"
            }`}
          >
            <CardContent className="flex items-center justify-between p-6">
              <div className="flex items-center gap-4">
                <div
                  className={`flex h-12 w-12 items-center justify-center rounded-2xl border transition-colors ${
                    active
                      ? "bg-rose-500/15 border-rose-500/30 text-rose-500"
                      : "bg-emerald-500/10 border-emerald-500/20 text-emerald-500"
                  }`}
                >
                  <Power className="h-6 w-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-bold text-base text-[var(--foreground)]">
                      {active ? "AI Agent Orders Halted" : "Agent Purchases Fully Enabled"}
                    </p>
                    <Badge variant={active ? "error" : "success"}>
                      {active ? "Halted" : "Standby"}
                    </Badge>
                  </div>
                  {active && data?.reason && (
                    <p className="mt-1 text-xs font-medium text-rose-500 font-mono">
                      Reason: {data.reason}
                    </p>
                  )}
                  {active && data?.activatedAt && (
                    <p className="mt-0.5 text-xs text-[var(--foreground-muted)] font-mono">
                      Active since {new Date(data.activatedAt).toLocaleString()}
                    </p>
                  )}
                  {!active && (
                    <p className="mt-0.5 text-xs text-[var(--foreground-muted)]">
                      Flip switch to immediately halt all agent-driven checkout flows.
                    </p>
                  )}
                </div>
              </div>
              <Switch
                checked={active}
                disabled={saving}
                onCheckedChange={(next) => {
                  if (next) {
                    setConfirmOpen(true);
                  } else {
                    void applyToggle(false);
                  }
                }}
              />
            </CardContent>
          </Card>
        )}

        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Activate kill switch?</DialogTitle>
              <DialogDescription>
                Your agent will be unable to complete any purchase until you turn this back off.
              </DialogDescription>
            </DialogHeader>
            <Input
              placeholder="Reason (optional)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={saving}
                onClick={() => void applyToggle(true)}
              >
                Activate
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </PageWrapper>
  );
}
