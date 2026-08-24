import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import type { Instant, CounterId, Sha256Digest, ActorReference } from "@counter/domain";
import {
  MERCHANT_LIFECYCLE_STATES,
  LIFECYCLE_TRANSITIONS,
  transitionMerchantLifecycle,
  isTerminalState,
  isMerchantSuspended,
} from "./index.js";
import type { MerchantLifecycleState } from "./index.js";

// --- Test Helpers ---

const NOW = 1_700_000_000_000 as Instant;
const MERCHANT_ID = "ctr_merchant_AAAAAAAAAAAAAAAAAAAAAA" as CounterId<"merchant">;
const OPERATOR_ID = "ctr_operator_AAAAAAAAAAAAAAAAAAAAAA" as CounterId<"operator">;
const VALID_DIGEST = `sha256:${"a".repeat(64)}` as Sha256Digest;
const ACTOR: ActorReference = { kind: "operator", id: OPERATOR_ID };

function makeTransitionParams(
  currentState: MerchantLifecycleState,
  targetState: MerchantLifecycleState,
  currentVersion = 0,
) {
  return {
    merchantId: MERCHANT_ID,
    currentState,
    targetState,
    actor: ACTOR,
    reason: "test transition",
    occurredAt: NOW,
    evidenceDigest: VALID_DIGEST,
    currentVersion,
  };
}

// --- Tests ---

