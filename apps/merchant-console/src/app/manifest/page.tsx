/**
 * Manifest Activation screen.
 *
 * Displays the current capability manifest, activation gates, and
 * publish controls for merchant capability management.
 */

import type { CapabilityGate, ManifestState } from "../../lib/types.js";

const DEMO_GATES: readonly CapabilityGate[] = [
  { gateId: "gate-001", name: "Readiness Checks Passed", satisfied: true, requiredFor: "payment_processing" },
  { gateId: "gate-002", name: "Policy Agreement Signed", satisfied: true, requiredFor: "payment_processing" },
  { gateId: "gate-003", name: "Shopify Integration Active", satisfied: true, requiredFor: "order_management" },
  { gateId: "gate-004", name: "Product Mapping Complete", satisfied: false, requiredFor: "order_management" },
  { gateId: "gate-005", name: "Razorpay Test Verified", satisfied: true, requiredFor: "payment_processing" },
  { gateId: "gate-006", name: "Webhook Delivery Stable", satisfied: true, requiredFor: "event_streaming" },
];

const DEMO_DATA = {
  manifestId: "manifest-pilot-001",
  merchantId: "merchant-pilot-001",
  state: "pending_activation" as ManifestState,
  version: 2,
  capabilities: ["payment_processing", "order_management", "refund_handling", "event_streaming", "reconciliation"],
  gates: DEMO_GATES,
  activatedAt: null,
  publishedAt: "2025-01-18T10:00:00Z",
};

function stateStyle(state: ManifestState): { bg: string; color: string } {
  switch (state) {
    case "draft": return { bg: "#f3f4f6", color: "#374151" };
    case "pending_activation": return { bg: "#fef3c7", color: "#92400e" };
    case "active": return { bg: "#d1fae5", color: "#065f46" };
    case "revoked": return { bg: "#fee2e2", color: "#991b1b" };
  }
}

export default function ManifestPage() {
  const data = DEMO_DATA;
  const style = stateStyle(data.state);
  const allGatesSatisfied = data.gates.every((g) => g.satisfied);

  return (
    <div>
      <h1>Manifest Activation</h1>
      <p style={{ color: "#666" }}>
        Manage capability manifest, review activation gates, and control publishing.
      </p>

      {/* Manifest Overview */}
      <section style={{ marginTop: "24px", padding: "20px", border: "1px solid #e5e7eb", borderRadius: "8px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
          <div>
            <div style={{ fontSize: "12px", color: "#6b7280" }}>Manifest ID</div>
            <div style={{ fontFamily: "monospace", fontSize: "14px" }}>{data.manifestId}</div>
          </div>
          <div>
            <div style={{ fontSize: "12px", color: "#6b7280" }}>Version</div>
            <div style={{ fontSize: "18px", fontWeight: 700 }}>v{data.version}</div>
          </div>
          <div>
            <div style={{ fontSize: "12px", color: "#6b7280" }}>State</div>
            <span style={{ padding: "6px 14px", borderRadius: "16px", fontSize: "12px", fontWeight: 700, backgroundColor: style.bg, color: style.color }}>
              {data.state.replace("_", " ").toUpperCase()}
            </span>
          </div>
          <div>
            <div style={{ fontSize: "12px", color: "#6b7280" }}>Published At</div>
            <div style={{ fontSize: "13px" }}>{data.publishedAt ?? "Not published"}</div>
          </div>
        </div>
      </section>

      {/* Capabilities */}
      <section style={{ marginTop: "24px" }}>
        <h2>Capabilities</h2>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {data.capabilities.map((cap) => (
            <span key={cap} style={{ padding: "6px 12px", border: "1px solid #e5e7eb", borderRadius: "16px", fontSize: "13px", fontFamily: "monospace" }}>
              {cap}
            </span>
          ))}
        </div>
      </section>

      {/* Activation Gates */}
      <section style={{ marginTop: "24px" }}>
        <h2>Activation Gates</h2>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #e5e7eb", textAlign: "left" }}>
              <th style={{ padding: "8px" }}>Gate</th>
              <th style={{ padding: "8px" }}>Required For</th>
              <th style={{ padding: "8px" }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {data.gates.map((gate) => (
              <tr key={gate.gateId} style={{ borderBottom: "1px solid #f3f4f6" }}>
                <td style={{ padding: "8px" }}>{gate.name}</td>
                <td style={{ padding: "8px", fontFamily: "monospace", fontSize: "12px" }}>{gate.requiredFor}</td>
                <td style={{ padding: "8px" }}>
                  <span style={{ padding: "3px 8px", borderRadius: "10px", fontSize: "11px", fontWeight: 600, backgroundColor: gate.satisfied ? "#d1fae5" : "#fee2e2", color: gate.satisfied ? "#065f46" : "#991b1b" }}>
                    {gate.satisfied ? "SATISFIED" : "PENDING"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Activation Control */}
      <section style={{ marginTop: "24px", padding: "20px", border: "1px dashed #d1d5db", borderRadius: "8px" }}>
        <h2>Activation Control</h2>
        {allGatesSatisfied ? (
          <div>
            <p style={{ color: "#065f46" }}>All gates satisfied. Manifest ready for activation.</p>
            <button type="button" style={{ padding: "10px 24px", backgroundColor: "#2563eb", color: "#fff", border: "none", borderRadius: "6px", fontWeight: 600, cursor: "pointer" }}>
              Activate Manifest
            </button>
          </div>
        ) : (
          <div>
            <p style={{ color: "#92400e" }}>
              {data.gates.filter((g) => !g.satisfied).length} gate(s) unsatisfied. Resolve before activation.
            </p>
            <button type="button" disabled style={{ padding: "10px 24px", backgroundColor: "#e5e7eb", color: "#9ca3af", border: "none", borderRadius: "6px", fontWeight: 600, cursor: "not-allowed" }}>
              Activate Manifest
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
