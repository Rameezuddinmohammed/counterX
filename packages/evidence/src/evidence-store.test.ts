import { describe, expect, it } from "vitest";
import type { CounterId, Instant, Sha256Digest } from "@counter/domain";
import { InMemoryEvidenceStore } from "./evidence-store.js";
import type { EvidenceRecord } from "./types.js";

function makeEvidenceRecord(
  overrides: Partial<EvidenceRecord> = {},
): EvidenceRecord {
  return {
    id: "ctr_evidence_AAAAAAAAAAAAAAAAAAAAAA" as CounterId<"evidence">,
    transactionId: "ctr_transaction_BBBBBBBBBBBBBBBBBBBBBB" as CounterId<"transaction">,
    source: "payment_provider",
    observationMethod: "api_query",
    observedAt: 1_700_000_000_000 as Instant,
    sourceId: "provider-123",
    sourceVersion: "1",
    integrityDigest: "sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789" as Sha256Digest,
    dataClassification: "restricted",
    retentionClass: "standard",
    canonicalClaim: { type: "payment_confirmed", details: {} },
    originalArtifactRef: undefined,
    createdAt: 1_700_000_000_000 as Instant,
    environment: "test",
    supersedes: undefined,
    ...overrides,
  };
}

describe("InMemoryEvidenceStore", () => {
  describe("append", () => {
    it("successfully appends a new record", () => {
      const store = new InMemoryEvidenceStore();
      const record = makeEvidenceRecord();

      const result = store.append(record);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe(record.id);
      }
    });

    it("returns frozen records", () => {
      const store = new InMemoryEvidenceStore();
      const record = makeEvidenceRecord();

      const result = store.append(record);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(Object.isFrozen(result.value)).toBe(true);
      }
    });

    it("rejects duplicate id", () => {
      const store = new InMemoryEvidenceStore();
      const record = makeEvidenceRecord();

      store.append(record);
      const result = store.append(record);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("CONFLICT");
      }
    });

    it("records cannot be mutated after append", () => {
      const store = new InMemoryEvidenceStore();
      const record = makeEvidenceRecord();

      const result = store.append(record);
      expect(result.ok).toBe(true);

      const retrieved = store.getById(record.id);
      expect(retrieved).toBeDefined();
      expect(Object.isFrozen(retrieved)).toBe(true);

      // Attempting to mutate should throw in strict mode
      expect(() => {
        (retrieved as { source: string }).source = "agent_claim";
      }).toThrow();
    });
  });

  describe("getById", () => {
    it("returns the record by id", () => {
      const store = new InMemoryEvidenceStore();
      const record = makeEvidenceRecord();
      store.append(record);

      const result = store.getById(record.id);

      expect(result).toBeDefined();
      expect(result?.id).toBe(record.id);
    });

    it("returns undefined for unknown id", () => {
      const store = new InMemoryEvidenceStore();

      const result = store.getById(
        "ctr_evidence_CCCCCCCCCCCCCCCCCCCCCC" as CounterId<"evidence">,
      );

      expect(result).toBeUndefined();
    });
  });

  describe("getByTransaction", () => {
    it("returns all records for a transaction", () => {
      const store = new InMemoryEvidenceStore();
      const txId = "ctr_transaction_BBBBBBBBBBBBBBBBBBBBBB" as CounterId<"transaction">;

      const record1 = makeEvidenceRecord({
        id: "ctr_evidence_AAAAAAAAAAAAAAAAAAAAAA" as CounterId<"evidence">,
        transactionId: txId,
      });
      const record2 = makeEvidenceRecord({
        id: "ctr_evidence_BBBBBBBBBBBBBBBBBBBBBB" as CounterId<"evidence">,
        transactionId: txId,
      });

      store.append(record1);
      store.append(record2);

      const results = store.getByTransaction(txId);

      expect(results).toHaveLength(2);
    });

    it("returns empty array for unknown transaction", () => {
      const store = new InMemoryEvidenceStore();

      const results = store.getByTransaction(
        "ctr_transaction_CCCCCCCCCCCCCCCCCCCCCC" as CounterId<"transaction">,
      );

      expect(results).toHaveLength(0);
    });
  });

  describe("getBySource", () => {
    it("filters records by source within a transaction", () => {
      const store = new InMemoryEvidenceStore();
      const txId = "ctr_transaction_BBBBBBBBBBBBBBBBBBBBBB" as CounterId<"transaction">;

      const paymentRecord = makeEvidenceRecord({
        id: "ctr_evidence_AAAAAAAAAAAAAAAAAAAAAA" as CounterId<"evidence">,
        transactionId: txId,
        source: "payment_provider",
      });
      const agentRecord = makeEvidenceRecord({
        id: "ctr_evidence_BBBBBBBBBBBBBBBBBBBBBB" as CounterId<"evidence">,
        transactionId: txId,
        source: "agent_claim",
      });

      store.append(paymentRecord);
      store.append(agentRecord);

      const paymentResults = store.getBySource(txId, "payment_provider");
      expect(paymentResults).toHaveLength(1);
      expect(paymentResults[0]?.source).toBe("payment_provider");

      const agentResults = store.getBySource(txId, "agent_claim");
      expect(agentResults).toHaveLength(1);
      expect(agentResults[0]?.source).toBe("agent_claim");
    });

    it("returns empty when no records match the source", () => {
      const store = new InMemoryEvidenceStore();
      const txId = "ctr_transaction_BBBBBBBBBBBBBBBBBBBBBB" as CounterId<"transaction">;

      const record = makeEvidenceRecord({
        transactionId: txId,
        source: "payment_provider",
      });
      store.append(record);

      const results = store.getBySource(txId, "agent_claim");
      expect(results).toHaveLength(0);
    });
  });

  describe("append-only semantics", () => {
    it("has no update method", () => {
      const store = new InMemoryEvidenceStore();
      expect("update" in store).toBe(false);
    });

    it("has no delete method", () => {
      const store = new InMemoryEvidenceStore();
      expect("delete" in store).toBe(false);
    });

    it("has no remove method", () => {
      const store = new InMemoryEvidenceStore();
      expect("remove" in store).toBe(false);
    });
  });
});
