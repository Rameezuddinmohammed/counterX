/**
 * Suspension & Offboarding screen.
 *
 * Provides controls for merchant suspension and structured
 * offboarding flow with step-by-step progress visualization.
 */

import type { OffboardingStep, SuspensionReason } from "../../lib/types.js";

const OFFBOARDING_STEPS: readonly OffboardingStep[] = [
  "initiated",
  "data_export",
  "payment_settlement",
  "webhook_removal",
  "credential_revocation",
  "completed",
];

const STEP_LABELS: Record<OffboardingStep, string> = {
  initiated: "Initiated",
  data_export: "Data Export",
  payment_settlement: "Payment Settlement",
  webhook_removal: "Webhook Removal",
  credential_revocation: "Credential Revocation",
  completed: "Completed",
};

const DEMO_DATA = {
  merchantId: "merchant-pilot-001",
  suspended: false,
  suspendedAt: null,
  reason: null as SuspensionReason | null,
  suspendedBy: null,
  offboardingStep: null as OffboardingStep | null,
  offboardingStartedAt: null,
};

const SUSPENSION_REASONS: readonly { value: SuspensionReason; label: string }[] = [
  { value: "policy_violation", label: "Policy Violation" },
  { value: "kill_switch", label: "Kill Switch Activated" },
  { value: "manual", label: "Manual Suspension" },
  { value: "reconciliation_failure", label: "Reconciliation Failure" },
  { value: "inactivity", label: "Inactivity" },
];

export default function SuspensionPage() {
  const data = DEMO_DATA;

  return (
    <div>
      <h1>Suspension &amp; Offboarding</h1>
      <p style={{ color: "#666" }}>
        Manage merchant suspension status and initiate structured offboarding when needed.
      </p>

      {/* Current Status */}
      <section style={{ marginTop: "24px", padding: "20px", border: "1px solid #e5e7eb", borderRadius: "8px" }}>
        <h2 style={{ marginTop: 0 }}>Current Status</h2>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={{
            padding: "6px 14px",
            borderRadius: "16px",
            fontSize: "13px",
            fontWeight: 700,
            backgroundColor: data.suspended ? "#fee2e2" : "#d1fae5",
            color: data.suspended ? "#991b1b" : "#065f46",
          }}>
            {data.suspended ? "SUSPENDED" : "ACTIVE"}
          </span>
          {data.suspended && data.reason && (
            <span style={{ fontSize: "13px", color: "#6b7280" }}>
              Reason: {data.reason} | By: {data.suspendedBy} | Since: {data.suspendedAt}
            </span>
          )}
        </div>
      </section>

      {/* Suspension Controls */}
      <section style={{ marginTop: "24px", padding: "20px", border: "1px solid #fca5a5", borderRadius: "8px", backgroundColor: "#fef2f2" }}>
        <h2 style={{ marginTop: 0, color: "#991b1b" }}>Suspension Controls</h2>
        <p style={{ fontSize: "14px", color: "#4b5563" }}>
          Suspending a merchant immediately halts all processing. The merchant will be notified.
        </p>
        <div style={{ display: "flex", gap: "12px", alignItems: "flex-end", flexWrap: "wrap", marginTop: "12px" }}>
          <div>
            <label style={{ fontSize: "12px", color: "#6b7280", display: "block", marginBottom: "4px" }}>Reason</label>
            <select style={{ padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: "6px", minWidth: "200px" }}>
              {SUSPENSION_REASONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            style={{
              padding: "10px 24px",
              backgroundColor: data.suspended ? "#10b981" : "#dc2626",
              color: "#fff",
              border: "none",
              borderRadius: "6px",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {data.suspended ? "Lift Suspension" : "Suspend Merchant"}
          </button>
        </div>
      </section>

      {/* Offboarding Flow */}
      <section style={{ marginTop: "32px" }}>
        <h2>Offboarding Flow</h2>
        <p style={{ fontSize: "14px", color: "#6b7280" }}>
          Structured offboarding ensures all data is exported, payments settled, and credentials revoked before completing merchant removal.
        </p>

        {/* Step Visualization */}
        <div style={{ marginTop: "16px", display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap" }}>
          {OFFBOARDING_STEPS.map((step, idx) => {
            const currentIdx = data.offboardingStep ? OFFBOARDING_STEPS.indexOf(data.offboardingStep) : -1;
            const isPast = idx < currentIdx;
            const isCurrent = idx === currentIdx;

            return (
              <div key={step} style={{ display: "flex", alignItems: "center" }}>
                <div
                  style={{
                    padding: "10px 16px",
                    borderRadius: "6px",
                    backgroundColor: isCurrent ? "#2563eb" : isPast ? "#10b981" : "#f3f4f6",
                    color: isCurrent || isPast ? "#fff" : "#6b7280",
                    fontSize: "12px",
                    fontWeight: isCurrent ? 700 : 400,
                  }}
                >
                  {STEP_LABELS[step]}
                </div>
                {idx < OFFBOARDING_STEPS.length - 1 && (
                  <span style={{ margin: "0 2px", color: "#d1d5db" }}>&rarr;</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Initiate Offboarding */}
        <div style={{ marginTop: "24px", padding: "16px", border: "1px dashed #d1d5db", borderRadius: "8px" }}>
          {data.offboardingStep ? (
            <div>
              <p style={{ fontWeight: 600 }}>Offboarding in progress: {STEP_LABELS[data.offboardingStep]}</p>
              <p style={{ fontSize: "13px", color: "#6b7280" }}>
                Started: {data.offboardingStartedAt}
              </p>
            </div>
          ) : (
            <div>
              <p style={{ fontSize: "14px", color: "#4b5563" }}>
                Initiate offboarding to begin the structured merchant removal process.
                This action cannot be undone once payment settlement begins.
              </p>
              <button
                type="button"
                style={{
                  padding: "10px 24px",
                  backgroundColor: "#7c3aed",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                  fontWeight: 700,
                  cursor: "pointer",
                  marginTop: "8px",
                }}
              >
                Initiate Offboarding
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
