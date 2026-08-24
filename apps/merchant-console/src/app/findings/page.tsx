/**
 * Findings & Reconciliation screen.
 *
 * Displays reconciliation findings with severity, affected objects,
 * resolution status, and compensation commands.
 */

import type { Finding, FindingResolution, FindingSeverity } from "../../lib/types.js";

const DEMO_FINDINGS: readonly Finding[] = [
  {
    findingId: "find-001",
    merchantId: "merchant-pilot-001",
    severity: "critical",
    title: "Payment Amount Mismatch",
    description: "Captured amount differs from authorized amount by INR 50. Possible partial capture not reflected in order.",
    affectedObject: "txn-002",
    resolution: "compensated",
    compensationCommand: "compensate --txn txn-002 --amount 50 --reason partial_capture_mismatch",
    detectedAt: "2025-01-20T11:00:00Z",
    resolvedAt: "2025-01-20T12:00:00Z",
  },
  {
    findingId: "find-002",
    merchantId: "merchant-pilot-001",
    severity: "high",
    title: "Webhook Delivery Failure",
    description: "Order status webhook failed delivery 3 consecutive times. Events may be out of sync.",
    affectedObject: "webhook-order-status-001",
    resolution: "acknowledged",
    compensationCommand: null,
    detectedAt: "2025-01-20T10:30:00Z",
    resolvedAt: null,
  },
  {
    findingId: "find-003",
    merchantId: "merchant-pilot-001",
    severity: "medium",
    title: "Mapping Version Drift",
    description: "Product catalog mapping version is behind latest Shopify catalog sync by 2 versions.",
    affectedObject: "mapping-v3",
    resolution: "open",
    compensationCommand: null,
    detectedAt: "2025-01-20T09:00:00Z",
    resolvedAt: null,
  },
  {
    findingId: "find-004",
    merchantId: "merchant-pilot-001",
    severity: "low",
    title: "Slow Razorpay Response",
    description: "Average Razorpay API response time exceeded 2s threshold (avg 2.4s over last hour).",
    affectedObject: "razorpay-api",
    resolution: "dismissed",
    compensationCommand: null,
    detectedAt: "2025-01-20T08:00:00Z",
    resolvedAt: "2025-01-20T08:30:00Z",
  },
  {
    findingId: "find-005",
    merchantId: "merchant-pilot-001",
    severity: "info",
    title: "New Policy Version Available",
    description: "Bilateral policy v3 has been published. Current merchant is on v2.",
    affectedObject: "policy-bilateral-v3",
    resolution: "open",
    compensationCommand: null,
    detectedAt: "2025-01-19T16:00:00Z",
    resolvedAt: null,
  },
];

function severityStyle(severity: FindingSeverity): { bg: string; color: string } {
  switch (severity) {
    case "critical": return { bg: "#fee2e2", color: "#991b1b" };
    case "high": return { bg: "#ffedd5", color: "#9a3412" };
    case "medium": return { bg: "#fef3c7", color: "#92400e" };
    case "low": return { bg: "#f3f4f6", color: "#374151" };
    case "info": return { bg: "#dbeafe", color: "#1e40af" };
  }
}

function resolutionLabel(resolution: FindingResolution): string {
  switch (resolution) {
    case "open": return "Open";
    case "acknowledged": return "Acknowledged";
    case "compensated": return "Compensated";
    case "resolved": return "Resolved";
    case "dismissed": return "Dismissed";
  }
}

export default function FindingsPage() {
  return (
    <div>
      <h1>Findings &amp; Reconciliation</h1>
      <p style={{ color: "#666" }}>
        Review reconciliation findings, track severity and resolution, and execute compensation commands.
      </p>

      {/* Summary */}
      <section style={{ marginTop: "24px", display: "flex", gap: "12px", flexWrap: "wrap" }}>
        {(["critical", "high", "medium", "low", "info"] as FindingSeverity[]).map((sev) => {
          const count = DEMO_FINDINGS.filter((f) => f.severity === sev).length;
          const style = severityStyle(sev);
          return (
            <div key={sev} style={{ padding: "12px 20px", borderRadius: "8px", backgroundColor: style.bg, textAlign: "center" }}>
              <div style={{ fontSize: "20px", fontWeight: 700, color: style.color }}>{count}</div>
              <div style={{ fontSize: "11px", color: style.color, textTransform: "uppercase" }}>{sev}</div>
            </div>
          );
        })}
      </section>

      {/* Findings List */}
      <section style={{ marginTop: "24px" }}>
        {DEMO_FINDINGS.map((finding) => {
          const style = severityStyle(finding.severity);
          return (
            <div
              key={finding.findingId}
              style={{ marginBottom: "16px", padding: "16px", border: "1px solid #e5e7eb", borderRadius: "8px", borderLeft: `4px solid ${style.color}` }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ padding: "3px 8px", borderRadius: "10px", fontSize: "11px", fontWeight: 700, backgroundColor: style.bg, color: style.color }}>
                    {finding.severity.toUpperCase()}
                  </span>
                  <strong>{finding.title}</strong>
                </div>
                <span style={{ fontSize: "12px", padding: "3px 8px", borderRadius: "10px", backgroundColor: "#f3f4f6", color: "#374151" }}>
                  {resolutionLabel(finding.resolution)}
                </span>
              </div>
              <p style={{ margin: "8px 0", fontSize: "13px", color: "#4b5563" }}>{finding.description}</p>
              <div style={{ fontSize: "12px", color: "#9ca3af" }}>
                Affected: <code>{finding.affectedObject}</code> | Detected: {finding.detectedAt}
                {finding.resolvedAt && <span> | Resolved: {finding.resolvedAt}</span>}
              </div>
              {finding.compensationCommand && (
                <div style={{ marginTop: "8px", padding: "8px 12px", backgroundColor: "#f8fafc", borderRadius: "4px", fontFamily: "monospace", fontSize: "12px", border: "1px solid #e2e8f0" }}>
                  $ {finding.compensationCommand}
                </div>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}
