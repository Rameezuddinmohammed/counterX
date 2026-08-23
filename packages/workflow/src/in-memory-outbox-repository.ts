import {
  type CanonicalError,
  type CounterId,
  type Instant,
  type Result,
  createCanonicalError,
  err,
  ok,
} from "@counter/domain";
import type { OutboxEvent, OutboxEventInput, OutboxRepository } from "./outbox-repository.js";

export class InMemoryOutboxRepository implements OutboxRepository {
  readonly #events: Map<CounterId<"outbox-event">, OutboxEvent> = new Map();

  public append(
    events: readonly OutboxEventInput[],
    now: Instant,
  ): Result<readonly OutboxEvent[], CanonicalError> {
    const created: OutboxEvent[] = [];

    for (const input of events) {
      const event: OutboxEvent = Object.freeze({
        id: input.id,
        eventType: input.eventType,
        eventVersion: input.eventVersion,
        payload: input.payload,
        correlationId: input.correlationId,
        idempotencyKey: input.idempotencyKey,
        status: "pending",
        attempts: 0,
        nextAttemptAt: now,
        createdAt: now,
        dispatchedAt: undefined,
        errorClass: undefined,
        owner: undefined,
      });
      this.#events.set(input.id, event);
      created.push(event);
    }

    return ok(Object.freeze(created));
  }

  public claim(
    limit: number,
    owner: string,
    now: Instant,
  ): Result<readonly OutboxEvent[], CanonicalError> {
    const claimed: OutboxEvent[] = [];

    for (const [id, event] of this.#events) {
      if (claimed.length >= limit) break;
      if (event.status !== "pending" && event.status !== "failed") continue;
      if (event.nextAttemptAt !== undefined && event.nextAttemptAt > now) continue;

      const updated: OutboxEvent = Object.freeze({
        ...event,
        owner,
      });
      this.#events.set(id, updated);
      claimed.push(updated);
    }

    return ok(Object.freeze(claimed));
  }

  public markDispatched(
    ids: readonly CounterId<"outbox-event">[],
    now: Instant,
  ): Result<void, CanonicalError> {
    for (const id of ids) {
      const event = this.#events.get(id);
      if (event === undefined) {
        return err(
          createCanonicalError({
            category: "validation",
            code: "INVALID_FORMAT",
            message: "Outbox event not found",
          }),
        );
      }
      const updated: OutboxEvent = Object.freeze({
        ...event,
        status: "dispatched",
        dispatchedAt: now,
      });
      this.#events.set(id, updated);
    }
    return ok(undefined);
  }

  public markFailed(
    id: CounterId<"outbox-event">,
    errorClass: string,
    now: Instant,
  ): Result<void, CanonicalError> {
    const event = this.#events.get(id);
    if (event === undefined) {
      return err(
        createCanonicalError({
          category: "validation",
          code: "INVALID_FORMAT",
          message: "Outbox event not found",
        }),
      );
    }

    const attempts = event.attempts + 1;
    const backoffMs = 1000 * Math.pow(2, attempts - 1);
    const nextAttemptAt = (now + backoffMs) as Instant;

    const updated: OutboxEvent = Object.freeze({
      ...event,
      status: "failed",
      attempts,
      errorClass,
      nextAttemptAt,
    });
    this.#events.set(id, updated);
    return ok(undefined);
  }

  public markDeadLetter(
    id: CounterId<"outbox-event">,
    owner: string,
  ): Result<void, CanonicalError> {
    const event = this.#events.get(id);
    if (event === undefined) {
      return err(
        createCanonicalError({
          category: "validation",
          code: "INVALID_FORMAT",
          message: "Outbox event not found",
        }),
      );
    }

    const updated: OutboxEvent = Object.freeze({
      ...event,
      status: "dead_letter",
      owner,
    });
    this.#events.set(id, updated);
    return ok(undefined);
  }

  /** Test helper: get all events. */
  public getAll(): readonly OutboxEvent[] {
    return Object.freeze([...this.#events.values()]);
  }
}
