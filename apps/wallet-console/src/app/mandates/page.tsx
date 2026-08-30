"use client";

import { Card, CardContent, CardHeader, CardTitle, Badge, Button } from "@counter/ui";
import { FileText, Plus } from "lucide-react";
import { PageWrapper } from "@/components/page-wrapper";

interface Mandate {
  id: string;
  merchant: string;
  maxAmount: string;
  frequency: string;
  status: "active" | "paused" | "expired";
  expiresAt: string;
  nextDebit: string;
}

const MOCK_MANDATES: Mandate[] = [
  {
    id: "mdt-001",
    merchant: "StreamFlix",
    maxAmount: "INR 999/month",
    frequency: "Monthly",
    status: "active",
    expiresAt: "2026-01-01",
    nextDebit: "2025-02-01",
  },
  {
    id: "mdt-002",
    merchant: "CloudStore Pro",
    maxAmount: "INR 2,500/month",
    frequency: "Monthly",
    status: "active",
    expiresAt: "2025-12-15",
    nextDebit: "2025-02-15",
  },
  {
    id: "mdt-003",
    merchant: "GymFit Premium",
    maxAmount: "INR 1,500/month",
    frequency: "Monthly",
    status: "paused",
    expiresAt: "2025-06-30",
    nextDebit: "-",
  },
  {
    id: "mdt-004",
    merchant: "NewsDaily",
    maxAmount: "INR 299/month",
    frequency: "Monthly",
    status: "expired",
    expiresAt: "2025-01-01",
    nextDebit: "-",
  },
];

const STATUS_VARIANT: Record<string, "success" | "warning" | "secondary"> = {
  active: "success",
  paused: "warning",
  expired: "secondary",
};

export default function MandatesPage() {
  return (
    <PageWrapper>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--foreground)]">Mandates</h1>
            <p className="mt-1 text-[var(--foreground-secondary)]">
              Manage standing payment authorizations with merchants.
            </p>
          </div>
          <Button size="sm">
            <Plus className="mr-2 h-4 w-4" />
            New Mandate
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {MOCK_MANDATES.map((mandate) => (
            <Card key={mandate.id} className="transition-all hover:border-[var(--brand-orange)]/20">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <FileText className="h-4 w-4 text-[var(--brand-orange)]" />
                    {mandate.merchant}
                  </CardTitle>
                  <Badge variant={STATUS_VARIANT[mandate.status]}>{mandate.status}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-[var(--foreground-muted)]">Max Amount</p>
                    <p className="font-mono font-medium text-[var(--foreground)]">
                      {mandate.maxAmount}
                    </p>
                  </div>
                  <div>
                    <p className="text-[var(--foreground-muted)]">Frequency</p>
                    <p className="text-[var(--foreground)]">{mandate.frequency}</p>
                  </div>
                  <div>
                    <p className="text-[var(--foreground-muted)]">Next Debit</p>
                    <p className="text-[var(--foreground)]">{mandate.nextDebit}</p>
                  </div>
                  <div>
                    <p className="text-[var(--foreground-muted)]">Expires</p>
                    <p className="text-[var(--foreground)]">{mandate.expiresAt}</p>
                  </div>
                </div>
                <div className="mt-4 flex justify-end">
                  {mandate.status === "active" && (
                    <Button variant="outline" size="sm">
                      Pause
                    </Button>
                  )}
                  {mandate.status === "paused" && (
                    <Button variant="outline" size="sm">
                      Resume
                    </Button>
                  )}
                  {mandate.status === "expired" && (
                    <Button variant="outline" size="sm" disabled>
                      Expired
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </PageWrapper>
  );
}
