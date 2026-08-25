/**
 * Kill Switches screen.
 *
 * Provides toggle controls for merchant and global kill switches
 * with immediate suspension capability.
 */

import type { KillSwitchState } from "../../lib/types.js";

const DEMO_SWITCHES: readonly KillSwitchState[] = [
  {
    switchId: "ks-001",
    name: "Merchant Payment Processing",
    scope: "merchant",
    active: false,
    activatedBy: null,
    activatedAt: null,
    reason: null,
    affectedMerchants: ["merchant-pilot-001"],
  },
  {
    switchId: "ks-002",
    name: "Merchant Order Ingestion",
    scope: "merchant",
    active: false,
    activatedBy: null,
    activatedAt: null,
    reason: null,
    affectedMerchants: ["merchant-pilot-001"],
  },
  {
    switchId: "ks-003",
    name: "Global Payment Halt",
    scope: "global",
    active: false,
    activatedBy: null,
    activatedAt: null,
    reason: null,
    affectedMerchants: [],
  },
  {
    switchId: "ks-004",
    name: "Global Reconciliation Pause",
    scope: "global",
    active: true,
    activatedBy: "ops-admin",
    activatedAt: "2025-01-20T09:00:00Z",
    reason: "Scheduled maintenance window",
    affectedMerchants: [],
  },
];

export default function KillSwitchPage() {
  return (
    <div>
      <h1>Kill Switches</h1>
      <p style={{ color: "#666" }}>
        Immediate suspension controls for merchant-level and global operations.
        Activating a kill switch takes effect immediately.
      </p>

      {/* Warning Banner */}
      <div style={{ marginTop: "24px", padding: "12px 16px", backgroundColor: "#fee2e2", borderRadius: "8px", border: "1px solid #fca5a5" }}>
        <strong style={{ color: "#991b1b" }}>Caution:</strong>
        <span style={{ color: "#991b1b", marginLeft: "8px" }}>Kill switches take immediate effect. Ensure proper authorization before activation.</span>
      </div>

      {/* Merchant Switches */}
      <section style={{ marginTop: "24px" }}>
        <h2>Merchant Kill Switches</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {DEMO_SWITCHES.filter((s) => s.scope === "merchant").map((sw) => (
            <div
              key={sw.switchId}
              style={{
                padding: "16px",
                border: `1px solid ${sw.active ? "#fca5a5" : "#e5e7eb"}`,
                borderRadius: "8px",
                backgroundColor: sw.active ? "#fef2f2" : "#fff",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{sw.name}</div>
                  <div style={{ fontSize: "12px", color: "#6b7280", fontFamily: "monospace" }}>{sw.switchId}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <span style={{
                    padding: "4px 10px",
                    borderRadius: "12px",
                    fontSize: "12px",
                    fontWeight: 700,
                    backgroundColor: sw.active ? "#fee2e2" : "#d1fae5",
                    color: sw.active ? "#991b1b" : "#065f46",
                  }}>
                    {sw.active ? "ACTIVE" : "INACTIVE"}
                  </span>
                  <button
                    type="button"
                    style={{
                      padding: "6px 14px",
                      border: "none",
                      borderRadius: "6px",
                      fontWeight: 600,
                      fontSize: "12px",
                      cursor: "pointer",
                      backgroundColor: sw.active ? "#10b981" : "#ef4444",
                      color: "#fff",
                    }}
                  >
                    {sw.active ? "Deactivate" : "Activate"}
                  </button>
                </div>
              </div>
              {sw.active && sw.reason && (
                <div style={{ marginTop: "8px", fontSize: "13px", color: "#991b1b" }}>
                  Reason: {sw.reason} | By: {sw.activatedBy} | At: {sw.activatedAt}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Global Switches */}
      <section style={{ marginTop: "32px" }}>
        <h2>Global Kill Switches</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {DEMO_SWITCHES.filter((s) => s.scope === "global").map((sw) => (
            <div
              key={sw.switchId}
              style={{
                padding: "16px",
                border: `1px solid ${sw.active ? "#fca5a5" : "#e5e7eb"}`,
                borderRadius: "8px",
                backgroundColor: sw.active ? "#fef2f2" : "#fff",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{sw.name}</div>
                  <div style={{ fontSize: "12px", color: "#6b7280", fontFamily: "monospace" }}>{sw.switchId}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <span style={{
                    padding: "4px 10px",
                    borderRadius: "12px",
                    fontSize: "12px",
                    fontWeight: 700,
                    backgroundColor: sw.active ? "#fee2e2" : "#d1fae5",
                    color: sw.active ? "#991b1b" : "#065f46",
                  }}>
                    {sw.active ? "ACTIVE" : "INACTIVE"}
                  </span>
                  <button
                    type="button"
                    style={{
                      padding: "6px 14px",
                      border: "none",
                      borderRadius: "6px",
                      fontWeight: 600,
                      fontSize: "12px",
                      cursor: "pointer",
                      backgroundColor: sw.active ? "#10b981" : "#ef4444",
                      color: "#fff",
                    }}
                  >
                    {sw.active ? "Deactivate" : "Activate"}
                  </button>
                </div>
              </div>
              {sw.active && sw.reason && (
                <div style={{ marginTop: "8px", fontSize: "13px", color: "#991b1b" }}>
                  Reason: {sw.reason} | By: {sw.activatedBy} | At: {sw.activatedAt}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Immediate Suspension Control */}
      <section style={{ marginTop: "32px", padding: "20px", border: "2px solid #fca5a5", borderRadius: "8px", backgroundColor: "#fef2f2" }}>
        <h2 style={{ color: "#991b1b", marginTop: 0 }}>Immediate Suspension</h2>
        <p style={{ fontSize: "14px", color: "#4b5563" }}>
          Immediately suspend all merchant operations. This activates all merchant kill switches simultaneously.
        </p>
        <button
          type="button"
          style={{
            padding: "10px 24px",
            backgroundColor: "#dc2626",
            color: "#fff",
            border: "none",
            borderRadius: "6px",
            fontWeight: 700,
            cursor: "pointer",
            fontSize: "14px",
          }}
        >
          Suspend All Operations
        </button>
      </section>
    </div>
  );
}
