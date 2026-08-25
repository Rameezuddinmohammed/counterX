/**
 * Audit & Export screen.
 *
 * Displays immutable audit trail, export controls, and data
 * retention information.
 */

import type { AuditAction, AuditEntry } from "../../lib/types.js";

const DEMO_ENTRIES: readonly AuditEntry[] = [
  { entryId: "aud-001", merchantId: "merchant-pilot-001", action: "login", actor: "merchant@example.com", detail: "Console login from 192.168.1.x", timestamp: "2025-01-20T14:30:00Z", immutable: true },
  { entryId: "aud-002", merchantId: "merchant-pilot-001", action: "config_change", actor: "merchant@example.com", detail: "Updated Shopify webhook URL", timestamp: "2025-01-20T14:15:00Z", immutable: true },
  { entryId: "aud-003", merchantId: "merchant-pilot-001", action: "activation", actor: "system", detail: "Manifest v2 published for review", timestamp: "2025-01-20T12:00:00Z", immutable: true },
  { entryId: "aud-004", merchantId: "merchant-pilot-001", action: "kill_switch", actor: "ops-admin", detail: "Activated Global Reconciliation Pause (maintenance)", timestamp: "2025-01-20T09:00:00Z", immutable: true },
  { entryId: "aud-005", merchantId: "merchant-pilot-001", action: "config_change", actor: "merchant@example.com", detail: "Updated product mapping (v2 -> v3)", timestamp: "2025-01-19T16:00:00Z", immutable: true },
  { entryId: "aud-006", merchantId: "merchant-pilot-001", action: "export", actor: "merchant@example.com", detail: "Exported transaction data (2025-01-01 to 2025-01-19)", timestamp: "2025-01-19T11:00:00Z", immutable: true },
];

function actionStyle(action: AuditAction): { bg: string; color: string } {
  switch (action) {
    case "login": return { bg: "#f3f4f6", color: "#374151" };
    case "config_change": return { bg: "#dbeafe", color: "#1e40af" };
    case "activation": return { bg: "#d1fae5", color: "#065f46" };
    case "suspension": return { bg: "#fee2e2", color: "#991b1b" };
    case "kill_switch": return { bg: "#ffedd5", color: "#9a3412" };
    case "export": return { bg: "#e0e7ff", color: "#3730a3" };
    case "offboarding": return { bg: "#fce7f3", color: "#9d174d" };
  }
}

export default function AuditPage() {
  return (
    <div>
      <h1>Audit &amp; Export</h1>
      <p style={{ color: "#666" }}>
        Immutable audit trail of all merchant console actions. Records cannot be modified or deleted.
      </p>

      {/* Data Retention Info */}
      <section style={{ marginTop: "24px", padding: "16px", backgroundColor: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "8px" }}>
        <strong>Data Retention Policy:</strong> Audit records retained for 7 years in compliance with financial regulations.
        All entries are cryptographically signed and tamper-evident.
      </section>

      {/* Export Controls */}
      <section style={{ marginTop: "24px", padding: "20px", border: "1px solid #e5e7eb", borderRadius: "8px" }}>
        <h2 style={{ marginTop: 0 }}>Export Controls</h2>
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <label style={{ fontSize: "12px", color: "#6b7280", display: "block" }}>From</label>
            <input type="date" defaultValue="2025-01-01" style={{ padding: "6px 10px", border: "1px solid #d1d5db", borderRadius: "4px" }} />
          </div>
          <div>
            <label style={{ fontSize: "12px", color: "#6b7280", display: "block" }}>To</label>
            <input type="date" defaultValue="2025-01-20" style={{ padding: "6px 10px", border: "1px solid #d1d5db", borderRadius: "4px" }} />
          </div>
          <div>
            <label style={{ fontSize: "12px", color: "#6b7280", display: "block" }}>Format</label>
            <select style={{ padding: "6px 10px", border: "1px solid #d1d5db", borderRadius: "4px" }}>
              <option value="json">JSON</option>
              <option value="csv">CSV</option>
            </select>
          </div>
          <button
            type="button"
            style={{
              padding: "8px 20px",
              backgroundColor: "#2563eb",
              color: "#fff",
              border: "none",
              borderRadius: "6px",
              fontWeight: 600,
              cursor: "pointer",
              marginTop: "16px",
            }}
          >
            Export Audit Log
          </button>
        </div>
      </section>

      {/* Audit Trail */}
      <section style={{ marginTop: "24px" }}>
        <h2>Audit Trail</h2>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #e5e7eb", textAlign: "left" }}>
              <th style={{ padding: "8px" }}>Timestamp</th>
              <th style={{ padding: "8px" }}>Action</th>
              <th style={{ padding: "8px" }}>Actor</th>
              <th style={{ padding: "8px" }}>Detail</th>
              <th style={{ padding: "8px" }}>ID</th>
            </tr>
          </thead>
          <tbody>
            {DEMO_ENTRIES.map((entry) => {
              const style = actionStyle(entry.action);
              return (
                <tr key={entry.entryId} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={{ padding: "8px", fontSize: "13px", whiteSpace: "nowrap" }}>{entry.timestamp}</td>
                  <td style={{ padding: "8px" }}>
                    <span style={{ padding: "3px 8px", borderRadius: "10px", fontSize: "11px", fontWeight: 600, backgroundColor: style.bg, color: style.color }}>
                      {entry.action.replace("_", " ").toUpperCase()}
                    </span>
                  </td>
                  <td style={{ padding: "8px", fontSize: "13px" }}>{entry.actor}</td>
                  <td style={{ padding: "8px", fontSize: "13px", color: "#4b5563" }}>{entry.detail}</td>
                  <td style={{ padding: "8px", fontFamily: "monospace", fontSize: "11px", color: "#9ca3af" }}>{entry.entryId}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <p style={{ fontSize: "12px", color: "#9ca3af", marginTop: "16px" }}>
        Showing {DEMO_ENTRIES.length} entries. All records are immutable and cryptographically signed.
      </p>
    </div>
  );
}
