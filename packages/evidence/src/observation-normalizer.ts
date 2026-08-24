/**
 * Observation normalizers for external sources.
 *
 * Transforms raw observations from Shopify, TestProvider, Razorpay, and
 * agent claims into uniform EvidenceRecord format using the existing
 * normalization infrastructure.
 *
 * Each normalizer maps source-specific data to the correct EvidenceSource,
 * ObservationMethod, and CanonicalClaim, then delegates to createEvidenceRecord
 * for integrity-digest computation and immutable record creation.
 */

import type { CounterId, Environment, Instant } from "@counter/domain";
import type {
  CanonicalClaim,
  CanonicalClaimType,
  DataClassification,
  EvidenceRecord,
  EvidenceSource,
  ObservationMethod,
} from "./types.js";
import type { CreateEvidenceRecordParams } from "./normalization.js";
import { createEvidenceRecord } from "./normalization.js";

// ---------------------------------------------------------------------------
// Shared Types
// ---------------------------------------------------------------------------

export interface NormalizerContext {
  readonly evidenceId: CounterId<"evidence">;
  readonly transactionId: CounterId<"transaction">;
  readonly environment: Environment;
  readonly now: Instant;
}

// ---------------------------------------------------------------------------
// Shopify Observation
// ---------------------------------------------------------------------------

export interface ShopifyObservation {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly status: string;
  readonly financialStatus?: string;
  readonly fulfillmentStatus?: string;
  readonly totalPrice?: string;
  readonly currency?: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly cancelledAt?: string;
  readonly closedAt?: string;
  readonly sourceVersion?: string;
}

function mapShopifyStatusToClaimType(observation: ShopifyObservation): CanonicalClaimType {
  if (observation.cancelledAt !== undefined || observation.status === "cancelled") {
    return "order_cancelled";
  }
  if (observation.fulfillmentStatus === "shipped") {
    return "fulfillment_shipped";
  }
  if (observation.fulfillmentStatus === "delivered") {
    return "fulfillment_delivered";
  }
  if (observation.financialStatus === "paid" || observation.financialStatus === "partially_paid") {
    return "order_committed";
  }
  if (observation.financialStatus === "refunded" || observation.financialStatus === "partially_refunded") {
    return "refund_issued";
  }
  return "order_committed";
}

/**
 * Normalizes a Shopify order/draft observation into an EvidenceRecord.
 * Source: merchant_connector, Method: connector_read.
 */
export function normalizeShopifyObservation(
  observation: ShopifyObservation,
  context: NormalizerContext,
): EvidenceRecord {
  const claimType = mapShopifyStatusToClaimType(observation);

  const details: Record<string, unknown> = {
    orderId: observation.orderId,
    orderNumber: observation.orderNumber,
    status: observation.status,
  };
  if (observation.financialStatus !== undefined) {
    details["financialStatus"] = observation.financialStatus;
  }
  if (observation.fulfillmentStatus !== undefined) {
    details["fulfillmentStatus"] = observation.fulfillmentStatus;
  }
  if (observation.totalPrice !== undefined) {
    details["amount"] = observation.totalPrice;
  }
  if (observation.currency !== undefined) {
    details["currency"] = observation.currency;
  }

  const canonicalClaim: CanonicalClaim = Object.freeze({
    type: claimType,
    details: Object.freeze(details),
  });

  const base: CreateEvidenceRecordParams = {
    id: context.evidenceId,
    transactionId: context.transactionId,
    source: "merchant_connector" as EvidenceSource,
    observationMethod: "connector_read" as ObservationMethod,
    observedAt: context.now,
    sourceId: `shopify:${observation.orderId}`,
    dataClassification: "restricted" as DataClassification,
    retentionClass: "standard",
    canonicalClaim,
    originalArtifactRef: `shopify://orders/${observation.orderId}`,
    createdAt: context.now,
    environment: context.environment,
  };

  if (observation.sourceVersion !== undefined) {
    return createEvidenceRecord({ ...base, sourceVersion: observation.sourceVersion });
  }
  return createEvidenceRecord(base);
}

// ---------------------------------------------------------------------------
// TestProvider Observation
// ---------------------------------------------------------------------------

export interface TestProviderObservation {
  readonly paymentId: string;
  readonly status: string;
  readonly amount: number;
  readonly currency: string;
  readonly authorizationId?: string;
  readonly refundId?: string;
  readonly capturedAt?: string;
  readonly failureReason?: string;
  readonly sourceVersion?: string;
}

function mapTestProviderStatusToClaimType(status: string): CanonicalClaimType {
  switch (status) {
    case "captured":
    case "confirmed":
    case "succeeded":
      return "payment_confirmed";
    case "declined":
    case "failed":
      return "payment_declined";
    case "authorized":
      return "authorization_created";
    case "voided":
      return "authorization_voided";
    case "refunded":
      return "refund_issued";
    case "pending":
    default:
      return "payment_pending";
  }
}

/**
 * Normalizes a CounterTestPaymentProvider observation into an EvidenceRecord.
 * Source: payment_provider, Method: signed_envelope.
 */
