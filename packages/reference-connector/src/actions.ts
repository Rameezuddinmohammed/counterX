/**
 * ActionPort implementations for the reference connector.
 *
 * Provides: create_quote, create_draft_order, complete_order,
 * cancel_order, create_refund. Each with idempotency (Map store),
 * proper ActionOutcome returns, inventory management, and fault injection.
 */

import type { ExternalReference, Instant } from "@counter/domain";
import type {
  ActionInput,
  ActionOutcome,
  ActionPort,
} from "@counter/connector-sdk";
import { createConnectorError } from "@counter/connector-sdk";

import { CONNECTOR_SOURCE } from "./catalog.js";
import type { DeterministicEventStream } from "./event-stream.js";
import type { FaultControls } from "./fault-controls.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface QuotePayload {
  readonly variantId?: string;
  readonly quantity?: number;
  readonly test?: boolean;
}

export interface OrderPayload {
  readonly quoteId?: string;
  readonly variantId?: string;
  readonly quantity?: number;
  readonly test?: boolean;
  readonly extra?: string;
}

export interface CancelPayload {
  readonly orderId?: string;
  readonly reason?: string;
  readonly test?: boolean;
}

export interface RefundPayload {
  readonly orderId?: string;
  readonly amountMinor?: number;
  readonly test?: boolean;
}

export interface QuoteResult {
  readonly quoteId: string;
  readonly variantId: string;
  readonly quantity: number;
  readonly totalMinor: bigint;
}

export interface OrderResult {
  readonly orderId: string;
  readonly status: string;
  readonly variantId: string;
  readonly quantity: number;
}

export interface CancelResult {
  readonly orderId: string;
  readonly status: string;
  readonly cancelledAt: Instant;
}

export interface RefundResult {
  readonly refundId: string;
  readonly orderId: string;
  readonly amountMinor: number;
  readonly status: string;
}

// ─── Inventory Store ──────────────────────────────────────────────────────────

export class InventoryStore {
  readonly #inventory = new Map<string, number>();

  constructor(initial?: ReadonlyMap<string, number>) {
    if (initial) {
      for (const [k, v] of initial) {
        this.#inventory.set(k, v);
      }
    }
  }

  get(variantId: string): number {
    return this.#inventory.get(variantId) ?? 0;
  }

  reserve(variantId: string, quantity: number): boolean {
    const current = this.get(variantId);
    if (current < quantity) return false;
    this.#inventory.set(variantId, current - quantity);
    return true;
  }

  release(variantId: string, quantity: number): void {
    const current = this.get(variantId);
    this.#inventory.set(variantId, current + quantity);
  }
}

// ─── Action Helpers ───────────────────────────────────────────────────────────

function makeSucceeded<T>(result: T, refValue: string): ActionOutcome<T> {
  return {
    status: "succeeded",
    result,
    effectTime: Date.now() as Instant,
    sourceReference: { source: CONNECTOR_SOURCE, value: refValue } as ExternalReference,
  };
}

// ─── Create Quote Action ──────────────────────────────────────────────────────

export function createQuoteAction(
  eventStream: DeterministicEventStream,
  faultControls?: FaultControls,
): ActionPort<QuotePayload, QuoteResult> {
  const idempotencyStore = new Map<string, ActionOutcome<QuoteResult>>();
  const correlationStore = new Map<string, ActionOutcome<QuoteResult>>();
  let quoteCounter = 0;

  return {
    async execute(input: ActionInput<QuotePayload>): Promise<ActionOutcome<QuoteResult>> {
      const existing = idempotencyStore.get(input.idempotencyKey);
      if (existing) return existing;

      if (faultControls?.shouldReturnConflictError()) {
        const outcome: ActionOutcome<QuoteResult> = {
          status: "failed",
          error: createConnectorError({
            code: "conflict",
            message: "Conflict during quote creation",
            retryable: false,
            source: CONNECTOR_SOURCE,
          }),
        };
        idempotencyStore.set(input.idempotencyKey, outcome);
        correlationStore.set(input.correlationId, outcome);
        return outcome;
      }

      if (faultControls?.shouldReturnAmbiguousWrite()) {
        const outcome: ActionOutcome<QuoteResult> = {
          status: "indeterminate",
          correlationId: input.correlationId,
          lastKnownState: "quote_pending",
        };
        idempotencyStore.set(input.idempotencyKey, outcome);
        correlationStore.set(input.correlationId, outcome);
        return outcome;
      }

      quoteCounter++;
      const quoteId = `quote-${quoteCounter.toString().padStart(4, "0")}`;
      const payload = input.payload;
      const variantId = payload.variantId ?? "unknown";
      const quantity = payload.quantity ?? 1;

      const result: QuoteResult = {
        quoteId,
        variantId,
        quantity,
        totalMinor: BigInt(quantity) * 79900n,
      };

      const outcome = makeSucceeded(result, quoteId);
      idempotencyStore.set(input.idempotencyKey, outcome);
      correlationStore.set(input.correlationId, outcome);

      eventStream.emit("quote_created", { quoteId, variantId, quantity });

      return outcome;
    },

    async query(correlationId: string): Promise<ActionOutcome<QuoteResult> | null> {
      return correlationStore.get(correlationId) ?? null;
    },
  };
}

