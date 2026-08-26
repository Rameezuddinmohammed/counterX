/**
 * Buyer policy immutable versioned constraint types.
 *
 * Buyer policies define what actions a wallet can perform. They are immutable
 * by version: each change creates a new version that supersedes the previous.
 * Constraints cover merchant allowlists, geography (India legal/settlement
 * metadata, NOT IP), categories, currencies, amount limits, count limits,
 * operations, time windows, approval thresholds, and payment references.
 */

import type { CounterId } from "@counter/domain";

// ---------------------------------------------------------------------------
// Individual Constraint Types
// ---------------------------------------------------------------------------

/**
 * Merchant allowlist constraint.
 * Merchants are identified by Counter merchant IDs and verified domains.
 */
export interface MerchantAllowlistConstraint {
  readonly allowedMerchantIds: readonly string[];
  readonly allowedDomains: readonly string[];
}

/**
 * Geography constraint.
 * India = "IN" on merchant verified legal/settlement metadata, NOT IP/domain.
 * Delivery countries are the buyer's declared delivery destinations.
 */
export interface GeographyConstraint {
  readonly allowedMerchantCountries: readonly string[];
  readonly allowedDeliveryCountries: readonly string[];
}

/**
 * Category constraint.
 * Product categories with optional SKU-level restrictions.
 */
export interface CategoryConstraint {
  readonly allowedCategories: readonly string[];
  readonly allowedSkus?: readonly string[] | undefined;
}

/**
 * Currency constraint.
 * Pilot: ["INR"] only.
 */
export interface CurrencyConstraint {
  readonly allowedCurrencies: readonly string[];
}

/**
 * Amount limits constraint.
 * All amounts in paise (bigint) for precision.
 */
export interface AmountLimitsConstraint {
  readonly perTransactionMaxPaise: bigint;
  readonly rollingPeriodMs?: number | undefined;
  readonly rollingMaxPaise?: bigint | undefined;
  readonly aggregateMaxPaise?: bigint | undefined;
}

/**
 * Count limits constraint.
 * Limits on the number of transactions and quantity per transaction.
 */
export interface CountLimitsConstraint {
  readonly maxTransactions?: number | undefined;
  readonly maxQuantityPerTransaction?: number | undefined;
}

/**
 * Operation constraint.
 * Permitted operations (e.g., "purchase", "refund").
 */
export interface OperationConstraint {
  readonly allowedOperations: readonly string[];
}

/**
 * Time constraint.
 * Valid days (0=Sunday..6=Saturday), valid time range, and absolute expiry.
 */
export interface TimeConstraint {
  readonly validDays?: readonly number[] | undefined;
  readonly validStartTime?: string | undefined;
  readonly validEndTime?: string | undefined;
  readonly expiresAt?: string | undefined;
}

/**
 * Approval threshold constraint.
 * Amounts above this require manual principal approval.
 */
export interface ApprovalThresholdConstraint {
  readonly thresholdPaise: bigint;
}

/**
 * Payment reference constraint.
 * Only the listed payment authorization reference IDs are permitted.
 */
export interface PaymentReferenceConstraint {
  readonly allowedReferenceIds: readonly string[];
}

// ---------------------------------------------------------------------------
// Composite Constraints
// ---------------------------------------------------------------------------

/**
 * Complete buyer policy constraints combining all constraint types.
 */
export interface BuyerPolicyConstraints {
  readonly merchantAllowlist: MerchantAllowlistConstraint;
  readonly geography: GeographyConstraint;
  readonly category: CategoryConstraint;
  readonly currency: CurrencyConstraint;
  readonly amountLimits: AmountLimitsConstraint;
  readonly countLimits: CountLimitsConstraint;
  readonly operations: OperationConstraint;
  readonly timeConstraints: TimeConstraint;
  readonly approvalThreshold: ApprovalThresholdConstraint;
  readonly paymentReferences: PaymentReferenceConstraint;
}

// ---------------------------------------------------------------------------
// Buyer Policy Version
// ---------------------------------------------------------------------------

/**
 * An immutable versioned buyer policy.
 * Each change creates a new version that supersedes the previous.
 */
export interface BuyerPolicyVersion {
  readonly versionId: string;
  readonly walletId: CounterId<"wallet">;
  readonly constraints: BuyerPolicyConstraints;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly supersedes?: string | undefined;
}
