"use client";

import { Badge, Button, DataTable } from "@counter/ui";
import type { DataTableColumn } from "@counter/ui";
import { Download } from "lucide-react";
import { toast } from "@counter/ui";
import { PageWrapper } from "@/components/page-wrapper";
import type { AuditEntry } from "@/lib/types";

const DEMO_AUDIT: AuditEntry[] = [
  { entryId: "aud-001", merchantId: "merchant-pilot-001", action: "login", actor: "admin@merchant.com", detail: "Successful login from 192.168.1.1", timestamp: "2025-01-20T10:00:00Z", immutable: true },
  { entryId: "aud-002", merchantId: "merchant-pilot-001", action: "config_change", actor: "admin@merchant.com", detail: "Updated webhook endpoint URL", timestamp: "2025-01-20T09:30:00Z", immutable: true },
  { entryId: "aud-003", merchantId: "merchant-pilot-001", action: "activation", actor: "system", detail: "Manifest v1 activated", timestamp: "2025-01-19T16:00:00Z", immutable: true },
  { entryId: "aud-004", merchantId: "merchant-pilot-001", action: "kill_switch", actor: "system", detail: "Webhook delivery kill switch activated", timestamp: "2025-01-20T08:00:00Z", immutable: true },
];

function getActionBadge(action: AuditEntry["action"]) {
  switch (action) { case "login": return "info" as const; case "config_change": return "warning" as const; case "activation": return "success" as const; case "suspension": case "kill_switch": case "offboarding": return "error" as const; case "export": return "secondary" as const; }
}

const columns: DataTableColumn<AuditEntry>[] = [
  { key: "timestamp", header: "Time", cell: (item: AuditEntry) => <span className="text-sm text-[var(--foreground-secondary)]">{new Date(item.timestamp).toLocaleString()}</span> },
  { key: "actor", header: "Actor", cell: (item: AuditEntry) => <span className="text-sm font-medium text-[var(--foreground)]">{item.actor}</span> },
  { key: "action", header: "Action", cell: (item: AuditEntry) => <Badge variant={getActionBadge(item.action)}>{item.action.replace("_", " ")}</Badge> },
  { key: "detail", header: "Details", cell: (item: AuditEntry) => <span className="text-sm text-[var(--foreground-secondary)]">{item.detail}</span> },
];

export default function AuditPage() {
  return (
    <PageWrapper>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--foreground)]">Audit Log</h1>
            <p className="mt-1 text-[var(--foreground-secondary)]">Immutable record of all account activities.</p>
          </div>
          <Button variant="outline" onClick={() => toast.success("Audit log export started")}><Download className="mr-2 h-4 w-4" />Export</Button>
        </div>
        <DataTable columns={columns as unknown as DataTableColumn<Record<string, unknown>>[]} data={DEMO_AUDIT as unknown as Record<string, unknown>[]} emptyMessage="No audit entries found" />
      </div>
    </PageWrapper>
  );
}
