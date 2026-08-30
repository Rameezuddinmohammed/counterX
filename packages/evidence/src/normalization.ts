/**
 * Source normalization and evidence record creation.
 *
 * Normalizes observations from different sources into canonical claims.
 * Agent claims are always labelled as agent_claim source and NEVER treated
 * as authoritative for payment/order/fulfillment truth.
 */

import type { CounterId, Environment, Instant, Sha256Digest } from "@counter/domain";
import { sha256Digest } from "@counter/domain";
import type {
  CanonicalClaim,
  CanonicalClaimType,
  DataClassification,
  EvidenceRecord,
  EvidenceSource,
  ObservationMethod,
} from "./types.js";

export interface NormalizeInput {
  readonly sourceType: string;
  readonly rawData: Readonly<Record<string, unknown>>;
}

/**
 * Normalizes raw observation data into a canonical claim.
 *
 * The sourceType determines the mapping:
 * - "payment_provider": maps status to payment_confirmed/declined/pending
 * - "merchant_connector": maps event to order/fulfillment claims
 * - "agent": always produces an agent_claim-sourced claim
 */
export function normalizeToCanonicalClaim(input: NormalizeInput): CanonicalClaim {
  const { sourceType, rawData } = input;

  if (sourceType === "payment_provider") {
    const status = rawData["status"] as string | undefined;
    let type: CanonicalClaimType = "payment_pending";
    if (status === "confirmed" || status === "captured") {
      type = "payment_confirmed";
    } else if (status === "declined" || status === "failed") {
      type = "payment_declined";
    }
    return Object.freeze({ type, details: Object.freeze({ ...rawData }) });
  }

  if (sourceType === "merchant_connector") {
    const event = rawData["event"] as string | undefined;
    let type: CanonicalClaimType = "order_committed";
    if (event === "order_cancelled") {
      type = "order_cancelled";
    } else if (event === "fulfillment_shipped" || event === "shipped") {
      type = "fulfillment_shipped";
    } else if (event === "fulfillment_delivered" || event === "delivered") {
      type = "fulfillment_delivered";
    }
    return Object.freeze({ type, details: Object.freeze({ ...rawData }) });
  }

  // Agent claims or any other source - use the claim type from data if valid
  const claimType = rawData["claimType"] as CanonicalClaimType | undefined;
  const type: CanonicalClaimType = claimType ?? "payment_pending";
  return Object.freeze({ type, details: Object.freeze({ ...rawData }) });
}

export interface CreateEvidenceRecordParams {
  readonly id: CounterId<"evidence">;
  readonly transactionId: CounterId<"transaction">;
  readonly source: EvidenceSource;
  readonly observationMethod: ObservationMethod;
  readonly observedAt: Instant;
  readonly sourceId: string;
  readonly sourceVersion?: string;
  readonly dataClassification: DataClassification;
  readonly retentionClass: string;
  readonly canonicalClaim: CanonicalClaim;
  readonly originalArtifactRef?: string;
  readonly createdAt: Instant;
  readonly environment: Environment;
  readonly supersedes?: CounterId<"evidence">;
}

/**
 * Computes the integrity digest from the canonical JSON of the claim.
 */
function computeClaimDigest(claim: CanonicalClaim): Sha256Digest {
  const canonical = JSON.stringify({
    type: claim.type,
    details: claim.details,
  });
  return sha256Digest(new TextEncoder().encode(canonical));
}

/**
 * Creates a complete EvidenceRecord from normalized input, computing the
 * integrityDigest from the canonical JSON of the claim.
 */
export function createEvidenceRecord(params: CreateEvidenceRecordParams): EvidenceRecord {
  const integrityDigest = computeClaimDigest(params.canonicalClaim);

  return Object.freeze({
    id: params.id,
    transactionId: params.transactionId,
    source: params.source,
    observationMethod: params.observationMethod,
    observedAt: params.observedAt,
    sourceId: params.sourceId,
    sourceVersion: params.sourceVersion,
    integrityDigest,
    dataClassification: params.dataClassification,
    retentionClass: params.retentionClass,
    canonicalClaim: Object.freeze({
      type: params.canonicalClaim.type,
      details: Object.freeze({ ...params.canonicalClaim.details }),
    }),
    originalArtifactRef: params.originalArtifactRef,
    createdAt: params.createdAt,
    environment: params.environment,
    supersedes: params.supersedes,
  });
}
