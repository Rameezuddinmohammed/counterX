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
    header: "ID",
    cell: (item: Transaction) => <span className="font-mono text-xs">{item.transactionId}</span>,
  },
  {
    key: "amount",
    header: "Amount",
    cell: (item: Transaction) => (
      <span className="font-semibold">
        {item.currency} {item.amount.toLocaleString()}
      </span>
    ),
  },
  {
    key: "currentState",
    header: "Status",
    cell: (item: Transaction) => (
      <Badge variant={getStatusVariant(item.currentState)}>{item.currentState}</Badge>
    ),
  },
  {
    key: "createdAt",
    header: "Date",
    cell: (item: Transaction) => (
      <span className="text-[var(--foreground-secondary)]">
        {new Date(item.createdAt).toLocaleDateString()}
      </span>
    ),
  },
  {
    key: "method",
    header: "Method",
    cell: (item: Transaction) => <span className="capitalize">{item.method}</span>,
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
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Transactions</h1>
          <p className="mt-1 text-[var(--foreground-secondary)]">
            View and monitor all transaction activity.
          </p>
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