// ─── Create Draft Order Action ────────────────────────────────────────────────

export function createDraftOrderAction(
  eventStream: DeterministicEventStream,
  _inventory: InventoryStore,
  faultControls?: FaultControls,
): ActionPort<OrderPayload, OrderResult> {
  const idempotencyStore = new Map<string, ActionOutcome<OrderResult>>();
  const correlationStore = new Map<string, ActionOutcome<OrderResult>>();
  let orderCounter = 0;

  return {
    async execute(input: ActionInput<OrderPayload>): Promise<ActionOutcome<OrderResult>> {
      const existing = idempotencyStore.get(input.idempotencyKey);
      if (existing) return existing;

      if (faultControls?.shouldReturnConflictError()) {
        const outcome: ActionOutcome<OrderResult> = {
          status: "failed",
          error: createConnectorError({
            code: "conflict",
            message: "Conflict during draft order creation",
            retryable: false,
            source: CONNECTOR_SOURCE,
          }),
        };
        idempotencyStore.set(input.idempotencyKey, outcome);
        correlationStore.set(input.correlationId, outcome);
        return outcome;
      }

      orderCounter++;
      const orderId = `order-${orderCounter.toString().padStart(4, "0")}`;
      const payload = input.payload;
      const variantId = payload.variantId ?? "unknown";
      const quantity = payload.quantity ?? 1;

      const result: OrderResult = {
        orderId,
        status: "draft",
        variantId,
        quantity,
      };

      const outcome = makeSucceeded(result, orderId);
      idempotencyStore.set(input.idempotencyKey, outcome);
      correlationStore.set(input.correlationId, outcome);

      eventStream.emit("draft_order_created", { orderId, variantId, quantity });

      return outcome;
    },

    async query(correlationId: string): Promise<ActionOutcome<OrderResult> | null> {
      return correlationStore.get(correlationId) ?? null;
    },
  };
}

// ─── Complete Order Action ────────────────────────────────────────────────────

export function createCompleteOrderAction(
  eventStream: DeterministicEventStream,
  inventory: InventoryStore,
  faultControls?: FaultControls,
): ActionPort<OrderPayload, OrderResult> {
  const idempotencyStore = new Map<string, ActionOutcome<OrderResult>>();
  const correlationStore = new Map<string, ActionOutcome<OrderResult>>();

  return {
    async execute(input: ActionInput<OrderPayload>): Promise<ActionOutcome<OrderResult>> {
      const existing = idempotencyStore.get(input.idempotencyKey);
      if (existing) return existing;

      if (faultControls?.shouldReturnConflictError()) {
        const outcome: ActionOutcome<OrderResult> = {
          status: "failed",
          error: createConnectorError({
            code: "conflict",
            message: "Conflict during order completion",
            retryable: false,
            source: CONNECTOR_SOURCE,
          }),
        };
        idempotencyStore.set(input.idempotencyKey, outcome);
        correlationStore.set(input.correlationId, outcome);
        return outcome;
      }

      const payload = input.payload;
      const variantId = payload.variantId ?? "unknown";
      const quantity = payload.quantity ?? 1;
      const orderId = payload.quoteId ?? `order-completed-${Date.now()}`;

      const reserved = inventory.reserve(variantId, quantity);
      if (!reserved) {
        const outcome: ActionOutcome<OrderResult> = {
          status: "failed",
          error: createConnectorError({
            code: "conflict",
            message: "Insufficient inventory",
            retryable: false,
            source: CONNECTOR_SOURCE,
          }),
        };
        idempotencyStore.set(input.idempotencyKey, outcome);
        correlationStore.set(input.correlationId, outcome);
        return outcome;
      }

      const result: OrderResult = {
        orderId,
        status: "completed",
        variantId,
        quantity,
      };

      const outcome = makeSucceeded(result, orderId);
      idempotencyStore.set(input.idempotencyKey, outcome);
      correlationStore.set(input.correlationId, outcome);

      eventStream.emit("order_completed", { orderId, variantId, quantity });

      return outcome;
    },

    async query(correlationId: string): Promise<ActionOutcome<OrderResult> | null> {
      return correlationStore.get(correlationId) ?? null;
    },
  };
}

