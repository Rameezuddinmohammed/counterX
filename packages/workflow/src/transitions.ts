/**
 * Pure transition functions for the transaction state machine.
 * Each returns Result<TransactionState, TransitionError> and performs no side effects.
 */

import { err, ok } from "@counter/domain";
import type { Instant, Result } from "@counter/domain";
import type {
  FulfillmentState,
  OrderState,
  PaymentState,
  Phase,
  ReservationState,
  ReturnState,
} from "./phases.js";
import { TERMINAL_PHASES } from "./phases.js";
import type { TransactionState } from "./transaction-state.js";
import type { TransitionError } from "./transition-error.js";
import {
  FULFILLMENT_TRANSITIONS,
  ORDER_TRANSITIONS,
  PAYMENT_TRANSITIONS,
  PHASE_TRANSITIONS,
  RESERVATION_TRANSITIONS,
  RETURN_TRANSITIONS,
} from "./transition-rules.js";

// ─── Phase Guards ───────────────────────────────────────────────────────────

/**
 * Phases during which reservation sub-state transitions are permitted.
 * Reservations are managed during checkout flow and active transaction phases.
 */
const RESERVATION_ALLOWED_PHASES: ReadonlySet<Phase> = new Set([
  "CHECKOUT_READY",
  "COMMITTING",
  "ACTIVE",
  "FAILED_REQUIRES_ACTION",
  "INDETERMINATE",
]);

/**
 * Phases during which payment sub-state transitions are permitted.
 * Payment is advanced during checkout, commit, active, and recovery phases.
 */
const PAYMENT_ALLOWED_PHASES: ReadonlySet<Phase> = new Set([
  "CHECKOUT_READY",
  "COMMITTING",
  "ACTIVE",
  "FAILED_REQUIRES_ACTION",
  "INDETERMINATE",
]);

/**
 * Phases during which order sub-state transitions are permitted.
 * Orders are managed during commit and active transaction phases.
 */
const ORDER_ALLOWED_PHASES: ReadonlySet<Phase> = new Set([
  "COMMITTING",
  "ACTIVE",
  "FAILED_REQUIRES_ACTION",
  "INDETERMINATE",
]);

/**
 * Phases during which fulfillment sub-state transitions are permitted.
 * Fulfillment only progresses when the transaction is actively being fulfilled.
 */
const FULFILLMENT_ALLOWED_PHASES: ReadonlySet<Phase> = new Set([
  "ACTIVE",
  "INDETERMINATE",
]);

/**
 * Phases during which return sub-state transitions are permitted.
 * Returns only happen on active or closed transactions.
 */
const RETURN_ALLOWED_PHASES: ReadonlySet<Phase> = new Set([
  "ACTIVE",
  "CLOSED",
  "INDETERMINATE",
]);

// ─── Helpers ────────────────────────────────────────────────────────────────

function checkVersion(
  state: TransactionState,
  expectedVersion: number,
): TransitionError | undefined {
  if (state.version !== expectedVersion) {
    return {
      code: "VERSION_CONFLICT",
      expected: expectedVersion,
      actual: state.version,
      message: `Version conflict: expected ${String(expectedVersion)}, actual ${String(state.version)}`,
    };
  }
  return undefined;
}

function advanceState(
  state: TransactionState,
  now: Instant,
  patch: Partial<
    Pick<
      TransactionState,
      "phase" | "reservation" | "payment" | "order" | "fulfillment" | "return"
    >
  >,
  subStateKey?: keyof TransactionState["subStateUpdatedAt"],
): TransactionState {
  const subStateUpdatedAt =
    subStateKey !== undefined
      ? Object.freeze({ ...state.subStateUpdatedAt, [subStateKey]: now })
      : state.subStateUpdatedAt;

  return Object.freeze({
    ...state,
    ...patch,
    version: state.version + 1,
    updatedAt: now,
    subStateUpdatedAt,
  });
}

