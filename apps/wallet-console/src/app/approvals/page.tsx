"use client";

import { Card, CardContent, CardHeader, CardTitle, Badge, Button, Separator } from "@counter/ui";
import { CheckCircle2, XCircle, Clock, AlertTriangle } from "lucide-react";
import { toast } from "@counter/ui";
import { PageWrapper } from "@/components/page-wrapper";

interface ApprovalRequest {
  id: string;
  merchant: string;
  amount: string;
  description: string;
  requestedAt: string;
  expiresAt: string;
  risk: "low" | "medium" | "high";
}

const MOCK_APPROVALS: ApprovalRequest[] = [
  {
    id: "apr-001",
    merchant: "ShopEase",
    amount: "INR 8,750",
    description: "One-time purchase - Electronics",
    requestedAt: "2025-01-15 10:30",
    expiresAt: "2025-01-15 22:30",
    risk: "medium",
  },
  {
    id: "apr-002",
    merchant: "TravelBook",
    amount: "INR 45,000",
    description: "Flight booking - DEL to BLR",
    requestedAt: "2025-01-15 09:15",
    expiresAt: "2025-01-16 09:15",
    risk: "high",
  },
];

const RISK_VARIANT: Record<string, "success" | "warning" | "error"> = {
  low: "success",
  medium: "warning",
  high: "error",
};

export default function ApprovalsPage() {
  const handleApprove = (id: string) => {
    toast.success("Approval " + id + " confirmed");
  };

  const handleReject = (id: string) => {
    toast.error("Approval " + id + " rejected");
  };

  return (
    <PageWrapper>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Approvals</h1>
          <p className="mt-1 text-[var(--foreground-secondary)]">
            Review and authorize pending transaction requests.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-[var(--brand-orange)]" />
          <span className="text-sm text-[var(--foreground-secondary)]">
            <strong className="text-[var(--foreground)]">{MOCK_APPROVALS.length}</strong> pending
            approvals
          </span>
        </div>

        <div className="space-y-4">
          {MOCK_APPROVALS.map((approval) => (
            <Card
              key={approval.id}
              className="transition-all hover:border-[var(--brand-orange)]/20"
            >
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{approval.merchant}</CardTitle>
                  <Badge variant={RISK_VARIANT[approval.risk]}>{approval.risk} risk</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-[var(--foreground-muted)]">Amount</p>
                    <p className="font-mono font-semibold text-[var(--foreground)]">
                      {approval.amount}
                    </p>
                  </div>
                  <div>
                    <p className="text-[var(--foreground-muted)]">Description</p>
                    <p className="text-[var(--foreground)]">{approval.description}</p>
                  </div>
                  <div>
                    <p className="text-[var(--foreground-muted)]">Requested</p>
                    <p className="text-[var(--foreground)]">{approval.requestedAt}</p>
                  </div>
                  <div>
                    <p className="text-[var(--foreground-muted)]">Expires</p>
                    <p className="text-[var(--foreground)]">{approval.expiresAt}</p>
                  </div>
                </div>

                {approval.risk === "high" && (
                  <div className="flex items-center gap-2 rounded-lg bg-red-500/5 border border-red-500/20 px-3 py-2">
                    <AlertTriangle className="h-4 w-4 text-red-500" />
                    <span className="text-xs text-red-500">
                      High-value transaction requires additional verification
                    </span>
                  </div>
                )}

                <Separator />

                <div className="flex items-center justify-end gap-3">
                  <Button variant="outline" size="sm" onClick={() => handleReject(approval.id)}>
                    <XCircle className="mr-2 h-4 w-4" />
                    Reject
                  </Button>
                  <Button size="sm" onClick={() => handleApprove(approval.id)}>
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                    Approve
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </PageWrapper>
  );
}
