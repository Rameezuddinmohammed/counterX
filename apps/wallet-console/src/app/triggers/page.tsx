"use client";

import { Card, CardContent, Badge, Button, Switch } from "@counter/ui";
import { Zap, Plus } from "lucide-react";
import { toast } from "@counter/ui";
import { PageWrapper } from "@/components/page-wrapper";

interface TriggerRule {
  id: string;
  name: string;
  condition: string;
  action: string;
  enabled: boolean;
  lastFired: string;
  firedCount: number;
}

const MOCK_TRIGGERS: TriggerRule[] = [
  { id: "trg-001", name: "Auto-approve small payments", condition: "Amount < INR 1,000 AND Merchant in trusted list", action: "Auto-approve transaction", enabled: true, lastFired: "2 hours ago", firedCount: 47 },
  { id: "trg-002", name: "Block suspicious merchants", condition: "Merchant risk score > 80", action: "Auto-reject and alert", enabled: true, lastFired: "3 days ago", firedCount: 2 },
  { id: "trg-003", name: "Notify on high value", condition: "Amount > INR 10,000", action: "Send push notification", enabled: true, lastFired: "1 day ago", firedCount: 8 },
  { id: "trg-004", name: "Weekend spending limit", condition: "Day is Saturday OR Sunday AND total > INR 5,000", action: "Require additional approval", enabled: false, lastFired: "Never", firedCount: 0 },
];

export default function TriggersPage() {
  const handleToggle = (name: string, enabled: boolean) => {
    toast.success(name + (enabled ? " enabled" : " disabled"));
  };

  return (
    <PageWrapper>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--foreground)]">Triggers</h1>
            <p className="mt-1 text-[var(--foreground-secondary)]">
              Define automation rules to handle transactions based on conditions.
            </p>
          </div>
          <Button size="sm">
            <Plus className="mr-2 h-4 w-4" />
            New Trigger
          </Button>
        </div>

        <div className="space-y-4">
          {MOCK_TRIGGERS.map((trigger) => (
            <Card key={trigger.id} className="transition-all hover:border-[var(--brand-orange)]/20">
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 flex-1">
                    <div className="rounded-lg bg-[var(--brand-orange)]/10 p-2 mt-0.5">
                      <Zap className="h-4 w-4 text-[var(--brand-orange)]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-[var(--foreground)]">{trigger.name}</p>
                        <Badge variant={trigger.enabled ? "success" : "secondary"}>
                          {trigger.enabled ? "Active" : "Disabled"}
                        </Badge>
                      </div>
                      <div className="mt-2 space-y-1">
                        <p className="text-xs text-[var(--foreground-muted)]">
                          <span className="font-medium text-[var(--foreground-secondary)]">If:</span>{" "}
                          {trigger.condition}
                        </p>
                        <p className="text-xs text-[var(--foreground-muted)]">
                          <span className="font-medium text-[var(--foreground-secondary)]">Then:</span>{" "}
                          {trigger.action}
                        </p>
                      </div>
                      <div className="mt-2 flex items-center gap-4 text-xs text-[var(--foreground-muted)]">
                        <span>Fired {trigger.firedCount} times</span>
                        <span>Last: {trigger.lastFired}</span>
                      </div>
                    </div>
                  </div>
                  <Switch defaultChecked={trigger.enabled} onCheckedChange={(checked) => handleToggle(trigger.name, checked)} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </PageWrapper>
  );
}
