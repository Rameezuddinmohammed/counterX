import { describe, expect, it } from "vitest";
import type { CounterId, Instant } from "@counter/domain";
import {
  transitionFinding,
  VALID_FINDING_TRANSITIONS,
} from "./finding-lifecycle.js";
import type { FindingRecord } from "./types.js";
import { FINDING_STATUSES } from "./types.js";

function makeFinding(overrides: Partial<FindingRecord> = {}): FindingRecord {
  return Object.freeze({
    id: "ctr_finding_AAAAAAAAAAAAAAAAAAAAAA" as CounterId<"finding">,
    type: "payment_order_mismatch" as const,
    severity: "high" as const,
    affectedObjects: Object.freeze(["obj-1"]),
    conflictingEvidence: Object.freeze([
      "ctr_evidence_AAAAAAAAAAAAAAAAAAAAAA" as CounterId<"evidence">,
    ]),
    missingEvidence: undefined,
    detectedAt: 1_700_000_000_000 as Instant,
    ownerId: "system",
    permittedCompensation: undefined,
    status: "open" as const,
    resolutionEvidence: undefined,
    environment: "test" as const,
    ...overrides,
  });
}

describe("finding-lifecycle", () => {
  describe("VALID_FINDING_TRANSITIONS", () => {
    it("open can only transition to investigating", () => {
      expect(VALID_FINDING_TRANSITIONS.open).toEqual(["investigating"]);
    });

    it("investigating can transition to compensating, resolved, unresolved, accepted", () => {
      expect(VALID_FINDING_TRANSITIONS.investigating).toContain("compensating");
      expect(VALID_FINDING_TRANSITIONS.investigating).toContain("resolved");
      expect(VALID_FINDING_TRANSITIONS.investigating).toContain("unresolved");
      expect(VALID_FINDING_TRANSITIONS.investigating).toContain("accepted");
    });

    it("compensating can transition to resolved or unresolved", () => {
      expect(VALID_FINDING_TRANSITIONS.compensating).toEqual(["resolved", "unresolved"]);
    });

    it("resolved is terminal", () => {
      expect(VALID_FINDING_TRANSITIONS.resolved).toHaveLength(0);
    });

    it("accepted is terminal", () => {
      expect(VALID_FINDING_TRANSITIONS.accepted).toHaveLength(0);
    });

    it("unresolved can transition to investigating or accepted", () => {
      expect(VALID_FINDING_TRANSITIONS.unresolved).toContain("investigating");
      expect(VALID_FINDING_TRANSITIONS.unresolved).toContain("accepted");
    });
  });

  describe("transitionFinding", () => {
    it("open -> investigating succeeds", () => {
      const finding = makeFinding({ status: "open" });

      const result = transitionFinding(finding, "investigating");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe("investigating");
        expect(Object.isFrozen(result.value)).toBe(true);
      }
    });

    it("investigating -> compensating succeeds", () => {
      const finding = makeFinding({ status: "investigating" });

      const result = transitionFinding(finding, "compensating");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe("compensating");
      }
    });

    it("investigating -> resolved succeeds with resolution evidence", () => {
      const finding = makeFinding({ status: "investigating" });
      const evidenceRefs = [
        "ctr_evidence_BBBBBBBBBBBBBBBBBBBBBB" as CounterId<"evidence">,
      ];

      const result = transitionFinding(finding, "resolved", evidenceRefs);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe("resolved");
        expect(result.value.resolutionEvidence).toContain(evidenceRefs[0]);
      }
    });

    it("compensating -> resolved succeeds", () => {
      const finding = makeFinding({ status: "compensating" });

      const result = transitionFinding(finding, "resolved");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe("resolved");
      }
    });

    it("compensating -> unresolved succeeds", () => {
      const finding = makeFinding({ status: "compensating" });

      const result = transitionFinding(finding, "unresolved");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe("unresolved");
      }
    });

    it("unresolved -> investigating succeeds (re-investigation)", () => {
      const finding = makeFinding({ status: "unresolved" });

      const result = transitionFinding(finding, "investigating");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe("investigating");
      }
    });

    it("invalid: open -> resolved directly fails", () => {
      const finding = makeFinding({ status: "open" });

      const result = transitionFinding(finding, "resolved");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("UNSUPPORTED_VALUE");
      }
    });

    it("invalid: open -> compensating directly fails", () => {
      const finding = makeFinding({ status: "open" });

      const result = transitionFinding(finding, "compensating");

      expect(result.ok).toBe(false);
    });

    it("invalid: resolved -> investigating fails (terminal)", () => {
      const finding = makeFinding({ status: "resolved" });

      const result = transitionFinding(finding, "investigating");

      expect(result.ok).toBe(false);
    });

    it("invalid: accepted -> investigating fails (terminal)", () => {
      const finding = makeFinding({ status: "accepted" });

      const result = transitionFinding(finding, "investigating");

      expect(result.ok).toBe(false);
    });

    it("all invalid transitions from each status are rejected", () => {
      for (const status of FINDING_STATUSES) {
        const validTargets = VALID_FINDING_TRANSITIONS[status];
        const invalidTargets = FINDING_STATUSES.filter(
          (s) => !validTargets.includes(s) && s !== status,
        );

        for (const invalidTarget of invalidTargets) {
          const finding = makeFinding({ status });
          const result = transitionFinding(finding, invalidTarget);
          expect(result.ok).toBe(false);
        }
      }
    });
  });
});
