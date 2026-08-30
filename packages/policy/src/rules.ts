/**
 * Individual rule evaluators.
 *
 * Each rule takes a PolicyEvaluationInput and returns a RuleResult.
 * Rules are pure functions: they examine constraints and produce pass/fail.
 */

import type { PolicyEvaluationInput } from "./types.js";

// ---------------------------------------------------------------------------
// Rule Result types
// ---------------------------------------------------------------------------

export type RuleOutcome = "pass" | "deny" | "review_required";

export interface RuleResult {
  readonly ruleId: string;
  readonly outcome: RuleOutcome;
  readonly explanation: string;
  readonly source: string;
}

// ---------------------------------------------------------------------------
// Rule evaluation helpers
// ---------------------------------------------------------------------------

function pass(ruleId: string, source: string): RuleResult {
  return Object.freeze({ ruleId, outcome: "pass" as const, explanation: "", source });
}

function deny(ruleId: string, explanation: string, source: string): RuleResult {
  return Object.freeze({ ruleId, outcome: "deny" as const, explanation, source });
}

function reviewRequired(ruleId: string, explanation: string, source: string): RuleResult {
  return Object.freeze({ ruleId, outcome: "review_required" as const, explanation, source });
}

// ---------------------------------------------------------------------------
// Rule: Platform Safety
// ---------------------------------------------------------------------------

export function evaluatePlatformSafety(input: PolicyEvaluationInput): RuleResult {
  const ruleId = "platform_safety";
  if (input.platform === undefined) {
    return deny(ruleId, "Platform safety constraints are missing", "platform");
  }
  const p = input.platform;

  if (p.blockedCategories.includes(input.merchantCategory)) {
    return deny(ruleId, "Merchant category is blocked by platform policy", p.source);
  }
  if (p.blockedMerchants.includes(input.merchantId)) {
    return deny(ruleId, "Merchant is blocked by platform policy", p.source);
  }
  if (p.blockedCountries.includes(input.buyerCountry)) {
    return deny(ruleId, "Buyer country is blocked by platform policy", p.source);
  }
  if (
    input.requestedAmount.currency === p.maxTransactionAmount.currency &&
    input.requestedAmount.amountMinor > p.maxTransactionAmount.amountMinor
  ) {
    return deny(ruleId, "Transaction exceeds platform maximum amount", p.source);
  }

  return pass(ruleId, p.source);
}

// ---------------------------------------------------------------------------
// Rule: Buyer Allowlist
// ---------------------------------------------------------------------------

export function evaluateBuyerAllowlist(input: PolicyEvaluationInput): RuleResult {
  const ruleId = "buyer_allowlist";
  if (input.buyer === undefined) {
    return deny(ruleId, "Buyer policy constraints are missing", "buyer");
  }
  const b = input.buyer;

  if (b.merchantAllowlist.length > 0 && !b.merchantAllowlist.includes(input.merchantId)) {
    return deny(ruleId, "Merchant is not in buyer allowlist", b.source);
  }
  if (b.domainAllowlist.length > 0 && !b.domainAllowlist.includes(input.merchantDomain)) {
    return deny(ruleId, "Merchant domain is not in buyer allowlist", b.source);
  }

  return pass(ruleId, b.source);
}

// ---------------------------------------------------------------------------
// Rule: Buyer Amount / Rolling Limit
// ---------------------------------------------------------------------------

export function evaluateBuyerAmountLimit(input: PolicyEvaluationInput): RuleResult {
  const ruleId = "buyer_amount_limit";
  if (input.buyer === undefined) {
    return deny(ruleId, "Buyer policy constraints are missing", "buyer");
  }
  const b = input.buyer;

  const limit = b.perTransactionLimit;
  if (
    input.requestedAmount.currency === limit.maxAmount.currency &&
    input.requestedAmount.amountMinor > limit.maxAmount.amountMinor
  ) {
    return deny(ruleId, "Transaction exceeds buyer per-transaction limit", b.source);
  }

  return pass(ruleId, b.source);
}

