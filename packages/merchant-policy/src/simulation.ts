/**
 * Wallet authority simulation.
 *
 * Takes a compiled merchant policy and representative BuyerPolicyConstraints
 * (Wallet authority), computes the bilateral intersection using
 * @counter/policy's reduceToDecision, and returns the effective constraints
 * or denial.
 */

import type { CounterId, DecimalQuantity, Instant, Money, Result } from "@counter/domain";
import { createCanonicalError, err, ok } from "@counter/domain";
import type {
  BuyerPolicyConstraints,
  PolicyDecision,
  PolicyEvaluationInput,
} from "@counter/policy";
import { evaluateAllRules, reduceToDecision } from "@counter/policy";

import type { CompiledMerchantPolicy } from "./compiler.js";

// ---------------------------------------------------------------------------
// Simulation input
// ---------------------------------------------------------------------------

export interface SimulationInput {
  readonly compiledPolicy: CompiledMerchantPolicy;
  readonly walletAuthority: BuyerPolicyConstraints;
  readonly transactionId: CounterId<"transaction">;
  readonly requestedAmount: Money;
  readonly requestedAt: Instant;
  readonly merchantId: string;
  readonly merchantDomain: string;
  readonly merchantCategory: string;
  readonly buyerCountry: string;
  readonly sku: string;
  readonly quantity: DecimalQuantity;
  readonly paymentMethod: PolicyEvaluationInput["paymentMethod"];
  readonly destination: string;
  readonly operationType: PolicyEvaluationInput["operationType"];
}

// ---------------------------------------------------------------------------
// Simulation result
// ---------------------------------------------------------------------------

export interface SimulationResult {
  readonly decision: PolicyDecision;
  readonly ruleResults: readonly { readonly ruleId: string; readonly outcome: string }[];
}

// ---------------------------------------------------------------------------
// Build minimal evaluation input for simulation
// ---------------------------------------------------------------------------

function buildSimulationEvalInput(input: SimulationInput): PolicyEvaluationInput {
  return {
    transactionId: input.transactionId,
    operationType: input.operationType,
    requestedAmount: input.requestedAmount,
    requestedAt: input.requestedAt,
    merchantId: input.merchantId,
    merchantDomain: input.merchantDomain,
    merchantCategory: input.merchantCategory,
    buyerCountry: input.buyerCountry,
    sku: input.sku,
    quantity: input.quantity,
    paymentMethod: input.paymentMethod,
    destination: input.destination,
    // Provide only buyer and merchant constraints for bilateral simulation
    platform: undefined,
    buyer: input.walletAuthority,
    mandate: undefined,
    merchant: input.compiledPolicy.constraints,
    connector: undefined,
    provider: undefined,
    risk: undefined,
    transactionState: undefined,
  };
}

// ---------------------------------------------------------------------------
// Simulate wallet authority intersection
// ---------------------------------------------------------------------------

/**
 * Simulates a bilateral policy intersection between a merchant's compiled
 * policy and a representative Wallet authority (BuyerPolicyConstraints).
 *
 * This function evaluates only the buyer and merchant rules - other
 * constraint sources (platform, connector, provider, risk, transaction state)
 * are left undefined. Rules that require those sources will deny, which
 * is the expected "fail closed" behavior for a simulation that focuses
 * on the buyer/merchant bilateral intersection.
 */
export function simulateWalletAuthority(
  input: SimulationInput,
): Result<SimulationResult> {
  // Validate that the compiled policy is not ambiguous
  if (input.compiledPolicy.constraints.version !== 1) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "UNSUPPORTED_VALUE",
        message: "Only version 1 merchant policy constraints are supported",
      }),
    );
  }

  const evalInput = buildSimulationEvalInput(input);

  // Run all rules (some will deny due to missing sources - expected in simulation)
  const allResults = evaluateAllRules(evalInput);

  // For bilateral simulation, only consider buyer and merchant rule results.
  // Uses prefix-based filtering to remain resilient if the policy engine adds
  // or renames rules under these namespaces.
  const bilateralResults = allResults.filter(
    (r) => r.ruleId.startsWith("buyer_") || r.ruleId.startsWith("merchant_"),
  );

  if (bilateralResults.length === 0) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "INVALID_FORMAT",
        message: "No bilateral rules could be evaluated",
      }),
    );
  }

  // Reduce only the bilateral results to a decision
  const decision = reduceToDecision(bilateralResults, evalInput);

  const ruleResults = bilateralResults.map((r) => ({
    ruleId: r.ruleId,
    outcome: r.outcome,
  }));

  return ok(Object.freeze({ decision, ruleResults }));
}
