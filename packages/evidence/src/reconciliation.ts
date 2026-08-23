/**
 * Reconciliation functions.
 *
 * Compares normalized views from different sources without mutating source
 * evidence. Detects mismatches, conflicts, and gaps, producing typed findings.
 */

import type { CounterId, Instant } from "@counter/domain";
import { sha256Digest, sha256DigestsEqual } from "@counter/domain";
import type {
  EvidenceRecord,
  FindingRecord,
  FindingSeverity,
  FindingType,
} from "./types.js";
import { isAuthoritative } from "./source-authority.js";

interface FindingBuilder {
  readonly type: FindingType;
  readonly severity: FindingSeverity;
  readonly affectedObjects: readonly string[];
  readonly conflictingEvidence: readonly CounterId<"evidence">[] | undefined;
  readonly missingEvidence: readonly string[] | undefined;
}

function createFindingFromBuilder(
  builder: FindingBuilder,
  findingId: CounterId<"finding">,
  transactionId: string,
  detectedAt: Instant,
  environment: EvidenceRecord["environment"],
): FindingRecord {
  return Object.freeze({
    id: findingId,
    type: builder.type,
    severity: builder.severity,
    affectedObjects: Object.freeze([transactionId, ...builder.affectedObjects]),
    conflictingEvidence: builder.conflictingEvidence
      ? Object.freeze([...builder.conflictingEvidence])
      : undefined,
    missingEvidence: builder.missingEvidence
      ? Object.freeze([...builder.missingEvidence])
      : undefined,
    detectedAt,
    ownerId: "system",
    permittedCompensation: undefined,
    status: "open" as const,
    resolutionEvidence: undefined,
    environment,
  });
}

export interface ReconcileOptions {
  readonly findingIdGenerator: () => CounterId<"finding">;
  readonly now: Instant;
  readonly staleThresholdMs?: number;
}

/**
 * Reconciles evidence records for a transaction and produces findings
 * for detected discrepancies.
 */
