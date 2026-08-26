"use client";

import { Card, CardContent, Button, Badge } from "@counter/ui";
import { XCircle, Clock } from "lucide-react";
import { PageWrapper } from "@/components/page-wrapper";

const MOCK_SESSIONS = [
  {
    grantId: "grant-001",
    operatorId: "op-admin-1",
    purpose: "Customer billing inquiry",
    targetScope: "merchant:m-42",
    permissions: ["view_transactions", "view_audit_log"],
    expiresAt: "2024-01-15T16:00:00Z",
    issuedAt: "2024-01-15T14:00:00Z",
  },
  {
    grantId: "grant-002",
    operatorId: "op-support-3",
    purpose: "Payment failure investigation",
    targetScope: "merchant:m-128",
    permissions: ["view_transactions", "retry_transaction"],
    expiresAt: "2024-01-15T15:30:00Z",
    issuedAt: "2024-01-15T14:30:00Z",
  },
];

export default function SupportSessionsPage() {
  return (
    <PageWrapper>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Support Sessions</h1>
          <p className="mt-1 text-[var(--foreground-secondary)]">
            Active support grants with scope, purpose, and permission tracking.
          </p>
        </div>

        {/* Sessions Table */}
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className="px-5 py-3 text-left font-medium text-[var(--foreground-muted)]">Grant ID</th>
                    <th className="px-5 py-3 text-left font-medium text-[var(--foreground-muted)]">Purpose</th>
                    <th className="px-5 py-3 text-left font-medium text-[var(--foreground-muted)]">Target</th>
                    <th className="px-5 py-3 text-left font-medium text-[var(--foreground-muted)]">Permissions</th>
                    <th className="px-5 py-3 text-left font-medium text-[var(--foreground-muted)]">Expiry</th>
                    <th className="px-5 py-3 text-left font-medium text-[var(--foreground-muted)]">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {MOCK_SESSIONS.map((session) => (
                    <tr key={session.grantId} className="hover:bg-[var(--surface-secondary)]/50 transition-colors">
                      <td className="px-5 py-3.5">
                        <code className="text-xs bg-[var(--surface-secondary)] px-1.5 py-0.5 rounded">
                          {session.grantId}
                        </code>
                      </td>
                      <td className="px-5 py-3.5 text-[var(--foreground)]">{session.purpose}</td>
                      <td className="px-5 py-3.5">
                        <code className="text-xs bg-[var(--surface-secondary)] px-1.5 py-0.5 rounded">
                          {session.targetScope}
                        </code>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex flex-wrap gap-1">
                          {session.permissions.map((perm) => (
                            <Badge key={perm} variant="secondary" className="text-[10px]">
                              {perm}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-1.5 text-[var(--foreground-muted)]">
                          <Clock className="h-3 w-3" />
                          <span className="text-xs">{new Date(session.expiresAt).toLocaleTimeString()}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <Button size="sm" variant="outline" className="flex items-center gap-1.5 text-red-500 border-red-500/20 hover:bg-red-500/10">
                          <XCircle className="h-3 w-3" />
                          Revoke
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </PageWrapper>
  );
}