// ─── Phase Transition ───────────────────────────────────────────────────────

export interface TransitionPhaseParams {
  readonly state: TransactionState;
  readonly to: Phase;
  readonly expectedVersion: number;
  readonly now: Instant;
}

export function transitionPhase(
  params: TransitionPhaseParams,
): Result<TransactionState, TransitionError> {
  const { state, to, expectedVersion, now } = params;

  const versionError = checkVersion(state, expectedVersion);
  if (versionError !== undefined) {
    return err(versionError);
  }

  if (TERMINAL_PHASES.has(state.phase)) {
    return err({
      code: "TERMINAL_PHASE",
      phase: state.phase,
      message: `Phase ${state.phase} is terminal; no transitions allowed`,
    });
  }

  const allowed = PHASE_TRANSITIONS[state.phase];
  if (!allowed.includes(to)) {
    return err({
      code: "ILLEGAL_PHASE_TRANSITION",
      from: state.phase,
      to,
      message: `Transition from ${state.phase} to ${to} is not allowed`,
    });
  }

  // Prerequisite: COMMITTING requires payment not in failed/declined/voided/declining
  if (to === "COMMITTING") {
    const blockedPaymentStates: readonly PaymentState[] = [
      "failed",
      "declined",
      "voided",
      "declining",
    ];
    if (blockedPaymentStates.includes(state.payment)) {
      return err({
        code: "PREREQUISITE_NOT_MET",
        phase: to,
        requirement: "payment must not be in failed, declined, declining, or voided state",
        message: `Cannot transition to COMMITTING: payment is ${state.payment}`,
      });
    }

    // When re-entering COMMITTING from FAILED_REQUIRES_ACTION, payment must have
    // been moved out of its originally-failed state. The blocked states above cover
    // the terminal failure states. Additionally, payment must not still be in a
    // state that indicates the failure has not been addressed: if the phase is
    // FAILED_REQUIRES_ACTION, payment must be in an actionable state (not pending_instruction).
    if (state.phase === "FAILED_REQUIRES_ACTION") {
      const unresolved: readonly PaymentState[] = ["pending_instruction"];
      if (unresolved.includes(state.payment)) {
        return err({
          code: "PREREQUISITE_NOT_MET",
          phase: to,
          requirement:
            "payment must be advanced from its initial state before re-entering COMMITTING from FAILED_REQUIRES_ACTION",
          message: `Cannot re-enter COMMITTING: payment is still ${state.payment} (failure not resolved)`,
        });
      }
    }
  }

  return ok(advanceState(state, now, { phase: to }));
}

// ─── Reservation Sub-State Transition ───────────────────────────────────────

export interface TransitionReservationParams {
  readonly state: TransactionState;
  readonly to: ReservationState;
  readonly expectedVersion: number;
  readonly now: Instant;
}

export function transitionReservation(
  params: TransitionReservationParams,
): Result<TransactionState, TransitionError> {
  const { state, to, expectedVersion, now } = params;

  const versionError = checkVersion(state, expectedVersion);
  if (versionError !== undefined) {
    return err(versionError);
  }

  // Phase guard: reservation transitions only allowed in specific phases
  if (!RESERVATION_ALLOWED_PHASES.has(state.phase)) {
    return err({
      code: "PREREQUISITE_NOT_MET",
      phase: state.phase,
      requirement: "reservation transitions require phase CHECKOUT_READY, COMMITTING, ACTIVE, FAILED_REQUIRES_ACTION, or INDETERMINATE",
      message: `Cannot transition reservation in phase ${state.phase}`,
    });
  }

  const allowed = RESERVATION_TRANSITIONS[state.reservation];
  if (!allowed.includes(to)) {
    return err({
      code: "ILLEGAL_RESERVATION_TRANSITION",
      from: state.reservation,
      to,
      message: `Reservation transition from ${state.reservation} to ${to} is not allowed`,
    });
  }

  return ok(advanceState(state, now, { reservation: to }, "reservation"));
}

