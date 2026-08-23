import type { CounterId, Instant } from "@counter/domain";
import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import type {
  FulfillmentState,
  OrderState,
  PaymentState,
  Phase,
  ReservationState,
  ReturnState,
} from "./phases.js";
import {
  FULFILLMENT_STATES,
  ORDER_STATES,
  PAYMENT_STATES,
  PHASES,
  RESERVATION_STATES,
  RETURN_STATES,
  TERMINAL_PHASES,
} from "./phases.js";
import { createInitialState } from "./transaction-state.js";
import type { TransactionState } from "./transaction-state.js";
import {
  FULFILLMENT_TRANSITIONS,
  ORDER_TRANSITIONS,
  PAYMENT_TRANSITIONS,
  PHASE_TRANSITIONS,
  RESERVATION_TRANSITIONS,
  RETURN_TRANSITIONS,
} from "./transition-rules.js";
import {
  timeoutToIndeterminate,
  transitionFulfillment,
  transitionOrder,
  transitionPayment,
  transitionPhase,
  transitionReservation,
  transitionReturn,
} from "./transitions.js";

// --- Test Helpers ---

const TEST_TRANSACTION_ID = "ctr_transaction_AAAAAAAAAAAAAAAAAAAAAA" as CounterId<"transaction">;
const NOW = 1_700_000_000_000 as Instant;
const LATER = 1_700_000_001_000 as Instant;

function makeState(overrides: Partial<TransactionState> = {}): TransactionState {
  return Object.freeze({
    ...createInitialState({ transactionId: TEST_TRANSACTION_ID, now: NOW }),
    ...overrides,
  });
}

// --- createInitialState ---

describe("createInitialState", () => {
  it("returns a frozen state in DRAFT phase with version 0", () => {
    const state = createInitialState({ transactionId: TEST_TRANSACTION_ID, now: NOW });

    expect(state.transactionId).toBe(TEST_TRANSACTION_ID);
    expect(state.phase).toBe("DRAFT");
    expect(state.reservation).toBe("unsupported");
    expect(state.payment).toBe("pending_instruction");
    expect(state.order).toBe("absent");
    expect(state.fulfillment).toBe("pending");
    expect(state.return).toBe("none");
    expect(state.version).toBe(0);
    expect(state.createdAt).toBe(NOW);
    expect(state.updatedAt).toBe(NOW);
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.subStateUpdatedAt)).toBe(true);
  });
});

// --- Phase Transitions ---

