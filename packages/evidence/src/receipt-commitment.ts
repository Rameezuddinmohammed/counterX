/**
 * Canonical receipt commitment computation.
 *
 * A ReceiptCommitment captures the canonical state of a transaction at a
 * point in time. It is deterministically serialized using RFC 8785
 * (JSON Canonicalization Scheme) and digested with SHA-256.
 *
 * The resulting digest is IDENTICAL for both merchant and wallet views,
 * proving they describe the same transaction state.
 */

import { sha256Digest, type Sha256Digest } from "@counter/domain";
import { canonicalizeToString } from "@counter/trust-protocol";
import type { ReceiptCommitment, ReceiptIssuanceInput } from "./receipt-types.js";

/**
 * Builds a ReceiptCommitment from issuance input data.
 * The commitment captures all fields that both audiences agree on.
 */
export function buildReceiptCommitment(input: ReceiptIssuanceInput): ReceiptCommitment {
  return {
    transactionId: input.transactionId,
    orchestrationPhase: input.orchestrationPhase,
    paymentState: input.paymentState,
    orderState: input.orderState,
    fulfillmentState: input.fulfillmentState,
    returnState: input.returnState,
    items: input.items,
    commercialTotals: input.commercialTotals,
    mandateDigest: input.mandateDigest,
    authorityDigest: input.authorityDigest,
    policyDecisionDigest: input.policyDecisionDigest,
    paymentAuthorizationClass: input.paymentAuthorizationClass,
    paymentProviderState: input.paymentProviderState,
    paymentEvidenceTime: input.paymentEvidenceTime,
    orderEvidenceTime: input.orderEvidenceTime,
    fulfillmentEvidenceTime: input.fulfillmentEvidenceTime,
    refundState: input.refundState,
    refundEvidenceTime: input.refundEvidenceTime,
    findingsSummary: {
      countBySeverity: input.findingsSeverityCounts,
      unresolvedIds: input.unresolvedLimitations,
    },
    assuranceLevel: input.assuranceLevel,
    evidenceRootDigest: input.evidenceRootDigest,
  };
}

/**
 * Computes the canonical commitment digest.
 *
 * The commitment is serialized to RFC 8785 canonical JSON, then
 * SHA-256 digested. This digest is the same for both merchant and
 * wallet views, proving they describe the same underlying transaction.
 */
export function computeCommitmentDigest(commitment: ReceiptCommitment): Sha256Digest {
  const canonicalJson = canonicalizeToString(commitment);
  const bytes = new TextEncoder().encode(canonicalJson);
  return sha256Digest(bytes);
}
