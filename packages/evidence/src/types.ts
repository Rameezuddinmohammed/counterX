/**
 * Core types and enumerations for the evidence package.
 *
 * All types are readonly interfaces. Enumerations use const arrays with
 * 'as const' and corresponding type guards following domain conventions.
 */

import type { CounterId, Environment, Instant, Money, Sha256Digest } from "@counter/domain";

// ---------------------------------------------------------------------------
// Evidence Source
// ---------------------------------------------------------------------------

export const EVIDENCE_SOURCES = [
  "wallet_intent",
  "merchant_connector",
  "payment_provider",
  "counter_service",
  "agent_claim",
] as const;

export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];

const evidenceSourceSet: ReadonlySet<string> = new Set(EVIDENCE_SOURCES);

export function isEvidenceSource(value: unknown): value is EvidenceSource {
  return typeof value === "string" && evidenceSourceSet.has(value);
}

// ---------------------------------------------------------------------------
// Observation Method
// ---------------------------------------------------------------------------

export const OBSERVATION_METHODS = [
  "api_query",
  "verified_webhook",
  "signed_envelope",
  "connector_read",
  "local_record",
] as const;

export type ObservationMethod = (typeof OBSERVATION_METHODS)[number];

const observationMethodSet: ReadonlySet<string> = new Set(OBSERVATION_METHODS);

export function isObservationMethod(value: unknown): value is ObservationMethod {
  return typeof value === "string" && observationMethodSet.has(value);
}

// ---------------------------------------------------------------------------
// Data Classification
// ---------------------------------------------------------------------------

export const DATA_CLASSIFICATIONS = ["public", "restricted", "confidential"] as const;

export type DataClassification = (typeof DATA_CLASSIFICATIONS)[number];

const dataClassificationSet: ReadonlySet<string> = new Set(DATA_CLASSIFICATIONS);

export function isDataClassification(value: unknown): value is DataClassification {
  return typeof value === "string" && dataClassificationSet.has(value);
}

// ---------------------------------------------------------------------------
// Canonical Claim Type
// ---------------------------------------------------------------------------

export const CANONICAL_CLAIM_TYPES = [
  "payment_confirmed",
  "payment_declined",
  "payment_pending",
  "order_committed",
  "order_cancelled",
  "refund_issued",
  "refund_declined",
  "fulfillment_shipped",
  "fulfillment_delivered",
  "authorization_created",
  "authorization_voided",
  "intent_created",
  "consent_given",
  "consent_revoked",
] as const;

export type CanonicalClaimType = (typeof CANONICAL_CLAIM_TYPES)[number];

const canonicalClaimTypeSet: ReadonlySet<string> = new Set(CANONICAL_CLAIM_TYPES);

export function isCanonicalClaimType(value: unknown): value is CanonicalClaimType {
  return typeof value === "string" && canonicalClaimTypeSet.has(value);
}

// ---------------------------------------------------------------------------
// Canonical Claim
// ---------------------------------------------------------------------------

