import { describe, expect, it } from "vitest";
import type { CounterId, Instant, Sha256Digest } from "@counter/domain";
import { sha256Digest } from "@counter/domain";
import { CompensationRegistry, DEFAULT_COMPENSATION_REGISTRY } from "./compensation-registry.js";
import type { CompensationCommandRecord, EvidenceRecord } from "./types.js";

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

function makeCommand(
  overrides: Partial<CompensationCommandRecord> = {},
): CompensationCommandRecord {
  return Object.freeze({
    type: "refund" as const,
    prerequisites: Object.freeze(["payment_confirmed:payment_provider"]),
    buyerPolicyRequired: true,
    merchantPolicyRequired: false,
    maxMonetaryEffect: undefined,
    idempotencyKey: "refund-key-1",
    providerAction: "issue_refund",
    expectedResult: "refund_issued",
    queryStrategy: "query_before_retry",
    fallbackHumanOwner: "payments-oncall",
    ...overrides,
  });
}

describe("compensation-registry", () => {
  describe("CompensationRegistry", () => {
    describe("register and getEligibleCommands", () => {
      it("returns registered commands for a finding type", () => {
        const registry = new CompensationRegistry();
        const command = makeCommand();

        registry.register("payment_order_mismatch", [command]);

        const eligible = registry.getEligibleCommands("payment_order_mismatch");
        expect(eligible).toHaveLength(1);
        expect(eligible[0]?.type).toBe("refund");
      });

      it("returns empty array for unregistered finding type", () => {
        const registry = new CompensationRegistry();

        const eligible = registry.getEligibleCommands("stale_evidence");
        expect(eligible).toHaveLength(0);
      });

      it("accumulates commands when registered multiple times", () => {
        const registry = new CompensationRegistry();
        const command1 = makeCommand({ idempotencyKey: "key-1" });
        const command2 = makeCommand({ type: "escalate_human", idempotencyKey: "key-2" });

        registry.register("payment_order_mismatch", [command1]);
        registry.register("payment_order_mismatch", [command2]);

        const eligible = registry.getEligibleCommands("payment_order_mismatch");
        expect(eligible).toHaveLength(2);
      });
    });

    describe("checkPrerequisites", () => {
      it("returns true when all prerequisites are met", () => {
        const registry = new CompensationRegistry();
        const command = makeCommand({
          prerequisites: Object.freeze(["payment_confirmed:payment_provider"]),
        });

        const evidence = [
          makeEvidenceRecord({
            source: "payment_provider",
            canonicalClaim: { type: "payment_confirmed", details: {} },
          }),
        ];

        const result = registry.checkPrerequisites(command, evidence);
        expect(result).toBe(true);
      });

      it("returns false when prerequisites are not met", () => {
        const registry = new CompensationRegistry();
        const command = makeCommand({
          prerequisites: Object.freeze(["payment_confirmed:payment_provider"]),
        });

        const evidence = [
          makeEvidenceRecord({
            source: "agent_claim",
            canonicalClaim: { type: "payment_declined", details: {} },
          }),
        ];

        const result = registry.checkPrerequisites(command, evidence);
        expect(result).toBe(false);
      });

      it("returns true for empty prerequisites", () => {
        const registry = new CompensationRegistry();
        const command = makeCommand({
          prerequisites: Object.freeze([]),
        });

        const result = registry.checkPrerequisites(command, []);
        expect(result).toBe(true);
      });

      it("returns false when source does not match", () => {
        const registry = new CompensationRegistry();
        const command = makeCommand({
          prerequisites: Object.freeze(["payment_confirmed:payment_provider"]),
        });

        const evidence = [
          makeEvidenceRecord({
            source: "agent_claim",
            canonicalClaim: { type: "payment_confirmed", details: {} },
          }),
        ];

        const result = registry.checkPrerequisites(command, evidence);
        expect(result).toBe(false);
      });
    });

    describe("executeCompensation", () => {
      it("returns prerequisite_failed when prerequisites are not met", () => {
        const registry = new CompensationRegistry();
        const command = makeCommand({
          prerequisites: Object.freeze(["payment_confirmed:payment_provider"]),
        });

        const evidence = [
          makeEvidenceRecord({
            source: "agent_claim",
            canonicalClaim: { type: "payment_declined", details: {} },
          }),
        ];

        const result = registry.executeCompensation(command, evidence);

        expect(result.status).toBe("prerequisite_failed");
        expect(result.detail).toContain("prerequisites");
      });

      it("returns executed when prerequisites are met", () => {
        const registry = new CompensationRegistry();
        const command = makeCommand({
          prerequisites: Object.freeze(["payment_confirmed:payment_provider"]),
          idempotencyKey: "my-key",
        });

        const evidence = [
          makeEvidenceRecord({
            source: "payment_provider",
            canonicalClaim: { type: "payment_confirmed", details: {} },
          }),
        ];

        const result = registry.executeCompensation(command, evidence);

        expect(result.status).toBe("executed");
        expect(result.detail).toContain("my-key");
      });

      it("failed compensation never silently succeeds", () => {
        const registry = new CompensationRegistry();
        const command = makeCommand({
          prerequisites: Object.freeze([
            "payment_confirmed:payment_provider",
            "authorization_created:payment_provider",
          ]),
        });

        // Only one prerequisite met
        const evidence = [
          makeEvidenceRecord({
            source: "payment_provider",
            canonicalClaim: { type: "payment_confirmed", details: {} },
          }),
        ];

        const result = registry.executeCompensation(command, evidence);

        expect(result.status).toBe("prerequisite_failed");
        expect(result.status).not.toBe("executed");
      });
    });

    describe("idempotency key", () => {
      it("all registered commands have an idempotency key", () => {
        const registry = new CompensationRegistry();
        const commands = [
          makeCommand({ idempotencyKey: "key-1" }),
          makeCommand({ type: "void", idempotencyKey: "key-2" }),
          makeCommand({ type: "escalate_human", idempotencyKey: "key-3" }),
        ];

        registry.register("payment_order_mismatch", commands);

        const eligible = registry.getEligibleCommands("payment_order_mismatch");
        for (const cmd of eligible) {
          expect(cmd.idempotencyKey).toBeDefined();
          expect(cmd.idempotencyKey.length).toBeGreaterThan(0);
        }
      });
    });
  });

  describe("DEFAULT_COMPENSATION_REGISTRY", () => {
    it("has commands for payment_order_mismatch", () => {
      const commands = DEFAULT_COMPENSATION_REGISTRY.getEligibleCommands("payment_order_mismatch");
      expect(commands.length).toBeGreaterThan(0);
    });

    it("has commands for orphaned_authorization", () => {
      const commands = DEFAULT_COMPENSATION_REGISTRY.getEligibleCommands("orphaned_authorization");
      expect(commands.length).toBeGreaterThan(0);
    });

    it("has commands for integrity_failure", () => {
      const commands = DEFAULT_COMPENSATION_REGISTRY.getEligibleCommands("integrity_failure");
      expect(commands.length).toBeGreaterThan(0);
    });

    it("all default commands have idempotency keys", () => {
      const findingTypes = [
        "payment_order_mismatch",
        "orphaned_authorization",
        "refund_mismatch",
        "integrity_failure",
        "intent_authority_mismatch",
      ] as const;

      for (const findingType of findingTypes) {
        const commands = DEFAULT_COMPENSATION_REGISTRY.getEligibleCommands(findingType);
        for (const cmd of commands) {
          expect(cmd.idempotencyKey).toBeDefined();
          expect(cmd.idempotencyKey.length).toBeGreaterThan(0);
        }
      }
    });
  });
});
