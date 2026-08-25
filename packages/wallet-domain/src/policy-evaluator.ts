/**
 * Deterministic buyer policy evaluation.
 *
 * Evaluates a proposed action against the current buyer policy constraints.
 * Checks all constraints in defined order, fails closed on any error,
 * and returns a deterministic PolicyDecision with plain-language reasons.
 *
 * Same input always produces the same output (no randomness, no clock reads).
 */

import type { BuyerPolicyConstraints } from "./buyer-policy.js";

// ---------------------------------------------------------------------------
// Proposed Action
// ---------------------------------------------------------------------------

/**
 * Describes a proposed action to be evaluated against policy.
 */
export interface ProposedAction {
  readonly merchantId: string;
  readonly merchantCountry: string;
  readonly deliveryCountry: string;
  readonly category?: string | undefined;
  readonly sku?: string | undefined;
  readonly currency: string;
  readonly amountPaise: bigint;
  readonly operation: string;
  readonly paymentReferenceId: string;
  readonly timestamp: string;
}

// ---------------------------------------------------------------------------
// Accumulated Usage (for rolling/aggregate checks)
// ---------------------------------------------------------------------------

/**
 * Accumulated usage for rolling period and aggregate limit checks.
 */
export interface AccumulatedUsage {
  readonly rollingPeriodTotalPaise: bigint;
  readonly aggregateTotalPaise: bigint;
  readonly transactionCount: number;
}

// ---------------------------------------------------------------------------
// Policy Decision
// ---------------------------------------------------------------------------

/**
 * The result of evaluating a proposed action against policy.
 */