export function normalizeTestProviderObservation(
  observation: TestProviderObservation,
  context: NormalizerContext,
): EvidenceRecord {
  const claimType = mapTestProviderStatusToClaimType(observation.status);

  const details: Record<string, unknown> = {
    paymentId: observation.paymentId,
    status: observation.status,
    amount: observation.amount,
    currency: observation.currency,
  };
  if (observation.authorizationId !== undefined) {
    details["authorizationId"] = observation.authorizationId;
  }
  if (observation.refundId !== undefined) {
    details["refundId"] = observation.refundId;
  }
  if (observation.failureReason !== undefined) {
    details["failureReason"] = observation.failureReason;
  }

  const canonicalClaim: CanonicalClaim = Object.freeze({
    type: claimType,
    details: Object.freeze(details),
  });

  const base: CreateEvidenceRecordParams = {
    id: context.evidenceId,
    transactionId: context.transactionId,
    source: "payment_provider" as EvidenceSource,
    observationMethod: "signed_envelope" as ObservationMethod,
    observedAt: context.now,
    sourceId: `test-provider:${observation.paymentId}`,
    dataClassification: "restricted" as DataClassification,
    retentionClass: "standard",
    canonicalClaim,
    originalArtifactRef: `counter-test-provider://payments/${observation.paymentId}`,
    createdAt: context.now,
    environment: context.environment,
  };

  if (observation.sourceVersion !== undefined) {
    return createEvidenceRecord({ ...base, sourceVersion: observation.sourceVersion });
  }
  return createEvidenceRecord(base);
}

// ---------------------------------------------------------------------------
// Razorpay Observation
// ---------------------------------------------------------------------------

export interface RazorpayObservation {
  readonly paymentId: string;
  readonly status: string;
  readonly amount: number;
  readonly currency: string;
  readonly method?: string;
  readonly orderId?: string;
  readonly refundId?: string;
  readonly refundAmount?: number;
  readonly errorCode?: string;
  readonly errorDescription?: string;
  readonly isWebhook: boolean;
  readonly sourceVersion?: string;
}

function mapRazorpayStatusToClaimType(observation: RazorpayObservation): CanonicalClaimType {
  switch (observation.status) {
    case "captured":
      return "payment_confirmed";
    case "authorized":
      return "authorization_created";
    case "failed":
      return "payment_declined";
    case "refunded":
      return "refund_issued";
    default:
      return "payment_pending";
  }
}

/**
 * Normalizes a Razorpay payment/refund observation into an EvidenceRecord.
 * Source: payment_provider, Method: api_query or verified_webhook (based on isWebhook flag).
 */
export function normalizeRazorpayObservation(
  observation: RazorpayObservation,
  context: NormalizerContext,
): EvidenceRecord {
  const claimType = mapRazorpayStatusToClaimType(observation);
  const method: ObservationMethod = observation.isWebhook ? "verified_webhook" : "api_query";

  const details: Record<string, unknown> = {
    paymentId: observation.paymentId,
    status: observation.status,
    amount: observation.amount,
    currency: observation.currency,
  };
  if (observation.method !== undefined) {
    details["paymentMethod"] = observation.method;
  }
  if (observation.orderId !== undefined) {
    details["orderId"] = observation.orderId;
  }
  if (observation.refundId !== undefined) {
    details["refundId"] = observation.refundId;
  }
  if (observation.refundAmount !== undefined) {
    details["refundAmount"] = observation.refundAmount;
  }
  if (observation.errorCode !== undefined) {
    details["errorCode"] = observation.errorCode;
  }
  if (observation.errorDescription !== undefined) {
    details["errorDescription"] = observation.errorDescription;
  }

  const canonicalClaim: CanonicalClaim = Object.freeze({
    type: claimType,
    details: Object.freeze(details),
  });

  const base: CreateEvidenceRecordParams = {
    id: context.evidenceId,
    transactionId: context.transactionId,
    source: "payment_provider" as EvidenceSource,
    observationMethod: method,
    observedAt: context.now,
    sourceId: `razorpay:${observation.paymentId}`,
    dataClassification: "restricted" as DataClassification,
    retentionClass: "standard",
    canonicalClaim,
    originalArtifactRef: `razorpay://payments/${observation.paymentId}`,
    createdAt: context.now,
    environment: context.environment,
  };

  if (observation.sourceVersion !== undefined) {
    return createEvidenceRecord({ ...base, sourceVersion: observation.sourceVersion });
  }
  return createEvidenceRecord(base);
}

// ---------------------------------------------------------------------------
// Agent Claim
// ---------------------------------------------------------------------------

export interface AgentClaimObservation {
  readonly agentId: string;
  readonly claimType: CanonicalClaimType;
  readonly details: Readonly<Record<string, unknown>>;
  readonly confidence?: number;
  readonly sourceVersion?: string;
}

/**
 * Normalizes an agent-reported state into an EvidenceRecord.
 * Source: agent_claim, Method: local_record.
 * Agent claims are NEVER authoritative for any claim type.
 */
export function normalizeAgentClaim(
  observation: AgentClaimObservation,
  context: NormalizerContext,
): EvidenceRecord {
  const details: Record<string, unknown> = { ...observation.details };
  if (observation.confidence !== undefined) {
    details["confidence"] = observation.confidence;
  }
  details["agentId"] = observation.agentId;

  const canonicalClaim: CanonicalClaim = Object.freeze({
    type: observation.claimType,
    details: Object.freeze(details),
  });

  const base: CreateEvidenceRecordParams = {
    id: context.evidenceId,
    transactionId: context.transactionId,
    source: "agent_claim" as EvidenceSource,
    observationMethod: "local_record" as ObservationMethod,
    observedAt: context.now,
    sourceId: `agent:${observation.agentId}`,
    dataClassification: "restricted" as DataClassification,
    retentionClass: "standard",
    canonicalClaim,
    createdAt: context.now,
    environment: context.environment,
  };

  if (observation.sourceVersion !== undefined) {
    return createEvidenceRecord({ ...base, sourceVersion: observation.sourceVersion });
  }
  return createEvidenceRecord(base);
}
