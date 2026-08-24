/**
 * Transaction state vector: the complete snapshot of a transaction's current
 * position in the orchestration lifecycle. All fields are readonly and the
 * factory returns a frozen object.
 */

import type { CounterId } from "@counter/domain";
import type { Instant } from "@counter/domain";
import type {
  FulfillmentState,
  OrderState,
  PaymentState,
  Phase,
  ReservationState,
  ReturnState,
} from "./phases.js";

// ─── Sub-State Timestamps ───────────────────────────────────────────────────

export interface SubStateTimestamps {
  readonly reservation: Instant;
  readonly payment: Instant;
  readonly order: Instant;
  readonly fulfillment: Instant;
  readonly return: Instant;
}

// ─── Transaction State ──────────────────────────────────────────────────────

export interface TransactionState {
  readonly transactionId: CounterId<"transaction">;
  readonly phase: Phase;
  readonly reservation: ReservationState;
  readonly payment: PaymentState;
  readonly order: OrderState;
  readonly fulfillment: FulfillmentState;
  readonly return: ReturnState;
  readonly version: number;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
  readonly subStateUpdatedAt: SubStateTimestamps;
}

// ─── Factory ────────────────────────────────────────────────────────────────

export interface CreateInitialStateParams {
  readonly transactionId: CounterId<"transaction">;
  readonly now: Instant;
}

export function createInitialState(params: CreateInitialStateParams): TransactionState {
  const { transactionId, now } = params;
  const subStateUpdatedAt: SubStateTimestamps = Object.freeze({
    reservation: now,
    payment: now,
    order: now,
    fulfillment: now,
    return: now,
  });

  return Object.freeze({
    transactionId,
    phase: "DRAFT" as const,
    reservation: "unsupported" as const,
    payment: "pending_instruction" as const,
    order: "absent" as const,
    fulfillment: "pending" as const,
    return: "none" as const,
    version: 0,
    createdAt: now,
    updatedAt: now,
    subStateUpdatedAt,
  });
}
