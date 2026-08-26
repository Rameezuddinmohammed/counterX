"use client";

import { Card, CardContent, Button } from "@counter/ui";
import { AlertTriangle, Plus, CheckCircle } from "lucide-react";
import { PageWrapper } from "@/components/page-wrapper";

const MOCK_INCIDENTS = [
  {
    id: "INC-001",
    title: "Elevated error rate on payment processing",
    severity: "critical" as const,
    status: "resolved" as const,
    scope: "payments",
    startedAt: "2024-01-15T10:30:00Z",
    resolvedAt: "2024-01-15T11:45:00Z",
  },
  {
    id: "INC-002",
    title: "Redis connection timeout spike",
    severity: "warning" as const,
    status: "resolved" as const,
    scope: "infrastructure",
    startedAt: "2024-01-14T14:00:00Z",
    resolvedAt: "2024-01-14T14:30:00Z",
  },
];

function SeverityBadge({ severity }: { severity: "critical" | "warning" | "info" }) {
  const styles: Record<string, string> = {
    critical: "bg-red-500/10 text-red-500 border-red-500/20",
    warning: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
    info: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${styles[severity]}`}>
      {severity}
    </span>
  );
}

function StatusBadge({ status }: { status: "active" | "investigating" | "resolved" }) {
  const styles: Record<string, string> = {
    active: "bg-red-500/10 text-red-500 border-red-500/20",
    investigating: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
    resolved: "bg-green-500/10 text-green-500 border-green-500/20",
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${styles[status]}`}>
      {status}
    </span>
  );
}

export default function IncidentsPage() {
  return (
    <PageWrapper>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--foreground)]">Incidents</h1>
            <p className="mt-1 text-[var(--foreground-secondary)]">
              Manage platform incidents with severity tracking and timeline.
            </p>
          </div>
          <Button className="flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Create Incident
          </Button>
        </div>

        {/* Active Status */}
        <Card className="border-green-500/20 bg-green-500/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <CheckCircle className="h-5 w-5 text-green-500" />
              <p className="text-sm font-medium text-[var(--foreground)]">
                No active incidents. All systems nominal.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Incident History */}
        <div>
          <h2 className="mb-4 text-lg font-semibold text-[var(--foreground)]">Recent History</h2>
          <div className="space-y-3">
            {MOCK_INCIDENTS.map((incident) => (
              <Card key={incident.id} className="transition-all hover:border-[var(--border-secondary)]">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <div className="rounded-lg bg-[var(--surface-secondary)] p-2 mt-0.5">
                        <AlertTriangle className="h-4 w-4 text-[var(--foreground-muted)]" />
                      </div>
                      <div>
                        <p className="font-medium text-[var(--foreground)]">{incident.title}</p>
                        <p className="mt-1 text-xs text-[var(--foreground-muted)]">
                          {incident.id} &middot; Scope: {incident.scope} &middot; Started: {new Date(incident.startedAt).toLocaleString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <SeverityBadge severity={incident.severity} />
                      <StatusBadge status={incident.status} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </PageWrapper>
  );
}