// ---------------------------------------------------------------------------
// Rule: Buyer Category/SKU
// ---------------------------------------------------------------------------

export function evaluateBuyerCategorySku(input: PolicyEvaluationInput): RuleResult {
  const ruleId = "buyer_category_sku";
  if (input.buyer === undefined) {
    return deny(ruleId, "Buyer policy constraints are missing", "buyer");
  }
  const b = input.buyer;

  if (b.allowedCategories.length > 0 && !b.allowedCategories.includes(input.merchantCategory)) {
    return deny(ruleId, "Category is not allowed by buyer policy", b.source);
  }
  if (b.allowedSkus.length > 0 && !b.allowedSkus.includes(input.sku)) {
    return deny(ruleId, "SKU is not allowed by buyer policy", b.source);
  }

  return pass(ruleId, b.source);
}

// ---------------------------------------------------------------------------
// Rule: Buyer Geography
// ---------------------------------------------------------------------------

export function evaluateBuyerGeography(input: PolicyEvaluationInput): RuleResult {
  const ruleId = "buyer_geography";
  if (input.buyer === undefined) {
    return deny(ruleId, "Buyer policy constraints are missing", "buyer");
  }
  const b = input.buyer;

  if (b.indiaGeographyRequired && input.buyerCountry !== "IN") {
    return deny(ruleId, "Buyer geography must be India per buyer policy", b.source);
  }
  if (b.inrCurrencyOnly && input.requestedAmount.currency !== ("INR" as unknown)) {
    return deny(ruleId, "Currency must be INR per buyer policy", b.source);
  }

  return pass(ruleId, b.source);
}

// ---------------------------------------------------------------------------
// Rule: Buyer Time Window
// ---------------------------------------------------------------------------

export function evaluateBuyerTimeWindow(input: PolicyEvaluationInput): RuleResult {
  const ruleId = "buyer_time_window";
  if (input.buyer === undefined) {
    return deny(ruleId, "Buyer policy constraints are missing", "buyer");
  }
  const b = input.buyer;

  if (
    input.requestedAt < b.timeWindow.allowedFrom ||
    input.requestedAt > b.timeWindow.allowedUntil
  ) {
    return deny(ruleId, "Transaction is outside buyer allowed time window", b.source);
  }

  return pass(ruleId, b.source);
}

// ---------------------------------------------------------------------------
// Rule: Buyer Operations
// ---------------------------------------------------------------------------

export function evaluateBuyerOperations(input: PolicyEvaluationInput): RuleResult {
  const ruleId = "buyer_operations";
  if (input.buyer === undefined) {
    return deny(ruleId, "Buyer policy constraints are missing", "buyer");
  }
  const b = input.buyer;

  if (b.allowedOperations.length > 0 && !b.allowedOperations.includes(input.operationType)) {
    return deny(ruleId, "Operation type is not allowed by buyer policy", b.source);
  }

  return pass(ruleId, b.source);
}

// ---------------------------------------------------------------------------
// Rule: Buyer Approval Threshold
// ---------------------------------------------------------------------------

export function evaluateBuyerApprovalThreshold(input: PolicyEvaluationInput): RuleResult {
  const ruleId = "buyer_approval_threshold";
  if (input.buyer === undefined) {
    return deny(ruleId, "Buyer policy constraints are missing", "buyer");
  }
  const b = input.buyer;

  const threshold = b.approvalThreshold;
  if (
    threshold.requiresApproval &&
    input.requestedAmount.currency === threshold.thresholdAmount.currency &&
    input.requestedAmount.amountMinor >= threshold.thresholdAmount.amountMinor
  ) {
    return reviewRequired(ruleId, "Transaction requires approval per buyer threshold", b.source);
  }

  return pass(ruleId, b.source);
}

// ---------------------------------------------------------------------------
// Rule: Mandate Scope
// ---------------------------------------------------------------------------

