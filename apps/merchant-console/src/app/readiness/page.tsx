"use client";

import { useState } from "react";
import { Card, CardContent, Button, Badge } from "@counter/ui";
import { Activity, CheckCircle, XCircle, Play } from "lucide-react";
import { toast } from "@counter/ui";
import { PageWrapper } from "@/components/page-wrapper";
import type { ReadinessCheck } from "@/lib/types";

const DEMO_CHECKS: ReadinessCheck[] = [
  {
    checkId: "chk-001",
    name: "KYC Documents Verified",
    category: "Blocking",
    passed: true,
    message: "All documents verified and approved",
    detail: null,
    checkedAt: "2025-01-20T10:00:00Z",
  },
  {
    checkId: "chk-002",
    name: "Razorpay Connection",
    category: "Blocking",
    passed: true,
    message: "Payment gateway connected and operational",
    detail: null,
    checkedAt: "2025-01-20T10:00:01Z",
  },
  {
    checkId: "chk-003",
    name: "Shopify Integration",
    category: "Blocking",
    passed: true,
    message: "Store connected with valid credentials",
    detail: null,
    checkedAt: "2025-01-20T10:00:01Z",
  },
  {
    checkId: "chk-004",
    name: "Product Mapping",
    category: "AcceptedLimitation",
    passed: true,
    message: "60% of products mapped",
    detail: "3 products remain unmapped",
    checkedAt: "2025-01-20T10:00:02Z",
  },
  {
    checkId: "chk-005",
    name: "Webhook Endpoints",
    category: "Blocking",
    passed: false,
    message: "One webhook endpoint returning errors",
    detail: "Order fulfillment webhook timing out",
    checkedAt: "2025-01-20T10:00:03Z",
  },
];

function getCategoryBadge(category: ReadinessCheck["category"]) {
  switch (category) {
    case "Blocking":
      return "error" as const;
    case "AcceptedLimitation":
      return "warning" as const;
    case "Advisory":
      return "info" as const;
    case "Expiring":
      return "warning" as const;
  }
}

export default function ReadinessPage() {
  const [running, setRunning] = useState(false);
  const passed = DEMO_CHECKS.filter((c) => c.passed).length;
  const total = DEMO_CHECKS.length;

  const handleRunCheck = () => {
    setRunning(true);
    setTimeout(() => {
      setRunning(false);
      toast.success("Readiness check completed");
    }, 2000);
  };

  return (
    <PageWrapper>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--foreground)]">Readiness Checks</h1>
            <p className="mt-1 text-[var(--foreground-secondary)]">
              Verify your merchant account is ready for activation.
            </p>
          </div>
          <Button onClick={handleRunCheck} disabled={running}>
            <Play className="mr-2 h-4 w-4" />
            {running ? "Running..." : "Run Checks"}
          </Button>
        </div>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="rounded-lg bg-[var(--brand-orange)]/10 p-3">
                <Activity className="h-6 w-6 text-[var(--brand-orange)]" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-[var(--foreground)]">Overall Readiness</p>
                <p className="text-sm text-[var(--foreground-muted)]">
                  {passed} of {total} checks passing
                </p>
              </div>
              <div className="text-3xl font-bold text-[var(--brand-orange)]">
                {Math.round((passed / total) * 100)}%
              </div>
            </div>
          </CardContent>
        </Card>
        <div className="space-y-3">
          {DEMO_CHECKS.map((check) => (
            <Card key={check.checkId}>
              <CardContent className="flex items-center gap-4 p-4">
                {check.passed ? (
                  <CheckCircle className="h-5 w-5 text-emerald-500" />
                ) : (
                  <XCircle className="h-5 w-5 text-red-500" />
                )}
                <div className="flex-1">
                  <p className="font-medium text-[var(--foreground)]">{check.name}</p>
                  <p className="text-sm text-[var(--foreground-muted)]">{check.message}</p>
                  {check.detail && (
                    <p className="mt-1 text-xs text-[var(--foreground-muted)]">{check.detail}</p>
                  )}
                </div>
                <Badge variant={getCategoryBadge(check.category)}>{check.category}</Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </PageWrapper>
  );
}
