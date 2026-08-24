/**
 * Orchestration phases and independent sub-states for transaction lifecycle.
 *
 * Each enum is defined as a const array so the literal union type is derived
 * automatically and remains exhaustive at compile time.
 */

// ─── Orchestration Phase ────────────────────────────────────────────────────

export const PHASES = [
  "DRAFT",
  "QUOTED",
  "CHECKOUT_READY",
  "REVIEW_REQUIRED",
  "COMMITTING",
  "ACTIVE",
  "CLOSED",
  "INDETERMINATE",
  "DECLINED",
  "EXPIRED",
  "CANCELED",
  "FAILED_REQUIRES_ACTION",
] as const;

export type Phase = (typeof PHASES)[number];

// ─── Reservation Sub-State ──────────────────────────────────────────────────

export const RESERVATION_STATES = [
  "unsupported",
  "pending",
  "reserved",
  "released",
  "expired",
  "indeterminate",
  "failed",
] as const;

export type ReservationState = (typeof RESERVATION_STATES)[number];

// ─── Payment Sub-State ──────────────────────────────────────────────────────

export const PAYMENT_STATES = [
  "pending_instruction",
  "action_required",
  "authorizing",
  "authorized",
  "capturing",
  "captured",
  "voiding",
  "voided",
  "declining",
  "declined",
  "indeterminate",
  "failed",
] as const;

export type PaymentState = (typeof PAYMENT_STATES)[number];

// ─── Order Sub-State ────────────────────────────────────────────────────────

export const ORDER_STATES = [
  "absent",
  "committing",
  "committed",
  "canceled",
  "closed",
  "indeterminate",
  "failed",
] as const;

export type OrderState = (typeof ORDER_STATES)[number];

// ─── Fulfillment Sub-State ──────────────────────────────────────────────────

export const FULFILLMENT_STATES = [
  "pending",
  "processing",
  "shipped",
  "delivered",
  "partial",
  "failed",
] as const;

export type FulfillmentState = (typeof FULFILLMENT_STATES)[number];

// ─── Return Sub-State ───────────────────────────────────────────────────────

export const RETURN_STATES = [
  "none",
  "requested",
  "approved",
  "received",
  "refunded",
  "declined",
] as const;

export type ReturnState = (typeof RETURN_STATES)[number];

// ─── Terminal helpers ───────────────────────────────────────────────────────

export const TERMINAL_PHASES: ReadonlySet<Phase> = new Set([
  "CLOSED",
  "DECLINED",
  "EXPIRED",
  "CANCELED",
]);