// ─── Payment Sub-State Transition ───────────────────────────────────────────

export interface TransitionPaymentParams {
  readonly state: TransactionState;
  readonly to: PaymentState;
  readonly expectedVersion: number;
  readonly now: Instant;
}

export function transitionPayment(
  params: TransitionPaymentParams,
): Result<TransactionState, TransitionError> {
  const { state, to, expectedVersion, now } = params;

  const versionError = checkVersion(state, expectedVersion);
  if (versionError !== undefined) {
    return err(versionError);
  }

  // Phase guard: payment transitions only allowed in specific phases
  if (!PAYMENT_ALLOWED_PHASES.has(state.phase)) {
    return err({
      code: "PREREQUISITE_NOT_MET",
      phase: state.phase,
      requirement: "payment transitions require phase CHECKOUT_READY, COMMITTING, ACTIVE, FAILED_REQUIRES_ACTION, or INDETERMINATE",
      message: `Cannot transition payment in phase ${state.phase}`,
    });
  }

  const allowed = PAYMENT_TRANSITIONS[state.payment];
  if (!allowed.includes(to)) {
    return err({
      code: "ILLEGAL_PAYMENT_TRANSITION",
      from: state.payment,
      to,
      message: `Payment transition from ${state.payment} to ${to} is not allowed`,
    });
  }

  return ok(advanceState(state, now, { payment: to }, "payment"));
}

// ─── Order Sub-State Transition ─────────────────────────────────────────────

export interface TransitionOrderParams {
  readonly state: TransactionState;
  readonly to: OrderState;
  readonly expectedVersion: number;
  readonly now: Instant;
}

export function transitionOrder(
  params: TransitionOrderParams,
): Result<TransactionState, TransitionError> {
  const { state, to, expectedVersion, now } = params;

  const versionError = checkVersion(state, expectedVersion);
  if (versionError !== undefined) {
    return err(versionError);
  }

  // Phase guard: order transitions only allowed in specific phases
  if (!ORDER_ALLOWED_PHASES.has(state.phase)) {
    return err({
      code: "PREREQUISITE_NOT_MET",
      phase: state.phase,
      requirement: "order transitions require phase COMMITTING, ACTIVE, FAILED_REQUIRES_ACTION, or INDETERMINATE",
      message: `Cannot transition order in phase ${state.phase}`,
    });
  }

  const allowed = ORDER_TRANSITIONS[state.order];
  if (!allowed.includes(to)) {
    return err({
      code: "ILLEGAL_ORDER_TRANSITION",
      from: state.order,
      to,
      message: `Order transition from ${state.order} to ${to} is not allowed`,
    });
  }

  return ok(advanceState(state, now, { order: to }, "order"));
}

// ─── Fulfillment Sub-State Transition ───────────────────────────────────────

export interface TransitionFulfillmentParams {
  readonly state: TransactionState;
  readonly to: FulfillmentState;
  readonly expectedVersion: number;
  readonly now: Instant;
}

export function transitionFulfillment(
  params: TransitionFulfillmentParams,
): Result<TransactionState, TransitionError> {
  const { state, to, expectedVersion, now } = params;

  const versionError = checkVersion(state, expectedVersion);
  if (versionError !== undefined) {
    return err(versionError);
  }

  // Phase guard: fulfillment transitions only allowed in specific phases
  if (!FULFILLMENT_ALLOWED_PHASES.has(state.phase)) {
    return err({
      code: "PREREQUISITE_NOT_MET",
      phase: state.phase,
      requirement: "fulfillment transitions require phase ACTIVE or INDETERMINATE",
      message: `Cannot transition fulfillment in phase ${state.phase}`,
    });
  }

  const allowed = FULFILLMENT_TRANSITIONS[state.fulfillment];
  if (!allowed.includes(to)) {
    return err({
      code: "ILLEGAL_FULFILLMENT_TRANSITION",
      from: state.fulfillment,
      to,
      message: `Fulfillment transition from ${state.fulfillment} to ${to} is not allowed`,
    });
  }

  return ok(advanceState(state, now, { fulfillment: to }, "fulfillment"));
}

