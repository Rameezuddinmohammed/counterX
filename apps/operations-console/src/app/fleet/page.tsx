"use client";

import { Card, CardContent } from "@counter/ui";
import { Server, CheckCircle, AlertCircle, XCircle } from "lucide-react";
import { PageWrapper } from "@/components/page-wrapper";

const FLEET_DEPENDENCIES = [
  { name: "PostgreSQL", status: "healthy" as const, responseTime: "4ms", lastCheck: "30s ago" },
  { name: "Redis", status: "healthy" as const, responseTime: "1ms", lastCheck: "30s ago" },
  { name: "RabbitMQ", status: "healthy" as const, responseTime: "3ms", lastCheck: "30s ago" },
  {
    name: "Razorpay API",
    status: "healthy" as const,
    responseTime: "120ms",
    lastCheck: "1 min ago",
  },
  { name: "Shopify API", status: "healthy" as const, responseTime: "95ms", lastCheck: "1 min ago" },
  { name: "Auth0", status: "healthy" as const, responseTime: "45ms", lastCheck: "2 min ago" },
];

function StatusIcon({ status }: { status: "healthy" | "degraded" | "unhealthy" }) {
  switch (status) {
    case "healthy":
      return <CheckCircle className="h-5 w-5 text-green-500" />;
    case "degraded":
      return <AlertCircle className="h-5 w-5 text-yellow-500" />;
    case "unhealthy":
      return <XCircle className="h-5 w-5 text-red-500" />;
  }
}

function StatusBadge({ status }: { status: "healthy" | "degraded" | "unhealthy" }) {
  const variants: Record<string, string> = {
    healthy: "bg-green-500/10 text-green-500 border-green-500/20",
    degraded: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
    unhealthy: "bg-red-500/10 text-red-500 border-red-500/20",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${variants[status]}`}
    >
      {status}
    </span>
  );
}

export default function FleetHealthPage() {
  return (
    <PageWrapper>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Fleet Health</h1>
          <p className="mt-1 text-[var(--foreground-secondary)]">
            Dependency health status grid with response time monitoring.
          </p>
        </div>

        {/* Overall Status */}
        <Card className="border-green-500/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-green-500" />
              </span>
              <p className="text-sm font-medium text-[var(--foreground)]">
                All {FLEET_DEPENDENCIES.length} dependencies healthy
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Dependency Grid */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FLEET_DEPENDENCIES.map((dep) => (
            <Card key={dep.name} className="transition-all hover:border-[var(--border-secondary)]">
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="rounded-lg bg-[var(--surface-secondary)] p-2">
                      <Server className="h-4 w-4 text-[var(--foreground-muted)]" />
                    </div>
                    <div>
                      <p className="font-medium text-[var(--foreground)]">{dep.name}</p>
                      <p className="text-xs text-[var(--foreground-muted)]">{dep.responseTime}</p>
                    </div>
                  </div>
                  <StatusIcon status={dep.status} />
                </div>
                <div className="mt-4 flex items-center justify-between">
                  <StatusBadge status={dep.status} />
                  <span className="text-xs text-[var(--foreground-muted)]">{dep.lastCheck}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </PageWrapper>
  );
}
