"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, Button, Badge } from "@counter/ui";
import { FileText, CheckCircle, XCircle, Zap } from "lucide-react";
import { toast } from "@counter/ui";
import { PageWrapper } from "@/components/page-wrapper";

const CAPABILITIES = [
  { name: "Payment Processing", enabled: true },
  { name: "Order Fulfillment", enabled: true },
  { name: "Refund Management", enabled: true },
  { name: "Dispute Resolution", enabled: false },
  { name: "Multi-currency", enabled: false },
];

const GATES = [
  {
    gateId: "gate-001",
    name: "KYC Verification",
    satisfied: true,
    requiredFor: "Payment Processing",
  },
  {
    gateId: "gate-002",
    name: "Bank Account Verified",
    satisfied: true,
    requiredFor: "Refund Management",
  },
  {
    gateId: "gate-003",
    name: "Dispute Policy Configured",
    satisfied: false,
    requiredFor: "Dispute Resolution",
  },
];

export default function ManifestPage() {
  const [activating, setActivating] = useState(false);
  const handleActivate = () => {
    setActivating(true);
    setTimeout(() => {
      setActivating(false);
      toast.success("Manifest activated successfully");
    }, 1500);
  };

  return (
    <PageWrapper>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--foreground)]">Manifest Activation</h1>
            <p className="mt-1 text-[var(--foreground-secondary)]">
              Manage your merchant capabilities and activation status.
            </p>
          </div>
          <Button onClick={handleActivate} disabled={activating}>
            <Zap className="mr-2 h-4 w-4" />
            {activating ? "Activating..." : "Activate Manifest"}
          </Button>
        </div>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="rounded-lg bg-[var(--brand-orange)]/10 p-3">
                  <FileText className="h-6 w-6 text-[var(--brand-orange)]" />
                </div>
                <div>
                  <p className="font-semibold text-[var(--foreground)]">Merchant Manifest</p>
                  <p className="text-sm text-[var(--foreground-muted)]">Version 1 - Draft</p>
                </div>
              </div>
              <Badge variant="warning">Pending Activation</Badge>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Capabilities</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {CAPABILITIES.map((cap) => (
                <div
                  key={cap.name}
                  className="flex items-center justify-between rounded-lg border border-[var(--border)] p-3"
                >
                  <div className="flex items-center gap-3">
                    {cap.enabled ? (
                      <CheckCircle className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <XCircle className="h-4 w-4 text-[var(--foreground-muted)]" />
                    )}
                    <span className="text-sm font-medium text-[var(--foreground)]">{cap.name}</span>
                  </div>
                  <Badge variant={cap.enabled ? "success" : "secondary"}>
                    {cap.enabled ? "Enabled" : "Locked"}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Capability Gates</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {GATES.map((gate) => (
                <div
                  key={gate.gateId}
                  className="flex items-center justify-between rounded-lg border border-[var(--border)] p-3"
                >
                  <div className="flex items-center gap-3">
                    {gate.satisfied ? (
                      <CheckCircle className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-500" />
                    )}
                    <div>
                      <p className="text-sm font-medium text-[var(--foreground)]">{gate.name}</p>
                      <p className="text-xs text-[var(--foreground-muted)]">
                        Required for: {gate.requiredFor}
                      </p>
                    </div>
                  </div>
                  <Badge variant={gate.satisfied ? "success" : "error"}>
                    {gate.satisfied ? "Satisfied" : "Pending"}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </PageWrapper>
  );
}
