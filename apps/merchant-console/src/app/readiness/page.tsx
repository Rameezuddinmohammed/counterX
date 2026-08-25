/**
 * Readiness Checks & Scenario Runner screen.
 *
 * Displays readiness check results organized by category
 * (Blocking, AcceptedLimitation, Advisory, Expiring) and provides
 * the ability to trigger test scenarios.
 */

import type { ReadinessCategory, ReadinessCheck } from "../../lib/types.js";

const DEMO_CHECKS: readonly ReadinessCheck[] = [
  { checkId: "chk-001", name: "Shopify Store Connected", category: "Blocking", passed: true, message: "Store connected and syncing", detail: null, checkedAt: "2025-01-20T14:00:00Z" },
  { checkId: "chk-002", name: "Razorpay Credentials Valid", category: "Blocking", passed: true, message: "Test mode credentials verified", detail: null, checkedAt: "2025-01-20T14:00:00Z" },
  { checkId: "chk-003", name: "Product Mapping Complete", category: "Blocking", passed: false, message: "6 products unmapped", detail: "Resolve unmapped products before activation", checkedAt: "2025-01-20T14:00:00Z" },
  { checkId: "chk-004", name: "Multi-currency Support", category: "AcceptedLimitation", passed: true, message: "INR only (pilot limitation)", detail: "Multi-currency support planned for GA", checkedAt: "2025-01-20T14:00:00Z" },
  { checkId: "chk-005", name: "Webhook Delivery Rate", category: "Advisory", passed: true, message: "99.2% delivery rate (above 95% threshold)", detail: null, checkedAt: "2025-01-20T14:00:00Z" },
  { checkId: "chk-006", name: "Policy Version Alignment", category: "Advisory", passed: false, message: "Policy version 2 available, currently on v1", detail: "Review updated bilateral policies", checkedAt: "2025-01-20T14:00:00Z" },
  { checkId: "chk-007", name: "API Key Expiration", category: "Expiring", passed: true, message: "Key expires in 45 days", detail: "Renewal recommended before 2025-03-06", checkedAt: "2025-01-20T14:00:00Z" },
  { checkId: "chk-008", name: "TLS Certificate", category: "Expiring", passed: true, message: "Certificate valid for 90 days", detail: null, checkedAt: "2025-01-20T14:00:00Z" },
];

const DEMO_DATA = {
  merchantId: "merchant-pilot-001",
  overallReady: false,
  blockingCount: 1,
  advisoryCount: 1,
  checks: DEMO_CHECKS,
  lastRunAt: "2025-01-20T14:00:00Z",
};

function categoryStyle(category: ReadinessCategory): { bg: string; color: string; border: string } {
  switch (category) {
    case "Blocking": return { bg: "#fee2e2", color: "#991b1b", border: "#fca5a5" };
    case "AcceptedLimitation": return { bg: "#e0e7ff", color: "#3730a3", border: "#a5b4fc" };
    case "Advisory": return { bg: "#fef3c7", color: "#92400e", border: "#fcd34d" };
    case "Expiring": return { bg: "#f3e8ff", color: "#6b21a8", border: "#c4b5fd" };
  }
}

const CATEGORIES: readonly ReadinessCategory[] = ["Blocking", "AcceptedLimitation", "Advisory", "Expiring"];

export default function ReadinessPage() {
  const data = DEMO_DATA;

  return (
    <div>
      <h1>Readiness Checks</h1>
      <p style={{ color: "#666" }}>
        Evaluate merchant readiness for activation. All blocking issues must be resolved before the manifest can be activated.
      </p>

      {/* Overall Status */}
      <section style={{ marginTop: "24px", padding: "20px", border: "1px solid #e5e7eb", borderRadius: "8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div style={{ fontSize: "32px" }}>{data.overallReady ? "\u2705" : "\u26a0\ufe0f"}</div>
          <div>
            <div style={{ fontSize: "18px", fontWeight: 700 }}>
              {data.overallReady ? "Ready for Activation" : "Not Ready - Issues Detected"}
            </div>
            <div style={{ fontSize: "13px", color: "#6b7280" }}>
              {data.blockingCount} blocking | {data.advisoryCount} advisory | Last run: {data.lastRunAt}
            </div>
          </div>
        </div>
      </section>

      {/* Checks by Category */}
      {CATEGORIES.map((category) => {
        const checks = data.checks.filter((c) => c.category === category);
        if (checks.length === 0) return null;
        const style = categoryStyle(category);

        return (
          <section key={category} style={{ marginTop: "24px" }}>
            <h2 style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ padding: "4px 10px", borderRadius: "12px", fontSize: "12px", fontWeight: 700, backgroundColor: style.bg, color: style.color, border: `1px solid ${style.border}` }}>
                {category}
              </span>
              <span style={{ fontSize: "14px", color: "#6b7280", fontWeight: 400 }}>({checks.length} checks)</span>
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {checks.map((check) => (
                <div
                  key={check.checkId}
                  style={{
                    padding: "12px 16px",
                    border: `1px solid ${check.passed ? "#d1fae5" : "#fca5a5"}`,
                    borderRadius: "6px",
                    backgroundColor: check.passed ? "#fafff9" : "#fff5f5",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span>{check.passed ? "\u2705" : "\u274c"}</span>
                    <strong>{check.name}</strong>
                  </div>
                  <div style={{ marginLeft: "28px", fontSize: "13px", color: "#4b5563" }}>{check.message}</div>
                  {check.detail && (
                    <div style={{ marginLeft: "28px", fontSize: "12px", color: "#9ca3af", marginTop: "4px" }}>{check.detail}</div>
                  )}
                </div>
              ))}
            </div>
          </section>
        );
      })}

      {/* Scenario Runner */}
      <section style={{ marginTop: "32px", padding: "20px", border: "1px dashed #d1d5db", borderRadius: "8px" }}>
        <h2>Scenario Runner</h2>
        <p style={{ fontSize: "14px", color: "#6b7280" }}>
          Trigger test scenarios to validate merchant readiness under simulated conditions.
        </p>
        <div style={{ display: "flex", gap: "8px", marginTop: "12px", flexWrap: "wrap" }}>
          {["Full Purchase Flow", "Refund Scenario", "Dispute Resolution", "High Volume Test"].map((scenario) => (
            <button
              key={scenario}
              type="button"
              style={{
                padding: "8px 16px",
                border: "1px solid #d1d5db",
                borderRadius: "6px",
                backgroundColor: "#fff",
                cursor: "pointer",
                fontSize: "13px",
              }}
            >
              {scenario}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
