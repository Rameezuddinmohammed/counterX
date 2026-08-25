/**
 * Mapping Preview screen.
 *
 * Displays product catalog mapping from Shopify to Counter format,
 * including version diffs and mapping conflict detection.
 */

import type { MappingEntry } from "../../lib/types.js";

const DEMO_ENTRIES: readonly MappingEntry[] = [
  { shopifyProductId: "gid://shopify/Product/001", shopifyTitle: "Organic Cotton T-Shirt", counterSku: "SKU-TEE-001", counterCategory: "apparel", status: "mapped" },
  { shopifyProductId: "gid://shopify/Product/002", shopifyTitle: "Recycled Denim Jeans", counterSku: "SKU-JNS-002", counterCategory: "apparel", status: "mapped" },
  { shopifyProductId: "gid://shopify/Product/003", shopifyTitle: "Eco Tote Bag", counterSku: "", counterCategory: "", status: "unmapped" },
  { shopifyProductId: "gid://shopify/Product/004", shopifyTitle: "Bamboo Water Bottle", counterSku: "SKU-BTL-004", counterCategory: "accessories", status: "conflict" },
  { shopifyProductId: "gid://shopify/Product/005", shopifyTitle: "Hemp Backpack", counterSku: "SKU-BAG-005", counterCategory: "accessories", status: "mapped" },
];

const DEMO_DATA = {
  totalProducts: 47,
  mappedCount: 38,
  unmappedCount: 6,
  conflictCount: 3,
  entries: DEMO_ENTRIES,
  lastUpdatedAt: "2025-01-20T12:00:00Z",
  version: 3,
};

function statusColor(status: MappingEntry["status"]): string {
  switch (status) {
    case "mapped": return "#065f46";
    case "unmapped": return "#92400e";
    case "conflict": return "#991b1b";
  }
}

function statusBg(status: MappingEntry["status"]): string {
  switch (status) {
    case "mapped": return "#d1fae5";
    case "unmapped": return "#fef3c7";
    case "conflict": return "#fee2e2";
  }
}

export default function MappingPage() {
  const data = DEMO_DATA;

  return (
    <div>
      <h1>Mapping Preview</h1>
      <p style={{ color: "#666" }}>
        Product catalog mapping from Shopify to Counter format. Version {data.version}.
      </p>

      {/* Summary */}
      <section style={{ marginTop: "24px" }}>
        <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
          <div style={{ padding: "16px 24px", border: "1px solid #e5e7eb", borderRadius: "8px" }}>
            <div style={{ fontSize: "28px", fontWeight: 700 }}>{data.totalProducts}</div>
            <div style={{ fontSize: "12px", color: "#6b7280" }}>Total Products</div>
          </div>
          <div style={{ padding: "16px 24px", border: "1px solid #d1fae5", borderRadius: "8px", backgroundColor: "#f0fdf4" }}>
            <div style={{ fontSize: "28px", fontWeight: 700, color: "#065f46" }}>{data.mappedCount}</div>
            <div style={{ fontSize: "12px", color: "#6b7280" }}>Mapped</div>
          </div>
          <div style={{ padding: "16px 24px", border: "1px solid #fef3c7", borderRadius: "8px", backgroundColor: "#fffbeb" }}>
            <div style={{ fontSize: "28px", fontWeight: 700, color: "#92400e" }}>{data.unmappedCount}</div>
            <div style={{ fontSize: "12px", color: "#6b7280" }}>Unmapped</div>
          </div>
          <div style={{ padding: "16px 24px", border: "1px solid #fee2e2", borderRadius: "8px", backgroundColor: "#fef2f2" }}>
            <div style={{ fontSize: "28px", fontWeight: 700, color: "#991b1b" }}>{data.conflictCount}</div>
            <div style={{ fontSize: "12px", color: "#6b7280" }}>Conflicts</div>
          </div>
        </div>
      </section>

      {/* Mapping Table */}
      <section style={{ marginTop: "24px" }}>
        <h2>Product Mappings</h2>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #e5e7eb", textAlign: "left" }}>
              <th style={{ padding: "8px" }}>Shopify Product</th>
              <th style={{ padding: "8px" }}>Counter SKU</th>
              <th style={{ padding: "8px" }}>Category</th>
              <th style={{ padding: "8px" }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {data.entries.map((entry) => (
              <tr key={entry.shopifyProductId} style={{ borderBottom: "1px solid #f3f4f6" }}>
                <td style={{ padding: "8px" }}>
                  <div style={{ fontWeight: 500 }}>{entry.shopifyTitle}</div>
                  <div style={{ fontSize: "11px", color: "#9ca3af", fontFamily: "monospace" }}>{entry.shopifyProductId}</div>
                </td>
                <td style={{ padding: "8px", fontFamily: "monospace", fontSize: "13px" }}>{entry.counterSku || "-"}</td>
                <td style={{ padding: "8px" }}>{entry.counterCategory || "-"}</td>
                <td style={{ padding: "8px" }}>
                  <span style={{ padding: "3px 8px", borderRadius: "10px", fontSize: "11px", fontWeight: 600, backgroundColor: statusBg(entry.status), color: statusColor(entry.status) }}>
                    {entry.status.toUpperCase()}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ fontSize: "12px", color: "#9ca3af", marginTop: "8px" }}>
          Last updated: {data.lastUpdatedAt}
        </p>
      </section>
    </div>
  );
}