// ─── Return Sub-State Transition ────────────────────────────────────────────

export interface TransitionReturnParams {
  readonly state: TransactionState;
  readonly to: ReturnState;
  readonly expectedVersion: number;
  readonly now: Instant;
}

export function transitionReturn(
  params: TransitionReturnParams,
): Result<TransactionState, TransitionError> {
  const { state, to, expectedVersion, now } = params;

  const versionError = checkVersion(state, expectedVersion);
  if (versionError !== undefined) {
    return err(versionError);
  }

  // Phase guard: return transitions only allowed in specific phases
  if (!RETURN_ALLOWED_PHASES.has(state.phase)) {
    return err({
      code: "PREREQUISITE_NOT_MET",
      phase: state.phase,
      requirement: "return transitions require phase ACTIVE, CLOSED, or INDETERMINATE",
      message: `Cannot transition return in phase ${state.phase}`,
    });
  }

  const allowed = RETURN_TRANSITIONS[state.return];
  if (!allowed.includes(to)) {
    return err({
      code: "ILLEGAL_RETURN_TRANSITION",
      from: state.return,
      to,
      message: `Return transition from ${state.return} to ${to} is not allowed`,
    });
  }

  return ok(advanceState(state, now, { return: to }, "return"));
}

// ─── Timeout to Indeterminate (Phase) ───────────────────────────────────────

export interface TimeoutToIndeterminateParams {
  readonly state: TransactionState;
  readonly expectedVersion: number;
  readonly now: Instant;
}

/**
 * Moves the transaction phase to INDETERMINATE when a timeout occurs after
 * a possible external effect. Only valid from phases where external effects
 * may have occurred (COMMITTING, ACTIVE).
 */
export function timeoutToIndeterminate(
  params: TimeoutToIndeterminateParams,
): Result<TransactionState, TransitionError> {
  const { state, expectedVersion, now } = params;

  const versionError = checkVersion(state, expectedVersion);
  if (versionError !== undefined) {
    return err(versionError);
  }

  const allowedFromPhases: readonly Phase[] = ["COMMITTING", "ACTIVE"];
  if (!allowedFromPhases.includes(state.phase)) {
    return err({
      code: "ILLEGAL_PHASE_TRANSITION",
      from: state.phase,
      to: "INDETERMINATE",
      message: `Timeout to INDETERMINATE is only valid from COMMITTING or ACTIVE, not ${state.phase}`,
    });
  }

  return ok(advanceState(state, now, { phase: "INDETERMINATE" as const }));
}

// ─── Sub-State Timeout to Indeterminate ─────────────────────────────────────

export interface TimeoutReservationToIndeterminateParams {
  readonly state: TransactionState;
  readonly expectedVersion: number;
  readonly now: Instant;
}

/**
 * Moves the reservation sub-state to indeterminate when a timeout occurs
 * during an in-flight reservation operation. Valid from states where an
 * external reservation effect may be pending (pending, reserved).
 */
export function timeoutReservationToIndeterminate(
  params: TimeoutReservationToIndeterminateParams,
): Result<TransactionState, TransitionError> {
  const { state, expectedVersion, now } = params;

  const versionError = checkVersion(state, expectedVersion);
  if (versionError !== undefined) {
    return err(versionError);
  }

  // Phase guard applies to reservation timeouts as well
  if (!RESERVATION_ALLOWED_PHASES.has(state.phase)) {
    return err({
      code: "PREREQUISITE_NOT_MET",
      phase: state.phase,
      requirement: "reservation timeout requires phase CHECKOUT_READY, COMMITTING, ACTIVE, FAILED_REQUIRES_ACTION, or INDETERMINATE",
      message: `Cannot timeout reservation to indeterminate in phase ${state.phase}`,
    });
  }

  const allowedFrom: readonly ReservationState[] = ["pending", "reserved"];
  if (!allowedFrom.includes(state.reservation)) {
    return err({
      code: "ILLEGAL_RESERVATION_TRANSITION",
      from: state.reservation,
      to: "indeterminate",
      message: `Reservation timeout to indeterminate is only valid from pending or reserved, not ${state.reservation}`,
    });
  }

  return ok(advanceState(state, now, { reservation: "indeterminate" as const }, "reservation"));
}

