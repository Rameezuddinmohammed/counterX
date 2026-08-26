"use client";

import { useState } from "react";
import { Card, CardContent, Switch, Badge, Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, Button } from "@counter/ui";
import { Power } from "lucide-react";
import { toast } from "@counter/ui";
import { PageWrapper } from "@/components/page-wrapper";
import type { KillSwitchState } from "@/lib/types";

const INITIAL_SWITCHES: KillSwitchState[] = [
  { switchId: "ks-001", name: "Payment Processing", scope: "merchant", active: false, activatedBy: null, activatedAt: null, reason: null, affectedMerchants: [] },
  { switchId: "ks-002", name: "Order Fulfillment", scope: "merchant", active: false, activatedBy: null, activatedAt: null, reason: null, affectedMerchants: [] },
  { switchId: "ks-003", name: "Webhook Delivery", scope: "merchant", active: true, activatedBy: "system", activatedAt: "2025-01-20T08:00:00Z", reason: "Excessive failures detected", affectedMerchants: ["merchant-pilot-001"] },
  { switchId: "ks-004", name: "Refund Processing", scope: "global", active: false, activatedBy: null, activatedAt: null, reason: null, affectedMerchants: [] },
];

export default function KillSwitchPage() {
  const [switches, setSwitches] = useState(INITIAL_SWITCHES);
  const [confirmSwitch, setConfirmSwitch] = useState<KillSwitchState | null>(null);

  const confirmToggle = () => {
    if (!confirmSwitch) return;
    setSwitches((prev) => prev.map((s) => s.switchId === confirmSwitch.switchId ? { ...s, active: !s.active, activatedBy: !s.active ? "user" : null, activatedAt: !s.active ? new Date().toISOString() : null } : s));
    toast.success(`Kill switch "${confirmSwitch.name}" ${confirmSwitch.active ? "deactivated" : "activated"}`);
    setConfirmSwitch(null);
  };

  return (
    <PageWrapper>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Kill Switches</h1>
          <p className="mt-1 text-[var(--foreground-secondary)]">Emergency circuit breakers for critical system functions.</p>
        </div>
        <div className="space-y-3">
          {switches.map((sw) => (
            <Card key={sw.switchId}>
              <CardContent className="flex items-center justify-between p-5">
                <div className="flex items-center gap-4">
                  <div className={`rounded-lg p-2 ${sw.active ? "bg-red-500/10" : "bg-[var(--surface-secondary)]"}`}>
                    <Power className={`h-5 w-5 ${sw.active ? "text-red-500" : "text-[var(--foreground-muted)]"}`} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-[var(--foreground)]">{sw.name}</p>
                      <Badge variant={sw.scope === "global" ? "info" : "secondary"}>{sw.scope}</Badge>
                    </div>
                    {sw.active && sw.reason && <p className="mt-0.5 text-xs text-red-500">{sw.reason}</p>}
                  </div>
                </div>
                <Switch checked={sw.active} onCheckedChange={() => setConfirmSwitch(sw)} />
              </CardContent>
            </Card>
          ))}
        </div>
        <Dialog open={!!confirmSwitch} onOpenChange={() => setConfirmSwitch(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Confirm Kill Switch Toggle</DialogTitle>
              <DialogDescription>Are you sure you want to {confirmSwitch?.active ? "deactivate" : "activate"} the kill switch?</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmSwitch(null)}>Cancel</Button>
              <Button variant={confirmSwitch?.active ? "default" : "destructive"} onClick={confirmToggle}>{confirmSwitch?.active ? "Deactivate" : "Activate"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </PageWrapper>
  );
}
