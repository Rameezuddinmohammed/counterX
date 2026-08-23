/**
 * Legal transition tables as readonly data structures.
 * Each map key is a source state; the value is the set of states reachable from it.
 */

import type {
  FulfillmentState,
  OrderState,
  PaymentState,
  Phase,
  ReservationState,
  ReturnState,
} from "./phases.js";

// ─── Phase Transitions ──────────────────────────────────────────────────────

export const PHASE_TRANSITIONS: Readonly<Record<Phase, readonly Phase[]>> = {
  DRAFT: ["QUOTED"],
  QUOTED: ["CHECKOUT_READY", "REVIEW_REQUIRED", "DECLINED", "EXPIRED"],
  CHECKOUT_READY: ["COMMITTING", "CANCELED", "EXPIRED"],
  REVIEW_REQUIRED: ["CHECKOUT_READY", "DECLINED", "CANCELED", "EXPIRED"],
  COMMITTING: ["ACTIVE", "CLOSED", "INDETERMINATE", "FAILED_REQUIRES_ACTION"],
  ACTIVE: ["CLOSED", "INDETERMINATE", "FAILED_REQUIRES_ACTION"],
  INDETERMINATE: ["ACTIVE", "CLOSED", "FAILED_REQUIRES_ACTION", "CANCELED", "DECLINED"],
  CLOSED: [],
  DECLINED: [],
  EXPIRED: [],
  CANCELED: [],
  FAILED_REQUIRES_ACTION: ["COMMITTING", "CANCELED", "CLOSED"],
} as const;

// ─── Reservation Sub-State Transitions ──────────────────────────────────────

export const RESERVATION_TRANSITIONS: Readonly<
  Record<ReservationState, readonly ReservationState[]>
> = {
  unsupported: [],
  pending: ["reserved", "expired", "indeterminate", "failed"],
  reserved: ["released", "expired", "indeterminate"],
  released: [],
  expired: [],
  indeterminate: ["reserved", "released", "failed"],
  failed: [],
} as const;

// ─── Payment Sub-State Transitions ──────────────────────────────────────────

export const PAYMENT_TRANSITIONS: Readonly<Record<PaymentState, readonly PaymentState[]>> = {
  pending_instruction: ["action_required", "authorizing", "declining", "failed"],
  action_required: ["authorizing", "declining", "failed"],
  authorizing: ["authorized", "declining", "indeterminate", "failed"],
  authorized: ["capturing", "voiding", "indeterminate"],
  capturing: ["captured", "indeterminate", "failed"],
  captured: ["voiding", "indeterminate"],
  voiding: ["voided", "indeterminate", "failed"],
  voided: [],
  declining: ["declined", "indeterminate", "failed"],
  declined: [],
  indeterminate: ["authorized", "captured", "voided", "declined", "failed"],
  failed: [],
} as const;

// ─── Order Sub-State Transitions ────────────────────────────────────────────

export const ORDER_TRANSITIONS: Readonly<Record<OrderState, readonly OrderState[]>> = {
  absent: ["committing"],
  committing: ["committed", "indeterminate", "failed"],
  committed: ["canceled", "closed", "indeterminate"],
  canceled: [],
  closed: [],
  indeterminate: ["committed", "canceled", "closed", "failed"],
  failed: [],
} as const;

// ─── Fulfillment Sub-State Transitions ──────────────────────────────────────

export const FULFILLMENT_TRANSITIONS: Readonly<
  Record<FulfillmentState, readonly FulfillmentState[]>
> = {
  pending: ["processing", "failed"],
  processing: ["shipped", "partial", "failed"],
  shipped: ["delivered", "partial"],
  partial: ["processing", "shipped", "delivered", "failed"],
  delivered: [],
  failed: [],
} as const;

// ─── Return Sub-State Transitions ───────────────────────────────────────────

export const RETURN_TRANSITIONS: Readonly<Record<ReturnState, readonly ReturnState[]>> = {
  none: ["requested"],
  requested: ["approved", "declined"],
  approved: ["received"],
  received: ["refunded"],
  refunded: [],
  declined: [],
} as const;
