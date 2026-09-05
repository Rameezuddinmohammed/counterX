"use client";

import { DataTable, Badge, EmptyState, ErrorState, Skeleton } from "@counter/ui";
import type { DataTableColumn } from "@counter/ui";
import { Receipt } from "lucide-react";
import { PageWrapper } from "@/components/page-wrapper";
import { useApi, useCurrentMerchantId } from "@/hooks/use-api";
import type { Transaction, TransactionState } from "@/lib/types";

function getStatusVariant(state: TransactionState) {
  switch (state) {
    case "settled":
      return "success" as const;
    case "captured":
    case "authorized":
      return "info" as const;
    case "refunded":
      return "warning" as const;
    case "failed":
    case "disputed":
      return "error" as const;
    default:
      return "secondary" as const;
  }
}

const columns: DataTableColumn<Transaction>[] = [
  {
    key: "transactionId",
    header: "Transaction ID",
    cell: (item: Transaction) => (
      <span className="font-mono text-xs font-medium text-[var(--foreground)] bg-[var(--surface-secondary)] px-2.5 py-1 rounded-lg border border-[var(--border)]">
        {item.transactionId}
      </span>
    ),
  },
  {
    key: "amount",
    header: "Amount",
    cell: (item: Transaction) => (
      <span className="font-mono font-bold text-sm text-[var(--foreground)]">
        {item.currency === "INR" ? "₹" : `${item.currency} `}
        {item.amount.toLocaleString("en-IN")}
      </span>
    ),
  },
  {
    key: "currentState",
    header: "Clearance Status",
    cell: (item: Transaction) => (
      <Badge variant={getStatusVariant(item.currentState)} className="capitalize font-semibold">
        {item.currentState}
      </Badge>
    ),
  },
  {
    key: "createdAt",
    header: "Timestamp",
    cell: (item: Transaction) => (
      <span className="text-xs text-[var(--foreground-muted)] font-mono">
        {new Date(item.createdAt).toLocaleString("en-IN")}
      </span>
    ),
  },
  {
    key: "method",
    header: "Payment Rail",
    cell: (item: Transaction) => (
      <span className="capitalize text-xs font-semibold text-[var(--foreground-secondary)] bg-[var(--surface-secondary)] px-2 py-0.5 rounded-md border border-[var(--border)] font-mono">
        {item.method}
      </span>
    ),
  },
];

export default function TransactionsPage() {
  const { merchantId, loading: merchantLoading, error: merchantError } = useCurrentMerchantId();
  const {
    data,
    loading: transactionsLoading,
    error: transactionsError,
    refetch,
  } = useApi<readonly Transaction[]>(
    (client) =>
      merchantId
        ? client.listTransactions(merchantId)
        : Promise.resolve({ ok: true, data: [] as readonly Transaction[] }),
    [merchantId],
  );
  const loading = merchantLoading || transactionsLoading;
  const error = merchantError ?? transactionsError;

  return (
    <PageWrapper>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs uppercase font-bold tracking-wider text-cyan-600 dark:text-cyan-400">
                Audit Trail
              </span>
              <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-500 border border-indigo-500/30">
                CTP Verified
              </span>
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight text-[var(--foreground)]">
              Agent Transactions
            </h1>
            <p className="mt-1 text-sm text-[var(--foreground-secondary)]">
              Every autonomous AI agent purchase executed against your Shopify store catalog.
            </p>
          </div>
          {data && data.length > 0 && (
            <Badge variant="secondary" className="self-start sm:self-auto font-mono text-xs px-3 py-1">
              {data.length} Total Orders
            </Badge>
          )}
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
