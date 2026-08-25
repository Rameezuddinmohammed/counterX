/**
 * Readiness check types for merchant activation and runtime evaluation.
 *
 * A readiness check evaluates one dimension of merchant preparedness. Each
 * check kind carries typed evidence bindings (version refs, digests, timestamps).
 * The overall readiness status uses worst-of semantics.
 */

import type { CounterId, Instant, Sha256Digest } from "@counter/domain";

// ─── Readiness Status ───────────────────────────────────────────────────────

export const READINESS_STATUSES = [
  "Blocking",
  "AcceptedLimitation",
  "Advisory",
  "Expiring",
] as const;

export type ReadinessStatus = (typeof READINESS_STATUSES)[number];

// ─── Check Kinds ────────────────────────────────────────────────────────────

export const READINESS_CHECK_KINDS = [
  "connector_health",
  "mapping_freshness",
  "policy_compiled",
  "payment_configured",
  "protocol_version",
  "evidence_valid",
] as const;

export type ReadinessCheckKind = (typeof READINESS_CHECK_KINDS)[number];

// ─── Typed Evidence Bindings ────────────────────────────────────────────────

export interface ConnectorHealthEvidence {
  readonly kind: "connector_health";
  readonly connectorId: string;
  readonly connectorVersion: string;
  readonly lastHeartbeatAt: Instant;
}

export interface MappingFreshnessEvidence {
  readonly kind: "mapping_freshness";
  readonly mappingSchemaHash: Sha256Digest;
  readonly updatedAt: Instant;
}

export interface PolicyCompiledEvidence {
  readonly kind: "policy_compiled";
  readonly policyVersion: string;
  readonly compiledAt: Instant;
  readonly policyDigest: Sha256Digest;
}

export interface PaymentConfiguredEvidence {
  readonly kind: "payment_configured";
  readonly paymentProviderVersion: string;
  readonly configuredAt: Instant;
}

export interface ProtocolVersionEvidence {
  readonly kind: "protocol_version";
  readonly protocolVersion: string;
  readonly supportedSince: Instant;
}

export interface EvidenceValidEvidence {
  readonly kind: "evidence_valid";
  readonly evidenceDigest: Sha256Digest;
  readonly issuedAt: Instant;
  readonly expiresAt: Instant;
}

export type ReadinessEvidence =
  | ConnectorHealthEvidence
  | MappingFreshnessEvidence
  | PolicyCompiledEvidence
  | PaymentConfiguredEvidence
  | ProtocolVersionEvidence
  | EvidenceValidEvidence;

// ─── Readiness Check ────────────────────────────────────────────────────────

export interface ReadinessCheck {
  readonly merchantId: CounterId<"merchant">;
  readonly checkKind: ReadinessCheckKind;
  readonly evidence: ReadinessEvidence;
  readonly expiresAt: Instant | null;
  readonly acceptedLimitation: string | null;
}

// ─── Readiness Check Result ─────────────────────────────────────────────────

export interface ReadinessCheckResult {
  readonly checkKind: ReadinessCheckKind;
  readonly status: ReadinessStatus;
  readonly reason: string;
  readonly timeToExpiryMs: number | null;
}

// ─── Overall Readiness Result ───────────────────────────────────────────────

export interface ReadinessResult {
  readonly merchantId: CounterId<"merchant">;
  readonly overallStatus: ReadinessStatus;
  readonly checkResults: readonly ReadinessCheckResult[];
  readonly expiringItems: readonly ReadinessCheckResult[];
  readonly isReady: boolean;
}
