/**
 * Policy widening detection.
 *
 * Detects when buyer policy constraints are being relaxed (widened),
 * which requires step-up authentication. Narrowing (tightening) or
 * emergency suspension takes immediate effect without step-up.
 *
 * Widening examples:
 * - Adding merchants to allowlist
 * - Increasing amount limits
 * - Adding categories or operations
 * - Extending time windows
 *
 * Narrowing examples:
 * - Removing merchants from allowlist
 * - Lowering amount limits
 * - Removing categories or operations
 */

import type { BuyerPolicyConstraints } from "./buyer-policy.js";

/**
 * Determines if a policy change from oldPolicy to newPolicy constitutes widening.
 * Widening means any constraint is being relaxed to allow more actions.
 *
 * Returns true if the new policy is wider (requires step-up).
 * Returns false if the new policy is narrower or equivalent (immediate effect).
 */
export function isWidening(
  oldPolicy: BuyerPolicyConstraints,
  newPolicy: BuyerPolicyConstraints,
): boolean {
  // Check merchant allowlist widening
  if (isArrayWidened(oldPolicy.merchantAllowlist.allowedMerchantIds, newPolicy.merchantAllowlist.allowedMerchantIds)) {
    return true;
  }
  if (isArrayWidened(oldPolicy.merchantAllowlist.allowedDomains, newPolicy.merchantAllowlist.allowedDomains)) {
    return true;
  }

  // Check geography widening
  if (isArrayWidened(oldPolicy.geography.allowedMerchantCountries, newPolicy.geography.allowedMerchantCountries)) {
    return true;
  }
  if (isArrayWidened(oldPolicy.geography.allowedDeliveryCountries, newPolicy.geography.allowedDeliveryCountries)) {
    return true;
  }

  // Check category widening
  if (isArrayWidened(oldPolicy.category.allowedCategories, newPolicy.category.allowedCategories)) {
    return true;
  }
  if (isOptionalArrayWidened(oldPolicy.category.allowedSkus, newPolicy.category.allowedSkus)) {
    return true;
  }

  // Check currency widening
  if (isArrayWidened(oldPolicy.currency.allowedCurrencies, newPolicy.currency.allowedCurrencies)) {
    return true;
  }

  // Check amount limits widening (higher limits = wider)
  if (newPolicy.amountLimits.perTransactionMaxPaise > oldPolicy.amountLimits.perTransactionMaxPaise) {
    return true;
  }
  if (isBigintLimitWidened(oldPolicy.amountLimits.rollingMaxPaise, newPolicy.amountLimits.rollingMaxPaise)) {
    return true;
  }
  if (isBigintLimitWidened(oldPolicy.amountLimits.aggregateMaxPaise, newPolicy.amountLimits.aggregateMaxPaise)) {
    return true;
  }

  // Check count limits widening (higher counts = wider)
  if (isNumberLimitWidened(oldPolicy.countLimits.maxTransactions, newPolicy.countLimits.maxTransactions)) {
    return true;
  }
  if (isNumberLimitWidened(oldPolicy.countLimits.maxQuantityPerTransaction, newPolicy.countLimits.maxQuantityPerTransaction)) {
    return true;
  }

  // Check operations widening
  if (isArrayWidened(oldPolicy.operations.allowedOperations, newPolicy.operations.allowedOperations)) {
    return true;
  }

  // Check approval threshold widening (higher threshold = wider, less manual review)
  if (newPolicy.approvalThreshold.thresholdPaise > oldPolicy.approvalThreshold.thresholdPaise) {
    return true;
  }

  // Check payment references widening
  if (isArrayWidened(oldPolicy.paymentReferences.allowedReferenceIds, newPolicy.paymentReferences.allowedReferenceIds)) {
    return true;
  }

  // Check time constraints widening
  if (isTimeConstraintsWidened(oldPolicy, newPolicy)) {
    return true;
  }

  return false;
}

