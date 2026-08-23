import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import {
  EVIDENCE_SOURCES,
  OBSERVATION_METHODS,
  DATA_CLASSIFICATIONS,
  CANONICAL_CLAIM_TYPES,
  AUDIT_ACTIONS,
  ACTOR_KINDS,
  FINDING_SEVERITIES,
  FINDING_TYPES,
  FINDING_STATUSES,
  COMPENSATION_TYPES,
  isEvidenceSource,
  isObservationMethod,
  isDataClassification,
  isCanonicalClaimType,
  isAuditAction,
  isActorKind,
  isFindingSeverity,
  isFindingType,
  isFindingStatus,
  isCompensationType,
} from "./types.js";

describe("types", () => {
  describe("EvidenceSource", () => {
    it("has exactly 5 members", () => {
      expect(EVIDENCE_SOURCES).toHaveLength(5);
    });

    it("type guard accepts all defined sources", () => {
      for (const source of EVIDENCE_SOURCES) {
        expect(isEvidenceSource(source)).toBe(true);
      }
    });

    it("type guard rejects arbitrary strings", () => {
      fc.assert(
        fc.property(
          fc.string().filter((s) => !(EVIDENCE_SOURCES as readonly string[]).includes(s)),
          (s) => {
            expect(isEvidenceSource(s)).toBe(false);
          },
        ),
      );
    });

    it("type guard rejects non-strings", () => {
      expect(isEvidenceSource(123)).toBe(false);
      expect(isEvidenceSource(null)).toBe(false);
      expect(isEvidenceSource(undefined)).toBe(false);
    });
  });

  describe("ObservationMethod", () => {
    it("has exactly 5 members", () => {
      expect(OBSERVATION_METHODS).toHaveLength(5);
    });

    it("type guard accepts all defined methods", () => {
      for (const method of OBSERVATION_METHODS) {
        expect(isObservationMethod(method)).toBe(true);
      }
    });

    it("type guard rejects arbitrary strings", () => {
      fc.assert(
        fc.property(
          fc.string().filter((s) => !(OBSERVATION_METHODS as readonly string[]).includes(s)),
          (s) => {
            expect(isObservationMethod(s)).toBe(false);
          },
        ),
      );
    });
  });

  describe("DataClassification", () => {
    it("has exactly 3 members", () => {
      expect(DATA_CLASSIFICATIONS).toHaveLength(3);
    });

    it("type guard accepts all classifications", () => {
      for (const c of DATA_CLASSIFICATIONS) {
        expect(isDataClassification(c)).toBe(true);
      }
    });

    it("type guard rejects arbitrary strings", () => {
      fc.assert(
        fc.property(
          fc.string().filter((s) => !(DATA_CLASSIFICATIONS as readonly string[]).includes(s)),
          (s) => {
            expect(isDataClassification(s)).toBe(false);
          },
        ),
      );
    });
  });

  describe("CanonicalClaimType", () => {
    it("has exactly 14 members", () => {
      expect(CANONICAL_CLAIM_TYPES).toHaveLength(14);
    });

    it("type guard accepts all claim types", () => {
      for (const t of CANONICAL_CLAIM_TYPES) {
        expect(isCanonicalClaimType(t)).toBe(true);
      }
    });

    it("type guard rejects arbitrary strings", () => {
      fc.assert(
        fc.property(
          fc.string().filter((s) => !(CANONICAL_CLAIM_TYPES as readonly string[]).includes(s)),
          (s) => {
            expect(isCanonicalClaimType(s)).toBe(false);
          },
        ),
      );
    });
  });

  describe("AuditAction", () => {
    it("has expected number of members", () => {
      expect(AUDIT_ACTIONS.length).toBeGreaterThan(0);
    });

    it("type guard accepts all actions", () => {
      for (const a of AUDIT_ACTIONS) {
        expect(isAuditAction(a)).toBe(true);
      }
    });
  });

  describe("ActorKind", () => {
    it("has exactly 4 members", () => {
      expect(ACTOR_KINDS).toHaveLength(4);
    });

    it("type guard accepts all kinds", () => {
      for (const k of ACTOR_KINDS) {
        expect(isActorKind(k)).toBe(true);
      }
    });
  });

  describe("FindingSeverity", () => {
    it("has exactly 5 members", () => {
      expect(FINDING_SEVERITIES).toHaveLength(5);
    });

    it("type guard accepts all severities", () => {
      for (const s of FINDING_SEVERITIES) {
        expect(isFindingSeverity(s)).toBe(true);
      }
    });
  });

  describe("FindingType", () => {
    it("has exactly 10 members", () => {
      expect(FINDING_TYPES).toHaveLength(10);
    });

    it("type guard accepts all types", () => {
      for (const t of FINDING_TYPES) {
        expect(isFindingType(t)).toBe(true);
      }
    });

    it("type guard rejects arbitrary strings", () => {
      fc.assert(
        fc.property(
          fc.string().filter((s) => !(FINDING_TYPES as readonly string[]).includes(s)),
          (s) => {
            expect(isFindingType(s)).toBe(false);
          },
        ),
      );
    });
  });

  describe("FindingStatus", () => {
    it("has exactly 6 members", () => {
      expect(FINDING_STATUSES).toHaveLength(6);
    });

    it("type guard accepts all statuses", () => {
      for (const s of FINDING_STATUSES) {
        expect(isFindingStatus(s)).toBe(true);
      }
    });
  });

  describe("CompensationType", () => {
    it("has exactly 5 members", () => {
      expect(COMPENSATION_TYPES).toHaveLength(5);
    });

    it("type guard accepts all types", () => {
      for (const t of COMPENSATION_TYPES) {
        expect(isCompensationType(t)).toBe(true);
      }
    });

    it("type guard rejects arbitrary strings", () => {
      fc.assert(
        fc.property(
          fc.string().filter((s) => !(COMPENSATION_TYPES as readonly string[]).includes(s)),
          (s) => {
            expect(isCompensationType(s)).toBe(false);
          },
        ),
      );
    });
  });
});
