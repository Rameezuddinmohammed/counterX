import {
  type CanonicalError,
  type CounterId,
  type Instant,
  type Result,
  createCanonicalError,
  err,
  ok,
} from "@counter/domain";
import type {
  InboxEvent,
  InboxEventInput,
  InboxReceiveResult,
  InboxRepository,
} from "./inbox-repository.js";

export class InMemoryInboxRepository implements InboxRepository {
  readonly #events: Map<CounterId<"inbox-event">, InboxEvent> = new Map();
  readonly #sourceIndex: Map<string, CounterId<"inbox-event">> = new Map();

  public receive(input: InboxEventInput, now: Instant): Result<InboxReceiveResult, CanonicalError> {
    const compositeKey = `${input.source}::${input.sourceEventId}`;
    const existingId = this.#sourceIndex.get(compositeKey);

    if (existingId !== undefined) {
      return ok({ outcome: "duplicate" });
    }

    const event: InboxEvent = Object.freeze({
      id: input.id,
      source: input.source,
      sourceEventId: input.sourceEventId,
      eventType: input.eventType,
      payload: input.payload,
      correlationId: input.correlationId,
      status: "received",
      receivedAt: now,
      processedAt: undefined,
    });

    this.#events.set(input.id, event);
    this.#sourceIndex.set(compositeKey, input.id);

    return ok({ outcome: "new", event });
  }

  public markProcessed(id: CounterId<"inbox-event">, now: Instant): Result<void, CanonicalError> {
    const event = this.#events.get(id);
    if (event === undefined) {
      return err(
        createCanonicalError({
          category: "validation",
          code: "INVALID_FORMAT",
          message: "Inbox event not found",
        }),
      );
    }

    const updated: InboxEvent = Object.freeze({
      ...event,
      status: "processed",
      processedAt: now,
    });
    this.#events.set(id, updated);
    return ok(undefined);
  }

  /** Test helper: get event by ID. */
  public getEvent(id: CounterId<"inbox-event">): InboxEvent | undefined {
    return this.#events.get(id);
  }
}
