/**
 * Typed merchant policy rule configurations.
 *
 * Each rule type is a discriminated union member with a `kind` field
 * and typed parameters. Rule configs are composed into a versioned
 * policy configuration that the compiler transforms into
 * MerchantPolicyConstraints.
 */

import type { DecimalQuantity, Instant, Money } from "@counter/domain";
import type { PaymentMethod } from "@counter/policy";

// ---------------------------------------------------------------------------
// Individual rule types (discriminated on `kind`)
// ---------------------------------------------------------------------------

export interface ProductAllowlistRule {
  readonly kind: "product-allowlist";
  readonly products: readonly string[];
}

export interface CategoryAllowlistRule {
  readonly kind: "category-allowlist";
  readonly categories: readonly string[];
}

export interface InrOnlyRule {
  readonly kind: "inr-only";
}

export interface QuantityLimitRule {
  readonly kind: "quantity-limit";
  readonly maxQuantity: DecimalQuantity;
}

export interface CountLimitRule {
  readonly kind: "count-limit";
  readonly maxCount: number;
  readonly windowDurationMs: number;
}

export interface IndiaDestinationRule {
  readonly kind: "india-destination";
  readonly allowedDestinations: readonly string[];
}

export interface OperatingWindowRule {
  readonly kind: "operating-window";
  readonly allowedFrom: Instant;
  readonly allowedUntil: Instant;
}

export interface FreshnessRequirementRule {
  readonly kind: "freshness-requirement";
  readonly maxAgeMs: number;
}

export interface PaymentPathRule {
  readonly kind: "payment-path";
  readonly allowedMethods: readonly PaymentMethod[];
}

export interface ReviewThresholdRule {
  readonly kind: "review-threshold";
  readonly thresholdAmount: Money;
}

export interface CancellationPolicyRule {
  readonly kind: "cancellation-policy";
  readonly allowedWithinMs: number;
  readonly refundPercentage: number;
}

export interface RefundPolicyRule {
  readonly kind: "refund-policy";
  readonly maxRefundWindowMs: number;
  readonly partialRefundAllowed: boolean;
}

// ---------------------------------------------------------------------------
// Discriminated union of all rule types
// ---------------------------------------------------------------------------

export type MerchantPolicyRuleConfig =
  | ProductAllowlistRule
  | CategoryAllowlistRule
  | InrOnlyRule
  | QuantityLimitRule
  | CountLimitRule
  | IndiaDestinationRule
  | OperatingWindowRule
  | FreshnessRequirementRule
  | PaymentPathRule
  | ReviewThresholdRule
  | CancellationPolicyRule
  | RefundPolicyRule;

/** All valid rule kinds. */
export const RULE_KINDS = [
  "product-allowlist",
  "category-allowlist",
  "inr-only",
  "quantity-limit",
  "count-limit",
  "india-destination",
  "operating-window",
  "freshness-requirement",
  "payment-path",
  "review-threshold",
  "cancellation-policy",
  "refund-policy",
] as const;

export type RuleKind = (typeof RULE_KINDS)[number];

// ---------------------------------------------------------------------------
// Versioned policy configuration
// ---------------------------------------------------------------------------

export interface MerchantPolicyRuleSet {
  readonly version: number;
  readonly merchantId: string;
  readonly rules: readonly MerchantPolicyRuleConfig[];
  readonly effectiveFrom: Instant;
  readonly effectiveUntil: Instant;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function isValidRuleKind(kind: unknown): kind is RuleKind {
  return typeof kind === "string" && (RULE_KINDS as readonly string[]).includes(kind);
}

/**
 * Validates a single rule config structurally.
 * Returns an array of error messages (empty means valid).
 */
export function validateRuleConfig(rule: MerchantPolicyRuleConfig): readonly string[] {
  const errors: string[] = [];

  switch (rule.kind) {
    case "product-allowlist":
      if (rule.products.length === 0) {
        errors.push("product-allowlist must have at least one product");
      }
      break;
    case "category-allowlist":
      if (rule.categories.length === 0) {
        errors.push("category-allowlist must have at least one category");
      }
      break;
    case "inr-only":
      // No parameters to validate
      break;
    case "quantity-limit":
      if (rule.maxQuantity.value === "0") {
        errors.push("quantity-limit maxQuantity must be greater than zero");
      }
      break;
    case "count-limit":
      if (rule.maxCount <= 0) {
        errors.push("count-limit maxCount must be positive");
      }
      if (rule.windowDurationMs <= 0) {
        errors.push("count-limit windowDurationMs must be positive");
      }
      break;
    case "india-destination":
      if (rule.allowedDestinations.length === 0) {
        errors.push("india-destination must have at least one destination");
      }
      break;
    case "operating-window":
      if (rule.allowedFrom >= rule.allowedUntil) {
        errors.push("operating-window allowedFrom must be before allowedUntil");
      }
      break;
    case "freshness-requirement":
      if (rule.maxAgeMs <= 0) {
        errors.push("freshness-requirement maxAgeMs must be positive");
      }
      break;
    case "payment-path":
      if (rule.allowedMethods.length === 0) {
        errors.push("payment-path must have at least one payment method");
      }
      break;
    case "review-threshold":
      if (rule.thresholdAmount.amountMinor <= 0n) {
        errors.push("review-threshold thresholdAmount must be positive");
      }
      break;
    case "cancellation-policy":
      if (rule.allowedWithinMs <= 0) {
        errors.push("cancellation-policy allowedWithinMs must be positive");
      }
      if (rule.refundPercentage < 0 || rule.refundPercentage > 100) {
        errors.push("cancellation-policy refundPercentage must be between 0 and 100");
      }
      break;
    case "refund-policy":
      if (rule.maxRefundWindowMs <= 0) {
        errors.push("refund-policy maxRefundWindowMs must be positive");
      }
      break;
  }

  return errors;
}

/**
 * Validates an entire rule set for structural correctness.
 */
export function validateRuleSet(ruleSet: MerchantPolicyRuleSet): readonly string[] {
  const errors: string[] = [];

  if (ruleSet.version <= 0) {
    errors.push("Policy version must be a positive integer");
  }

  if (ruleSet.merchantId.trim() === "") {
    errors.push("merchantId must not be empty");
  }

  if (ruleSet.rules.length === 0) {
    errors.push("Rule set must contain at least one rule");
  }

  if (ruleSet.effectiveFrom >= ruleSet.effectiveUntil) {
    errors.push("effectiveFrom must be before effectiveUntil");
  }

  for (const rule of ruleSet.rules) {
    const ruleErrors = validateRuleConfig(rule);
    for (const e of ruleErrors) {
      errors.push(e);
    }
  }

  return errors;
}
