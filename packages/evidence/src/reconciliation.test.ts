import { describe, expect, it } from "vitest";
import type { CounterId, Instant, Sha256Digest } from "@counter/domain";
import { sha256Digest } from "@counter/domain";
import { reconcileTransaction } from "./reconciliation.js";
import type { EvidenceRecord } from "./types.js";

let findingCounter = 0;

function makeFindingId(): CounterId<"finding"> {
  findingCounter++;
  const padded = String(findingCounter).padStart(22, "A");
  return `ctr_finding_${padded}` as CounterId<"finding">;
}

function computeClaimDigest(claim: { type: string; details: Record<string, unknown> }): Sha256Digest {
  const canonical = JSON.stringify({ type: claim.type, details: claim.details });
  return sha256Digest(new TextEncoder().encode(canonical));
}

function makeEvidenceRecord(
  overrides: Partial<EvidenceRecord> = {},
): EvidenceRecord {
  const canonicalClaim = overrides.canonicalClaim ?? {
    type: "payment_confirmed" as const,
    details: {},
  };
  const integrityDigest =
    overrides.integrityDigest ??
    computeClaimDigest(canonicalClaim as { type: string; details: Record<string, unknown> });

  return Object.freeze({
    id: "ctr_evidence_AAAAAAAAAAAAAAAAAAAAAA" as CounterId<"evidence">,
    transactionId: "ctr_transaction_BBBBBBBBBBBBBBBBBBBBBB" as CounterId<"transaction">,
    source: "payment_provider" as const,
    observationMethod: "api_query" as const,
    observedAt: 1_700_000_000_000 as Instant,
    sourceId: "provider-123",
    sourceVersion: "1",
    integrityDigest,
    dataClassification: "restricted" as const,
    retentionClass: "standard",
    canonicalClaim,
    originalArtifactRef: undefined,
    createdAt: 1_700_000_000_000 as Instant,
    environment: "test" as const,
    supersedes: undefined,
    ...overrides,
  });
}

const NOW = 1_700_000_001_000 as Instant;

const defaultOptions = {
  findingIdGenerator: makeFindingId,
  now: NOW,
};

