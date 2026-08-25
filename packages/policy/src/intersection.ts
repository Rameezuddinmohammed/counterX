/**
 * Intersection reducer.
 *
 * Takes all RuleResult values, applies precedence (DENY > REVIEW_REQUIRED > ALLOW),
 * computes effective constraints as the narrowest intersection of all applicable
 * bounds, and returns the final PolicyDecision.
 */

import { sha256Digest } from "@counter/domain";
import type { Instant, IsoCurrencyCode, Money, Sha256Digest } from "@counter/domain";
import type {
  AllowDecision,
  DenyDecision,
  EffectiveConstraints,
  PolicyDecision,
  ReviewRequiredDecision,
} from "./decision.js";
import { createAllowDecision, createDenyDecision, createReviewRequiredDecision } from "./decision.js";
import type { RuleResult } from "./rules.js";
import type { PolicyEvaluationInput } from "./types.js";

// ---------------------------------------------------------------------------
// Material-input digest computation
// ---------------------------------------------------------------------------

/**
 * Computes a SHA-256 digest of the material inputs that produced this decision.
 * This pins the decision to the exact input state, preventing replay with
 * different inputs.
 */
export function computeMaterialInputDigest(input: PolicyEvaluationInput): Sha256Digest {
  const material = JSON.stringify({
    transactionId: input.transactionId,
    operationType: input.operationType,
    requestedAmount: {
      amountMinor: input.requestedAmount.amountMinor.toString(),
      currency: input.requestedAmount.currency,
    },
    requestedAt: input.requestedAt,
    merchantId: input.merchantId,
    merchantDomain: input.merchantDomain,
    merchantCategory: input.merchantCategory,
    buyerCountry: input.buyerCountry,
    sku: input.sku,
    quantity: input.quantity,
    paymentMethod: input.paymentMethod,
    destination: input.destination,
  });
  const bytes = new TextEncoder().encode(material);
  return sha256Digest(bytes);
}

// ---------------------------------------------------------------------------
// Effective constraints computation
// ---------------------------------------------------------------------------

