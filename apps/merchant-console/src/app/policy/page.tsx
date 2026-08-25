/**
 * Policy Simulation screen.
 *
 * Displays rule evaluation results from simulating wallet authority
 * and bilateral policy rules. Shows overall verdict and individual
 * rule outcomes.
 */

import type { PolicyRuleResult, RuleVerdict } from "../../lib/types.js";

const DEMO_RULES: readonly PolicyRuleResult[] = [
  { ruleId: "rule-001", ruleName: "Wallet Authority Limit", verdict: "allow", reason: "Transaction amount within authorized limit", evaluatedAt: "2025-01-20T14:00:00Z" },
  { ruleId: "rule-002", ruleName: "Bilateral Policy: Refund Window", verdict: "allow", reason: "Refund request within 7-day window", evaluatedAt: "2025-01-20T14:00:00Z" },
  { ruleId: "rule-003", ruleName: "Currency Restriction", verdict: "allow", reason: "INR only policy satisfied", evaluatedAt: "2025-01-20T14:00:00Z" },
  { ruleId: "rule-004", ruleName: "Velocity Check", verdict: "conditional", reason: "Approaching daily transaction limit (80%)", evaluatedAt: "2025-01-20T14:00:00Z" },
  { ruleId: "rule-005", ruleName: "Merchant Standing", verdict: "allow", reason: "No active findings or suspensions", evaluatedAt: "2025-01-20T14:00:00Z" },
];

const DEMO_DATA = {
  simulationId: "sim-20250120-001",
  merchantId: "merchant-pilot-001",
  scenarioName: "Standard Purchase Flow",
  overallVerdict: "conditional" as RuleVerdict,
  rules: DEMO_RULES,
  walletAuthorityLimit: 50000,
  currency: "INR" as const,
  executedAt: "2025-01-20T14:00:00Z",
};

function verdictStyle(verdict: RuleVerdict): { bg: string; color: string } {
  switch (verdict) {
    case "allow": return { bg: "#d1fae5", color: "#065f46" };
    case "deny": return { bg: "#fee2e2", color: "#991b1b" };
    case "conditional": return { bg: "#fef3c7", color: "#92400e" };
  }
}

export default function PolicyPage() {
  const data = DEMO_DATA;
  const overallStyle = verdictStyle(data.overallVerdict);

  return (
    <div>
      <h1>Policy Simulation</h1>
      <p style={{ color: "#666" }}>
        Simulate wallet authority and bilateral policy rules to preview rule evaluation outcomes.
      </p>

      {/* Simulation Summary */}
      <section style={{ marginTop: "24px", padding: "20px", border: "1px solid #e5e7eb", borderRadius: "8px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
          <div>
            <div style={{ fontSize: "12px", color: "#6b7280" }}>Scenario</div>
            <div style={{ fontSize: "16px", fontWeight: 600 }}>{data.scenarioName}</div>
          </div>
          <div>
            <div style={{ fontSize: "12px", color: "#6b7280" }}>Overall Verdict</div>
            <span style={{ padding: "6px 14px", borderRadius: "16px", fontSize: "13px", fontWeight: 700, backgroundColor: overallStyle.bg, color: overallStyle.color }}>
              {data.overallVerdict.toUpperCase()}
            </span>
          </div>
          <div>
            <div style={{ fontSize: "12px", color: "#6b7280" }}>Wallet Authority Limit</div>
            <div style={{ fontSize: "16px", fontWeight: 600 }}>{data.currency} {data.walletAuthorityLimit.toLocaleString()}</div>
          </div>
        </div>
      </section>

      {/* Rule Results */}
      <section style={{ marginTop: "24px" }}>
        <h2>Rule Evaluation Results</h2>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #e5e7eb", textAlign: "left" }}>
              <th style={{ padding: "8px" }}>Rule</th>
              <th style={{ padding: "8px" }}>Verdict</th>
              <th style={{ padding: "8px" }}>Reason</th>
            </tr>
          </thead>
          <tbody>
            {data.rules.map((rule) => {
              const style = verdictStyle(rule.verdict);
              return (
                <tr key={rule.ruleId} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={{ padding: "8px" }}>
                    <div style={{ fontWeight: 500 }}>{rule.ruleName}</div>
                    <div style={{ fontSize: "11px", color: "#9ca3af", fontFamily: "monospace" }}>{rule.ruleId}</div>
                  </td>
                  <td style={{ padding: "8px" }}>
                    <span style={{ padding: "3px 8px", borderRadius: "10px", fontSize: "11px", fontWeight: 600, backgroundColor: style.bg, color: style.color }}>
                      {rule.verdict.toUpperCase()}
                    </span>
                  </td>
                  <td style={{ padding: "8px", fontSize: "13px", color: "#4b5563" }}>{rule.reason}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <p style={{ fontSize: "12px", color: "#9ca3af", marginTop: "16px" }}>
        Simulation ID: {data.simulationId} | Executed: {data.executedAt}
      </p>
    </div>
  );
}