/**
 * Checks if a readonly string array has been widened (new elements added).
 */
function isArrayWidened(
  oldArr: readonly string[],
  newArr: readonly string[],
): boolean {
  const oldSet = new Set(oldArr);
  for (const item of newArr) {
    if (!oldSet.has(item)) {
      return true;
    }
  }
  return false;
}

/**
 * Checks if an optional array has been widened.
 * Going from defined to undefined means removing restriction = widening.
 * Adding new elements to a defined array = widening.
 */
function isOptionalArrayWidened(
  oldArr: readonly string[] | undefined,
  newArr: readonly string[] | undefined,
): boolean {
  // If old had restrictions and new removes them, that is widening
  if (oldArr !== undefined && oldArr.length > 0 && newArr === undefined) {
    return true;
  }
  // If both defined, check for new elements
  if (oldArr !== undefined && newArr !== undefined) {
    return isArrayWidened(oldArr, newArr);
  }
  return false;
}

/**
 * Checks if an optional bigint limit has been widened.
 * Removing a limit (defined -> undefined) = widening.
 * Increasing a limit = widening.
 */
function isBigintLimitWidened(
  oldLimit: bigint | undefined,
  newLimit: bigint | undefined,
): boolean {
  // Removing a limit entirely is widening
  if (oldLimit !== undefined && newLimit === undefined) {
    return true;
  }
  // Increasing a limit is widening
  if (oldLimit !== undefined && newLimit !== undefined && newLimit > oldLimit) {
    return true;
  }
  return false;
}

/**
 * Checks if an optional number limit has been widened.
 * Removing a limit (defined -> undefined) = widening.
 * Increasing a limit = widening.
 */
function isNumberLimitWidened(
  oldLimit: number | undefined,
  newLimit: number | undefined,
): boolean {
  // Removing a limit entirely is widening
  if (oldLimit !== undefined && newLimit === undefined) {
    return true;
  }
  // Increasing a limit is widening
  if (oldLimit !== undefined && newLimit !== undefined && newLimit > oldLimit) {
    return true;
  }
  return false;
}

/**
 * Checks if time constraints have been widened.
 * Adding more valid days, extending time window, or removing expiry = widening.
 */
function isTimeConstraintsWidened(
  oldPolicy: BuyerPolicyConstraints,
  newPolicy: BuyerPolicyConstraints,
): boolean {
  const oldTime = oldPolicy.timeConstraints;
  const newTime = newPolicy.timeConstraints;

  // Adding more valid days is widening
  if (oldTime.validDays !== undefined && oldTime.validDays.length > 0) {
    if (newTime.validDays === undefined) {
      // Removing day restriction = widening
      return true;
    }
    const oldDaySet = new Set(oldTime.validDays);
    for (const day of newTime.validDays) {
      if (!oldDaySet.has(day)) {
        return true;
      }
    }
  }

  // Extending time window is widening
  if (oldTime.validStartTime !== undefined && newTime.validStartTime !== undefined) {
    if (newTime.validStartTime < oldTime.validStartTime) {
      return true; // Earlier start = wider
    }
  }
  if (oldTime.validEndTime !== undefined && newTime.validEndTime !== undefined) {
    if (newTime.validEndTime > oldTime.validEndTime) {
      return true; // Later end = wider
    }
  }
  // Removing start/end time restriction is widening
  if (oldTime.validStartTime !== undefined && newTime.validStartTime === undefined) {
    return true;
  }
  if (oldTime.validEndTime !== undefined && newTime.validEndTime === undefined) {
    return true;
  }

  // Removing or extending expiry is widening
  if (oldTime.expiresAt !== undefined && newTime.expiresAt === undefined) {
    return true; // Removing expiry = widening
  }
  if (oldTime.expiresAt !== undefined && newTime.expiresAt !== undefined) {
    if (newTime.expiresAt > oldTime.expiresAt) {
      return true; // Later expiry = wider
    }
  }

  return false;
}
