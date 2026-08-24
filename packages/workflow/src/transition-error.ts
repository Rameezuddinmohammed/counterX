/**
 * TransitionError: discriminated union for illegal state transition attempts.
 * Compatible with the Result<T, E> pattern from @counter/domain.
 */

import type {
  FulfillmentState,
  OrderState,
  PaymentState,
  Phase,
  ReservationState,
  ReturnState,
} from "./phases.js";

// ─── Error Codes ────────────────────────────────────────────────────────────

export type TransitionErrorCode =
  | "ILLEGAL_PHASE_TRANSITION"
  | "ILLEGAL_RESERVATION_TRANSITION"
  | "ILLEGAL_PAYMENT_TRANSITION"
  | "ILLEGAL_ORDER_TRANSITION"
  | "ILLEGAL_FULFILLMENT_TRANSITION"
  | "ILLEGAL_RETURN_TRANSITION"
  | "VERSION_CONFLICT"
  | "PREREQUISITE_NOT_MET"
  | "TERMINAL_PHASE";

// ─── Error Types ────────────────────────────────────────────────────────────

export interface IllegalPhaseTransition {
  readonly code: "ILLEGAL_PHASE_TRANSITION";
  readonly from: Phase;
  readonly to: Phase;
  readonly message: string;
}

export interface IllegalReservationTransition {
  readonly code: "ILLEGAL_RESERVATION_TRANSITION";
  readonly from: ReservationState;
  readonly to: ReservationState;
  readonly message: string;
}

export interface IllegalPaymentTransition {
  readonly code: "ILLEGAL_PAYMENT_TRANSITION";
  readonly from: PaymentState;
  readonly to: PaymentState;
  readonly message: string;
}

export interface IllegalOrderTransition {
  readonly code: "ILLEGAL_ORDER_TRANSITION";
  readonly from: OrderState;
  readonly to: OrderState;
  readonly message: string;
}

export interface IllegalFulfillmentTransition {
  readonly code: "ILLEGAL_FULFILLMENT_TRANSITION";
  readonly from: FulfillmentState;
  readonly to: FulfillmentState;
  readonly message: string;
}

export interface IllegalReturnTransition {
  readonly code: "ILLEGAL_RETURN_TRANSITION";
  readonly from: ReturnState;
  readonly to: ReturnState;
  readonly message: string;
}

export interface VersionConflict {
  readonly code: "VERSION_CONFLICT";
  readonly expected: number;
  readonly actual: number;
  readonly message: string;
}

export interface PrerequisiteNotMet {
  readonly code: "PREREQUISITE_NOT_MET";
  readonly phase: Phase;
  readonly requirement: string;
  readonly message: string;
}

export interface TerminalPhaseError {
  readonly code: "TERMINAL_PHASE";
  readonly phase: Phase;
  readonly message: string;
}

// ─── Union Type ─────────────────────────────────────────────────────────────

export type TransitionError =
  | IllegalPhaseTransition
  | IllegalReservationTransition
  | IllegalPaymentTransition
  | IllegalOrderTransition
  | IllegalFulfillmentTransition
  | IllegalReturnTransition
  | VersionConflict
  | PrerequisiteNotMet
  | TerminalPhaseError;