export function evaluateMandateScope(input: PolicyEvaluationInput): RuleResult {
  const ruleId = "mandate_scope";
  if (input.mandate === undefined) {
    // Mandate is optional - pass if not present
    return pass(ruleId, "mandate");
  }
  const m = input.mandate;

  if (!m.permittedOperations.includes(input.operationType)) {
    return deny(ruleId, "Operation is not permitted by mandate", m.source);
  }
  if (
    input.requestedAmount.currency === m.maxAmount.currency &&
    input.requestedAmount.amountMinor > m.maxAmount.amountMinor
  ) {
    return deny(ruleId, "Transaction exceeds mandate maximum amount", m.source);
  }
  if (
    input.requestedAmount.currency === m.minAmount.currency &&
    input.requestedAmount.amountMinor < m.minAmount.amountMinor
  ) {
    return deny(ruleId, "Transaction is below mandate minimum amount", m.source);
  }
  if (input.requestedAt < m.validFrom || input.requestedAt > m.validUntil) {
    return deny(ruleId, "Transaction is outside mandate validity period", m.source);
  }

  return pass(ruleId, m.source);
}

// ---------------------------------------------------------------------------
// Rule: Merchant Policy
// ---------------------------------------------------------------------------

export function evaluateMerchantPolicy(input: PolicyEvaluationInput): RuleResult {
  const ruleId = "merchant_policy";
  if (input.merchant === undefined) {
    return deny(ruleId, "Merchant policy constraints are missing", "merchant");
  }
  const m = input.merchant;

  if (m.allowedCategories.length > 0 && !m.allowedCategories.includes(input.merchantCategory)) {
    return deny(ruleId, "Category is not allowed by merchant policy", m.source);
  }
  if (m.allowedProducts.length > 0 && !m.allowedProducts.includes(input.sku)) {
    return deny(ruleId, "Product is not allowed by merchant policy", m.source);
  }
  if (
    input.requestedAmount.currency === m.maxAmount.currency &&
    input.requestedAmount.amountMinor > m.maxAmount.amountMinor
  ) {
    return deny(ruleId, "Transaction exceeds merchant maximum amount", m.source);
  }
  if (
    input.requestedAmount.currency === m.minAmount.currency &&
    input.requestedAmount.amountMinor < m.minAmount.amountMinor
  ) {
    return deny(ruleId, "Transaction is below merchant minimum amount", m.source);
  }
  if (
    m.allowedCurrencies.length > 0 &&
    !m.allowedCurrencies.includes(input.requestedAmount.currency)
  ) {
    return deny(ruleId, "Currency is not allowed by merchant policy", m.source);
  }
  if (m.allowedDestinations.length > 0 && !m.allowedDestinations.includes(input.destination)) {
    return deny(ruleId, "Destination is not allowed by merchant policy", m.source);
  }
  if (m.allowedPaymentPaths.length > 0 && !m.allowedPaymentPaths.includes(input.paymentMethod)) {
    return deny(ruleId, "Payment method is not allowed by merchant policy", m.source);
  }
  if (
    input.requestedAt < m.timeWindow.allowedFrom ||
    input.requestedAt > m.timeWindow.allowedUntil
  ) {
    return deny(ruleId, "Transaction is outside merchant allowed time window", m.source);
  }

  return pass(ruleId, m.source);
}

// ---------------------------------------------------------------------------
// Rule: Connector Freshness
// ---------------------------------------------------------------------------

export function evaluateConnectorFreshness(input: PolicyEvaluationInput): RuleResult {
  const ruleId = "connector_freshness";
  if (input.connector === undefined) {
    return deny(ruleId, "Connector capability constraints are missing", "connector");
  }
  const c = input.connector;

  if (!c.supportedOperations.includes(input.operationType)) {
    return deny(ruleId, "Operation is not supported by connector", c.source);
  }
  if (
    c.supportedCurrencies.length > 0 &&
    !c.supportedCurrencies.includes(input.requestedAmount.currency)
  ) {
    return deny(ruleId, "Currency is not supported by connector", c.source);
  }
  if (c.supportedMethods.length > 0 && !c.supportedMethods.includes(input.paymentMethod)) {
    return deny(ruleId, "Payment method is not supported by connector", c.source);
  }

  const ageMs = (input.requestedAt as number) - (c.lastRefreshedAt as number);
  if (ageMs > c.freshnessMaxAgeMs) {
    return deny(ruleId, "Connector capabilities are stale", c.source);
  }

  return pass(ruleId, c.source);
}

