/**
 * Typed, versioned constraint types for all policy input sources.
 *
 * Each constraint type carries:
 * - A version field for schema evolution
 * - A source identifier for audit/traceability
 * - Readonly properties (immutable once constructed)
 */

import type { CounterId, DecimalQuantity, Instant, IsoCurrencyCode, Money } from "@counter/domain";

// ---------------------------------------------------------------------------
// Common types
// ---------------------------------------------------------------------------

/** Risk levels used in platform and risk-result constraints. */
export type RiskLevel = "low" | "medium" | "high" | "critical";

/** Assurance levels required for sensitive operations. */
export type AssuranceLevel = "none" | "basic" | "substantial" | "high";

/** Operation types for allowlists. */
export type OperationType =
  | "payment"
  | "refund"
  | "payout"
  | "transfer"
  | "subscription"
  | "mandate_create"
  | "mandate_execute";

/** Payment method types. */
export type PaymentMethod = "upi" | "card" | "netbanking" | "wallet" | "bank_transfer" | "bnpl";

/** Transaction phases for state constraints. */
export type TransactionPhase =
  | "initiated"
  | "authorized"
  | "captured"
  | "settled"
  | "refunded"
  | "cancelled"
  | "failed";

// ---------------------------------------------------------------------------
// 1. Platform Safety Constraints
// ---------------------------------------------------------------------------

export interface PlatformSafetyConstraints {
  readonly version: 1;
  readonly source: string;
  readonly blockedCategories: readonly string[];
  readonly blockedMerchants: readonly string[];
  readonly maxTransactionAmount: Money;
  readonly requiredAssuranceLevel: AssuranceLevel;
  readonly blockedCountries: readonly string[];
}

// ---------------------------------------------------------------------------
// 2. Buyer Policy Constraints
// ---------------------------------------------------------------------------

export interface BuyerAmountLimit {
  readonly maxAmount: Money;
}

export interface BuyerRollingLimit {
  readonly maxAmount: Money;
  readonly windowDurationMs: number;
}

export interface BuyerAggregateLimit {
  readonly maxTotalAmount: Money;
}

export interface BuyerQuantityLimit {
  readonly maxQuantity: DecimalQuantity;
}

export interface BuyerCountLimit {
  readonly maxCount: number;
  readonly windowDurationMs: number;
}

export interface BuyerTimeWindow {
  readonly allowedFrom: Instant;
  readonly allowedUntil: Instant;
}

export interface BuyerApprovalThreshold {
  readonly thresholdAmount: Money;
  readonly requiresApproval: boolean;
}

export interface BuyerPolicyConstraints {
  readonly version: 1;
  readonly source: string;
  readonly merchantAllowlist: readonly string[];
  readonly domainAllowlist: readonly string[];
  readonly indiaGeographyRequired: boolean;
  readonly allowedCategories: readonly string[];
  readonly allowedSkus: readonly string[];
  readonly inrCurrencyOnly: boolean;
  readonly perTransactionLimit: BuyerAmountLimit;
  readonly rollingPeriodLimit: BuyerRollingLimit;
  readonly aggregateLimit: BuyerAggregateLimit;
  readonly quantityLimit: BuyerQuantityLimit;
  readonly countLimit: BuyerCountLimit;
  readonly allowedOperations: readonly OperationType[];
  readonly timeWindow: BuyerTimeWindow;
  readonly approvalThreshold: BuyerApprovalThreshold;
}

// ---------------------------------------------------------------------------
// 3. Mandate Constraints
// ---------------------------------------------------------------------------

export interface MandateConstraints {
  readonly version: 1;
  readonly source: string;
  readonly authorityScope: string;
  readonly permittedOperations: readonly OperationType[];
  readonly minAmount: Money;
  readonly maxAmount: Money;
  readonly validFrom: Instant;
  readonly validUntil: Instant;
  readonly requiredAssuranceLevel: AssuranceLevel;
}

// ---------------------------------------------------------------------------
// 4. Merchant Policy Constraints
// ---------------------------------------------------------------------------

export interface MerchantTimeWindow {
  readonly allowedFrom: Instant;
  readonly allowedUntil: Instant;
}

export interface MerchantPolicyConstraints {
  readonly version: 1;
  readonly source: string;
  readonly allowedProducts: readonly string[];
  readonly allowedCategories: readonly string[];
  readonly maxQuantity: DecimalQuantity;
  readonly minAmount: Money;
  readonly maxAmount: Money;
  readonly allowedCurrencies: readonly IsoCurrencyCode[];
  readonly allowedDestinations: readonly string[];
  readonly allowedPaymentPaths: readonly PaymentMethod[];
  readonly timeWindow: MerchantTimeWindow;
}

// ---------------------------------------------------------------------------
// 5. Connector Capability Constraints
// ---------------------------------------------------------------------------

export interface ConnectorCapabilityConstraints {
  readonly version: 1;
  readonly source: string;
  readonly supportedOperations: readonly OperationType[];
  readonly freshnessMaxAgeMs: number;
  readonly lastRefreshedAt: Instant;
  readonly supportedCurrencies: readonly IsoCurrencyCode[];
  readonly supportedMethods: readonly PaymentMethod[];
}

// ---------------------------------------------------------------------------
// 6. Provider Constraints
// ---------------------------------------------------------------------------

export interface ProviderConstraints {
  readonly version: 1;
  readonly source: string;
  readonly supportedMethods: readonly PaymentMethod[];
  readonly supportedCurrencies: readonly IsoCurrencyCode[];
  readonly minAmount: Money;
  readonly maxAmount: Money;
}

// ---------------------------------------------------------------------------
// 7. Risk Result Constraints
// ---------------------------------------------------------------------------

export interface RiskResultConstraints {
  readonly version: 1;
  readonly source: string;
  readonly riskScore: number;
  readonly riskLevel: RiskLevel;
  readonly flags: readonly string[];
  readonly requiredActions: readonly string[];
}

// ---------------------------------------------------------------------------
// 8. Transaction State Constraints
// ---------------------------------------------------------------------------

export interface TransactionStateConstraints {
  readonly version: 1;
  readonly source: string;
  readonly currentPhase: TransactionPhase;
  readonly allowedTransitions: readonly TransactionPhase[];
  readonly stateVersion: number;
  readonly requiredBindings: readonly string[];
}

// ---------------------------------------------------------------------------
// Policy Evaluation Input
// ---------------------------------------------------------------------------

/**
 * All constraint snapshots gathered for a single policy evaluation.
 * Missing sources are represented as undefined and will fail closed (DENY).
 */
export interface PolicyEvaluationInput {
  readonly transactionId: CounterId<"transaction">;
  readonly operationType: OperationType;
  readonly requestedAmount: Money;
  readonly requestedAt: Instant;
  readonly merchantId: string;
  readonly merchantDomain: string;
  readonly merchantCategory: string;
  readonly buyerCountry: string;
  readonly sku: string;
  readonly quantity: DecimalQuantity;
  readonly paymentMethod: PaymentMethod;
  readonly destination: string;
  readonly platform: PlatformSafetyConstraints | undefined;
  readonly buyer: BuyerPolicyConstraints | undefined;
  readonly mandate: MandateConstraints | undefined;
  readonly merchant: MerchantPolicyConstraints | undefined;
  readonly connector: ConnectorCapabilityConstraints | undefined;
  readonly provider: ProviderConstraints | undefined;
  readonly risk: RiskResultConstraints | undefined;
  readonly transactionState: TransactionStateConstraints | undefined;
}
