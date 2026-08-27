"use client";

import { Card, CardContent, Badge, DataTable } from "@counter/ui";
import type { DataTableColumn } from "@counter/ui";
import { PageWrapper } from "@/components/page-wrapper";
import type { Finding, FindingSeverity } from "@/lib/types";

const DEMO_FINDINGS: Finding[] = [
  { findingId: "fnd-001", merchantId: "merchant-pilot-001", severity: "high", title: "Webhook Delivery Failures", description: "Order fulfillment webhook has failed 3 consecutive times", affectedObject: "webhook:order-fulfillment", resolution: "open", compensationCommand: null, detectedAt: "2025-01-20T09:00:00Z", resolvedAt: null },
  { findingId: "fnd-002", merchantId: "merchant-pilot-001", severity: "medium", title: "Unmapped Product Categories", description: "3 products have no Counter category assignment", affectedObject: "mapping:products", resolution: "acknowledged", compensationCommand: "remap-products", detectedAt: "2025-01-19T14:00:00Z", resolvedAt: null },
  { findingId: "fnd-003", merchantId: "merchant-pilot-001", severity: "low", title: "SSL Certificate Expiring", description: "Certificate expires in 30 days", affectedObject: "security:ssl", resolution: "open", compensationCommand: null, detectedAt: "2025-01-18T08:00:00Z", resolvedAt: null },
  { findingId: "fnd-004", merchantId: "merchant-pilot-001", severity: "critical", title: "Payment Gateway Error Rate", description: "Error rate exceeded 5% threshold", affectedObject: "payments:razorpay", resolution: "resolved", compensationCommand: null, detectedAt: "2025-01-17T22:00:00Z", resolvedAt: "2025-01-17T22:30:00Z" },
];

function getSeverityVariant(severity: FindingSeverity) {
  switch (severity) { case "critical": case "high": return "error" as const; case "medium": return "warning" as const; case "low": return "info" as const; case "info": return "secondary" as const; }
}

const columns: DataTableColumn<Finding>[] = [
  { key: "severity", header: "Severity", cell: (item: Finding) => <Badge variant={getSeverityVariant(item.severity)}>{item.severity}</Badge> },
  { key: "title", header: "Finding", cell: (item: Finding) => <div><p className="font-medium text-[var(--foreground)]">{item.title}</p><p className="text-xs text-[var(--foreground-muted)]">{item.description}</p></div> },
  { key: "resolution", header: "Status", cell: (item: Finding) => <Badge variant={item.resolution === "resolved" ? "success" : item.resolution === "acknowledged" ? "warning" : "secondary"}>{item.resolution}</Badge> },
  { key: "detectedAt", header: "Detected", cell: (item: Finding) => <span className="text-sm text-[var(--foreground-secondary)]">{new Date(item.detectedAt).toLocaleDateString()}</span> },
];

export default function FindingsPage() {
  return (
    <PageWrapper>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Findings</h1>
          <p className="mt-1 text-[var(--foreground-secondary)]">Security findings and reconciliation issues.</p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          {[{ label: "Critical", count: 0, v: "error" as const }, { label: "High", count: 1, v: "error" as const }, { label: "Medium", count: 1, v: "warning" as const }, { label: "Low", count: 1, v: "info" as const }].map((item) => (
            <Card key={item.label}><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-[var(--foreground)]">{item.count}</p><Badge variant={item.v} className="mt-1">{item.label}</Badge></CardContent></Card>
          ))}
        </div>
        <DataTable columns={columns as unknown as DataTableColumn<Record<string, unknown>>[]} data={DEMO_FINDINGS as unknown as Record<string, unknown>[]} emptyMessage="No findings detected" />
      </div>
    </PageWrapper>
  );
}
