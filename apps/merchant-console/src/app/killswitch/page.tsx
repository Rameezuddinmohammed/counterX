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
        <div>
          <p
            className="font-mono text-xs uppercase tracking-widest text-[var(--foreground-muted)] mb-2"
            data-manifest-figure
          >
            Controls
          </p>
          <h1 className="font-display text-2xl font-semibold text-[var(--foreground)]">
            Kill switch
          </h1>
          <p className="mt-1 text-[var(--foreground-secondary)]">
            An emergency stop for your own store. When active, your agent-driven purchases are
            halted before any payment or order is created — enforced for real at checkout.
          </p>
        </div>

        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : error ? (
          <ErrorState message={error} />
        ) : (
          <Card>
            <CardContent className="flex items-center justify-between p-5">
              <div className="flex items-center gap-4">
                <div
                  className={`rounded-lg p-2 ${active ? "bg-red-500/10" : "bg-[var(--surface-secondary)]"}`}
                >
                  <Power
                    className={`h-5 w-5 ${active ? "text-red-500" : "text-[var(--foreground-muted)]"}`}
                  />
                </div>
                <div>
                  <p className="font-medium text-[var(--foreground)]">
                    {active ? "Purchases halted" : "Purchases enabled"}
                  </p>
                  {active && data?.reason && (
                    <p className="mt-0.5 text-xs text-red-500">{data.reason}</p>
                  )}
                  {active && data?.activatedAt && (
                    <p className="mt-0.5 text-xs text-[var(--foreground-muted)]">
                      Since {new Date(data.activatedAt).toLocaleString()}
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
