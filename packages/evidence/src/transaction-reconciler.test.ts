import { describe, expect, it, beforeEach } from "vitest";
import type { CounterId, Instant, Sha256Digest } from "@counter/domain";
import { sha256Digest } from "@counter/domain";
import { TransactionReconciler } from "./transaction-reconciler.js";
import type { TransactionReconcilerConfig } from "./transaction-reconciler.js";
import { InMemoryCompensationExecutor } from "./compensation-commands.js";
import type { EvidenceRecord } from "./types.js";

const NOW = 1_700_000_001_000 as Instant;

let findingCounter = 0;
let commandCounter = 0;
let taskCounter = 0;

function resetCounters(): void {
  findingCounter = 0;
  commandCounter = 0;
  taskCounter = 0;
}

function makeFindingId(): CounterId<"finding"> {
  findingCounter++;
  const padded = String(findingCounter).padStart(22, "A");
  return `ctr_finding_${padded}` as CounterId<"finding">;
}

function makeCommandId(): string {
  commandCounter++;
  return `cmd_${commandCounter}`;
}

function makeTaskId(): string {
  taskCounter++;
  return `task_${taskCounter}`;
}

function computeClaimDigest(claim: {
  type: string;
  details: Record<string, unknown>;
}): Sha256Digest {
  const canonical = JSON.stringify({ type: claim.type, details: claim.details });
  return sha256Digest(new TextEncoder().encode(canonical));
}