export interface PolicyDecision {
  readonly outcome: "allowed" | "denied" | "review_required";
  readonly reasons: readonly string[];
  readonly evaluatedAt: string;
  readonly policyVersionId: string;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluates a proposed action against buyer policy constraints.
 *
 * Checks constraints in defined order:
 * 1. Merchant allowlist
 * 2. Geography (verified merchant country metadata, NOT IP/domain)
 * 3. Category/SKU
 * 4. Currency
 * 5. Amount limits (per-transaction)
 * 6. Rolling/aggregate limits
 * 7. Count limits
 * 8. Operation
 * 9. Payment reference
 * 10. Time constraints
 * 11. Approval threshold
 *
 * Fails closed: any error results in denial.
 * Deterministic: same input always produces same output.
 */
export function evaluatePolicy(
  policy: BuyerPolicyConstraints,
  action: ProposedAction,
  accumulatedUsage: AccumulatedUsage,
  policyVersionId: string,
): PolicyDecision {
  const reasons: string[] = [];

  try {
    // 1. Merchant allowlist
    checkMerchantAllowlist(policy, action, reasons);

    // 2. Geography (verified merchant country - NOT IP/domain)
    checkGeography(policy, action, reasons);

    // 3. Category/SKU
    checkCategory(policy, action, reasons);

    // 4. Currency
    checkCurrency(policy, action, reasons);

    // 5. Per-transaction amount limit
    checkPerTransactionAmount(policy, action, reasons);

    // 6. Rolling/aggregate limits
    checkRollingAndAggregateLimits(policy, action, accumulatedUsage, reasons);

    // 7. Count limits
    checkCountLimits(policy, accumulatedUsage, reasons);

    // 8. Operation
    checkOperation(policy, action, reasons);

    // 9. Payment reference
    checkPaymentReference(policy, action, reasons);

    // 10. Time constraints
    checkTimeConstraints(policy, action, reasons);

    // 11. Approval threshold - returns review_required if above threshold but otherwise allowed
    if (reasons.length === 0) {
      const reviewRequired = checkApprovalThreshold(policy, action);
      if (reviewRequired) {
        return {
          outcome: "review_required",
          reasons: [reviewRequired],
          evaluatedAt: action.timestamp,
          policyVersionId,
        };
      }
    }
  } catch {
    // Fail closed: any unexpected error results in denial
    reasons.push("Policy evaluation encountered an unexpected error - denied for safety");
  }

  if (reasons.length > 0) {
    return {
      outcome: "denied",
      reasons,
      evaluatedAt: action.timestamp,
      policyVersionId,
    };
  }

  return {
    outcome: "allowed",
    reasons: [],
    evaluatedAt: action.timestamp,
    policyVersionId,
  };
}

// ---------------------------------------------------------------------------
// Individual Constraint Checks
// ---------------------------------------------------------------------------

function checkMerchantAllowlist(
  policy: BuyerPolicyConstraints,
  action: ProposedAction,
  reasons: string[],
): void {
  const { allowedMerchantIds, allowedDomains } = policy.merchantAllowlist;

  // If both lists are empty, no merchants are allowed
  if (allowedMerchantIds.length === 0 && allowedDomains.length === 0) {
    reasons.push("Merchant allowlist is empty - no merchants are permitted");
    return;
  }

  // Check if merchant is in the allowlist
  if (allowedMerchantIds.length > 0 && !allowedMerchantIds.includes(action.merchantId)) {
    reasons.push(
      `Merchant '${action.merchantId}' is not in the allowed merchant list`,
    );
  }
}

function checkGeography(
  policy: BuyerPolicyConstraints,
  action: ProposedAction,
  reasons: string[],
): void {
  const { allowedMerchantCountries, allowedDeliveryCountries } = policy.geography;

  // Merchant country check: uses verified legal/settlement metadata, NOT IP/domain
  if (
    allowedMerchantCountries.length > 0 &&
    !allowedMerchantCountries.includes(action.merchantCountry)
  ) {
    reasons.push(
      `Merchant country '${action.merchantCountry}' is not in the allowed list (checked against verified merchant legal/settlement metadata, not IP or domain)`,
    );
  }

  // Delivery country check
  if (
    allowedDeliveryCountries.length > 0 &&
    !allowedDeliveryCountries.includes(action.deliveryCountry)
  ) {
    reasons.push(
      `Delivery country '${action.deliveryCountry}' is not in the allowed delivery countries`,
    );
  }
}

function checkCategory(
  policy: BuyerPolicyConstraints,
  action: ProposedAction,
  reasons: string[],
): void {
  const { allowedCategories, allowedSkus } = policy.category;

  if (action.category !== undefined && allowedCategories.length > 0) {
    if (!allowedCategories.includes(action.category)) {
      reasons.push(
        `Category '${action.category}' is not in the allowed categories`,
      );
    }
  }

  if (action.sku !== undefined && allowedSkus !== undefined && allowedSkus.length > 0) {
    if (!allowedSkus.includes(action.sku)) {
      reasons.push(
        `SKU '${action.sku}' is not in the allowed SKUs`,
      );
    }
  }
}

function checkCurrency(
  policy: BuyerPolicyConstraints,
  action: ProposedAction,
  reasons: string[],
): void {
  const { allowedCurrencies } = policy.currency;

  if (allowedCurrencies.length > 0 && !allowedCurrencies.includes(action.currency)) {
    reasons.push(
      `Currency '${action.currency}' is not in the allowed currencies (allowed: ${allowedCurrencies.join(", ")})`,
    );
  }
}

function checkPerTransactionAmount(
  policy: BuyerPolicyConstraints,
  action: ProposedAction,
  reasons: string[],
): void {
  if (action.amountPaise > policy.amountLimits.perTransactionMaxPaise) {
    reasons.push(
      `Transaction amount ${action.amountPaise} paise exceeds per-transaction limit of ${policy.amountLimits.perTransactionMaxPaise} paise`,
    );
  }
}

function checkRollingAndAggregateLimits(
  policy: BuyerPolicyConstraints,
  action: ProposedAction,
  accumulatedUsage: AccumulatedUsage,
  reasons: string[],
): void {
  const { rollingMaxPaise, aggregateMaxPaise } = policy.amountLimits;

  // Rolling period limit check
  if (rollingMaxPaise !== undefined) {
    const projectedRolling = accumulatedUsage.rollingPeriodTotalPaise + action.amountPaise;
    if (projectedRolling > rollingMaxPaise) {
      reasons.push(
        `Rolling period total would be ${projectedRolling} paise, exceeding rolling limit of ${rollingMaxPaise} paise`,
      );
    }
  }

  // Aggregate limit check
  if (aggregateMaxPaise !== undefined) {
    const projectedAggregate = accumulatedUsage.aggregateTotalPaise + action.amountPaise;
    if (projectedAggregate > aggregateMaxPaise) {
      reasons.push(
        `Aggregate total would be ${projectedAggregate} paise, exceeding aggregate limit of ${aggregateMaxPaise} paise`,
      );
    }
  }
}

function checkCountLimits(
  policy: BuyerPolicyConstraints,
  accumulatedUsage: AccumulatedUsage,
  reasons: string[],
): void {
  const { maxTransactions } = policy.countLimits;

  if (maxTransactions !== undefined) {
    // The current transaction would be the next one
    if (accumulatedUsage.transactionCount >= maxTransactions) {
      reasons.push(
        `Transaction count ${accumulatedUsage.transactionCount} has reached the maximum of ${maxTransactions}`,
      );
    }
  }
}

function checkOperation(
  policy: BuyerPolicyConstraints,
  action: ProposedAction,
  reasons: string[],
): void {
  const { allowedOperations } = policy.operations;

  if (allowedOperations.length > 0 && !allowedOperations.includes(action.operation)) {
    reasons.push(
      `Operation '${action.operation}' is not in the allowed operations (allowed: ${allowedOperations.join(", ")})`,
    );
  }
}

function checkPaymentReference(
  policy: BuyerPolicyConstraints,
  action: ProposedAction,
  reasons: string[],
): void {
  const { allowedReferenceIds } = policy.paymentReferences;

  if (allowedReferenceIds.length > 0 && !allowedReferenceIds.includes(action.paymentReferenceId)) {
    reasons.push(
      `Payment reference '${action.paymentReferenceId}' is not in the allowed references`,
    );
  }
}

function checkTimeConstraints(
  policy: BuyerPolicyConstraints,
  action: ProposedAction,
  reasons: string[],
): void {
  const { validDays, validStartTime, validEndTime, expiresAt } = policy.timeConstraints;

  // Check absolute expiry
  if (expiresAt !== undefined && action.timestamp >= expiresAt) {
    reasons.push("Policy has expired");
    return;
  }

  // Parse action timestamp for day-of-week and time-of-day checks
  const actionDate = new Date(action.timestamp);
  if (Number.isNaN(actionDate.getTime())) {
    reasons.push("Action timestamp is invalid - denied for safety");
    return;
  }

  // Check valid days (0=Sunday..6=Saturday)
  if (validDays !== undefined && validDays.length > 0) {
    const dayOfWeek = actionDate.getUTCDay();
    if (!validDays.includes(dayOfWeek)) {
      reasons.push(
        `Day of week ${dayOfWeek} is not in the allowed days (allowed: ${validDays.join(", ")})`,
      );
    }
  }

  // Check valid time window (HH:MM format, UTC)
  if (validStartTime !== undefined && validEndTime !== undefined) {
    const hours = actionDate.getUTCHours().toString().padStart(2, "0");
    const minutes = actionDate.getUTCMinutes().toString().padStart(2, "0");
    const currentTime = `${hours}:${minutes}`;

    if (currentTime < validStartTime || currentTime > validEndTime) {
      reasons.push(
        `Time '${currentTime}' UTC is outside the allowed window (${validStartTime} to ${validEndTime})`,
      );
    }
  }
}

function checkApprovalThreshold(
  policy: BuyerPolicyConstraints,
  action: ProposedAction,
): string | undefined {
  if (action.amountPaise > policy.approvalThreshold.thresholdPaise) {
    return `Transaction amount ${action.amountPaise} paise exceeds approval threshold of ${policy.approvalThreshold.thresholdPaise} paise - manual approval required`;
  }
  return undefined;
}
