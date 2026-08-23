/**
 * PolicyEngine orchestrates policy evaluation.
 *
 * Flow:
 * 1. Validates all required constraint sources are present (fail closed)
 * 2. Runs all applicable rules
 * 3. Passes results through intersection reducer
 * 4. If ALLOW, checks and reserves rolling limits via LimitStore
 * 5. Returns the final decision with validity and digest
 */

import type { Clock, Instant, Result } from "@counter/domain";
import { createCanonicalError, err, ok } from "@counter/domain";
import type { PolicyDecision } from "./decision.js";
import { createDenyDecision } from "./decision.js";
import { reduceToDecision } from "./intersection.js";
import type { LimitStore, ReserveContext } from "./limit-store.js";
import type { RuleResult } from "./rules.js";
import { evaluateAllRules } from "./rules.js";
import type { PolicyEvaluationInput } from "./types.js";

// ---------------------------------------------------------------------------
// Required constraint sources (fail closed if missing)
// ---------------------------------------------------------------------------

const REQUIRED_SOURCES = [
  "platform",
  "buyer",
  "merchant",
  "connector",
  "provider",
  "risk",
  "transactionState",
] as const;

type RequiredSource = (typeof REQUIRED_SOURCES)[number];

function getMissingSource(input: PolicyEvaluationInput): RequiredSource | undefined {
  for (const source of REQUIRED_SOURCES) {
    if (input[source] === undefined) {
      return source;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Engine configuration
// ---------------------------------------------------------------------------

export interface PolicyEngineConfig {
  readonly clock: Clock;
  readonly limitStore: LimitStore | undefined;
  readonly defaultValidityMs: number;
}

// ---------------------------------------------------------------------------
// PolicyEngine
// ---------------------------------------------------------------------------

export class PolicyEngine {
  readonly #clock: Clock;
  readonly #limitStore: LimitStore | undefined;
  readonly #defaultValidityMs: number;
  readonly #decisionReservations: Map<string, string[]> = new Map();

  constructor(config: PolicyEngineConfig) {
    this.#clock = config.clock;
    this.#limitStore = config.limitStore;
    this.#defaultValidityMs = config.defaultValidityMs;
  }

  /**
   * Evaluate a policy decision for the given input.
   *
   * Fails closed: missing required constraint sources produce DENY.
   * Malformed inputs produce DENY (never throws for expected failures).
   */
  async evaluate(input: PolicyEvaluationInput): Promise<PolicyDecision> {
    try {
      return await this.evaluateInternal(input);
    } catch {
      // Fail closed on any unexpected error
      return createDenyDecision({
        ruleIds: ["internal_error"],
        explanation: "Policy evaluation encountered an internal error",
        sources: ["engine"],
      });
    }
  }

  private async evaluateInternal(input: PolicyEvaluationInput): Promise<PolicyDecision> {
    // Step 1: Validate required sources (fail closed)
    const missingSource = getMissingSource(input);
    if (missingSource !== undefined) {
      return createDenyDecision({
        ruleIds: [`missing_${missingSource}`],
        explanation: `Required constraint source is missing: ${missingSource}`,
        sources: [missingSource],
      });
    }

    // Step 2: Run all rules
    let results: readonly RuleResult[];
    try {
      results = evaluateAllRules(input);
    } catch {
      return createDenyDecision({
        ruleIds: ["rule_evaluation_error"],
        explanation: "Rule evaluation failed due to malformed constraints",
        sources: ["engine"],
      });
    }

    // Step 3: Reduce through intersection
    const decision = reduceToDecision(results, input);

    // Step 4: If ALLOW and limit store available, try to reserve
    if (decision.outcome === "ALLOW" && this.#limitStore !== undefined) {
      const now = this.#clock.now();
      const expiresAt = (now + this.#defaultValidityMs) as Instant;

      const reserveContext: ReserveContext = {
        transactionId: input.transactionId,
        requestedAt: now,
        expiresAt,
      };

      // Reserve the transaction amount against the buyer rolling limit
      if (input.buyer !== undefined) {
        const bucketId = `rolling_amount_${input.buyer.source}`;
        const reserveResult = await this.#limitStore.reserve(
          bucketId,
          input.requestedAmount.amountMinor,
          reserveContext,
        );

        if (!reserveResult.ok) {
          return createDenyDecision({
            ruleIds: ["rolling_limit_exceeded"],
            explanation: "Transaction would exceed rolling amount limit",
            sources: [input.buyer.source],
          });
        }

        // Track reservation for potential release
        const existingReservations = this.#decisionReservations.get(input.transactionId);
        if (existingReservations !== undefined) {
          existingReservations.push(reserveResult.value.reservationId);
        } else {
          this.#decisionReservations.set(
            input.transactionId,
            [reserveResult.value.reservationId],
          );
        }

        // Return ALLOW with the reservation ID
        return Object.freeze({
          outcome: "ALLOW" as const,
          validUntil: decision.validUntil,
          materialInputDigest: decision.materialInputDigest,
          reservationId: reserveResult.value.reservationId,
          constraints: decision.constraints,
        });
      }
    }

    return decision;
  }

  /**
   * Release all reservations associated with a decision.
   * Called when an action does not complete (expiry, cancellation).
   */
  async releaseDecision(transactionId: string): Promise<Result<void>> {
    const reservationIds = this.#decisionReservations.get(transactionId);
    if (reservationIds === undefined || reservationIds.length === 0) {
      return ok(undefined);
    }

    if (this.#limitStore === undefined) {
      return ok(undefined);
    }

    for (const reservationId of reservationIds) {
      const result = await this.#limitStore.release(reservationId);
      if (!result.ok) {
        return err(
          createCanonicalError({
            category: "internal",
            code: "INTERNAL",
            message: "Failed to release reservation",
          }),
        );
      }
    }

    this.#decisionReservations.delete(transactionId);
    return ok(undefined);
  }
}
