/**
 * Policy simulation service.
 *
 * Allows a principal to simulate how a policy would evaluate against a set
 * of synthetic or historical transactions before activating the policy.
 * Returns what would have been allowed/denied under the proposed policy.
 */

import type { BuyerPolicyConstraints } from "./buyer-policy.js";
import type { AccumulatedUsage, PolicyDecision, ProposedAction } from "./policy-evaluator.js";
import { evaluatePolicy } from "./policy-evaluator.js";

// ---------------------------------------------------------------------------
// Simulation Result
// ---------------------------------------------------------------------------

/**
 * Result for a single simulated action.
 */
export interface SimulationResult {
  readonly action: ProposedAction;
  readonly decision: PolicyDecision;
}

/**
 * Summary of a full policy simulation run.
 */
export interface SimulationSummary {
  readonly results: readonly SimulationResult[];
  readonly totalActions: number;
  readonly allowed: number;
  readonly denied: number;
  readonly reviewRequired: number;
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

/**
 * Simulates a policy against a sequence of synthetic or historical actions.
 *
 * Each action is evaluated independently with the provided accumulated usage.
 * If no usage is provided, defaults to zero usage (simulates each action in
 * isolation, not as a sequence).
 *
 * @param policy - The buyer policy constraints to simulate
 * @param syntheticActions - Array of proposed actions to simulate
 * @param usage - Optional accumulated usage context (defaults to zero)
 * @param policyVersionId - Version ID of the policy being simulated
 * @returns Array of simulation results for each action
 */
export function simulatePolicy(
  policy: BuyerPolicyConstraints,
  syntheticActions: readonly ProposedAction[],
  usage?: AccumulatedUsage,
  policyVersionId?: string,
): SimulationSummary {
  const defaultUsage: AccumulatedUsage = {
    rollingPeriodTotalPaise: 0n,
    aggregateTotalPaise: 0n,
    transactionCount: 0,
  };

  const effectiveUsage = usage ?? defaultUsage;
  const effectiveVersionId = policyVersionId ?? "simulation";

  const results: SimulationResult[] = [];
  let allowed = 0;
  let denied = 0;
  let reviewRequired = 0;

  for (const action of syntheticActions) {
    const decision = evaluatePolicy(policy, action, effectiveUsage, effectiveVersionId);
    results.push({ action, decision });

    switch (decision.outcome) {
      case "allowed":
        allowed++;
        break;
      case "denied":
        denied++;
        break;
      case "review_required":
        reviewRequired++;
        break;
    }
  }

  return {
    results,
    totalActions: syntheticActions.length,
    allowed,
    denied,
    reviewRequired,
  };
}
