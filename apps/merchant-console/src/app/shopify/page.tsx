/**
 * Shopify Setup screen.
 *
 * Displays store connection status, credential validation, webhook
 * configuration, and synchronization status.
 */

const DEMO_DATA = {
  storeUrl: "pilot-store.myshopify.com",
  connectionState: "connected" as const,
  credentialsValid: true,
  webhooksConfigured: true,
  lastSyncAt: "2025-01-20T14:30:00Z",
  productCount: 47,
  orderCount: 12,
  errorMessage: null,
};

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "4px 10px",
        borderRadius: "12px",
        fontSize: "12px",
        fontWeight: 600,
        backgroundColor: ok ? "#d1fae5" : "#fee2e2",
        color: ok ? "#065f46" : "#991b1b",
      }}
    >
      {label}
    </span>
  );
}

export default function ShopifyPage() {
  const data = DEMO_DATA;

  return (
    <div>
      <h1>Shopify Setup</h1>
      <p style={{ color: "#666" }}>
        Monitor store connection, credentials, webhooks, and data synchronization.
      </p>

      {/* Connection Status */}
      <section style={{ marginTop: "24px" }}>
        <h2>Connection Status</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", maxWidth: "600px" }}>
          <div style={{ padding: "16px", border: "1px solid #e5e7eb", borderRadius: "8px" }}>
            <div style={{ fontSize: "12px", color: "#6b7280", marginBottom: "4px" }}>Store URL</div>
            <div style={{ fontFamily: "monospace", fontSize: "14px" }}>{data.storeUrl ?? "Not configured"}</div>
          </div>
          <div style={{ padding: "16px", border: "1px solid #e5e7eb", borderRadius: "8px" }}>
            <div style={{ fontSize: "12px", color: "#6b7280", marginBottom: "4px" }}>State</div>
            <StatusBadge ok={data.connectionState === "connected"} label={data.connectionState.toUpperCase()} />
          </div>
        </div>
      </section>

      {/* Validation Checks */}
      <section style={{ marginTop: "24px" }}>
        <h2>Validation Checks</h2>
        <table style={{ borderCollapse: "collapse", width: "100%", maxWidth: "600px" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #e5e7eb" }}>
              <th style={{ padding: "8px", textAlign: "left" }}>Check</th>
              <th style={{ padding: "8px", textAlign: "left" }}>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: "1px solid #f3f4f6" }}>
              <td style={{ padding: "8px" }}>API Credentials</td>
              <td style={{ padding: "8px" }}><StatusBadge ok={data.credentialsValid} label={data.credentialsValid ? "Valid" : "Invalid"} /></td>
            </tr>
            <tr style={{ borderBottom: "1px solid #f3f4f6" }}>
              <td style={{ padding: "8px" }}>Webhooks Configured</td>
              <td style={{ padding: "8px" }}><StatusBadge ok={data.webhooksConfigured} label={data.webhooksConfigured ? "Active" : "Missing"} /></td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* Sync Status */}
      <section style={{ marginTop: "24px" }}>
        <h2>Sync Status</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "16px", maxWidth: "600px" }}>
          <div style={{ padding: "16px", border: "1px solid #e5e7eb", borderRadius: "8px", textAlign: "center" }}>
            <div style={{ fontSize: "24px", fontWeight: 700 }}>{data.productCount}</div>
            <div style={{ fontSize: "12px", color: "#6b7280" }}>Products</div>
          </div>
          <div style={{ padding: "16px", border: "1px solid #e5e7eb", borderRadius: "8px", textAlign: "center" }}>
            <div style={{ fontSize: "24px", fontWeight: 700 }}>{data.orderCount}</div>
            <div style={{ fontSize: "12px", color: "#6b7280" }}>Orders</div>
          </div>
          <div style={{ padding: "16px", border: "1px solid #e5e7eb", borderRadius: "8px", textAlign: "center" }}>
            <div style={{ fontSize: "12px", color: "#6b7280", marginBottom: "4px" }}>Last Sync</div>
            <div style={{ fontSize: "13px" }}>{data.lastSyncAt ?? "Never"}</div>
          </div>
        </div>
      </section>

      {data.errorMessage && (
        <section style={{ marginTop: "24px", padding: "16px", backgroundColor: "#fee2e2", borderRadius: "8px" }}>
          <strong>Error:</strong> {data.errorMessage}
        </section>
      )}
    </div>
  );
}
