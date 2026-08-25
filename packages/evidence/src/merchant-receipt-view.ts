/**
 * Merchant-audience receipt projection.
 *
 * Projects transaction data into a merchant-relevant view that includes
 * order reference, amount, payment status, provider, timestamps, and
 * a findings summary. Uses the existing receipt infrastructure for
 * CTP-signed envelope issuance.
 */

import type { CounterId, Instant, Sha256Digest } from "@counter/domain";
import { sha256Digest } from "@counter/domain";
import type { EvidenceRecord, FindingRecord } from "./types.js";
import type { FindingsSummary } from "./receipt-types.js";

// ---------------------------------------------------------------------------
// Merchant Receipt Projection Type
// ---------------------------------------------------------------------------

/**
 * Merchant-audience projection of a transaction. Contains only information
 * relevant to the merchant: order details, payment summary, finding indicators.
 * REDACTS wallet policy details, agent private metadata, and internal platform state.
 */
export interface MerchantReceiptProjection {
  readonly transactionId: CounterId<"transaction">;
  readonly merchantId: string;
  readonly orderRef: string | undefined;
  readonly amount: number | undefined;
  readonly currency: string | undefined;
  readonly paymentStatus: string;
  readonly paymentProvider: string;
  readonly orderStatus: string | undefined;
  readonly fulfillmentStatus: string | undefined;
  readonly refundStatus: string | undefined;
  readonly paymentTimestamp: Instant | undefined;
  readonly orderTimestamp: Instant | undefined;
  readonly findingsSummary: FindingsSummary;
  readonly projectedAt: Instant;
}

// ---------------------------------------------------------------------------
// Build Merchant Receipt View
// ---------------------------------------------------------------------------

export interface BuildMerchantReceiptViewInput {
  readonly transactionId: CounterId<"transaction">;
  readonly merchantId: string;
  readonly evidence: readonly EvidenceRecord[];
  readonly findings: readonly FindingRecord[];
  readonly now: Instant;
}

/**
 * Projects transaction data into a merchant-relevant receipt view.
 *
 * Extracts payment, order, and fulfillment information from evidence records,
 * computes a findings summary, and returns an immutable projection suitable
 * for the merchant audience.
 */
export function buildMerchantReceiptView(
  input: BuildMerchantReceiptViewInput,
): MerchantReceiptProjection {
  const { transactionId, merchantId, evidence, findings, now } = input;

  // Extract payment information from payment_provider evidence
  const paymentEvidence = evidence.filter((r) => r.source === "payment_provider");
  const latestPayment = paymentEvidence.length > 0
    ? paymentEvidence.reduce((latest, r) => (r.observedAt > latest.observedAt ? r : latest))
    : undefined;

  const paymentStatus = latestPayment?.canonicalClaim.type ?? "unknown";
  const paymentProvider = latestPayment !== undefined
    ? extractProviderName(latestPayment.sourceId)
    : "unknown";
  const amount = latestPayment?.canonicalClaim.details["amount"] as number | undefined;
  const currency = latestPayment?.canonicalClaim.details["currency"] as string | undefined;
  const paymentTimestamp = latestPayment?.observedAt;

  // Extract order information from merchant_connector evidence
  const orderEvidence = evidence.filter((r) => r.source === "merchant_connector");
  const latestOrder = orderEvidence.length > 0
    ? orderEvidence.reduce((latest, r) => (r.observedAt > latest.observedAt ? r : latest))
    : undefined;

  const orderRef = latestOrder?.canonicalClaim.details["orderId"] as string | undefined
    ?? latestOrder?.canonicalClaim.details["orderNumber"] as string | undefined;
  const orderStatus = latestOrder?.canonicalClaim.type;
  const orderTimestamp = latestOrder?.observedAt;

  // Extract fulfillment status
  const fulfillmentEvidence = evidence.filter(
    (r) =>
      r.canonicalClaim.type === "fulfillment_shipped" ||
      r.canonicalClaim.type === "fulfillment_delivered",
  );
  const latestFulfillment = fulfillmentEvidence.length > 0
    ? fulfillmentEvidence.reduce((latest, r) => (r.observedAt > latest.observedAt ? r : latest))
    : undefined;
  const fulfillmentStatus = latestFulfillment?.canonicalClaim.type;

  // Extract refund status
  const refundEvidence = evidence.filter(
    (r) => r.canonicalClaim.type === "refund_issued",
  );
  const refundStatus = refundEvidence.length > 0 ? "refund_issued" : undefined;

  // Build findings summary
  const findingsSummary = buildFindingsSummary(findings);

  return Object.freeze({
    transactionId,
    merchantId,
    orderRef,
    amount,
    currency,
    paymentStatus,
    paymentProvider,
    orderStatus,
    fulfillmentStatus,
    refundStatus,
    paymentTimestamp,
    orderTimestamp,
    findingsSummary,
    projectedAt: now,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractProviderName(sourceId: string): string {
  const colonIndex = sourceId.indexOf(":");
  if (colonIndex > 0) {
    return sourceId.slice(0, colonIndex);
  }
  return sourceId;
}

function buildFindingsSummary(findings: readonly FindingRecord[]): FindingsSummary {
  const countBySeverity: Record<string, number> = {};
  const unresolvedIds: string[] = [];

  for (const finding of findings) {
    const severity = finding.severity;
    countBySeverity[severity] = (countBySeverity[severity] ?? 0) + 1;

    if (finding.status !== "resolved" && finding.status !== "accepted") {
      unresolvedIds.push(finding.id);
    }
  }

  return Object.freeze({
    countBySeverity: Object.freeze(countBySeverity),
    unresolvedIds: Object.freeze(unresolvedIds),
  });
}

// ---------------------------------------------------------------------------
// Receipt Digest Computation (for CTP envelope integration)
// ---------------------------------------------------------------------------

/**
 * Computes a commitment digest for the merchant receipt projection.
 * Used when issuing a CTP-signed envelope for the merchant view.
 */
export function computeMerchantReceiptDigest(
  projection: MerchantReceiptProjection,
): Sha256Digest {
  const canonical = JSON.stringify({
    transactionId: projection.transactionId,
    merchantId: projection.merchantId,
    orderRef: projection.orderRef,
    amount: projection.amount,
    currency: projection.currency,
    paymentStatus: projection.paymentStatus,
    paymentProvider: projection.paymentProvider,
    projectedAt: projection.projectedAt,
  });
  return sha256Digest(new TextEncoder().encode(canonical));
}