describe("transitionPhase", () => {
  describe("legal transitions", () => {
    const legalCases: Array<{ from: Phase; to: Phase }> = [];
    for (const from of PHASES) {
      for (const to of PHASE_TRANSITIONS[from]) {
        legalCases.push({ from, to });
      }
    }

    it.each(legalCases)("$from -> $to is allowed", ({ from, to }) => {
      // Skip prerequisite check for COMMITTING by ensuring payment is valid
      const state = makeState({ phase: from, payment: "authorized" });
      const result = transitionPhase({ state, to, expectedVersion: state.version, now: LATER });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.phase).toBe(to);
        expect(result.value.version).toBe(state.version + 1);
        expect(result.value.updatedAt).toBe(LATER);
      }
    });
  });

  describe("illegal transitions", () => {
    const illegalCases: Array<{ from: Phase; to: Phase }> = [];
    for (const from of PHASES) {
      const allowed = new Set(PHASE_TRANSITIONS[from]);
      for (const to of PHASES) {
        if (to !== from && !allowed.has(to)) {
          illegalCases.push({ from, to });
        }
      }
    }

    it.each(illegalCases)("$from -> $to is rejected", ({ from, to }) => {
      const state = makeState({ phase: from });
      const result = transitionPhase({ state, to, expectedVersion: state.version, now: LATER });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(
          result.error.code === "ILLEGAL_PHASE_TRANSITION" ||
            result.error.code === "TERMINAL_PHASE",
        ).toBe(true);
      }
    });
  });

  describe("terminal phases reject all transitions", () => {
    for (const terminal of TERMINAL_PHASES) {
      it(`${terminal} is terminal`, () => {
        const state = makeState({ phase: terminal });
        for (const to of PHASES) {
          if (to === terminal) continue;
          const result = transitionPhase({
            state,
            to,
            expectedVersion: state.version,
            now: LATER,
          });
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.error.code).toBe("TERMINAL_PHASE");
          }
        }
      });
    }
  });

  it("rejects transition to COMMITTING when payment is failed", () => {
    const state = makeState({ phase: "CHECKOUT_READY", payment: "failed" });
    const result = transitionPhase({
      state,
      to: "COMMITTING",
      expectedVersion: state.version,
      now: LATER,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PREREQUISITE_NOT_MET");
    }
  });

  it("rejects transition to COMMITTING when payment is declined", () => {
    const state = makeState({ phase: "CHECKOUT_READY", payment: "declined" });
    const result = transitionPhase({
      state,
      to: "COMMITTING",
      expectedVersion: state.version,
      now: LATER,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PREREQUISITE_NOT_MET");
    }
  });

  it("rejects transition to COMMITTING when payment is voided", () => {
    const state = makeState({ phase: "CHECKOUT_READY", payment: "voided" });
    const result = transitionPhase({
      state,
      to: "COMMITTING",
      expectedVersion: state.version,
      now: LATER,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PREREQUISITE_NOT_MET");
    }
  });
});

// --- Version Conflict ---

describe("optimistic version conflict", () => {
  it("rejects phase transition with wrong version", () => {
    const state = makeState({ phase: "DRAFT", version: 3 });
    const result = transitionPhase({
      state,
      to: "QUOTED",
      expectedVersion: 2,
      now: LATER,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VERSION_CONFLICT");
      if (result.error.code === "VERSION_CONFLICT") {
        expect(result.error.expected).toBe(2);
        expect(result.error.actual).toBe(3);
      }
    }
  });

  it("rejects reservation transition with wrong version", () => {
    const state = makeState({ reservation: "pending", version: 5 });
    const result = transitionReservation({
      state,
      to: "reserved",
      expectedVersion: 4,
      now: LATER,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VERSION_CONFLICT");
    }
  });

  it("rejects payment transition with wrong version", () => {
    const state = makeState({ payment: "pending_instruction", version: 1 });
    const result = transitionPayment({
      state,
      to: "authorizing",
      expectedVersion: 0,
      now: LATER,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VERSION_CONFLICT");
    }
  });

  it("rejects order transition with wrong version", () => {
    const state = makeState({ order: "absent", version: 2 });
    const result = transitionOrder({
      state,
      to: "committing",
      expectedVersion: 1,
      now: LATER,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VERSION_CONFLICT");
    }
  });

  it("rejects fulfillment transition with wrong version", () => {
    const state = makeState({ fulfillment: "pending", version: 7 });
    const result = transitionFulfillment({
      state,
      to: "processing",
      expectedVersion: 6,
      now: LATER,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VERSION_CONFLICT");
    }
  });

  it("rejects return transition with wrong version", () => {
    const state = makeState({ return: "none", version: 1 });
    const result = transitionReturn({
      state,
      to: "requested",
      expectedVersion: 0,
      now: LATER,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VERSION_CONFLICT");
    }
  });

  it("property: any wrong version is rejected for phase transitions", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 100 }),
        (actual, expected) => {
          fc.pre(actual !== expected);
          const state = makeState({ phase: "DRAFT", version: actual });
          const result = transitionPhase({
            state,
            to: "QUOTED",
            expectedVersion: expected,
            now: LATER,
          });
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.error.code).toBe("VERSION_CONFLICT");
          }
        },
      ),
    );
  });
});

// --- Reservation Sub-State ---

