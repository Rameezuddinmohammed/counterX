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

  // Prerequisite: COMMITTING requires payment not in failed/declined/voided
  if (to === "COMMITTING") {
    const blockedPaymentStates: readonly PaymentState[] = ["failed", "declined", "voided"];
    if (blockedPaymentStates.includes(state.payment)) {
      return err({
        code: "PREREQUISITE_NOT_MET",
        phase: to,
        requirement: "payment must not be in failed, declined, or voided state",
        message: `Cannot transition to COMMITTING: payment is ${state.payment}`,
      });
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

// ─── Timeout to Indeterminate ───────────────────────────────────────────────

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