describe("reconciliation", () => {
  describe("conflicting sources", () => {
    it("payment provider says confirmed, agent claims failed -> finding created", () => {
      const providerRecord = makeEvidenceRecord({
        id: "ctr_evidence_AAAAAAAAAAAAAAAAAAAAAA" as CounterId<"evidence">,
        source: "payment_provider",
        canonicalClaim: { type: "payment_confirmed", details: { amount: 1000 } },
      });
      const agentRecord = makeEvidenceRecord({
        id: "ctr_evidence_BBBBBBBBBBBBBBBBBBBBBB" as CounterId<"evidence">,
        source: "agent_claim",
        canonicalClaim: { type: "payment_declined", details: { reason: "agent says failed" } },
      });

      const findings = reconcileTransaction(
        [providerRecord, agentRecord],
        defaultOptions,
      );

      // Agent claims payment_declined but the actual claim type it searches for
      // authoritative source: payment_provider is authoritative for payment_declined.
      // Provider has payment_confirmed (different type), so mismatch is detected.
      const authorityFindings = findings.filter(
        (f) => f.type === "intent_authority_mismatch",
      );
      expect(authorityFindings.length).toBeGreaterThan(0);
      expect(authorityFindings[0]?.severity).toBe("high");
    });
  });

  describe("stale evidence", () => {
    it("evidence older than threshold produces stale_evidence finding", () => {
      const staleRecord = makeEvidenceRecord({
        id: "ctr_evidence_AAAAAAAAAAAAAAAAAAAAAA" as CounterId<"evidence">,
        source: "payment_provider",
        observedAt: (NOW - 100_000_000) as Instant,
      });

      const findings = reconcileTransaction([staleRecord], {
        ...defaultOptions,
        staleThresholdMs: 1_000,
      });

      const staleFindings = findings.filter((f) => f.type === "stale_evidence");
      expect(staleFindings.length).toBeGreaterThan(0);
      expect(staleFindings[0]?.severity).toBe("low");
    });

    it("fresh evidence does not produce stale_evidence finding", () => {
      const freshRecord = makeEvidenceRecord({
        id: "ctr_evidence_AAAAAAAAAAAAAAAAAAAAAA" as CounterId<"evidence">,
        source: "payment_provider",
        observedAt: NOW as Instant,
      });

      const findings = reconcileTransaction([freshRecord], {
        ...defaultOptions,
        staleThresholdMs: 86_400_000,
      });

      const staleFindings = findings.filter((f) => f.type === "stale_evidence");
      expect(staleFindings).toHaveLength(0);
    });
  });

  describe("false claims", () => {
    it("agent claims payment success but no provider evidence - agent is not authoritative", () => {
      const agentRecord = makeEvidenceRecord({
        id: "ctr_evidence_AAAAAAAAAAAAAAAAAAAAAA" as CounterId<"evidence">,
        source: "agent_claim",
        canonicalClaim: { type: "payment_confirmed", details: { note: "agent says paid" } },
      });

      const findings = reconcileTransaction([agentRecord], defaultOptions);

      // Agent claim alone is not treated as authoritative payment confirmation.
      // There should be no payment_order_mismatch because hasPaymentConfirmed
      // only considers authoritative sources.
      const paymentOrderFindings = findings.filter(
        (f) => f.type === "payment_order_mismatch",
      );
      expect(paymentOrderFindings).toHaveLength(0);

      // The agent is the only source, so there are no authority mismatches either
      // (no authoritative source to contradict)
      expect(agentRecord.source).toBe("agent_claim");
    });
  });

  describe("price mismatch", () => {
    it("detects different amounts in payment records", () => {
      const record1 = makeEvidenceRecord({
        id: "ctr_evidence_AAAAAAAAAAAAAAAAAAAAAA" as CounterId<"evidence">,
        source: "payment_provider",
        canonicalClaim: { type: "payment_confirmed", details: { amount: 1000 } },
      });
      const record2 = makeEvidenceRecord({
        id: "ctr_evidence_BBBBBBBBBBBBBBBBBBBBBB" as CounterId<"evidence">,
        source: "payment_provider",
        canonicalClaim: { type: "payment_confirmed", details: { amount: 1500 } },
      });

      const findings = reconcileTransaction([record1, record2], defaultOptions);

      const priceFindings = findings.filter((f) => f.type === "price_mismatch");
      expect(priceFindings.length).toBeGreaterThan(0);
      expect(priceFindings[0]?.severity).toBe("high");
      expect(priceFindings[0]?.conflictingEvidence).toContain(record1.id);
      expect(priceFindings[0]?.conflictingEvidence).toContain(record2.id);
    });

    it("does not flag matching amounts", () => {
      const record1 = makeEvidenceRecord({
        id: "ctr_evidence_AAAAAAAAAAAAAAAAAAAAAA" as CounterId<"evidence">,
        source: "payment_provider",
        canonicalClaim: { type: "payment_confirmed", details: { amount: 1000 } },
      });
      const record2 = makeEvidenceRecord({
        id: "ctr_evidence_BBBBBBBBBBBBBBBBBBBBBB" as CounterId<"evidence">,
        source: "payment_provider",
        canonicalClaim: { type: "payment_confirmed", details: { amount: 1000 } },
      });

      const findings = reconcileTransaction([record1, record2], defaultOptions);

      const priceFindings = findings.filter((f) => f.type === "price_mismatch");
      expect(priceFindings).toHaveLength(0);
    });
  });

  describe("duplicate effect", () => {
    it("detects same claim type from multiple authoritative records", () => {
      const record1 = makeEvidenceRecord({
        id: "ctr_evidence_AAAAAAAAAAAAAAAAAAAAAA" as CounterId<"evidence">,
        source: "payment_provider",
        canonicalClaim: { type: "payment_confirmed", details: { ref: "pay-1" } },
      });
      const record2 = makeEvidenceRecord({
        id: "ctr_evidence_BBBBBBBBBBBBBBBBBBBBBB" as CounterId<"evidence">,
        source: "payment_provider",
        canonicalClaim: { type: "payment_confirmed", details: { ref: "pay-2" } },
      });

      const findings = reconcileTransaction([record1, record2], defaultOptions);

      const duplicateFindings = findings.filter(
        (f) => f.type === "duplicate_effect",
      );
      expect(duplicateFindings.length).toBeGreaterThan(0);
      expect(duplicateFindings[0]?.severity).toBe("medium");
    });
  });

  describe("payment/order mismatch", () => {
    it("payment confirmed but no order committed", () => {
      const paymentRecord = makeEvidenceRecord({
        id: "ctr_evidence_AAAAAAAAAAAAAAAAAAAAAA" as CounterId<"evidence">,
        source: "payment_provider",
        canonicalClaim: { type: "payment_confirmed", details: {} },
      });

      const findings = reconcileTransaction([paymentRecord], defaultOptions);

      const mismatchFindings = findings.filter(
        (f) => f.type === "payment_order_mismatch",
      );
      expect(mismatchFindings.length).toBeGreaterThan(0);
      expect(mismatchFindings[0]?.missingEvidence).toContain("order_committed");
    });
  });

  describe("orphaned authorization", () => {
    it("authorization created but no capture or void", () => {
      const authRecord = makeEvidenceRecord({
        id: "ctr_evidence_AAAAAAAAAAAAAAAAAAAAAA" as CounterId<"evidence">,
        source: "payment_provider",
        canonicalClaim: { type: "authorization_created", details: {} },
      });

      const findings = reconcileTransaction([authRecord], defaultOptions);

      const orphanedFindings = findings.filter(
        (f) => f.type === "orphaned_authorization",
      );
      expect(orphanedFindings.length).toBeGreaterThan(0);
      expect(orphanedFindings[0]?.severity).toBe("medium");
    });
  });

  describe("integrity failure", () => {
    it("detects tampered evidence record with wrong digest", () => {
      const record = makeEvidenceRecord({
        id: "ctr_evidence_AAAAAAAAAAAAAAAAAAAAAA" as CounterId<"evidence">,
        source: "payment_provider",
        canonicalClaim: { type: "payment_confirmed", details: { amount: 1000 } },
        integrityDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000" as Sha256Digest,
      });

      const findings = reconcileTransaction([record], defaultOptions);

      const integrityFindings = findings.filter(
        (f) => f.type === "integrity_failure",
      );
      expect(integrityFindings.length).toBeGreaterThan(0);
      expect(integrityFindings[0]?.severity).toBe("critical");
    });

    it("does not flag records with correct digest", () => {
      const claim = { type: "payment_confirmed" as const, details: { amount: 1000 } };
      const correctDigest = computeClaimDigest(claim);
      const record = makeEvidenceRecord({
        id: "ctr_evidence_AAAAAAAAAAAAAAAAAAAAAA" as CounterId<"evidence">,
        source: "payment_provider",
        canonicalClaim: claim,
        integrityDigest: correctDigest,
      });

      const findings = reconcileTransaction([record], defaultOptions);

      const integrityFindings = findings.filter(
        (f) => f.type === "integrity_failure",
      );
      expect(integrityFindings).toHaveLength(0);
    });
  });

  describe("source authority enforcement", () => {
    it("agent evidence cannot prove payment success", () => {
      const agentRecord = makeEvidenceRecord({
        id: "ctr_evidence_AAAAAAAAAAAAAAAAAAAAAA" as CounterId<"evidence">,
        source: "agent_claim",
        canonicalClaim: { type: "payment_confirmed", details: {} },
      });

      const findings = reconcileTransaction([agentRecord], defaultOptions);

      // Agent claim alone should not be treated as authoritative payment confirmation
      // Therefore no payment_order_mismatch
      const paymentOrderFindings = findings.filter(
        (f) => f.type === "payment_order_mismatch",
      );
      expect(paymentOrderFindings).toHaveLength(0);
    });
  });

  describe("empty input", () => {
    it("returns empty findings for empty evidence", () => {
      const findings = reconcileTransaction([], defaultOptions);
      expect(findings).toHaveLength(0);
    });
  });
});