describe("transitionReservation", () => {
  describe("legal transitions", () => {
    const legalCases: Array<{ from: ReservationState; to: ReservationState }> = [];
    for (const from of RESERVATION_STATES) {
      for (const to of RESERVATION_TRANSITIONS[from]) {
        legalCases.push({ from, to });
      }
    }

    it.each(legalCases)("$from -> $to is allowed", ({ from, to }) => {
      const state = makeState({ reservation: from });
      const result = transitionReservation({
        state,
        to,
        expectedVersion: state.version,
        now: LATER,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.reservation).toBe(to);
        expect(result.value.version).toBe(state.version + 1);
        expect(result.value.subStateUpdatedAt.reservation).toBe(LATER);
      }
    });
  });

  describe("illegal transitions", () => {
    const illegalCases: Array<{ from: ReservationState; to: ReservationState }> = [];
    for (const from of RESERVATION_STATES) {
      const allowed = new Set(RESERVATION_TRANSITIONS[from]);
      for (const to of RESERVATION_STATES) {
        if (to !== from && !allowed.has(to)) {
          illegalCases.push({ from, to });
        }
      }
    }

    it.each(illegalCases)("$from -> $to is rejected", ({ from, to }) => {
      const state = makeState({ reservation: from });
      const result = transitionReservation({
        state,
        to,
        expectedVersion: state.version,
        now: LATER,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("ILLEGAL_RESERVATION_TRANSITION");
      }
    });
  });
});

// --- Payment Sub-State ---

describe("transitionPayment", () => {
  describe("legal transitions", () => {
    const legalCases: Array<{ from: PaymentState; to: PaymentState }> = [];
    for (const from of PAYMENT_STATES) {
      for (const to of PAYMENT_TRANSITIONS[from]) {
        legalCases.push({ from, to });
      }
    }

    it.each(legalCases)("$from -> $to is allowed", ({ from, to }) => {
      const state = makeState({ payment: from });
      const result = transitionPayment({
        state,
        to,
        expectedVersion: state.version,
        now: LATER,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.payment).toBe(to);
        expect(result.value.version).toBe(state.version + 1);
        expect(result.value.subStateUpdatedAt.payment).toBe(LATER);
      }
    });
  });

  describe("illegal transitions", () => {
    const illegalCases: Array<{ from: PaymentState; to: PaymentState }> = [];
    for (const from of PAYMENT_STATES) {
      const allowed = new Set(PAYMENT_TRANSITIONS[from]);
      for (const to of PAYMENT_STATES) {
        if (to !== from && !allowed.has(to)) {
          illegalCases.push({ from, to });
        }
      }
    }

    it.each(illegalCases)("$from -> $to is rejected", ({ from, to }) => {
      const state = makeState({ payment: from });
      const result = transitionPayment({
        state,
        to,
        expectedVersion: state.version,
        now: LATER,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("ILLEGAL_PAYMENT_TRANSITION");
      }
    });
  });
});

// --- Order Sub-State ---

describe("transitionOrder", () => {
  describe("legal transitions", () => {
    const legalCases: Array<{ from: OrderState; to: OrderState }> = [];
    for (const from of ORDER_STATES) {
      for (const to of ORDER_TRANSITIONS[from]) {
        legalCases.push({ from, to });
      }
    }

    it.each(legalCases)("$from -> $to is allowed", ({ from, to }) => {
      const state = makeState({ order: from });
      const result = transitionOrder({
        state,
        to,
        expectedVersion: state.version,
        now: LATER,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.order).toBe(to);
        expect(result.value.version).toBe(state.version + 1);
        expect(result.value.subStateUpdatedAt.order).toBe(LATER);
      }
    });
  });

  describe("illegal transitions", () => {
    const illegalCases: Array<{ from: OrderState; to: OrderState }> = [];
    for (const from of ORDER_STATES) {
      const allowed = new Set(ORDER_TRANSITIONS[from]);
      for (const to of ORDER_STATES) {
        if (to !== from && !allowed.has(to)) {
          illegalCases.push({ from, to });
        }
      }
    }

    it.each(illegalCases)("$from -> $to is rejected", ({ from, to }) => {
      const state = makeState({ order: from });
      const result = transitionOrder({
        state,
        to,
        expectedVersion: state.version,
        now: LATER,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("ILLEGAL_ORDER_TRANSITION");
      }
    });
  });
});

// --- Fulfillment Sub-State ---

describe("transitionFulfillment", () => {
  describe("legal transitions", () => {
    const legalCases: Array<{ from: FulfillmentState; to: FulfillmentState }> = [];
    for (const from of FULFILLMENT_STATES) {
      for (const to of FULFILLMENT_TRANSITIONS[from]) {
        legalCases.push({ from, to });
      }
    }

    it.each(legalCases)("$from -> $to is allowed", ({ from, to }) => {
      const state = makeState({ fulfillment: from });
      const result = transitionFulfillment({
        state,
        to,
        expectedVersion: state.version,
        now: LATER,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.fulfillment).toBe(to);
        expect(result.value.version).toBe(state.version + 1);
        expect(result.value.subStateUpdatedAt.fulfillment).toBe(LATER);
      }
    });
  });

  describe("illegal transitions", () => {
    const illegalCases: Array<{ from: FulfillmentState; to: FulfillmentState }> = [];
    for (const from of FULFILLMENT_STATES) {
      const allowed = new Set(FULFILLMENT_TRANSITIONS[from]);
      for (const to of FULFILLMENT_STATES) {
        if (to !== from && !allowed.has(to)) {
          illegalCases.push({ from, to });
        }
      }
    }

    it.each(illegalCases)("$from -> $to is rejected", ({ from, to }) => {
      const state = makeState({ fulfillment: from });
      const result = transitionFulfillment({
        state,
        to,
        expectedVersion: state.version,
        now: LATER,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("ILLEGAL_FULFILLMENT_TRANSITION");
      }
    });
  });
});

// --- Return Sub-State ---

describe("transitionReturn", () => {
  describe("legal transitions", () => {
    const legalCases: Array<{ from: ReturnState; to: ReturnState }> = [];
    for (const from of RETURN_STATES) {
      for (const to of RETURN_TRANSITIONS[from]) {
        legalCases.push({ from, to });
      }
    }

    it.each(legalCases)("$from -> $to is allowed", ({ from, to }) => {
      const state = makeState({ return: from });
      const result = transitionReturn({
        state,
        to,
        expectedVersion: state.version,
        now: LATER,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.return).toBe(to);
        expect(result.value.version).toBe(state.version + 1);
        expect(result.value.subStateUpdatedAt.return).toBe(LATER);
      }
    });
  });

  describe("illegal transitions", () => {
    const illegalCases: Array<{ from: ReturnState; to: ReturnState }> = [];
    for (const from of RETURN_STATES) {
      const allowed = new Set(RETURN_TRANSITIONS[from]);
      for (const to of RETURN_STATES) {
        if (to !== from && !allowed.has(to)) {
          illegalCases.push({ from, to });
        }
      }
    }

    it.each(illegalCases)("$from -> $to is rejected", ({ from, to }) => {
      const state = makeState({ return: from });
      const result = transitionReturn({
        state,
        to,
        expectedVersion: state.version,
        now: LATER,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("ILLEGAL_RETURN_TRANSITION");
      }
    });
  });
});

// --- Timeout to Indeterminate ---

describe("timeoutToIndeterminate", () => {
  it("transitions from COMMITTING to INDETERMINATE", () => {
    const state = makeState({ phase: "COMMITTING" });
    const result = timeoutToIndeterminate({
      state,
      expectedVersion: state.version,
      now: LATER,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.phase).toBe("INDETERMINATE");
      expect(result.value.version).toBe(state.version + 1);
    }
  });

  it("transitions from ACTIVE to INDETERMINATE", () => {
    const state = makeState({ phase: "ACTIVE" });
    const result = timeoutToIndeterminate({
      state,
      expectedVersion: state.version,
      now: LATER,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.phase).toBe("INDETERMINATE");
    }
  });

  it("rejects timeout from DRAFT", () => {
    const state = makeState({ phase: "DRAFT" });
    const result = timeoutToIndeterminate({
      state,
      expectedVersion: state.version,
      now: LATER,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ILLEGAL_PHASE_TRANSITION");
    }
  });

  it("rejects timeout from QUOTED", () => {
    const state = makeState({ phase: "QUOTED" });
    const result = timeoutToIndeterminate({
      state,
      expectedVersion: state.version,
      now: LATER,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ILLEGAL_PHASE_TRANSITION");
    }
  });

  it("rejects timeout from terminal phase", () => {
    const state = makeState({ phase: "CLOSED" });
    const result = timeoutToIndeterminate({
      state,
      expectedVersion: state.version,
      now: LATER,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ILLEGAL_PHASE_TRANSITION");
    }
  });

  it("rejects timeout with wrong version", () => {
    const state = makeState({ phase: "COMMITTING", version: 5 });
    const result = timeoutToIndeterminate({
      state,
      expectedVersion: 4,
      now: LATER,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VERSION_CONFLICT");
    }
  });
});

// --- State Immutability ---

describe("state immutability", () => {
  it("transition results are frozen", () => {
    const state = makeState({ phase: "DRAFT" });
    const result = transitionPhase({
      state,
      to: "QUOTED",
      expectedVersion: state.version,
      now: LATER,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.isFrozen(result.value)).toBe(true);
      expect(Object.isFrozen(result.value.subStateUpdatedAt)).toBe(true);
    }
  });

  it("original state is not mutated after transition", () => {
    const state = makeState({ phase: "DRAFT" });
    const originalVersion = state.version;
    const originalPhase = state.phase;

    transitionPhase({
      state,
      to: "QUOTED",
      expectedVersion: state.version,
      now: LATER,
    });

    expect(state.version).toBe(originalVersion);
    expect(state.phase).toBe(originalPhase);
  });
});

// --- Property-Based Tests ---

describe("property-based tests", () => {
  const phaseArb = fc.constantFrom(...PHASES);
  const reservationArb = fc.constantFrom(...RESERVATION_STATES);
  const paymentArb = fc.constantFrom(...PAYMENT_STATES);
  const orderArb = fc.constantFrom(...ORDER_STATES);
  const fulfillmentArb = fc.constantFrom(...FULFILLMENT_STATES);
  const returnArb = fc.constantFrom(...RETURN_STATES);

  it("version always increments by exactly 1 on success", () => {
    fc.assert(
      fc.property(
        phaseArb,
        phaseArb,
        fc.integer({ min: 0, max: 1000 }),
        (from, to, version) => {
          const state = makeState({ phase: from, version, payment: "authorized" });
          const result = transitionPhase({
            state,
            to,
            expectedVersion: version,
            now: LATER,
          });
          if (result.ok) {
            expect(result.value.version).toBe(version + 1);
          }
        },
      ),
    );
  });

  it("successful transitions always update the updatedAt timestamp", () => {
    fc.assert(
      fc.property(reservationArb, reservationArb, (from, to) => {
        const state = makeState({ reservation: from });
        const result = transitionReservation({
          state,
          to,
          expectedVersion: state.version,
          now: LATER,
        });
        if (result.ok) {
          expect(result.value.updatedAt).toBe(LATER);
        }
      }),
    );
  });

  it("failed transitions do not produce a new state value", () => {
    fc.assert(
      fc.property(paymentArb, paymentArb, (from, to) => {
        const state = makeState({ payment: from });
        const allowed = new Set(PAYMENT_TRANSITIONS[from]);
        if (!allowed.has(to)) {
          const result = transitionPayment({
            state,
            to,
            expectedVersion: state.version,
            now: LATER,
          });
          expect(result.ok).toBe(false);
        }
      }),
    );
  });

  it("every non-terminal phase has at least one legal outgoing transition", () => {
    for (const phase of PHASES) {
      if (!TERMINAL_PHASES.has(phase)) {
        expect(PHASE_TRANSITIONS[phase].length).toBeGreaterThan(0);
      }
    }
  });

  it("terminal phases have no outgoing transitions", () => {
    for (const phase of TERMINAL_PHASES) {
      expect(PHASE_TRANSITIONS[phase].length).toBe(0);
    }
  });

  it("sub-state transitions preserve unrelated sub-states", () => {
    fc.assert(
      fc.property(
        orderArb,
        fulfillmentArb,
        returnArb,
        (orderState, fulfillmentState, returnState) => {
          const state = makeState({
            reservation: "pending",
            order: orderState,
            fulfillment: fulfillmentState,
            return: returnState,
          });
          const result = transitionReservation({
            state,
            to: "reserved",
            expectedVersion: state.version,
            now: LATER,
          });
          if (result.ok) {
            expect(result.value.order).toBe(orderState);
            expect(result.value.fulfillment).toBe(fulfillmentState);
            expect(result.value.return).toBe(returnState);
          }
        },
      ),
    );
  });
});
