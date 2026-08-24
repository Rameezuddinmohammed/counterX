import { describe, expect, it } from "vitest";
import type { CounterId, Instant } from "@counter/domain";
import { AuditLog, computeEntriesDigest, createAuditEntry } from "./audit.js";
import type { AuditEntry } from "./types.js";

function makeAuditEntry(overrides: {
  id?: string;
  actorId?: string;
  actorKind?: AuditEntry["actorKind"];
  action?: AuditEntry["action"];
  targetType?: string;
  targetId?: string;
  timestamp?: Instant;
} = {}): AuditEntry {
  return createAuditEntry({
    id: overrides.id ?? "audit-1",
    actorId: overrides.actorId ?? "actor-1",
    actorKind: overrides.actorKind ?? "service",
    action: overrides.action ?? "evidence_appended",
    targetType: overrides.targetType ?? "evidence",
    targetId: overrides.targetId ?? "ctr_evidence_AAAAAAAAAAAAAAAAAAAAAA",
    environment: "test",
    scope: "transaction",
    correlationId: "corr-1",
    timestamp: overrides.timestamp ?? (1_700_000_000_000 as Instant),
    evidenceRefs: ["ctr_evidence_AAAAAAAAAAAAAAAAAAAAAA" as CounterId<"evidence">],
    metadata: { note: "test" },
  });
}

describe("audit", () => {
  describe("createAuditEntry", () => {
    it("returns a frozen audit entry", () => {
      const entry = makeAuditEntry();
      expect(Object.isFrozen(entry)).toBe(true);
    });

    it("freezes evidenceRefs array", () => {
      const entry = makeAuditEntry();
      expect(Object.isFrozen(entry.evidenceRefs)).toBe(true);
    });

    it("preserves all fields", () => {
      const entry = makeAuditEntry({ id: "my-id", actorId: "my-actor" });
      expect(entry.id).toBe("my-id");
      expect(entry.actorId).toBe("my-actor");
      expect(entry.actorKind).toBe("service");
      expect(entry.action).toBe("evidence_appended");
    });
  });

  describe("AuditLog", () => {
    it("appends entries and retrieves them", () => {
      const log = new AuditLog();
      const entry1 = makeAuditEntry({ id: "entry-1" });
      const entry2 = makeAuditEntry({ id: "entry-2" });

      log.append(entry1);
      log.append(entry2);

      expect(log.getEntries()).toHaveLength(2);
    });

    describe("createCheckpoint", () => {
      it("creates a checkpoint with sequenceNumber 0 for the first checkpoint", () => {
        const log = new AuditLog();
        log.append(makeAuditEntry({ id: "entry-1" }));

        const checkpoint = log.createCheckpoint("cp-1", 1_700_000_001_000 as Instant);

        expect(checkpoint.id).toBe("cp-1");
        expect(checkpoint.sequenceNumber).toBe(0);
        expect(checkpoint.previousCheckpointDigest).toBeUndefined();
        expect(checkpoint.entriesDigest).toBeDefined();
        expect(Object.isFrozen(checkpoint)).toBe(true);
      });

      it("sequential checkpoints chain via previousCheckpointDigest", () => {
        const log = new AuditLog();
        log.append(makeAuditEntry({ id: "entry-1" }));
        const cp1 = log.createCheckpoint("cp-1", 1_700_000_001_000 as Instant);

        log.append(makeAuditEntry({ id: "entry-2" }));
        const cp2 = log.createCheckpoint("cp-2", 1_700_000_002_000 as Instant);

        expect(cp2.sequenceNumber).toBe(1);
        expect(cp2.previousCheckpointDigest).toBe(cp1.entriesDigest);
      });

      it("checkpoint entriesDigest matches expected computation", () => {
        const log = new AuditLog();
        const entry = makeAuditEntry({ id: "entry-1" });
        log.append(entry);

        const checkpoint = log.createCheckpoint("cp-1", 1_700_000_001_000 as Instant);
        const expectedDigest = computeEntriesDigest([entry]);

        expect(checkpoint.entriesDigest).toBe(expectedDigest);
      });
    });

    describe("verifyIntegrity", () => {
      it("returns ok(true) when entries are not tampered", () => {
        const log = new AuditLog();
        log.append(makeAuditEntry({ id: "entry-1" }));
        const cp1 = log.createCheckpoint("cp-1", 1_700_000_001_000 as Instant);

        log.append(makeAuditEntry({ id: "entry-2" }));
        log.append(makeAuditEntry({ id: "entry-3" }));
        const cp2 = log.createCheckpoint("cp-2", 1_700_000_002_000 as Instant);

        const result = log.verifyIntegrity(cp1, cp2);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value).toBe(true);
        }
      });

      it("detects tampering: modified entry between checkpoints causes digest mismatch", () => {
        const log = new AuditLog();
        log.append(makeAuditEntry({ id: "entry-1" }));
        const cp1 = log.createCheckpoint("cp-1", 1_700_000_001_000 as Instant);

        log.append(makeAuditEntry({ id: "entry-2" }));
        log.append(makeAuditEntry({ id: "entry-3" }));
        const cp2 = log.createCheckpoint("cp-2", 1_700_000_002_000 as Instant);

        // Tamper with an entry between checkpoints
        const entries = log.getEntriesMutable();
        const tamperedEntry = { ...entries[1]!, id: "tampered-id" } as AuditEntry;
        entries[1] = tamperedEntry;

        // Verify should now fail
        const result = log.verifyIntegrity(cp1, cp2);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe("INVALID_FORMAT");
        }
      });

      it("returns error for invalid checkpoint range", () => {
        const log = new AuditLog();
        log.append(makeAuditEntry({ id: "entry-1" }));
        const cp1 = log.createCheckpoint("cp-1", 1_700_000_001_000 as Instant);

        log.append(makeAuditEntry({ id: "entry-2" }));
        const cp2 = log.createCheckpoint("cp-2", 1_700_000_002_000 as Instant);

        // Reversed order should fail
        const result = log.verifyIntegrity(cp2, cp1);

        expect(result.ok).toBe(false);
      });
    });
  });
});