export function reconcileTransaction(
  evidenceRecords: readonly EvidenceRecord[],
  options: ReconcileOptions,
): readonly FindingRecord[] {
  if (evidenceRecords.length === 0) {
    return [];
  }

  const findings: FindingRecord[] = [];
  const firstRecord = evidenceRecords[0];
  if (firstRecord === undefined) return [];

  const transactionId = firstRecord.transactionId;
  const environment = firstRecord.environment;

  // Group by source
  const bySource = new Map<string, EvidenceRecord[]>();
  for (const record of evidenceRecords) {
    const existing = bySource.get(record.source);
    if (existing !== undefined) {
      existing.push(record);
    } else {
      bySource.set(record.source, [record]);
    }
  }

  // Group by claim type
  const byClaimType = new Map<string, EvidenceRecord[]>();
  for (const record of evidenceRecords) {
    const existing = byClaimType.get(record.canonicalClaim.type);
    if (existing !== undefined) {
      existing.push(record);
    } else {
      byClaimType.set(record.canonicalClaim.type, [record]);
    }
  }

  // Detect intent/authority mismatch: agent claims something but authoritative source disagrees
  const agentRecords = bySource.get("agent_claim") ?? [];
  for (const agentRecord of agentRecords) {
    const claimType = agentRecord.canonicalClaim.type;
    const authoritativeRecords = evidenceRecords.filter(
      (r) => r.source !== "agent_claim" && isAuthoritative(r.source, claimType),
    );
    for (const authRecord of authoritativeRecords) {
      if (authRecord.canonicalClaim.type !== agentRecord.canonicalClaim.type) {
        findings.push(
          createFindingFromBuilder(
            {
              type: "intent_authority_mismatch",
              severity: "high",
              affectedObjects: [agentRecord.id, authRecord.id],
              conflictingEvidence: [agentRecord.id, authRecord.id],
              missingEvidence: undefined,
            },
            options.findingIdGenerator(),
            transactionId,
            options.now,
            environment,
          ),
        );
      }
    }
  }

  // Detect price mismatch: different amounts in claims
  const paymentRecords = evidenceRecords.filter(
    (r) =>
      r.canonicalClaim.type === "payment_confirmed" ||
      r.canonicalClaim.type === "payment_pending",
  );
  for (let i = 0; i < paymentRecords.length; i++) {
    const a = paymentRecords[i];
    if (a === undefined) continue;
    for (let j = i + 1; j < paymentRecords.length; j++) {
      const b = paymentRecords[j];
      if (b === undefined) continue;
      const amountA = a.canonicalClaim.details["amount"];
      const amountB = b.canonicalClaim.details["amount"];
      if (
        amountA !== undefined &&
        amountB !== undefined &&
        amountA !== amountB
      ) {
        findings.push(
          createFindingFromBuilder(
            {
              type: "price_mismatch",
              severity: "high",
              affectedObjects: [a.id, b.id],
              conflictingEvidence: [a.id, b.id],
              missingEvidence: undefined,
            },
            options.findingIdGenerator(),
            transactionId,
            options.now,
            environment,
          ),
        );
      }
    }
  }

  // Detect duplicate effect: same claim type from multiple authoritative records
  for (const [, records] of byClaimType) {
    if (records.length <= 1) continue;
    const authoritativeRecords = records.filter((r) =>
      isAuthoritative(r.source, r.canonicalClaim.type),
    );
    if (authoritativeRecords.length > 1) {
      const ids = authoritativeRecords.map((r) => r.id);
      findings.push(
        createFindingFromBuilder(
          {
            type: "duplicate_effect",
            severity: "medium",
            affectedObjects: ids,
            conflictingEvidence: ids as CounterId<"evidence">[],
            missingEvidence: undefined,
          },
          options.findingIdGenerator(),
          transactionId,
          options.now,
          environment,
        ),
      );
    }
  }

  // Detect payment/order mismatch: payment confirmed but no order committed or vice versa
  const hasPaymentConfirmed = evidenceRecords.some(
    (r) =>
      r.canonicalClaim.type === "payment_confirmed" &&
      isAuthoritative(r.source, "payment_confirmed"),
  );
  const hasOrderCommitted = evidenceRecords.some(
    (r) =>
      r.canonicalClaim.type === "order_committed" &&
      isAuthoritative(r.source, "order_committed"),
  );
  if (hasPaymentConfirmed && !hasOrderCommitted) {
    const paymentEvidence = evidenceRecords.filter(
      (r) =>
        r.canonicalClaim.type === "payment_confirmed" &&
        isAuthoritative(r.source, "payment_confirmed"),
    );
    findings.push(
      createFindingFromBuilder(
        {
          type: "payment_order_mismatch",
          severity: "high",
          affectedObjects: paymentEvidence.map((r) => r.id),
          conflictingEvidence: paymentEvidence.map(
            (r) => r.id,
          ) as CounterId<"evidence">[],
          missingEvidence: ["order_committed"],
        },
        options.findingIdGenerator(),
        transactionId,
        options.now,
        environment,
      ),
    );
  } else if (!hasPaymentConfirmed && hasOrderCommitted) {
    const orderEvidence = evidenceRecords.filter(
      (r) =>
        r.canonicalClaim.type === "order_committed" &&
        isAuthoritative(r.source, "order_committed"),
    );
    findings.push(
      createFindingFromBuilder(
        {
          type: "payment_order_mismatch",
          severity: "high",
          affectedObjects: orderEvidence.map((r) => r.id),
          conflictingEvidence: orderEvidence.map(
            (r) => r.id,
          ) as CounterId<"evidence">[],
          missingEvidence: ["payment_confirmed"],
        },
        options.findingIdGenerator(),
        transactionId,
        options.now,
        environment,
      ),
    );
  }

  // Detect fulfillment mismatch: fulfillment shipped but order not committed
  const hasFulfillmentShipped = evidenceRecords.some(
    (r) =>
      r.canonicalClaim.type === "fulfillment_shipped" &&
      isAuthoritative(r.source, "fulfillment_shipped"),
  );
  if (hasFulfillmentShipped && !hasOrderCommitted) {
    const fulfillmentEvidence = evidenceRecords.filter(
      (r) =>
        r.canonicalClaim.type === "fulfillment_shipped" &&
        isAuthoritative(r.source, "fulfillment_shipped"),
    );
    findings.push(
      createFindingFromBuilder(
        {
          type: "fulfillment_mismatch",
          severity: "high",
          affectedObjects: fulfillmentEvidence.map((r) => r.id),
          conflictingEvidence: fulfillmentEvidence.map(
            (r) => r.id,
          ) as CounterId<"evidence">[],
          missingEvidence: ["order_committed"],
        },
        options.findingIdGenerator(),
        transactionId,
        options.now,
        environment,
      ),
    );
  }

  // Detect orphaned authorization: authorization created but no capture/void/payment
  const hasAuthCreated = evidenceRecords.some(
    (r) =>
      r.canonicalClaim.type === "authorization_created" &&
      isAuthoritative(r.source, "authorization_created"),
  );
  const hasAuthVoided = evidenceRecords.some(
    (r) =>
      r.canonicalClaim.type === "authorization_voided" &&
      isAuthoritative(r.source, "authorization_voided"),
  );
  if (hasAuthCreated && !hasPaymentConfirmed && !hasAuthVoided) {
    const authEvidence = evidenceRecords.filter(
      (r) =>
        r.canonicalClaim.type === "authorization_created" &&
        isAuthoritative(r.source, "authorization_created"),
    );
    findings.push(
      createFindingFromBuilder(
        {
          type: "orphaned_authorization",
          severity: "medium",
          affectedObjects: authEvidence.map((r) => r.id),
          conflictingEvidence: authEvidence.map(
            (r) => r.id,
          ) as CounterId<"evidence">[],
          missingEvidence: ["payment_confirmed", "authorization_voided"],
        },
        options.findingIdGenerator(),
        transactionId,
        options.now,
        environment,
      ),
    );
  }

  // Detect refund mismatch: refund issued but no payment confirmed
  const hasRefundIssued = evidenceRecords.some(
    (r) =>
      r.canonicalClaim.type === "refund_issued" &&
      isAuthoritative(r.source, "refund_issued"),
  );
  if (hasRefundIssued && !hasPaymentConfirmed) {
    const refundEvidence = evidenceRecords.filter(
      (r) =>
        r.canonicalClaim.type === "refund_issued" &&
        isAuthoritative(r.source, "refund_issued"),
    );
    findings.push(
      createFindingFromBuilder(
        {
          type: "refund_mismatch",
          severity: "high",
          affectedObjects: refundEvidence.map((r) => r.id),
          conflictingEvidence: refundEvidence.map(
            (r) => r.id,
          ) as CounterId<"evidence">[],
          missingEvidence: ["payment_confirmed"],
        },
        options.findingIdGenerator(),
        transactionId,
        options.now,
        environment,
      ),
    );
  }

  // Detect stale evidence: evidence too old
  const staleThreshold = options.staleThresholdMs ?? 86_400_000; // 24 hours default
  for (const record of evidenceRecords) {
    if (options.now - record.observedAt > staleThreshold) {
      findings.push(
        createFindingFromBuilder(
          {
            type: "stale_evidence",
            severity: "low",
            affectedObjects: [record.id],
            conflictingEvidence: undefined,
            missingEvidence: undefined,
          },
          options.findingIdGenerator(),
          transactionId,
          options.now,
          environment,
        ),
      );
    }
  }

  // Detect integrity failure: verify each record's digest matches claim content
  for (const record of evidenceRecords) {
    const canonical = JSON.stringify({
      type: record.canonicalClaim.type,
      details: record.canonicalClaim.details,
    });
    const computedDigest = sha256Digest(new TextEncoder().encode(canonical));
    if (!sha256DigestsEqual(computedDigest, record.integrityDigest)) {
      findings.push(
        createFindingFromBuilder(
          {
            type: "integrity_failure",
            severity: "critical",
            affectedObjects: [record.id],
            conflictingEvidence: [record.id],
            missingEvidence: undefined,
          },
          options.findingIdGenerator(),
          transactionId,
          options.now,
          environment,
        ),
      );
    }
  }

  return Object.freeze(findings);
}
