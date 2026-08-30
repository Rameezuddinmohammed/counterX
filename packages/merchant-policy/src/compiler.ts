/**
 * PolicyCompiler: transforms a MerchantPolicyRuleSet into
 * MerchantPolicyConstraints from @counter/policy.
 *
 * Validates rule sets for ambiguity (conflicting rules on the same
 * dimension), rejects invalid combinations, and produces a
 * CompiledMerchantPolicy with version, compiledAt, and constraintSnapshot.
 *
 * Uses Result<T> for all error paths (never throws).
 */

import type { DecimalQuantity, Instant, IsoCurrencyCode, Money, Result } from "@counter/domain";
import { createCanonicalError, err, ok } from "@counter/domain";
import type { MerchantPolicyConstraints, MerchantTimeWindow } from "@counter/policy";

import type { MerchantPolicyRuleConfig, MerchantPolicyRuleSet } from "./policy-config.js";
import { validateRuleSet } from "./policy-config.js";

// ---------------------------------------------------------------------------
// Compiled policy output
// ---------------------------------------------------------------------------

export interface CompiledMerchantPolicy {
  readonly version: number;
  readonly compiledAt: Instant;
  readonly constraints: MerchantPolicyConstraints;
  readonly reviewThresholdAmount: Money | undefined;
  readonly cancellationWindowMs: number | undefined;
  readonly cancellationRefundPercentage: number | undefined;
  readonly refundWindowMs: number | undefined;
  readonly partialRefundAllowed: boolean | undefined;
  readonly freshnessMaxAgeMs: number | undefined;
  readonly countLimit: { readonly maxCount: number; readonly windowDurationMs: number } | undefined;
}

// ---------------------------------------------------------------------------
// Ambiguity detection
// ---------------------------------------------------------------------------

type RuleDimension =
  | "products"
  | "categories"
  | "currency"
  | "quantity"
  | "count"
  | "destination"
  | "time-window"
  | "freshness"
  | "payment-path"
  | "review"
  | "cancellation"
  | "refund";

function dimensionOf(rule: MerchantPolicyRuleConfig): RuleDimension {
  switch (rule.kind) {
    case "product-allowlist":
      return "products";
    case "category-allowlist":
      return "categories";
    case "inr-only":
      return "currency";
    case "quantity-limit":
      return "quantity";
    case "count-limit":
      return "count";
    case "india-destination":
      return "destination";
    case "operating-window":
      return "time-window";
    case "freshness-requirement":
      return "freshness";
    case "payment-path":
      return "payment-path";
    case "review-threshold":
      return "review";
    case "cancellation-policy":
      return "cancellation";
    case "refund-policy":
      return "refund";
  }
}

function detectAmbiguity(rules: readonly MerchantPolicyRuleConfig[]): readonly string[] {
  const dimensionCounts = new Map<RuleDimension, number>();
  for (const rule of rules) {
    const dim = dimensionOf(rule);
    dimensionCounts.set(dim, (dimensionCounts.get(dim) ?? 0) + 1);
  }

  const conflicts: string[] = [];
  for (const [dim, count] of dimensionCounts) {
    if (count > 1) {
      conflicts.push(`Ambiguous: multiple rules on dimension "${dim}" (${String(count)} rules)`);
    }
  }

  return conflicts;
}

// ---------------------------------------------------------------------------
// Compiler
// ---------------------------------------------------------------------------

/**
 * Compiles a validated MerchantPolicyRuleSet into MerchantPolicyConstraints.
 *
 * @param ruleSet - The rule set to compile
 * @param now - The current instant (used for compiledAt timestamp)
 * @returns Result containing the compiled policy or a CanonicalError
 */
