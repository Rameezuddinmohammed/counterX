/**
 * Invitation & Lifecycle screen.
 *
 * Displays merchant invitation status, acceptance flow, and lifecycle
 * state machine visualization showing the current phase.
 */

import type { LifecyclePhase } from "../../lib/types.js";

const LIFECYCLE_PHASES: readonly LifecyclePhase[] = [
  "invited",
  "accepted",
  "onboarding",
  "active",
  "suspended",
  "offboarded",
];

/** Placeholder data for the pilot UI */
const DEMO_DATA = {
  merchantId: "merchant-pilot-001",
  email: "merchant@example.com",
  invitedAt: "2025-01-15T10:00:00Z",
  acceptedAt: "2025-01-15T11:30:00Z",
  phase: "onboarding" as LifecyclePhase,
  expiresAt: null,
};

export default function InvitePage() {
  const data = DEMO_DATA;

  return (
    <div>
      <h1>Invitation &amp; Lifecycle</h1>
      <p style={{ color: "#666" }}>
        Manage merchant invitation status and track lifecycle progression.
      </p>

      {/* Invitation Details */}
      <section style={{ marginTop: "24px" }}>
        <h2>Invitation Details</h2>
        <table style={{ borderCollapse: "collapse", width: "100%", maxWidth: "600px" }}>
          <tbody>
            <tr>
              <td style={{ padding: "8px", fontWeight: 600, borderBottom: "1px solid #eee" }}>Merchant ID</td>
              <td style={{ padding: "8px", borderBottom: "1px solid #eee", fontFamily: "monospace" }}>{data.merchantId}</td>
            </tr>
            <tr>
              <td style={{ padding: "8px", fontWeight: 600, borderBottom: "1px solid #eee" }}>Email</td>
              <td style={{ padding: "8px", borderBottom: "1px solid #eee" }}>{data.email}</td>
            </tr>
            <tr>
              <td style={{ padding: "8px", fontWeight: 600, borderBottom: "1px solid #eee" }}>Invited At</td>
              <td style={{ padding: "8px", borderBottom: "1px solid #eee" }}>{data.invitedAt}</td>
            </tr>
            <tr>
              <td style={{ padding: "8px", fontWeight: 600, borderBottom: "1px solid #eee" }}>Accepted At</td>
              <td style={{ padding: "8px", borderBottom: "1px solid #eee" }}>{data.acceptedAt ?? "Pending"}</td>
            </tr>
            <tr>
              <td style={{ padding: "8px", fontWeight: 600, borderBottom: "1px solid #eee" }}>Current Phase</td>
              <td style={{ padding: "8px", borderBottom: "1px solid #eee" }}>
                <strong style={{ textTransform: "uppercase", color: "#2563eb" }}>{data.phase}</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* Lifecycle State Machine */}
      <section style={{ marginTop: "32px" }}>
        <h2>Lifecycle State Machine</h2>
        <div style={{ display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap" }}>
          {LIFECYCLE_PHASES.map((phase, idx) => {
            const isCurrent = phase === data.phase;
            const isPast = LIFECYCLE_PHASES.indexOf(data.phase) > idx;
            return (
              <div key={phase} style={{ display: "flex", alignItems: "center" }}>
                <div
                  style={{
                    padding: "8px 16px",
                    borderRadius: "4px",
                    backgroundColor: isCurrent ? "#2563eb" : isPast ? "#10b981" : "#e5e7eb",
                    color: isCurrent || isPast ? "#fff" : "#374151",
                    fontSize: "12px",
                    fontWeight: isCurrent ? 700 : 400,
                    textTransform: "uppercase",
                  }}
                >
                  {phase}
                </div>
                {idx < LIFECYCLE_PHASES.length - 1 && (
                  <span style={{ margin: "0 4px", color: "#9ca3af" }}>&rarr;</span>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
