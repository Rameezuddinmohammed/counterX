"use client";

import { DataTable, Badge } from "@counter/ui";
import type { DataTableColumn } from "@counter/ui";
import { PageWrapper } from "@/components/page-wrapper";
import type { Transaction, TransactionState } from "@/lib/types";

const DEMO_TRANSACTIONS: Transaction[] = [
  { transactionId: "txn-001", merchantId: "merchant-pilot-001", amount: 1500, currency: "INR", currentState: "settled", buyerRef: "buyer-xyz-001", method: "upi", createdAt: "2025-01-20T10:00:00Z", transitions: [] },
  { transactionId: "txn-002", merchantId: "merchant-pilot-001", amount: 2499, currency: "INR", currentState: "refunded", buyerRef: "buyer-abc-002", method: "card", createdAt: "2025-01-19T16:00:00Z", transitions: [] },
  { transactionId: "txn-003", merchantId: "merchant-pilot-001", amount: 999, currency: "INR", currentState: "failed", buyerRef: "buyer-def-003", method: "netbanking", createdAt: "2025-01-20T12:00:00Z", transitions: [] },
];

function getStatusVariant(state: TransactionState) {
  switch (state) {
    case "settled": return "success" as const;
    case "captured":
    case "authorized": return "info" as const;
    case "refunded": return "warning" as const;
    case "failed":
    case "disputed": return "error" as const;
    default: return "secondary" as const;
  }
}

const columns: DataTableColumn<Record<string, unknown>>[] = [
  { key: "transactionId", header: "ID", cell: (item: any) => <span className="font-mono text-xs">{item.transactionId}</span> },
  { key: "amount", header: "Amount", cell: (item: any) => <span className="font-semibold">{item.currency} {item.amount.toLocaleString()}</span> },
  { key: "currentState", header: "Status", cell: (item: any) => <Badge variant={getStatusVariant(item.currentState)}>{item.currentState}</Badge> },
  { key: "createdAt", header: "Date", cell: (item: any) => <span className="text-[var(--foreground-secondary)]">{new Date(item.createdAt).toLocaleDateString()}</span> },
  { key: "method", header: "Method", cell: (item: any) => <span className="capitalize">{item.method}</span> },
];

export default function TransactionsPage() {
  return (
    <PageWrapper>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Transactions</h1>
          <p className="mt-1 text-[var(--foreground-secondary)]">View and monitor all transaction activity.</p>
        </div>
        <DataTable columns={columns} data={DEMO_TRANSACTIONS as any} emptyMessage="No transactions found" />
      </div>
    </PageWrapper>
  );
}
