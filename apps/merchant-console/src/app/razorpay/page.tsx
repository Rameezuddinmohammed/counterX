/**
 * Razorpay Status screen.
 *
 * Displays test account configuration, payment method availability,
 * and recent transaction attempts through Razorpay.
 */

import type { TransactionAttempt } from "../../lib/types.js";

const DEMO_ATTEMPTS: readonly TransactionAttempt[] = [
  { attemptId: "att-001", amount: 1500, currency: "INR", status: "success", method: "upi", timestamp: "2025-01-20T14:30:00Z", errorCode: null },
  { attemptId: "att-002", amount: 2499, currency: "INR", status: "success", method: "card", timestamp: "2025-01-20T13:15:00Z", errorCode: null },
  { attemptId: "att-003", amount: 999, currency: "INR", status: "failed", method: "netbanking", timestamp: "2025-01-20T12:00:00Z", errorCode: "BAD_REQUEST_ERROR" },
  { attemptId: "att-004", amount: 3200, currency: "INR", status: "pending", method: "upi", timestamp: "2025-01-20T14:45:00Z", errorCode: null },
];

const DEMO_DATA = {
  accountId: "rzp_test_abc123xyz",
  mode: "test" as const,
  keyConfigured: true,
  webhookActive: true,
  supportedMethods: ["upi", "card", "netbanking", "wallet"],
  recentAttempts: DEMO_ATTEMPTS,
  lastVerifiedAt: "2025-01-20T14:00:00Z",
};

function statusStyle(status: TransactionAttempt["status"]) {
  switch (status) {
    case "success": return { bg: "#d1fae5", color: "#065f46" };
    case "failed": return { bg: "#fee2e2", color: "#991b1b" };
    case "pending": return { bg: "#fef3c7", color: "#92400e" };
  }
}

export default function RazorpayPage() {
  const data = DEMO_DATA;

  return (
    <div>
      <h1>Razorpay Status</h1>
      <p style={{ color: "#666" }}>
        Monitor test account configuration, payment methods, and transaction attempts.
      </p>

      {/* Account Configuration */}
      <section style={{ marginTop: "24px" }}>
        <h2>Account Configuration</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "16px", maxWidth: "700px" }}>
          <div style={{ padding: "16px", border: "1px solid #e5e7eb", borderRadius: "8px" }}>
            <div style={{ fontSize: "12px", color: "#6b7280" }}>Account ID</div>
            <div style={{ fontFamily: "monospace", fontSize: "13px", marginTop: "4px" }}>{data.accountId}</div>
          </div>
          <div style={{ padding: "16px", border: "1px solid #e5e7eb", borderRadius: "8px" }}>
            <div style={{ fontSize: "12px", color: "#6b7280" }}>Mode</div>
            <span style={{ padding: "3px 8px", borderRadius: "10px", fontSize: "12px", fontWeight: 700, backgroundColor: "#fef3c7", color: "#92400e" }}>
              {data.mode.toUpperCase()}
            </span>
          </div>
          <div style={{ padding: "16px", border: "1px solid #e5e7eb", borderRadius: "8px" }}>
            <div style={{ fontSize: "12px", color: "#6b7280" }}>Last Verified</div>
            <div style={{ fontSize: "13px", marginTop: "4px" }}>{data.lastVerifiedAt}</div>
          </div>
        </div>
      </section>

      {/* Validation */}
      <section style={{ marginTop: "24px" }}>
        <h2>Validation</h2>
        <div style={{ display: "flex", gap: "12px" }}>
          <span style={{ padding: "6px 12px", borderRadius: "12px", fontSize: "12px", fontWeight: 600, backgroundColor: data.keyConfigured ? "#d1fae5" : "#fee2e2", color: data.keyConfigured ? "#065f46" : "#991b1b" }}>
            API Key: {data.keyConfigured ? "Configured" : "Missing"}
          </span>
          <span style={{ padding: "6px 12px", borderRadius: "12px", fontSize: "12px", fontWeight: 600, backgroundColor: data.webhookActive ? "#d1fae5" : "#fee2e2", color: data.webhookActive ? "#065f46" : "#991b1b" }}>
            Webhook: {data.webhookActive ? "Active" : "Inactive"}
          </span>
        </div>
      </section>

      {/* Payment Methods */}
      <section style={{ marginTop: "24px" }}>
        <h2>Supported Methods</h2>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {data.supportedMethods.map((method) => (
            <span key={method} style={{ padding: "6px 12px", border: "1px solid #e5e7eb", borderRadius: "16px", fontSize: "13px" }}>
              {method}
            </span>
          ))}
        </div>
      </section>

      {/* Recent Transaction Attempts */}
      <section style={{ marginTop: "24px" }}>
        <h2>Recent Transaction Attempts</h2>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #e5e7eb", textAlign: "left" }}>
              <th style={{ padding: "8px" }}>ID</th>
              <th style={{ padding: "8px" }}>Amount</th>
              <th style={{ padding: "8px" }}>Method</th>
              <th style={{ padding: "8px" }}>Status</th>
              <th style={{ padding: "8px" }}>Time</th>
              <th style={{ padding: "8px" }}>Error</th>
            </tr>
          </thead>
          <tbody>
            {data.recentAttempts.map((attempt) => {
              const style = statusStyle(attempt.status);
              return (
                <tr key={attempt.attemptId} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={{ padding: "8px", fontFamily: "monospace", fontSize: "12px" }}>{attempt.attemptId}</td>
                  <td style={{ padding: "8px" }}>{attempt.currency} {attempt.amount.toLocaleString()}</td>
                  <td style={{ padding: "8px" }}>{attempt.method}</td>
                  <td style={{ padding: "8px" }}>
                    <span style={{ padding: "3px 8px", borderRadius: "10px", fontSize: "11px", fontWeight: 600, backgroundColor: style.bg, color: style.color }}>
                      {attempt.status.toUpperCase()}
                    </span>
                  </td>
                  <td style={{ padding: "8px", fontSize: "13px" }}>{attempt.timestamp}</td>
                  <td style={{ padding: "8px", fontSize: "12px", color: "#991b1b" }}>{attempt.errorCode ?? "-"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