function computeEffectiveConstraints(input: PolicyEvaluationInput): EffectiveConstraints {
  let maxAmount: Money = input.requestedAmount;
  const allowedCurrencies: IsoCurrencyCode[] = [];
  const allowedOperations: string[] = [];
  const allowedPaymentMethods: string[] = [];

  let validFrom: Instant = input.requestedAt;
  let validUntil: Instant = (input.requestedAt + 300_000) as Instant;

  if (input.platform !== undefined) {
    if (
      input.platform.maxTransactionAmount.currency === maxAmount.currency &&
      input.platform.maxTransactionAmount.amountMinor < maxAmount.amountMinor
    ) {
      maxAmount = input.platform.maxTransactionAmount;
    }
  }

  if (input.buyer !== undefined) {
    const b = input.buyer;
    if (
      b.perTransactionLimit.maxAmount.currency === maxAmount.currency &&
      b.perTransactionLimit.maxAmount.amountMinor < maxAmount.amountMinor
    ) {
      maxAmount = b.perTransactionLimit.maxAmount;
    }
    if (b.timeWindow.allowedFrom > validFrom) {
      validFrom = b.timeWindow.allowedFrom;
    }
    if (b.timeWindow.allowedUntil < validUntil) {
      validUntil = b.timeWindow.allowedUntil;
    }
    for (const op of b.allowedOperations) {
      if (!allowedOperations.includes(op)) {
        allowedOperations.push(op);
      }
    }
  }

  if (input.merchant !== undefined) {
    const m = input.merchant;
    if (
      m.maxAmount.currency === maxAmount.currency &&
      m.maxAmount.amountMinor < maxAmount.amountMinor
    ) {
      maxAmount = m.maxAmount;
    }
    for (const curr of m.allowedCurrencies) {
      if (!allowedCurrencies.includes(curr)) {
        allowedCurrencies.push(curr);
      }
    }
    for (const method of m.allowedPaymentPaths) {
      if (!allowedPaymentMethods.includes(method)) {
        allowedPaymentMethods.push(method);
      }
    }
    if (m.timeWindow.allowedFrom > validFrom) {
      validFrom = m.timeWindow.allowedFrom;
    }
    if (m.timeWindow.allowedUntil < validUntil) {
      validUntil = m.timeWindow.allowedUntil;
    }
  }

  if (input.provider !== undefined) {
    const p = input.provider;
    if (
      p.maxAmount.currency === maxAmount.currency &&
      p.maxAmount.amountMinor < maxAmount.amountMinor
    ) {
      maxAmount = p.maxAmount;
    }
    for (const curr of p.supportedCurrencies) {
      if (allowedCurrencies.length === 0 || allowedCurrencies.includes(curr)) {
        if (!allowedCurrencies.includes(curr)) {
          allowedCurrencies.push(curr);
        }
      }
    }
    for (const method of p.supportedMethods) {
      if (allowedPaymentMethods.length === 0 || allowedPaymentMethods.includes(method)) {
        if (!allowedPaymentMethods.includes(method)) {
          allowedPaymentMethods.push(method);
        }
      }
    }
  }

  if (allowedCurrencies.length === 0) {
    allowedCurrencies.push(input.requestedAmount.currency);
  }
  if (allowedOperations.length === 0) {
    allowedOperations.push(input.operationType);
  }
  if (allowedPaymentMethods.length === 0) {
    allowedPaymentMethods.push(input.paymentMethod);
  }

  return Object.freeze({
    maxAmount,
    allowedCurrencies: Object.freeze(allowedCurrencies),
    allowedOperations: Object.freeze(allowedOperations) as EffectiveConstraints["allowedOperations"],
    allowedPaymentMethods: Object.freeze(allowedPaymentMethods) as EffectiveConstraints["allowedPaymentMethods"],
    validFrom,
    validUntil,
  });
}

// ---------------------------------------------------------------------------
// Intersection Reducer
// ---------------------------------------------------------------------------

/**
 * Applies precedence rules:
 *   DENY > REVIEW_REQUIRED > ALLOW
 *
 * If any rule denies, the overall decision is DENY.
 * If any rule requires review (and none deny), the decision is REVIEW_REQUIRED.
 * Only if all rules pass is the decision ALLOW.
 */
export function reduceToDecision(
  results: readonly RuleResult[],
  input: PolicyEvaluationInput,
): PolicyDecision {
  const denyResults: RuleResult[] = [];
  const reviewResults: RuleResult[] = [];

  for (const result of results) {
    if (result.outcome === "deny") {
      denyResults.push(result);
    } else if (result.outcome === "review_required") {
      reviewResults.push(result);
    }
  }

  if (denyResults.length > 0) {
    const ruleIds = denyResults.map((r) => r.ruleId);
    const sources = [...new Set(denyResults.map((r) => r.source))];
    const explanation = denyResults.map((r) => r.explanation).join("; ");
    return createDenyDecision({ ruleIds, explanation, sources }) satisfies DenyDecision;
  }

  if (reviewResults.length > 0) {
    const blockingRuleIds = reviewResults.map((r) => r.ruleId);
    const reviewReason = reviewResults.map((r) => r.explanation).join("; ");
    const requiredActions = reviewResults.map((r) => r.ruleId);
    return createReviewRequiredDecision({
      reviewReason,
      blockingRuleIds,
      requiredActions,
    }) satisfies ReviewRequiredDecision;
  }

  const constraints = computeEffectiveConstraints(input);
  const digest = computeMaterialInputDigest(input);

  return createAllowDecision({
    validUntil: constraints.validUntil,
    materialInputDigest: digest,
    reservationId: undefined,
    constraints,
  }) satisfies AllowDecision;
}