export function compileMerchantPolicy(
  ruleSet: MerchantPolicyRuleSet,
  now: Instant,
): Result<CompiledMerchantPolicy> {
  // Step 1: Structural validation
  const validationErrors = validateRuleSet(ruleSet);
  if (validationErrors.length > 0) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "INVALID_FORMAT",
        message: validationErrors.join("; "),
      }),
    );
  }

  // Step 2: Ambiguity detection
  const ambiguities = detectAmbiguity(ruleSet.rules);
  if (ambiguities.length > 0) {
    return err(
      createCanonicalError({
        category: "policy_denial",
        code: "POLICY_DENIED",
        message: ambiguities.join("; "),
      }),
    );
  }

  // Step 3: Build constraints from rules
  let allowedProducts: readonly string[] = [];
  let allowedCategories: readonly string[] = [];
  let allowedCurrencies: readonly IsoCurrencyCode[] = [];
  let maxQuantity: DecimalQuantity | undefined;
  let allowedDestinations: readonly string[] = [];
  let allowedPaymentPaths: readonly string[] = [];
  let timeWindow: MerchantTimeWindow = {
    allowedFrom: ruleSet.effectiveFrom,
    allowedUntil: ruleSet.effectiveUntil,
  };

  // Extended policy fields
  let reviewThresholdAmount: Money | undefined;
  let cancellationWindowMs: number | undefined;
  let cancellationRefundPercentage: number | undefined;
  let refundWindowMs: number | undefined;
  let partialRefundAllowed: boolean | undefined;
  let freshnessMaxAgeMs: number | undefined;
  let countLimit: { readonly maxCount: number; readonly windowDurationMs: number } | undefined;

  for (const rule of ruleSet.rules) {
    switch (rule.kind) {
      case "product-allowlist":
        allowedProducts = rule.products;
        break;
      case "category-allowlist":
        allowedCategories = rule.categories;
        break;
      case "inr-only":
        allowedCurrencies = ["INR" as IsoCurrencyCode];
        break;
      case "quantity-limit":
        maxQuantity = rule.maxQuantity;
        break;
      case "count-limit":
        countLimit = { maxCount: rule.maxCount, windowDurationMs: rule.windowDurationMs };
        break;
      case "india-destination":
        allowedDestinations = rule.allowedDestinations;
        break;
      case "operating-window":
        timeWindow = { allowedFrom: rule.allowedFrom, allowedUntil: rule.allowedUntil };
        break;
      case "freshness-requirement":
        freshnessMaxAgeMs = rule.maxAgeMs;
        break;
      case "payment-path":
        allowedPaymentPaths = rule.allowedMethods;
        break;
      case "review-threshold":
        reviewThresholdAmount = rule.thresholdAmount;
        break;
      case "cancellation-policy":
        cancellationWindowMs = rule.allowedWithinMs;
        cancellationRefundPercentage = rule.refundPercentage;
        break;
      case "refund-policy":
        refundWindowMs = rule.maxRefundWindowMs;
        partialRefundAllowed = rule.partialRefundAllowed;
        break;
    }
  }

  // Default maxQuantity if not specified
  const effectiveMaxQuantity: DecimalQuantity = maxQuantity ?? {
    value: "999999",
    unit: "item" as DecimalQuantity["unit"],
  };

  // Default min/max amounts
  const defaultCurrency = (
    allowedCurrencies.length > 0 ? allowedCurrencies[0] : "INR"
  ) as IsoCurrencyCode;
  const defaultMinAmount: Money = {
    amountMinor: 0n,
    currency: defaultCurrency,
  };
  const defaultMaxAmount: Money = {
    amountMinor: 99_999_999_99n,
    currency: defaultCurrency,
  };

  const constraints: MerchantPolicyConstraints = Object.freeze({
    version: 1,
    source: `merchant:${ruleSet.merchantId}:v${String(ruleSet.version)}`,
    allowedProducts: Object.freeze([...allowedProducts]),
    allowedCategories: Object.freeze([...allowedCategories]),
    maxQuantity: effectiveMaxQuantity,
    minAmount: defaultMinAmount,
    maxAmount: defaultMaxAmount,
    allowedCurrencies: Object.freeze([...allowedCurrencies]) as readonly IsoCurrencyCode[],
    allowedDestinations: Object.freeze([...allowedDestinations]),
    allowedPaymentPaths: Object.freeze([
      ...allowedPaymentPaths,
    ]) as MerchantPolicyConstraints["allowedPaymentPaths"],
    timeWindow: Object.freeze(timeWindow),
  });

  return ok(
    Object.freeze({
      version: ruleSet.version,
      compiledAt: now,
      constraints,
      reviewThresholdAmount,
      cancellationWindowMs,
      cancellationRefundPercentage,
      refundWindowMs,
      partialRefundAllowed,
      freshnessMaxAgeMs,
      countLimit,
    }),
  );
}