function makeEvidenceRecord(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
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

describe("TransactionReconciler", () => {
  let executor: InMemoryCompensationExecutor;
  let reconciler: TransactionReconciler;
  let config: TransactionReconcilerConfig;

  beforeEach(() => {
    resetCounters();
    executor = new InMemoryCompensationExecutor();
    config = {
      findingIdGenerator: makeFindingId,
      commandIdGenerator: makeCommandId,
      humanTaskIdGenerator: makeTaskId,
    };
    reconciler = new TransactionReconciler(executor, config);
  });

  describe("clean reconciliation", () => {
    it("returns no findings when all evidence is consistent", async () => {
      const paymentRecord = makeEvidenceRecord({
        id: "ctr_evidence_AAAAAAAAAAAAAAAAAAAAAA" as CounterId<"evidence">,
        source: "payment_provider",
        canonicalClaim: { type: "payment_confirmed", details: { amount: 1000 } },
      });
      const orderRecord = makeEvidenceRecord({
        id: "ctr_evidence_BBBBBBBBBBBBBBBBBBBBBB" as CounterId<"evidence">,
        source: "merchant_connector",
        observationMethod: "connector_read",
        canonicalClaim: { type: "order_committed", details: { orderId: "order_1" } },
      });

      const result = await reconciler.reconcile([paymentRecord, orderRecord], NOW);

      expect(result.findings).toHaveLength(0);
      expect(result.compensationResults).toHaveLength(0);
      expect(result.humanTasks).toHaveLength(0);
      expect(result.transactionId).toBe("ctr_transaction_BBBBBBBBBBBBBBBBBBBBBB");
      expect(result.reconciledAt).toBe(NOW);
    });

    it("returns empty results for empty observations", async () => {
      const result = await reconciler.reconcile([], NOW);

      expect(result.findings).toHaveLength(0);
      expect(result.compensationResults).toHaveLength(0);
      expect(result.humanTasks).toHaveLength(0);
    });
  });

  describe("amount mismatch produces finding", () => {
    it("detects price mismatch and dispatches refund compensation", async () => {
      const record1 = makeEvidenceRecord({
        id: "ctr_evidence_AAAAAAAAAAAAAAAAAAAAAA" as CounterId<"evidence">,
        source: "payment_provider",
        sourceId: "razorpay:pay_001",
        canonicalClaim: {
          type: "payment_confirmed",
          details: { amount: 1000, paymentId: "pay_001" },
        },
      });
      const record2 = makeEvidenceRecord({
        id: "ctr_evidence_BBBBBBBBBBBBBBBBBBBBBB" as CounterId<"evidence">,
        source: "payment_provider",
        sourceId: "razorpay:pay_002",
        canonicalClaim: {
          type: "payment_confirmed",
          details: { amount: 1500, paymentId: "pay_002" },
        },
      });
      // Also add an order to avoid payment_order_mismatch
      const orderRecord = makeEvidenceRecord({
        id: "ctr_evidence_CCCCCCCCCCCCCCCCCCCCCC" as CounterId<"evidence">,
        source: "merchant_connector",
        observationMethod: "connector_read",
        canonicalClaim: { type: "order_committed", details: { orderId: "order_1" } },
      });

      const result = await reconciler.reconcile([record1, record2, orderRecord], NOW);

      const priceFindings = result.findings.filter((f) => f.type === "price_mismatch");
      expect(priceFindings.length).toBeGreaterThan(0);

      // Refund compensation should be dispatched
      const executed = executor.getExecuted();
      const refundCommands = executed.filter((c) => c.type === "refund");
      expect(refundCommands.length).toBeGreaterThan(0);

      expect(result.compensationResults.length).toBeGreaterThan(0);
      expect(result.compensationResults.some((r) => r.status === "executed")).toBe(true);
    });
  });

  describe("missing provider evidence produces finding", () => {
    it("detects payment without order (payment_order_mismatch)", async () => {
      const paymentRecord = makeEvidenceRecord({
        id: "ctr_evidence_AAAAAAAAAAAAAAAAAAAAAA" as CounterId<"evidence">,
        source: "payment_provider",
        canonicalClaim: { type: "payment_confirmed", details: { amount: 1000 } },
      });

      const result = await reconciler.reconcile([paymentRecord], NOW);

      const mismatchFindings = result.findings.filter((f) => f.type === "payment_order_mismatch");
      expect(mismatchFindings.length).toBeGreaterThan(0);
    });

    it("detects order without payment (payment_order_mismatch)", async () => {
      const orderRecord = makeEvidenceRecord({
        id: "ctr_evidence_AAAAAAAAAAAAAAAAAAAAAA" as CounterId<"evidence">,
        source: "merchant_connector",
        observationMethod: "connector_read",
        canonicalClaim: { type: "order_committed", details: { orderId: "order_1" } },
      });

      const result = await reconciler.reconcile([orderRecord], NOW);

      const mismatchFindings = result.findings.filter((f) => f.type === "payment_order_mismatch");
      expect(mismatchFindings.length).toBeGreaterThan(0);

      // Cancel compensation should be dispatched for the orphan order
      const executed = executor.getExecuted();
      const cancelCommands = executed.filter((c) => c.type === "cancel_order");
      expect(cancelCommands.length).toBeGreaterThan(0);
    });
  });

  describe("stale connector observation detected", () => {
    it("produces stale_evidence finding for old observations", async () => {
      const staleRecord = makeEvidenceRecord({
        id: "ctr_evidence_AAAAAAAAAAAAAAAAAAAAAA" as CounterId<"evidence">,
        source: "merchant_connector",
        observationMethod: "connector_read",
        observedAt: (NOW - 200_000_000) as Instant,
        canonicalClaim: { type: "order_committed", details: { orderId: "old_order" } },
      });

      const staleConfig: TransactionReconcilerConfig = {
        ...config,
        staleThresholdMs: 1_000,
      };
      const staleReconciler = new TransactionReconciler(executor, staleConfig);

      const result = await staleReconciler.reconcile([staleRecord], NOW);

      const staleFindings = result.findings.filter((f) => f.type === "stale_evidence");
      expect(staleFindings.length).toBeGreaterThan(0);
    });
  });

  describe("compensation command dispatched for actionable finding", () => {
    it("dispatches void for orphaned authorization", async () => {
      const authRecord = makeEvidenceRecord({
        id: "ctr_evidence_AAAAAAAAAAAAAAAAAAAAAA" as CounterId<"evidence">,
        source: "payment_provider",
        canonicalClaim: {
          type: "authorization_created",
          details: { authorizationId: "auth_001" },
        },
      });

      const result = await reconciler.reconcile([authRecord], NOW);

      const orphanFindings = result.findings.filter((f) => f.type === "orphaned_authorization");
      expect(orphanFindings.length).toBeGreaterThan(0);

      const executed = executor.getExecuted();
      const voidCommands = executed.filter((c) => c.type === "void");
      expect(voidCommands.length).toBeGreaterThan(0);
    });

    it("handles executor failure gracefully", async () => {
      executor.setFailMode(true);

      const authRecord = makeEvidenceRecord({
        id: "ctr_evidence_AAAAAAAAAAAAAAAAAAAAAA" as CounterId<"evidence">,
        source: "payment_provider",
        canonicalClaim: {
          type: "authorization_created",
          details: { authorizationId: "auth_fail" },
        },
      });

      const result = await reconciler.reconcile([authRecord], NOW);

      // Compensation was attempted but failed
      expect(result.compensationResults.length).toBeGreaterThan(0);
      expect(result.compensationResults.some((r) => r.status === "failed")).toBe(true);
    });
  });

  describe("human task created for non-automated finding", () => {
    it("creates human task for intent_authority_mismatch", async () => {
      const providerRecord = makeEvidenceRecord({
        id: "ctr_evidence_AAAAAAAAAAAAAAAAAAAAAA" as CounterId<"evidence">,
        source: "payment_provider",
        canonicalClaim: { type: "payment_confirmed", details: { amount: 1000 } },
      });
      const agentRecord = makeEvidenceRecord({
        id: "ctr_evidence_BBBBBBBBBBBBBBBBBBBBBB" as CounterId<"evidence">,
        source: "agent_claim",
        observationMethod: "local_record",
        canonicalClaim: { type: "payment_declined", details: { reason: "agent says failed" } },
      });
      // Add an order to avoid payment_order_mismatch interference
      const orderRecord = makeEvidenceRecord({
        id: "ctr_evidence_CCCCCCCCCCCCCCCCCCCCCC" as CounterId<"evidence">,
        source: "merchant_connector",
        observationMethod: "connector_read",
        canonicalClaim: { type: "order_committed", details: { orderId: "order_x" } },
      });

      const result = await reconciler.reconcile([providerRecord, agentRecord, orderRecord], NOW);

      const authorityFindings = result.findings.filter(
        (f) => f.type === "intent_authority_mismatch",
      );
      expect(authorityFindings.length).toBeGreaterThan(0);

      // Human task should be created
      expect(result.humanTasks.length).toBeGreaterThan(0);
      const authTask = result.humanTasks.find((t) => t.type === "intent_authority_mismatch");
      expect(authTask).toBeDefined();
      expect(authTask?.assignee).toBe("trust-team");
      expect(authTask?.status).toBe("pending");
    });

    it("creates human task for integrity_failure", async () => {
      const tamperedRecord = makeEvidenceRecord({
        id: "ctr_evidence_AAAAAAAAAAAAAAAAAAAAAA" as CounterId<"evidence">,
        source: "payment_provider",
        canonicalClaim: { type: "payment_confirmed", details: { amount: 1000 } },
        integrityDigest:
          "sha256:0000000000000000000000000000000000000000000000000000000000000000" as Sha256Digest,
      });
      // Add an order to avoid payment_order_mismatch
      const orderRecord = makeEvidenceRecord({
        id: "ctr_evidence_BBBBBBBBBBBBBBBBBBBBBB" as CounterId<"evidence">,
        source: "merchant_connector",
        observationMethod: "connector_read",
        canonicalClaim: { type: "order_committed", details: { orderId: "order_y" } },
      });

      const result = await reconciler.reconcile([tamperedRecord, orderRecord], NOW);

      const integrityFindings = result.findings.filter((f) => f.type === "integrity_failure");
      expect(integrityFindings.length).toBeGreaterThan(0);

      const integrityTask = result.humanTasks.find((t) => t.type === "integrity_failure");
      expect(integrityTask).toBeDefined();
      expect(integrityTask?.assignee).toBe("security-oncall");
    });

    it("creates human task for duplicate_effect", async () => {
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
      // Add an order to avoid payment_order_mismatch
      const orderRecord = makeEvidenceRecord({
        id: "ctr_evidence_CCCCCCCCCCCCCCCCCCCCCC" as CounterId<"evidence">,
        source: "merchant_connector",
        observationMethod: "connector_read",
        canonicalClaim: { type: "order_committed", details: { orderId: "order_z" } },
      });

      const result = await reconciler.reconcile([record1, record2, orderRecord], NOW);

      const duplicateFindings = result.findings.filter((f) => f.type === "duplicate_effect");
      expect(duplicateFindings.length).toBeGreaterThan(0);

      const duplicateTask = result.humanTasks.find((t) => t.type === "duplicate_effect");
      expect(duplicateTask).toBeDefined();
      expect(duplicateTask?.assignee).toBe("payments-oncall");
    });
  });

  describe("idempotency", () => {
    it("compensation executor handles duplicate idempotency keys", async () => {
      const authRecord = makeEvidenceRecord({
        id: "ctr_evidence_AAAAAAAAAAAAAAAAAAAAAA" as CounterId<"evidence">,
        source: "payment_provider",
        canonicalClaim: {
          type: "authorization_created",
          details: { authorizationId: "auth_idem" },
        },
      });

      // Run reconciliation twice - should only execute once due to idempotency
      await reconciler.reconcile([authRecord], NOW);
      resetCounters(); // Reset ID generators to produce same IDs
      const result2 = await reconciler.reconcile([authRecord], NOW);

      // The executor should return the cached result for the duplicate key
      expect(result2.compensationResults.length).toBeGreaterThan(0);
      expect(result2.compensationResults.every((r) => r.status === "executed")).toBe(true);
    });
  });
});