// ─── Cancel Order Action ──────────────────────────────────────────────────────

export function createCancelOrderAction(
  eventStream: DeterministicEventStream,
  inventory: InventoryStore,
  faultControls?: FaultControls,
): ActionPort<CancelPayload, CancelResult> {
  const idempotencyStore = new Map<string, ActionOutcome<CancelResult>>();
  const correlationStore = new Map<string, ActionOutcome<CancelResult>>();

  return {
    async execute(input: ActionInput<CancelPayload>): Promise<ActionOutcome<CancelResult>> {
      const existing = idempotencyStore.get(input.idempotencyKey);
      if (existing) return existing;

      if (faultControls?.shouldReturnConflictError()) {
        const outcome: ActionOutcome<CancelResult> = {
          status: "failed",
          error: createConnectorError({
            code: "conflict",
            message: "Conflict during order cancellation",
            retryable: false,
            source: CONNECTOR_SOURCE,
          }),
        };
        idempotencyStore.set(input.idempotencyKey, outcome);
        correlationStore.set(input.correlationId, outcome);
        return outcome;
      }

      const payload = input.payload;
      const orderId = payload.orderId ?? "unknown-order";

      // Release inventory (assume 1 unit for simplicity in ref connector)
      inventory.release("unknown", 1);

      const result: CancelResult = {
        orderId,
        status: "cancelled",
        cancelledAt: Date.now() as Instant,
      };

      const outcome = makeSucceeded(result, orderId);
      idempotencyStore.set(input.idempotencyKey, outcome);
      correlationStore.set(input.correlationId, outcome);

      eventStream.emit("order_cancelled", { orderId, reason: payload.reason ?? "user_request" });

      return outcome;
    },

    async query(correlationId: string): Promise<ActionOutcome<CancelResult> | null> {
      return correlationStore.get(correlationId) ?? null;
    },
  };
}

// ─── Create Refund Action ─────────────────────────────────────────────────────

export function createRefundAction(
  eventStream: DeterministicEventStream,
  faultControls?: FaultControls,
): ActionPort<RefundPayload, RefundResult> {
  const idempotencyStore = new Map<string, ActionOutcome<RefundResult>>();
  const correlationStore = new Map<string, ActionOutcome<RefundResult>>();
  let refundCounter = 0;

  return {
    async execute(input: ActionInput<RefundPayload>): Promise<ActionOutcome<RefundResult>> {
      const existing = idempotencyStore.get(input.idempotencyKey);
      if (existing) return existing;

      if (faultControls?.shouldReturnConflictError()) {
        const outcome: ActionOutcome<RefundResult> = {
          status: "failed",
          error: createConnectorError({
            code: "conflict",
            message: "Conflict during refund creation",
            retryable: false,
            source: CONNECTOR_SOURCE,
          }),
        };
        idempotencyStore.set(input.idempotencyKey, outcome);
        correlationStore.set(input.correlationId, outcome);
        return outcome;
      }

      refundCounter++;
      const refundId = `refund-${refundCounter.toString().padStart(4, "0")}`;
      const payload = input.payload;
      const orderId = payload.orderId ?? "unknown-order";
      const amountMinor = payload.amountMinor ?? 0;

      const result: RefundResult = {
        refundId,
        orderId,
        amountMinor,
        status: "refunded",
      };

      const outcome = makeSucceeded(result, refundId);
      idempotencyStore.set(input.idempotencyKey, outcome);
      correlationStore.set(input.correlationId, outcome);

      eventStream.emit("refund_created", { refundId, orderId, amountMinor });

      return outcome;
    },

    async query(correlationId: string): Promise<ActionOutcome<RefundResult> | null> {
      return correlationStore.get(correlationId) ?? null;
    },
  };
}
