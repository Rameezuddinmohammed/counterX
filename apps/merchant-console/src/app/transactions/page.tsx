/**
 * Transaction Timeline screen.
 *
 * Chronological view of all transactions showing states, evidence
 * references, and state transitions.
 */

import type { Transaction, TransactionState } from "../../lib/types.js";

const DEMO_TRANSACTIONS: readonly Transaction[] = [
  {
    transactionId: "txn-001",
    merchantId: "merchant-pilot-001",
    amount: 1500,
    currency: "INR",
    currentState: "settled",
    buyerRef: "buyer-xyz-001",
    method: "upi",
    createdAt: "2025-01-20T10:00:00Z",
    transitions: [
      { from: null, to: "initiated", timestamp: "2025-01-20T10:00:00Z", actor: "buyer", evidenceRef: null },
      { from: "initiated", to: "authorized", timestamp: "2025-01-20T10:00:05Z", actor: "razorpay", evidenceRef: "ev-auth-001" },
      { from: "authorized", to: "captured", timestamp: "2025-01-20T10:00:10Z", actor: "system", evidenceRef: "ev-cap-001" },
      { from: "captured", to: "settled", timestamp: "2025-01-20T10:30:00Z", actor: "razorpay", evidenceRef: "ev-stl-001" },
    ],
  },
  {
    transactionId: "txn-002",
    merchantId: "merchant-pilot-001",
    amount: 2499,
    currency: "INR",
    currentState: "refunded",
    buyerRef: "buyer-abc-002",
    method: "card",
    createdAt: "2025-01-19T16:00:00Z",
    transitions: [
      { from: null, to: "initiated", timestamp: "2025-01-19T16:00:00Z", actor: "buyer", evidenceRef: null },
      { from: "initiated", to: "authorized", timestamp: "2025-01-19T16:00:03Z", actor: "razorpay", evidenceRef: "ev-auth-002" },
      { from: "authorized", to: "captured", timestamp: "2025-01-19T16:00:08Z", actor: "system", evidenceRef: "ev-cap-002" },
      { from: "captured", to: "refunded", timestamp: "2025-01-20T09:00:00Z", actor: "merchant", evidenceRef: "ev-ref-002" },
    ],
  },
  {
    transactionId: "txn-003",
    merchantId: "merchant-pilot-001",
    amount: 999,
    currency: "INR",
    currentState: "failed",
    buyerRef: "buyer-def-003",
    method: "netbanking",
    createdAt: "2025-01-20T12:00:00Z",
    transitions: [
      { from: null, to: "initiated", timestamp: "2025-01-20T12:00:00Z", actor: "buyer", evidenceRef: null },
      { from: "initiated", to: "failed", timestamp: "2025-01-20T12:00:05Z", actor: "razorpay", evidenceRef: "ev-fail-003" },
    ],
  },
];

function stateColor(state: TransactionState): string {
  switch (state) {
    case "initiated": return "#6b7280";
    case "authorized": return "#2563eb";
    case "captured": return "#7c3aed";
    case "settled": return "#065f46";
    case "refunded": return "#92400e";
    case "failed": return "#991b1b";
    case "disputed": return "#dc2626";
  }
}

function stateBg(state: TransactionState): string {
  switch (state) {
    case "initiated": return "#f3f4f6";
    case "authorized": return "#dbeafe";
    case "captured": return "#ede9fe";
    case "settled": return "#d1fae5";
    case "refunded": return "#fef3c7";
    case "failed": return "#fee2e2";
    case "disputed": return "#fee2e2";
  }
}

export default function TransactionsPage() {
  return (
    <div>
      <h1>Transaction Timeline</h1>
      <p style={{ color: "#666" }}>
        Chronological view of all transactions with state transitions and evidence references.
      </p>

      {DEMO_TRANSACTIONS.map((txn) => (
        <section
          key={txn.transactionId}
          style={{ marginTop: "24px", padding: "20px", border: "1px solid #e5e7eb", borderRadius: "8px" }}
        >
          {/* Transaction Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
            <div>
              <span style={{ fontFamily: "monospace", fontWeight: 600 }}>{txn.transactionId}</span>
              <span style={{ marginLeft: "12px", padding: "3px 8px", borderRadius: "10px", fontSize: "11px", fontWeight: 600, backgroundColor: stateBg(txn.currentState), color: stateColor(txn.currentState) }}>
                {txn.currentState.toUpperCase()}
              </span>
            </div>
            <div style={{ fontSize: "18px", fontWeight: 700 }}>{txn.currency} {txn.amount.toLocaleString()}</div>
          </div>
          <div style={{ marginTop: "8px", fontSize: "13px", color: "#6b7280" }}>
            Method: {txn.method} | Buyer: {txn.buyerRef} | Created: {txn.createdAt}
          </div>

          {/* State Transitions Timeline */}
          <div style={{ marginTop: "16px", paddingLeft: "16px", borderLeft: "2px solid #e5e7eb" }}>
            {txn.transitions.map((transition, idx) => (
              <div key={idx} style={{ marginBottom: "12px", position: "relative" }}>
                <div
                  style={{
                    position: "absolute",
                    left: "-22px",
                    top: "4px",
                    width: "10px",
                    height: "10px",
                    borderRadius: "50%",
                    backgroundColor: stateColor(transition.to),
                  }}
                />
                <div style={{ fontSize: "13px" }}>
                  <strong style={{ color: stateColor(transition.to) }}>{transition.to.toUpperCase()}</strong>
                  <span style={{ color: "#9ca3af", marginLeft: "8px" }}>{transition.timestamp}</span>
                </div>
                <div style={{ fontSize: "12px", color: "#6b7280" }}>
                  Actor: {transition.actor}
                  {transition.evidenceRef && (
                    <span style={{ marginLeft: "8px", fontFamily: "monospace" }}>Evidence: {transition.evidenceRef}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