export interface CanonicalClaim {
  readonly type: CanonicalClaimType;
  readonly details: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Evidence Record
// ---------------------------------------------------------------------------

export interface EvidenceRecord {
  readonly id: CounterId<"evidence">;
  readonly transactionId: CounterId<"transaction">;
  readonly source: EvidenceSource;
  readonly observationMethod: ObservationMethod;
  readonly observedAt: Instant;
  readonly sourceId: string;
  readonly sourceVersion: string | undefined;
  readonly integrityDigest: Sha256Digest;
  readonly dataClassification: DataClassification;
  readonly retentionClass: string;
  readonly canonicalClaim: CanonicalClaim;
  readonly originalArtifactRef: string | undefined;
  readonly createdAt: Instant;
  readonly environment: Environment;
  readonly supersedes: CounterId<"evidence"> | undefined;
}

// ---------------------------------------------------------------------------
// Audit Action
// ---------------------------------------------------------------------------

export const AUDIT_ACTIONS = [
  "evidence_appended",
  "finding_created",
  "finding_transitioned",
  "compensation_attempted",
  "checkpoint_created",
  "integrity_verified",
  "integrity_failed",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

const auditActionSet: ReadonlySet<string> = new Set(AUDIT_ACTIONS);

export function isAuditAction(value: unknown): value is AuditAction {
  return typeof value === "string" && auditActionSet.has(value);
}

// ---------------------------------------------------------------------------
// Actor Kind
// ---------------------------------------------------------------------------

export const ACTOR_KINDS = ["principal", "agent", "service", "operator"] as const;

export type ActorKind = (typeof ACTOR_KINDS)[number];

const actorKindSet: ReadonlySet<string> = new Set(ACTOR_KINDS);

export function isActorKind(value: unknown): value is ActorKind {
  return typeof value === "string" && actorKindSet.has(value);
}

// ---------------------------------------------------------------------------
// Audit Entry
// ---------------------------------------------------------------------------

export interface AuditEntry {
  readonly id: string;
  readonly actorId: string;
  readonly actorKind: ActorKind;
  readonly action: AuditAction;
  readonly targetType: string;
  readonly targetId: string;
  readonly environment: Environment;
  readonly scope: string;
  readonly correlationId: string;
  readonly timestamp: Instant;
  readonly evidenceRefs: readonly CounterId<"evidence">[];
  readonly metadata: Readonly<Record<string, unknown>> | undefined;
}

// ---------------------------------------------------------------------------
// Integrity Checkpoint
// ---------------------------------------------------------------------------

export interface IntegrityCheckpoint {
  readonly id: string;
  readonly sequenceNumber: number;
  readonly previousCheckpointDigest: Sha256Digest | undefined;
  readonly entriesDigest: Sha256Digest;
  readonly createdAt: Instant;
}

// ---------------------------------------------------------------------------
// Finding Severity
// ---------------------------------------------------------------------------

export const FINDING_SEVERITIES = ["critical", "high", "medium", "low", "advisory"] as const;

export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

const findingSeveritySet: ReadonlySet<string> = new Set(FINDING_SEVERITIES);

export function isFindingSeverity(value: unknown): value is FindingSeverity {
  return typeof value === "string" && findingSeveritySet.has(value);
}

// ---------------------------------------------------------------------------
// Finding Type
// ---------------------------------------------------------------------------

export const FINDING_TYPES = [
  "intent_authority_mismatch",
  "price_mismatch",
  "duplicate_effect",
  "payment_order_mismatch",
  "fulfillment_mismatch",
  "orphaned_authorization",
  "refund_mismatch",
  "stale_evidence",
  "integrity_failure",
  "resolved_indeterminate",
] as const;

export type FindingType = (typeof FINDING_TYPES)[number];

const findingTypeSet: ReadonlySet<string> = new Set(FINDING_TYPES);

export function isFindingType(value: unknown): value is FindingType {
  return typeof value === "string" && findingTypeSet.has(value);
}

// ---------------------------------------------------------------------------
// Finding Status
// ---------------------------------------------------------------------------

export const FINDING_STATUSES = [
  "open",
  "investigating",
  "compensating",
  "resolved",
  "unresolved",
  "accepted",
] as const;

export type FindingStatus = (typeof FINDING_STATUSES)[number];

const findingStatusSet: ReadonlySet<string> = new Set(FINDING_STATUSES);

export function isFindingStatus(value: unknown): value is FindingStatus {
  return typeof value === "string" && findingStatusSet.has(value);
}

// ---------------------------------------------------------------------------
// Finding Record
// ---------------------------------------------------------------------------

export interface FindingRecord {
  readonly id: CounterId<"finding">;
  readonly type: FindingType;
  readonly severity: FindingSeverity;
  readonly affectedObjects: readonly string[];
  readonly conflictingEvidence: readonly CounterId<"evidence">[] | undefined;
  readonly missingEvidence: readonly string[] | undefined;
  readonly detectedAt: Instant;
  readonly ownerId: string;
  readonly permittedCompensation: readonly CompensationCommandRecord[] | undefined;
  readonly status: FindingStatus;
  readonly resolutionEvidence: readonly CounterId<"evidence">[] | undefined;
  readonly environment: Environment;
}

// ---------------------------------------------------------------------------
// Compensation Type
// ---------------------------------------------------------------------------

export const COMPENSATION_TYPES = [
  "refund",
  "void",
  "cancel_order",
  "create_finding",
  "escalate_human",
] as const;

export type CompensationType = (typeof COMPENSATION_TYPES)[number];

const compensationTypeSet: ReadonlySet<string> = new Set(COMPENSATION_TYPES);

export function isCompensationType(value: unknown): value is CompensationType {
  return typeof value === "string" && compensationTypeSet.has(value);
}

// ---------------------------------------------------------------------------
// Compensation Command Record
// ---------------------------------------------------------------------------

export interface CompensationCommandRecord {
  readonly type: CompensationType;
  readonly prerequisites: readonly string[];
  readonly buyerPolicyRequired: boolean;
  readonly merchantPolicyRequired: boolean;
  readonly maxMonetaryEffect: Money | undefined;
  readonly idempotencyKey: string;
  readonly providerAction: string | undefined;
  readonly expectedResult: string | undefined;
  readonly queryStrategy: string | undefined;
  readonly fallbackHumanOwner: string | undefined;
}

// ---------------------------------------------------------------------------
// Compensation Result
// ---------------------------------------------------------------------------

export interface CompensationResult {
  readonly status: "executed" | "prerequisite_failed" | "declined";
  readonly detail: string;
}

// ---------------------------------------------------------------------------
// Source Authority Mapping
// ---------------------------------------------------------------------------

export type SourceAuthorityMap = Readonly<Record<EvidenceSource, readonly CanonicalClaimType[]>>;
