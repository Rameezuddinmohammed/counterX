/**
 * PolicyDecision discriminated union types.
 *
 * Every policy evaluation produces exactly one of:
 * - ALLOW: operation is permitted with validity window and material-input digest
 * - DENY: operation is blocked with rule IDs and user-safe explanation
 * - REVIEW_REQUIRED: operation needs manual review before proceeding
 */

import type { Instant, IsoCurrencyCode, Money, Sha256Digest } from "@counter/domain";
import type { OperationType, PaymentMethod } from "./types.js";

// ---------------------------------------------------------------------------
// Effective Constraints (narrowed intersection result)
// ---------------------------------------------------------------------------

/**
 * The effective bounds after intersection reduction.
 * Represents the narrowest acceptable range across all constraint sources.
 */
export interface EffectiveConstraints {
  readonly maxAmount: Money;
  readonly allowedCurrencies: readonly IsoCurrencyCode[];
  readonly allowedOperations: readonly OperationType[];
  readonly allowedPaymentMethods: readonly PaymentMethod[];
  readonly validFrom: Instant;
  readonly validUntil: Instant;
}

// ---------------------------------------------------------------------------
// Decision variants
// ---------------------------------------------------------------------------

export interface AllowDecision {
  readonly outcome: "ALLOW";
  readonly validUntil: Instant;
  readonly materialInputDigest: Sha256Digest;
  readonly reservationId: string | undefined;
  readonly constraints: EffectiveConstraints;
}

export interface DenyDecision {
  readonly outcome: "DENY";
  readonly ruleIds: readonly string[];
  readonly explanation: string;
  readonly sources: readonly string[];
}

export interface ReviewRequiredDecision {
  readonly outcome: "REVIEW_REQUIRED";
  readonly reviewReason: string;
  readonly blockingRuleIds: readonly string[];
  readonly requiredActions: readonly string[];
}

// ---------------------------------------------------------------------------
// Discriminated union
// ---------------------------------------------------------------------------

export type PolicyDecision = AllowDecision | DenyDecision | ReviewRequiredDecision;

// ---------------------------------------------------------------------------
// Constructors (frozen value objects)
// ---------------------------------------------------------------------------

export function createAllowDecision(params: {
  readonly validUntil: Instant;
  readonly materialInputDigest: Sha256Digest;
  readonly reservationId: string | undefined;
  readonly constraints: EffectiveConstraints;
}): AllowDecision {
  return Object.freeze({
    outcome: "ALLOW" as const,
    validUntil: params.validUntil,
    materialInputDigest: params.materialInputDigest,
    reservationId: params.reservationId,
    constraints: Object.freeze({ ...params.constraints }),
  });
}

export function createDenyDecision(params: {
  readonly ruleIds: readonly string[];
  readonly explanation: string;
  readonly sources: readonly string[];
}): DenyDecision {
  return Object.freeze({
    outcome: "DENY" as const,
    ruleIds: Object.freeze([...params.ruleIds]),
    explanation: params.explanation,
    sources: Object.freeze([...params.sources]),
  });
}

export function createReviewRequiredDecision(params: {
  readonly reviewReason: string;
  readonly blockingRuleIds: readonly string[];
  readonly requiredActions: readonly string[];
}): ReviewRequiredDecision {
  return Object.freeze({
    outcome: "REVIEW_REQUIRED" as const,
    reviewReason: params.reviewReason,
    blockingRuleIds: Object.freeze([...params.blockingRuleIds]),
    requiredActions: Object.freeze([...params.requiredActions]),
  });
}