// ---------------------------------------------------------------------------
// Rule: Provider Capability
// ---------------------------------------------------------------------------

export function evaluateProviderCapability(input: PolicyEvaluationInput): RuleResult {
  const ruleId = "provider_capability";
  if (input.provider === undefined) {
    return deny(ruleId, "Provider constraints are missing", "provider");
  }
  const p = input.provider;

  if (p.supportedMethods.length > 0 && !p.supportedMethods.includes(input.paymentMethod)) {
    return deny(ruleId, "Payment method is not supported by provider", p.source);
  }
  if (
    p.supportedCurrencies.length > 0 &&
    !p.supportedCurrencies.includes(input.requestedAmount.currency)
  ) {
    return deny(ruleId, "Currency is not supported by provider", p.source);
  }
  if (
    input.requestedAmount.currency === p.maxAmount.currency &&
    input.requestedAmount.amountMinor > p.maxAmount.amountMinor
  ) {
    return deny(ruleId, "Transaction exceeds provider maximum amount", p.source);
  }
  if (
    input.requestedAmount.currency === p.minAmount.currency &&
    input.requestedAmount.amountMinor < p.minAmount.amountMinor
  ) {
    return deny(ruleId, "Transaction is below provider minimum amount", p.source);
  }

  return pass(ruleId, p.source);
}

// ---------------------------------------------------------------------------
// Rule: Risk Threshold
// ---------------------------------------------------------------------------

export function evaluateRiskThreshold(input: PolicyEvaluationInput): RuleResult {
  const ruleId = "risk_threshold";
  if (input.risk === undefined) {
    return deny(ruleId, "Risk result constraints are missing", "risk");
  }
  const r = input.risk;

  if (r.riskLevel === "critical") {
    return deny(ruleId, "Risk level is critical", r.source);
  }
  if (r.riskLevel === "high") {
    return reviewRequired(ruleId, "Risk level is high - review required", r.source);
  }
  if (r.requiredActions.length > 0) {
    return reviewRequired(ruleId, "Risk assessment requires additional actions", r.source);
  }

  return pass(ruleId, r.source);
}

// ---------------------------------------------------------------------------
// Rule: Transaction State Validity
// ---------------------------------------------------------------------------

export function evaluateTransactionState(input: PolicyEvaluationInput): RuleResult {
  const ruleId = "transaction_state";
  if (input.transactionState === undefined) {
    return deny(ruleId, "Transaction state constraints are missing", "transaction_state");
  }
  const t = input.transactionState;

  if (t.allowedTransitions.length > 0 && !t.allowedTransitions.includes(t.currentPhase)) {
    return deny(
      ruleId,
      "Current transaction phase does not allow the requested operation",
      t.source,
    );
  }

  return pass(ruleId, t.source);
}

// ---------------------------------------------------------------------------
// All rules evaluation
// ---------------------------------------------------------------------------

export type RuleEvaluator = (input: PolicyEvaluationInput) => RuleResult;

export const ALL_RULES: readonly RuleEvaluator[] = Object.freeze([
  evaluatePlatformSafety,
  evaluateBuyerAllowlist,
  evaluateBuyerAmountLimit,
  evaluateBuyerCategorySku,
  evaluateBuyerGeography,
  evaluateBuyerTimeWindow,
  evaluateBuyerOperations,
  evaluateBuyerApprovalThreshold,
  evaluateMandateScope,
  evaluateMerchantPolicy,
  evaluateConnectorFreshness,
  evaluateProviderCapability,
  evaluateRiskThreshold,
  evaluateTransactionState,
]);

export function evaluateAllRules(input: PolicyEvaluationInput): readonly RuleResult[] {
  return ALL_RULES.map((rule) => rule(input));
}
