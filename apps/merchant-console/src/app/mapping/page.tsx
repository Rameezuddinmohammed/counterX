"use client";

import { Card, CardContent, Badge, DataTable } from "@counter/ui";
import type { DataTableColumn } from "@counter/ui";
import { ArrowLeftRight } from "lucide-react";
import { PageWrapper } from "@/components/page-wrapper";
import type { MappingEntry } from "@/lib/types";

const DEMO_ENTRIES: MappingEntry[] = [
  { shopifyProductId: "sp-001", shopifyTitle: "Premium Widget", counterSku: "CX-WDG-001", counterCategory: "Electronics", status: "mapped" },
  { shopifyProductId: "sp-002", shopifyTitle: "Basic Gadget", counterSku: "CX-GDG-002", counterCategory: "Electronics", status: "mapped" },
  { shopifyProductId: "sp-003", shopifyTitle: "Custom Service Plan", counterSku: "", counterCategory: "", status: "unmapped" },
  { shopifyProductId: "sp-004", shopifyTitle: "Deluxe Bundle", counterSku: "CX-BDL-004", counterCategory: "Bundles", status: "conflict" },
  { shopifyProductId: "sp-005", shopifyTitle: "Standard Widget", counterSku: "CX-WDG-005", counterCategory: "Electronics", status: "mapped" },
];

function getStatusVariant(status: MappingEntry["status"]) {
  switch (status) { case "mapped": return "success" as const; case "unmapped": return "warning" as const; case "conflict": return "error" as const; }
}

const columns: DataTableColumn<MappingEntry>[] = [
  { key: "shopifyTitle", header: "Shopify Product", cell: (item: MappingEntry) => <div><p className="font-medium text-[var(--foreground)]">{item.shopifyTitle}</p><p className="text-xs text-[var(--foreground-muted)]">{item.shopifyProductId}</p></div> },
  { key: "counterSku", header: "Counter SKU", cell: (item: MappingEntry) => <span className="font-mono text-sm">{item.counterSku || "---"}</span> },
  { key: "counterCategory", header: "Category", cell: (item: MappingEntry) => <span>{item.counterCategory || "---"}</span> },
  { key: "status", header: "Status", cell: (item: MappingEntry) => <Badge variant={getStatusVariant(item.status)}>{item.status}</Badge> },
];

export default function MappingPage() {
  const mapped = DEMO_ENTRIES.filter((e) => e.status === "mapped").length;
  const total = DEMO_ENTRIES.length;
  const progress = Math.round((mapped / total) * 100);

  return (
    <PageWrapper>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Mapping Preview</h1>
          <p className="mt-1 text-[var(--foreground-secondary)]">Product mapping between Shopify and Counter platform.</p>
        </div>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-[var(--brand-orange)]/10 p-2"><ArrowLeftRight className="h-5 w-5 text-[var(--brand-orange)]" /></div>
                <div><p className="font-medium text-[var(--foreground)]">Mapping Progress</p><p className="text-sm text-[var(--foreground-muted)]">{mapped} of {total} products mapped</p></div>
              </div>
              <span className="text-2xl font-bold text-[var(--brand-orange)]">{progress}%</span>
            </div>
            <div className="h-2 rounded-full bg-[var(--surface-secondary)] overflow-hidden">
              <div className="h-full rounded-full bg-[var(--brand-orange)] transition-all duration-500" style={{ width: `${progress}%` }} />
            </div>
          </CardContent>
        </Card>
        <DataTable columns={columns as unknown as DataTableColumn<Record<string, unknown>>[]} data={DEMO_ENTRIES as unknown as Record<string, unknown>[]} emptyMessage="No mapping entries found" />
      </div>
    </PageWrapper>
  );
}