describe("lifecycle state machine", () => {
  describe("valid transitions", () => {
    it("succeeds for each allowed transition pair and returns frozen records", () => {
      for (const fromState of MERCHANT_LIFECYCLE_STATES) {
        const allowed = LIFECYCLE_TRANSITIONS[fromState];
        for (const toState of allowed) {
          const result = transitionMerchantLifecycle(
            makeTransitionParams(fromState, toState),
          );
          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.value.fromState).toBe(fromState);
            expect(result.value.toState).toBe(toState);
            expect(Object.isFrozen(result.value)).toBe(true);
          }
        }
      }
    });
  });

  describe("invalid transitions", () => {
    it("property: for every (state, target) pair NOT in LIFECYCLE_TRANSITIONS, transition returns err", () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...MERCHANT_LIFECYCLE_STATES),
          fc.constantFrom(...MERCHANT_LIFECYCLE_STATES),
          (from, to) => {
            const allowed = LIFECYCLE_TRANSITIONS[from];
            if (!allowed.includes(to)) {
              const result = transitionMerchantLifecycle(
                makeTransitionParams(from, to),
              );
              expect(result.ok).toBe(false);
            }
          },
        ),
      );
    });
  });

  describe("terminal state (CLOSED)", () => {
    it("rejects ALL transitions from CLOSED", () => {
      for (const target of MERCHANT_LIFECYCLE_STATES) {
        const result = transitionMerchantLifecycle(
          makeTransitionParams("CLOSED", target),
        );
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe("CONFLICT");
        }
      }
    });

    it("isTerminalState returns true for CLOSED", () => {
      expect(isTerminalState("CLOSED")).toBe(true);
    });

    it("isTerminalState returns false for non-terminal states", () => {
      for (const state of MERCHANT_LIFECYCLE_STATES) {
        if (state !== "CLOSED") {
          expect(isTerminalState(state)).toBe(false);
        }
      }
    });
  });

  describe("SUSPENDED state", () => {
    it("isMerchantSuspended returns true for SUSPENDED", () => {
      expect(isMerchantSuspended("SUSPENDED")).toBe(true);
    });

    it("blocks transitions EXCEPT to ACTIVATION_REVIEW and OFFBOARDING", () => {
      const allowedFromSuspended = LIFECYCLE_TRANSITIONS["SUSPENDED"];
      expect(allowedFromSuspended).toContain("ACTIVATION_REVIEW");
      expect(allowedFromSuspended).toContain("OFFBOARDING");

      for (const target of MERCHANT_LIFECYCLE_STATES) {
        if (target === "ACTIVATION_REVIEW" || target === "OFFBOARDING") {
          continue;
        }
        const result = transitionMerchantLifecycle(
          makeTransitionParams("SUSPENDED", target),
        );
        expect(result.ok).toBe(false);
      }
    });
  });

  describe("kill switch: operator can force suspend", () => {
    it("ACTIVE -> SUSPENDED is a valid transition", () => {
      const result = transitionMerchantLifecycle(
        makeTransitionParams("ACTIVE", "SUSPENDED"),
      );
      expect(result.ok).toBe(true);
    });

    it("ACTIVE_DEGRADED -> SUSPENDED is a valid transition", () => {
      const result = transitionMerchantLifecycle(
        makeTransitionParams("ACTIVE_DEGRADED", "SUSPENDED"),
      );
      expect(result.ok).toBe(true);
    });
  });

  describe("reactivation path", () => {
    it("SUSPENDED -> ACTIVATION_REVIEW -> ACTIVE succeeds", () => {
      const step1 = transitionMerchantLifecycle(
        makeTransitionParams("SUSPENDED", "ACTIVATION_REVIEW", 5),
      );
      expect(step1.ok).toBe(true);
      if (!step1.ok) return;
      expect(step1.value.toState).toBe("ACTIVATION_REVIEW");
      expect(step1.value.version).toBe(6);

      const step2 = transitionMerchantLifecycle(
        makeTransitionParams("ACTIVATION_REVIEW", "ACTIVE", 6),
      );
      expect(step2.ok).toBe(true);
      if (!step2.ok) return;
      expect(step2.value.toState).toBe("ACTIVE");
      expect(step2.value.version).toBe(7);
    });
  });

  describe("offboarding paths", () => {
    it("ACTIVE -> OFFBOARDING -> CLOSED", () => {
      const step1 = transitionMerchantLifecycle(
        makeTransitionParams("ACTIVE", "OFFBOARDING", 0),
      );
      expect(step1.ok).toBe(true);

      const step2 = transitionMerchantLifecycle(
        makeTransitionParams("OFFBOARDING", "CLOSED", 1),
      );
      expect(step2.ok).toBe(true);
    });

    it("ACTIVE_DEGRADED -> OFFBOARDING -> CLOSED", () => {
      const step1 = transitionMerchantLifecycle(
        makeTransitionParams("ACTIVE_DEGRADED", "OFFBOARDING", 0),
      );
      expect(step1.ok).toBe(true);

      const step2 = transitionMerchantLifecycle(
        makeTransitionParams("OFFBOARDING", "CLOSED", 1),
      );
      expect(step2.ok).toBe(true);
    });

    it("SUSPENDED -> OFFBOARDING -> CLOSED", () => {
      const step1 = transitionMerchantLifecycle(
        makeTransitionParams("SUSPENDED", "OFFBOARDING", 0),
      );
      expect(step1.ok).toBe(true);

      const step2 = transitionMerchantLifecycle(
        makeTransitionParams("OFFBOARDING", "CLOSED", 1),
      );
      expect(step2.ok).toBe(true);
    });
  });

  describe("transition race (version concurrency)", () => {
    it("two concurrent calls with same currentVersion both succeed as pure function (version conflict is repository concern)", () => {
      const params = makeTransitionParams("ACTIVE", "SUSPENDED", 10);
      const result1 = transitionMerchantLifecycle(params);
      const result2 = transitionMerchantLifecycle(params);

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);
      if (result1.ok && result2.ok) {
        // Both produce version 11 - the repository would reject the second write
        expect(result1.value.version).toBe(11);
        expect(result2.value.version).toBe(11);
      }
    });
  });

  describe("property-based tests", () => {
    it("no valid sequence of transitions reaches a state not in MERCHANT_LIFECYCLE_STATES", () => {
      const stateSet = new Set<string>(MERCHANT_LIFECYCLE_STATES);

      fc.assert(
        fc.property(
          fc.array(fc.constantFrom(...MERCHANT_LIFECYCLE_STATES), { minLength: 1, maxLength: 20 }),
          (targetSequence) => {
            let currentState: MerchantLifecycleState = "DRAFT";
            let version = 0;

            for (const target of targetSequence) {
              const result = transitionMerchantLifecycle({
                merchantId: MERCHANT_ID,
                currentState,
                targetState: target,
                actor: ACTOR,
                reason: "property test",
                occurredAt: NOW,
                currentVersion: version,
              });

              if (result.ok) {
                currentState = result.value.toState;
                version = result.value.version;
                expect(stateSet.has(currentState)).toBe(true);
              }
            }
          },
        ),
        { numRuns: 200 },
      );
    });

    it("every successful transition produces a frozen record with version = currentVersion + 1", () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...MERCHANT_LIFECYCLE_STATES),
          fc.constantFrom(...MERCHANT_LIFECYCLE_STATES),
          fc.integer({ min: 0, max: 1000 }),
          (from, to, version) => {
            const result = transitionMerchantLifecycle(
              makeTransitionParams(from, to, version),
            );
            if (result.ok) {
              expect(Object.isFrozen(result.value)).toBe(true);
              expect(result.value.version).toBe(version + 1);
            }
          },
        ),
        { numRuns: 500 },
      );
    });
  });
});
