"use client";

import { useState } from "react";
import { Card, CardContent, Button, Badge } from "@counter/ui";
import { Shield, Play, CheckCircle, XCircle, AlertTriangle } from "lucide-react";
import { toast } from "@counter/ui";
import { PageWrapper } from "@/components/page-wrapper";
import type { PolicySimulationResult, RuleVerdict } from "@/lib/types";

const DEMO_SIMULATION: PolicySimulationResult = {
  simulationId: "sim-001", merchantId: "merchant-pilot-001", scenarioName: "Standard Transaction Flow", overallVerdict: "allow",
  rules: [
    { ruleId: "rule-001", ruleName: "KYC Verification", verdict: "allow", reason: "All documents verified", evaluatedAt: "2025-01-20T10:00:00Z" },
    { ruleId: "rule-002", ruleName: "Transaction Limit", verdict: "allow", reason: "Within daily limit of INR 50,000", evaluatedAt: "2025-01-20T10:00:01Z" },
    { ruleId: "rule-003", ruleName: "Velocity Check", verdict: "allow", reason: "Transaction rate normal", evaluatedAt: "2025-01-20T10:00:01Z" },
    { ruleId: "rule-004", ruleName: "Geographic Restriction", verdict: "conditional", reason: "International transactions require additional review", evaluatedAt: "2025-01-20T10:00:02Z" },
  ],
  walletAuthorityLimit: 50000, currency: "INR", executedAt: "2025-01-20T10:00:02Z",
};

function getVerdictVariant(verdict: RuleVerdict) {
  switch (verdict) { case "allow": return "success" as const; case "deny": return "error" as const; case "conditional": return "warning" as const; }
}

function getVerdictIcon(verdict: RuleVerdict) {
  switch (verdict) { case "allow": return CheckCircle; case "deny": return XCircle; case "conditional": return AlertTriangle; }
}

export default function PolicyPage() {
  const [simulation] = useState<PolicySimulationResult | null>(DEMO_SIMULATION);
  const [running, setRunning] = useState(false);

  const handleRunSimulation = () => {
    setRunning(true);
    setTimeout(() => { setRunning(false); toast.success("Policy simulation completed"); }, 1500);
  };

  return (
    <PageWrapper>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--foreground)]">Policy Simulation</h1>
            <p className="mt-1 text-[var(--foreground-secondary)]">Run policy checks and review rule evaluations.</p>
          </div>
          <Button onClick={handleRunSimulation} disabled={running}>
            <Play className="mr-2 h-4 w-4" />{running ? "Running..." : "Run Simulation"}
          </Button>
        </div>

        {simulation && (
          <>
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="rounded-lg bg-[var(--brand-orange)]/10 p-2"><Shield className="h-5 w-5 text-[var(--brand-orange)]" /></div>
                    <div>
                      <p className="font-medium text-[var(--foreground)]">{simulation.scenarioName}</p>
                      <p className="text-sm text-[var(--foreground-muted)]">Wallet limit: {simulation.currency} {simulation.walletAuthorityLimit.toLocaleString()}</p>
                    </div>
                  </div>
                  <Badge variant={getVerdictVariant(simulation.overallVerdict)} className="text-sm px-3 py-1">{simulation.overallVerdict.toUpperCase()}</Badge>
                </div>
              </CardContent>
            </Card>
            <div className="space-y-3">
              <h2 className="text-lg font-semibold text-[var(--foreground)]">Rule Evaluations</h2>
              {simulation.rules.map((rule) => { const Icon = getVerdictIcon(rule.verdict); return (
                <Card key={rule.ruleId}>
                  <CardContent className="flex items-center gap-4 p-4">
                    <Icon className={`h-5 w-5 ${rule.verdict === "allow" ? "text-emerald-500" : rule.verdict === "deny" ? "text-red-500" : "text-amber-500"}`} />
                    <div className="flex-1">
                      <p className="font-medium text-[var(--foreground)]">{rule.ruleName}</p>
                      <p className="text-sm text-[var(--foreground-muted)]">{rule.reason}</p>
                    </div>
                    <Badge variant={getVerdictVariant(rule.verdict)}>{rule.verdict}</Badge>
                  </CardContent>
                </Card>
              ); })}
            </div>
          </>
        )}
      </div>
    </PageWrapper>
  );
}