export interface TimeoutPaymentToIndeterminateParams {
  readonly state: TransactionState;
  readonly expectedVersion: number;
  readonly now: Instant;
}

/**
 * Moves the payment sub-state to indeterminate when a timeout occurs
 * during an in-flight payment operation. Valid from intermediate states
 * where an external payment effect may be pending (authorizing, capturing,
 * voiding, declining).
 */
export function timeoutPaymentToIndeterminate(
  params: TimeoutPaymentToIndeterminateParams,
): Result<TransactionState, TransitionError> {
  const { state, expectedVersion, now } = params;

  const versionError = checkVersion(state, expectedVersion);
  if (versionError !== undefined) {
    return err(versionError);
  }

  // Phase guard applies to payment timeouts as well
  if (!PAYMENT_ALLOWED_PHASES.has(state.phase)) {
    return err({
      code: "PREREQUISITE_NOT_MET",
      phase: state.phase,
      requirement: "payment timeout requires phase CHECKOUT_READY, COMMITTING, ACTIVE, FAILED_REQUIRES_ACTION, or INDETERMINATE",
      message: `Cannot timeout payment to indeterminate in phase ${state.phase}`,
    });
  }

  const allowedFrom: readonly PaymentState[] = ["authorizing", "capturing", "voiding", "declining"];
  if (!allowedFrom.includes(state.payment)) {
    return err({
      code: "ILLEGAL_PAYMENT_TRANSITION",
      from: state.payment,
      to: "indeterminate",
      message: `Payment timeout to indeterminate is only valid from authorizing, capturing, voiding, or declining, not ${state.payment}`,
    });
  }

  return ok(advanceState(state, now, { payment: "indeterminate" as const }, "payment"));
}

export interface TimeoutOrderToIndeterminateParams {
  readonly state: TransactionState;
  readonly expectedVersion: number;
  readonly now: Instant;
}

/**
 * Moves the order sub-state to indeterminate when a timeout occurs
 * during an in-flight order operation. Valid from states where an external
 * order effect may be pending (committing, committed).
 */
export function timeoutOrderToIndeterminate(
  params: TimeoutOrderToIndeterminateParams,
): Result<TransactionState, TransitionError> {
  const { state, expectedVersion, now } = params;

  const versionError = checkVersion(state, expectedVersion);
  if (versionError !== undefined) {
    return err(versionError);
  }

  // Phase guard applies to order timeouts as well
  if (!ORDER_ALLOWED_PHASES.has(state.phase)) {
    return err({
      code: "PREREQUISITE_NOT_MET",
      phase: state.phase,
      requirement: "order timeout requires phase COMMITTING, ACTIVE, FAILED_REQUIRES_ACTION, or INDETERMINATE",
      message: `Cannot timeout order to indeterminate in phase ${state.phase}`,
    });
  }

  const allowedFrom: readonly OrderState[] = ["committing", "committed"];
  if (!allowedFrom.includes(state.order)) {
    return err({
      code: "ILLEGAL_ORDER_TRANSITION",
      from: state.order,
      to: "indeterminate",
      message: `Order timeout to indeterminate is only valid from committing or committed, not ${state.order}`,
    });
  }

  return ok(advanceState(state, now, { order: "indeterminate" as const }, "order"));
}
