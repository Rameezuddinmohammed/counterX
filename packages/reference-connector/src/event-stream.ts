/**
 * Deterministic event stream for the reference connector.
 *
 * Tracks state change events (quote_created, draft_order_created,
 * order_completed, order_cancelled, refund_created) and supports
 * polling with optional fault injection for duplicates and reordering.
 */

import type { Instant } from "@counter/domain";

import type { FaultControls } from "./fault-controls.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export const EVENT_TOPICS = [
  "quote_created",
  "draft_order_created",
  "order_completed",
  "order_cancelled",
  "refund_created",
] as const;

export type EventTopic = (typeof EVENT_TOPICS)[number];

export interface ConnectorEvent {
  readonly eventId: string;
  readonly topic: EventTopic;
  readonly sequence: number;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly occurredAt: Instant;
}

// ─── Deterministic Event Stream ───────────────────────────────────────────────

export class DeterministicEventStream {
  readonly #events: ConnectorEvent[] = [];
  readonly #faultControls: FaultControls | undefined;
  #nextSequence = 1;

  constructor(faultControls?: FaultControls) {
    this.#faultControls = faultControls;
  }

  emit(topic: EventTopic, payload: Readonly<Record<string, unknown>>): ConnectorEvent {
    const event: ConnectorEvent = {
      eventId: `evt-${this.#nextSequence.toString().padStart(6, "0")}`,
      topic,
      sequence: this.#nextSequence,
      payload,
      occurredAt: Date.now() as Instant,
    };
    this.#nextSequence++;
    this.#events.push(event);
    return event;
  }

  getEvents(sinceSequence: number): readonly ConnectorEvent[] {
    let result = this.#events.filter((e) => e.sequence > sinceSequence);

    if (this.#faultControls) {
      // Apply duplicate injection
      if (this.#faultControls.shouldDuplicateEvent() && result.length > 0) {
        const duplicated = result[0]!;
        result = [duplicated, ...result];
      }

      // Apply reorder injection
      if (this.#faultControls.shouldReorderEvents() && result.length > 1) {
        result = [...result].reverse();
      }
    }

    return result;
  }

  get allEvents(): readonly ConnectorEvent[] {
    return [...this.#events];
  }

  get currentSequence(): number {
    return this.#nextSequence - 1;
  }
}
