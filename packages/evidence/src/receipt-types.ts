/**
 * Receipt types for signed transaction receipts.
 *
 * Receipts are IMMUTABLE. Corrections create new receipts that reference
 * their predecessor via the supersession chain.
 */

import type { CounterId, Instant, Sha256Digest } from "@counter/domain";
import type {
  CommercialTotals,
  CtpEnvelope,
  ReceiptItem,
  TransactionReceiptPayload,
} from "@counter/trust-protocol";

// ---------------------------------------------------------------------------
// Receipt Audience
// ---------------------------------------------------------------------------

export const RECEIPT_AUDIENCES = ["merchant", "wallet"] as const;

export type ReceiptAudience = (typeof RECEIPT_AUDIENCES)[number];

const receiptAudienceSet: ReadonlySet<string> = new Set(RECEIPT_AUDIENCES);

export function isReceiptAudience(value: unknown): value is ReceiptAudience {
  return typeof value === "string" && receiptAudienceSet.has(value);
}

// ---------------------------------------------------------------------------
// Receipt Commitment (canonical transaction state snapshot)
// ---------------------------------------------------------------------------

/**
 * The canonical commitment captures the full deterministic state of a
 * transaction at a point in time. Both merchant and wallet views share
 * the same commitment digest.
 */
export interface ReceiptCommitment {
  readonly transactionId: string;
  readonly orchestrationPhase: string;
  readonly paymentState: string | undefined;
  readonly orderState: string | undefined;
  readonly fulfillmentState: string | undefined;
  readonly returnState: string | undefined;
  readonly items: readonly ReceiptItem[];
  readonly commercialTotals: CommercialTotals;
  readonly mandateDigest: string | undefined;
  readonly authorityDigest: string | undefined;
  readonly policyDecisionDigest: string | undefined;
  readonly paymentAuthorizationClass: string | undefined;
  readonly paymentProviderState: string | undefined;
  readonly paymentEvidenceTime: string | undefined;
  readonly orderEvidenceTime: string | undefined;
  readonly fulfillmentEvidenceTime: string | undefined;
  readonly refundState: string | undefined;
  readonly refundEvidenceTime: string | undefined;
  readonly findingsSummary: FindingsSummary;
  readonly assuranceLevel: string;
  readonly evidenceRootDigest: string | undefined;
}

/**
 * Summary of findings by severity plus unresolved IDs.
 */
export interface FindingsSummary {
  readonly countBySeverity: Readonly<Record<string, number>>;
  readonly unresolvedIds: readonly string[];
}

// ---------------------------------------------------------------------------
// Audience-Scoped Receipt Views
// ---------------------------------------------------------------------------

/**
 * Merchant view of a receipt. Includes order details, payment confirmation,
 * fulfillment. REDACTS wallet policy details, agent private metadata.
 */
export interface MerchantReceiptView {
  readonly receiptId: string;
  readonly transactionId: string;
  readonly merchantId: string;
  readonly orchestrationPhase: string;
  readonly items: readonly ReceiptItem[];
  readonly commercialTotals: CommercialTotals;
  readonly paymentState: string | undefined;
  readonly paymentEvidenceTime: string | undefined;
  readonly orderState: string | undefined;
  readonly orderEvidenceTime: string | undefined;
  readonly fulfillmentState: string | undefined;
  readonly fulfillmentEvidenceTime: string | undefined;
  readonly refundState: string | undefined;
  readonly refundEvidenceTime: string | undefined;
  readonly assuranceLevel: string;
  readonly canonicalCommitmentDigest: Sha256Digest;
  readonly predecessorReceiptId: string | undefined;
}

/**
 * Wallet view of a receipt. Includes intent/mandate summary, policy decision,
 * payment status, order confirmation. REDACTS merchant-internal connector
 * details, raw provider account info.
 */
export interface WalletReceiptView {
  readonly receiptId: string;
  readonly transactionId: string;
  readonly intentId: string;
  readonly orchestrationPhase: string;
  readonly items: readonly ReceiptItem[];
  readonly commercialTotals: CommercialTotals;
  readonly mandateSummary: string | undefined;
  readonly policyDecisionDigest: string | undefined;
  readonly paymentAuthorizationClass: string | undefined;
  readonly paymentState: string | undefined;
  readonly paymentEvidenceTime: string | undefined;
  readonly orderState: string | undefined;
  readonly orderEvidenceTime: string | undefined;
  readonly fulfillmentState: string | undefined;
  readonly fulfillmentEvidenceTime: string | undefined;
  readonly refundState: string | undefined;
  readonly refundEvidenceTime: string | undefined;
  readonly findingsSummary: FindingsSummary;
  readonly assuranceLevel: string;
  readonly canonicalCommitmentDigest: Sha256Digest;
  readonly predecessorReceiptId: string | undefined;
}

// ---------------------------------------------------------------------------
// Receipt Record (persisted in the store)
// ---------------------------------------------------------------------------

export interface ReceiptRecord {
  readonly id: CounterId<"receipt">;
  readonly transactionId: CounterId<"transaction">;
  readonly audience: ReceiptAudience;
  readonly version: number;
  readonly canonicalCommitmentDigest: Sha256Digest;
  readonly receiptEnvelope: CtpEnvelope<TransactionReceiptPayload>;
  readonly predecessorReceiptId: CounterId<"receipt"> | undefined;
  readonly issuedAt: Instant;
  readonly signingKeyId: string;
}

// ---------------------------------------------------------------------------
// Receipt Issuance Input
// ---------------------------------------------------------------------------

/**
 * Input data needed to issue a receipt for a transaction.
 */
export interface ReceiptIssuanceInput {
  readonly transactionId: CounterId<"transaction">;
  readonly intentId: string;
  readonly merchantId: string;
  readonly orchestrationPhase: string;
  readonly paymentState: string | undefined;
  readonly orderState: string | undefined;
  readonly fulfillmentState: string | undefined;
  readonly returnState: string | undefined;
  readonly items: readonly ReceiptItem[];
  readonly commercialTotals: CommercialTotals;
  readonly mandateDigest: string | undefined;
  readonly authorityDigest: string | undefined;
  readonly policyDecisionDigest: string | undefined;
  readonly paymentAuthorizationClass: string | undefined;
  readonly paymentProviderState: string | undefined;
  readonly paymentEvidenceTime: string | undefined;
  readonly orderEvidenceTime: string | undefined;
  readonly fulfillmentEvidenceTime: string | undefined;
  readonly refundState: string | undefined;
  readonly refundEvidenceTime: string | undefined;
  readonly findings: readonly string[];
  readonly unresolvedLimitations: readonly string[];
  readonly findingsSeverityCounts: Readonly<Record<string, number>>;
  readonly assuranceLevel: string;
  readonly evidenceRootDigest: string | undefined;
}
