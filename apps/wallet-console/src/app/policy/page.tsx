"use client";

import { Card, CardContent, CardHeader, CardTitle, Badge, Button } from "@counter/ui";
import { Shield, FileText, Clock, CheckCircle2 } from "lucide-react";
import { PageWrapper } from "@/components/page-wrapper";

interface PolicyRule {
  id: string;
  name: string;
  description: string;
  category: string;
  status: "enforced" | "advisory" | "draft";
}

const MOCK_POLICIES: PolicyRule[] = [
  { id: "pol-001", name: "Maximum single transaction", description: "Reject any single transaction exceeding INR 50,000 without biometric verification", category: "Spending Limits", status: "enforced" },
  { id: "pol-002", name: "Daily transaction limit", description: "Cap total daily spend at INR 1,00,000 across all merchants", category: "Spending Limits", status: "enforced" },
  { id: "pol-003", name: "Trusted merchant bypass", description: "Allow auto-approval for verified merchants with risk score below 20", category: "Trust", status: "enforced" },
  { id: "pol-004", name: "New device cooling period", description: "Restrict transactions from new devices for 24 hours after pairing", category: "Security", status: "advisory" },
  { id: "pol-005", name: "Geofencing restriction", description: "Alert on transactions originating from outside registered locations", category: "Security", status: "draft" },
];

const STATUS_VARIANT: Record<string, "success" | "warning" | "secondary"> = {
  enforced: "success",
  advisory: "warning",
  draft: "secondary",
};

export default function PolicyPage() {
  return (
    <PageWrapper>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--foreground)]">Policy</h1>
            <p className="mt-1 text-[var(--foreground-secondary)]">
              Buyer policy rules governing wallet transactions and behavior.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              v2.1.0
            </Badge>
            <Button size="sm" variant="outline">
              <FileText className="mr-2 h-4 w-4" />
              View History
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-lg bg-green-500/10 p-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              </div>
              <div>
                <p className="text-2xl font-bold text-[var(--foreground)]">3</p>
                <p className="text-xs text-[var(--foreground-muted)]">Enforced</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-lg bg-yellow-500/10 p-2">
                <Shield className="h-4 w-4 text-yellow-500" />
              </div>
              <div>
                <p className="text-2xl font-bold text-[var(--foreground)]">1</p>
                <p className="text-xs text-[var(--foreground-muted)]">Advisory</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-lg bg-[var(--foreground-muted)]/10 p-2">
                <FileText className="h-4 w-4 text-[var(--foreground-muted)]" />
              </div>
              <div>
                <p className="text-2xl font-bold text-[var(--foreground)]">1</p>
                <p className="text-xs text-[var(--foreground-muted)]">Draft</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Active Rules</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-[var(--border)]">
              {MOCK_POLICIES.map((policy) => (
                <div key={policy.id} className="px-5 py-4 hover:bg-[var(--surface-secondary)] transition-colors">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-[var(--foreground)]">{policy.name}</p>
                        <Badge variant={STATUS_VARIANT[policy.status]} className="text-[10px]">{policy.status}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-[var(--foreground-muted)]">{policy.description}</p>
                      <p className="mt-1 text-[10px] text-[var(--foreground-muted)] uppercase tracking-wide">{policy.category}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </PageWrapper>
  );
}
