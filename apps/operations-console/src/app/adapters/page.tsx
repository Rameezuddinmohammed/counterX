"use client";

import { Card, CardContent, CardHeader, CardTitle, Button } from "@counter/ui";
import { Plug, RotateCcw, CheckCircle, AlertCircle } from "lucide-react";
import { PageWrapper } from "@/components/page-wrapper";

const MOCK_ADAPTERS = [
  { id: "razorpay", name: "Razorpay", version: "2.1.0", status: "healthy" as const, lastDeployed: "2024-01-14T10:00:00Z", transactions: 12847 },
  { id: "shopify", name: "Shopify Connector", version: "1.4.2", status: "healthy" as const, lastDeployed: "2024-01-13T08:30:00Z", transactions: 8421 },
  { id: "reference", name: "Reference Connector", version: "1.0.0", status: "healthy" as const, lastDeployed: "2024-01-10T14:00:00Z", transactions: 342 },
];

function AdapterStatusIcon({ status }: { status: "healthy" | "degraded" | "offline" }) {
  switch (status) {
    case "healthy":
      return <CheckCircle className="h-4 w-4 text-green-500" />;
    case "degraded":
      return <AlertCircle className="h-4 w-4 text-yellow-500" />;
    case "offline":
      return <AlertCircle className="h-4 w-4 text-red-500" />;
  }
}

export default function AdaptersPage() {
  return (
    <PageWrapper>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Adapter Releases</h1>
          <p className="mt-1 text-[var(--foreground-secondary)]">
            Connector and payment adapter versions, health, and deployment history.
          </p>
        </div>

        {/* Adapter Grid */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MOCK_ADAPTERS.map((adapter) => (
            <Card key={adapter.id} className="transition-all hover:border-[var(--border-secondary)]">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Plug className="h-4 w-4 text-[var(--foreground-muted)]" />
                    {adapter.name}
                  </CardTitle>
                  <AdapterStatusIcon status={adapter.status} />
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-[var(--foreground-muted)]">Version</p>
                    <p className="text-sm font-semibold text-[var(--foreground)]">v{adapter.version}</p>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--foreground-muted)]">Transactions</p>
                    <p className="text-sm font-semibold text-[var(--foreground)]">{adapter.transactions.toLocaleString()}</p>
                  </div>
                </div>
                <div>
                  <p className="text-xs text-[var(--foreground-muted)]">Last Deployed</p>
                  <p className="text-xs text-[var(--foreground)]">{new Date(adapter.lastDeployed).toLocaleString()}</p>
                </div>
                <Button size="sm" variant="outline" className="flex items-center gap-1.5 w-full justify-center">
                  <RotateCcw className="h-3 w-3" />
                  Rollback
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </PageWrapper>
  );
}
