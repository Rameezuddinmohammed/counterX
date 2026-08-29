"use client";

import { DataTable, Badge, EmptyState, ErrorState, Skeleton } from "@counter/ui";
import type { DataTableColumn } from "@counter/ui";
import { Receipt } from "lucide-react";
import { PageWrapper } from "@/components/page-wrapper";
import { useApi } from "@/hooks/use-api";
import type { Transaction, TransactionState } from "@/lib/types";

// The merchant scope is enforced server-side from the authenticated token; the
// merchantId here only selects which merchant path to request. It is sourced
// from NEXT_PUBLIC_MERCHANT_ID, falling back to the SAME pilot merchant id the
// worker derives by default in apps/worker/src/boot.ts's pilotMerchantId()
// (createCounterId("merchant", new Uint8Array(16).fill(7))). These two values
// must agree — a real (`ctr_merchant_...`), not human-readable, id — or
// transactions the worker records will never match what this page queries.
// If you change the worker's derivation, update this fallback too, or set
// PILOT_MERCHANT_ID (worker) and NEXT_PUBLIC_MERCHANT_ID (this console) to the
// same explicit value on both sides instead.
const MERCHANT_ID = process.env["NEXT_PUBLIC_MERCHANT_ID"] ?? "ctr_merchant_BwcHBwcHBwcHBwcHBwcHBw";

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

const columns: DataTableColumn<Transaction>[] = [
  { key: "transactionId", header: "ID", cell: (item: Transaction) => <span className="font-mono text-xs">{item.transactionId}</span> },
  { key: "amount", header: "Amount", cell: (item: Transaction) => <span className="font-semibold">{item.currency} {item.amount.toLocaleString()}</span> },
  { key: "currentState", header: "Status", cell: (item: Transaction) => <Badge variant={getStatusVariant(item.currentState)}>{item.currentState}</Badge> },
  { key: "createdAt", header: "Date", cell: (item: Transaction) => <span className="text-[var(--foreground-secondary)]">{new Date(item.createdAt).toLocaleDateString()}</span> },
  { key: "method", header: "Method", cell: (item: Transaction) => <span className="capitalize">{item.method}</span> },
];

export default function TransactionsPage() {
  const { data, loading, error, refetch } = useApi<readonly Transaction[]>(
    (client) => client.listTransactions(MERCHANT_ID),
    [MERCHANT_ID],
  );

  return (
    <PageWrapper>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Transactions</h1>
          <p className="mt-1 text-[var(--foreground-secondary)]">View and monitor all transaction activity.</p>
        </div>
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : error ? (
          <ErrorState message={error} onRetry={refetch} />
        ) : data && data.length === 0 ? (
          <EmptyState
            icon={<Receipt />}
            title="No transactions yet"
            description="Transactions will appear here once buyers start checking out."
          />
        ) : (
          <DataTable
            columns={columns as unknown as DataTableColumn<Record<string, unknown>>[]}
            data={(data ?? []) as unknown as Record<string, unknown>[]}
            emptyMessage="No transactions found"
          />
        )}
      </div>
    </PageWrapper>
  );
}
