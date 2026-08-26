"use client";

import { useState } from "react";
import { Card, CardContent, Button, Switch } from "@counter/ui";
import { Power, Globe, ShoppingBag, Wallet, AlertTriangle } from "lucide-react";
import { toast } from "@counter/ui";
import { PageWrapper } from "@/components/page-wrapper";

interface KillSwitch {
  id: string;
  name: string;
  scope: "global" | "merchant" | "wallet";
  description: string;
  active: boolean;
  lastModified: string;
}

const KILL_SWITCHES: KillSwitch[] = [
  { id: "ks-1", name: "Payment Processing", scope: "global", description: "Disable all payment processing", active: false, lastModified: "Never activated" },
  { id: "ks-2", name: "Webhook Delivery", scope: "global", description: "Pause outbound webhooks", active: false, lastModified: "Never activated" },
  { id: "ks-3", name: "Merchant Onboarding", scope: "merchant", description: "Halt new merchant signups", active: false, lastModified: "Never activated" },
  { id: "ks-4", name: "Wallet Withdrawals", scope: "wallet", description: "Disable wallet withdrawals", active: false, lastModified: "Never activated" },
  { id: "ks-5", name: "Reconciliation Jobs", scope: "global", description: "Pause reconciliation processing", active: false, lastModified: "Never activated" },
];

function ScopeIcon({ scope }: { scope: "global" | "merchant" | "wallet" }) {
  switch (scope) {
    case "global":
      return <Globe className="h-4 w-4" />;
    case "merchant":
      return <ShoppingBag className="h-4 w-4" />;
    case "wallet":
      return <Wallet className="h-4 w-4" />;
  }
}

function ScopeBadge({ scope }: { scope: "global" | "merchant" | "wallet" }) {
  const styles: Record<string, string> = {
    global: "bg-red-500/10 text-red-500 border-red-500/20",
    merchant: "bg-blue-500/10 text-blue-500 border-blue-500/20",
    wallet: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${styles[scope]}`}>
      <ScopeIcon scope={scope} />
      {scope}
    </span>
  );
}

export default function KillSwitchesPage() {
  const [switches, setSwitches] = useState(KILL_SWITCHES);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const handleToggle = (id: string) => {
    const target = switches.find((s) => s.id === id);
    if (!target) return;

    if (!target.active) {
      setConfirmId(id);
    } else {
      setSwitches((prev) =>
        prev.map((s) =>
          s.id === id ? { ...s, active: false, lastModified: new Date().toLocaleString() } : s
        )
      );
      toast.success(`Kill switch "${target.name}" deactivated`);
    }
  };

  const confirmActivation = () => {
    if (!confirmId) return;
    const target = switches.find((s) => s.id === confirmId);
    setSwitches((prev) =>
      prev.map((s) =>
        s.id === confirmId ? { ...s, active: true, lastModified: new Date().toLocaleString() } : s
      )
    );
    if (target) {
      toast.success(`Kill switch "${target.name}" activated`);
    }
    setConfirmId(null);
  };

  const grouped = {
    global: switches.filter((s) => s.scope === "global"),
    merchant: switches.filter((s) => s.scope === "merchant"),
    wallet: switches.filter((s) => s.scope === "wallet"),
  };

  return (
    <PageWrapper>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Kill Switches</h1>
          <p className="mt-1 text-[var(--foreground-secondary)]">
            Server-side feature flags that disable functionality by scope. Activation requires confirmation.
          </p>
        </div>

        {/* Confirmation Dialog */}
        {confirmId && (
          <Card className="border-red-500/30 bg-red-500/5">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-red-500 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-[var(--foreground)]">
                    Confirm Kill Switch Activation
                  </p>
                  <p className="mt-1 text-xs text-[var(--foreground-muted)]">
                    Activating &quot;{switches.find((s) => s.id === confirmId)?.name}&quot; will immediately disable the affected functionality. Are you sure?
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <Button size="sm" variant="destructive" onClick={confirmActivation}>
                      Confirm Activation
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setConfirmId(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Grouped Kill Switches */}
        {Object.entries(grouped).map(([scope, items]) => (
          items.length > 0 && (
            <div key={scope}>
              <h2 className="mb-3 text-sm font-semibold text-[var(--foreground-muted)] uppercase tracking-wider">
                {scope} scope
              </h2>
              <Card>
                <CardContent className="p-0 divide-y divide-[var(--border)]">
                  {items.map((sw) => (
                    <div key={sw.id} className="flex items-center justify-between px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="rounded-lg bg-[var(--surface-secondary)] p-2">
                          <Power className="h-4 w-4 text-[var(--foreground-muted)]" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-[var(--foreground)]">{sw.name}</p>
                            <ScopeBadge scope={sw.scope} />
                          </div>
                          <p className="text-xs text-[var(--foreground-muted)]">{sw.description}</p>
                          <p className="text-xs text-[var(--foreground-muted)] mt-0.5">{sw.lastModified}</p>
                        </div>
                      </div>
                      <Switch
                        checked={sw.active}
                        onCheckedChange={() => handleToggle(sw.id)}
                      />
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          )
        ))}
      </div>
    </PageWrapper>
  );
}
