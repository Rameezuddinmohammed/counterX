"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, Badge, Button, Input } from "@counter/ui";
import { ArrowLeftRight, Search, Filter } from "lucide-react";
import { PageWrapper } from "@/components/page-wrapper";

type TxStatus = "settled" | "pending" | "failed" | "refunded";

interface Transaction {
  id: string;
  merchant: string;
  amount: string;
  method: string;
  status: TxStatus;
  date: string;
}

const MOCK_TRANSACTIONS: Transaction[] = [
  {
    id: "txn-001",
    merchant: "MerchantCo",
    amount: "INR 2,500",
    method: "UPI",
    status: "settled",
    date: "2025-01-15",
  },
  {
    id: "txn-002",
    merchant: "StreamFlix",
    amount: "INR 499",
    method: "Mandate",
    status: "settled",
    date: "2025-01-14",
  },
  {
    id: "txn-003",
    merchant: "ShopEase",
    amount: "INR 8,750",
    method: "UPI",
    status: "pending",
    date: "2025-01-14",
  },
  {
    id: "txn-004",
    merchant: "CloudStore",
    amount: "INR 1,200",
    method: "UPI",
    status: "settled",
    date: "2025-01-13",
  },
  {
    id: "txn-005",
    merchant: "FoodDash",
    amount: "INR 350",
    method: "UPI",
    status: "refunded",
    date: "2025-01-12",
  },
  {
    id: "txn-006",
    merchant: "TechMart",
    amount: "INR 15,999",
    method: "Card",
    status: "failed",
    date: "2025-01-11",
  },
  {
    id: "txn-007",
    merchant: "GroceryHub",
    amount: "INR 890",
    method: "UPI",
    status: "settled",
    date: "2025-01-10",
  },
  {
    id: "txn-008",
    merchant: "RideNow",
    amount: "INR 245",
    method: "Mandate",
    status: "settled",
    date: "2025-01-10",
  },
];

const STATUS_VARIANT: Record<TxStatus, "success" | "warning" | "error" | "secondary"> = {
  settled: "success",
  pending: "warning",
  failed: "error",
  refunded: "secondary",
};

export default function TransactionsPage() {
  const [filter, setFilter] = useState<TxStatus | "all">("all");
  const [search, setSearch] = useState("");

  const filtered = MOCK_TRANSACTIONS.filter((tx) => {
    if (filter !== "all" && tx.status !== filter) return false;
    if (search && !tx.merchant.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <PageWrapper>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Transactions</h1>
          <p className="mt-1 text-[var(--foreground-secondary)]">
            View and filter your transaction history.
          </p>
        </div>

        {/* Filters */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--foreground-muted)]" />
            <Input
              placeholder="Search by merchant..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-[var(--foreground-muted)]" />
            {(["all", "settled", "pending", "failed", "refunded"] as const).map((status) => (
              <Button
                key={status}
                variant={filter === status ? "default" : "outline"}
                size="sm"
                onClick={() => setFilter(status)}
              >
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </Button>
            ))}
          </div>
        </div>

        {/* Transaction List */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ArrowLeftRight className="h-4 w-4" />
              Transaction History
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <ArrowLeftRight className="h-8 w-8 text-[var(--foreground-muted)] mb-3" />
                <p className="text-sm text-[var(--foreground-muted)]">
                  No transactions match your filters
                </p>
              </div>
            ) : (
              <div className="divide-y divide-[var(--border)]">
                <div className="grid grid-cols-5 gap-4 px-5 py-3 text-xs font-medium text-[var(--foreground-muted)] uppercase tracking-wider">
                  <span>Merchant</span>
                  <span>Amount</span>
                  <span>Method</span>
                  <span>Status</span>
                  <span>Date</span>
                </div>
                {filtered.map((tx) => (
                  <div
                    key={tx.id}
                    className="grid grid-cols-5 gap-4 px-5 py-3.5 items-center hover:bg-[var(--surface-secondary)] transition-colors"
                  >
                    <span className="text-sm font-medium text-[var(--foreground)]">
                      {tx.merchant}
                    </span>
                    <span className="text-sm font-mono text-[var(--foreground)]">{tx.amount}</span>
                    <span className="text-sm text-[var(--foreground-secondary)]">{tx.method}</span>
                    <Badge variant={STATUS_VARIANT[tx.status]}>{tx.status}</Badge>
                    <span className="text-sm text-[var(--foreground-muted)]">{tx.date}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </PageWrapper>
  );
}
