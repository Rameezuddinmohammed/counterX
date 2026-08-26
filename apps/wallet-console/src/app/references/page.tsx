"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, Badge, Input } from "@counter/ui";
import { BookOpen, Search } from "lucide-react";
import { PageWrapper } from "@/components/page-wrapper";

interface ReferenceItem {
  id: string;
  key: string;
  value: string;
  category: string;
  updatedAt: string;
}

const MOCK_REFERENCES: ReferenceItem[] = [
  { id: "ref-001", key: "wallet.max_daily_limit", value: "100000", category: "Limits", updatedAt: "2025-01-10" },
  { id: "ref-002", key: "wallet.cooling_period_hours", value: "24", category: "Security", updatedAt: "2025-01-08" },
  { id: "ref-003", key: "wallet.trusted_merchant_threshold", value: "20", category: "Trust", updatedAt: "2025-01-05" },
  { id: "ref-004", key: "wallet.max_devices", value: "5", category: "Devices", updatedAt: "2025-01-01" },
  { id: "ref-005", key: "wallet.mandate_max_amount", value: "50000", category: "Limits", updatedAt: "2025-01-01" },
  { id: "ref-006", key: "wallet.session_timeout_minutes", value: "30", category: "Security", updatedAt: "2024-12-20" },
  { id: "ref-007", key: "wallet.auto_approve_threshold", value: "1000", category: "Trust", updatedAt: "2024-12-15" },
];

export default function ReferencesPage() {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const categories = Array.from(new Set(MOCK_REFERENCES.map((r) => r.category)));
  const filtered = MOCK_REFERENCES.filter((ref) => {
    if (categoryFilter !== "all" && ref.category !== categoryFilter) return false;
    if (search && !ref.key.toLowerCase().includes(search.toLowerCase()) && !ref.value.includes(search)) return false;
    return true;
  });

  return (
    <PageWrapper>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">References</h1>
          <p className="mt-1 text-[var(--foreground-secondary)]">
            Configuration reference data used by wallet policies and triggers.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--foreground-muted)]" />
            <Input placeholder="Search references..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button className={"rounded-md px-3 py-1.5 text-xs font-medium transition-colors " + (categoryFilter === "all" ? "bg-[var(--brand-orange)] text-white" : "bg-[var(--surface-secondary)] text-[var(--foreground-muted)] hover:text-[var(--foreground)]")} onClick={() => setCategoryFilter("all")}>All</button>
            {categories.map((cat) => (
              <button key={cat} className={"rounded-md px-3 py-1.5 text-xs font-medium transition-colors " + (categoryFilter === cat ? "bg-[var(--brand-orange)] text-white" : "bg-[var(--surface-secondary)] text-[var(--foreground-muted)] hover:text-[var(--foreground)]")} onClick={() => setCategoryFilter(cat)}>{cat}</button>
            ))}
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="h-4 w-4" />
              Reference Data
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <BookOpen className="h-8 w-8 text-[var(--foreground-muted)] mb-3" />
                <p className="text-sm text-[var(--foreground-muted)]">No references match your search</p>
              </div>
            ) : (
              <div className="divide-y divide-[var(--border)]">
                <div className="grid grid-cols-4 gap-4 px-5 py-3 text-xs font-medium text-[var(--foreground-muted)] uppercase tracking-wider">
                  <span>Key</span>
                  <span>Value</span>
                  <span>Category</span>
                  <span>Updated</span>
                </div>
                {filtered.map((ref) => (
                  <div key={ref.id} className="grid grid-cols-4 gap-4 px-5 py-3.5 items-center hover:bg-[var(--surface-secondary)] transition-colors">
                    <span className="text-sm font-mono text-[var(--foreground)]">{ref.key}</span>
                    <span className="text-sm font-mono font-medium text-[var(--brand-orange)]">{ref.value}</span>
                    <Badge variant="secondary">{ref.category}</Badge>
                    <span className="text-sm text-[var(--foreground-muted)]">{ref.updatedAt}</span>
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
