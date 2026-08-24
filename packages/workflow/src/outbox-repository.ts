import type { CanonicalError, CounterId, Instant } from "@counter/domain";
import type { Result } from "@counter/domain";

// --- Status types ---

export type OutboxEventStatus = "pending" | "dispatched" | "failed" | "dead_letter";

// --- Event entity ---

export interface OutboxEvent {
  readonly id: CounterId<"outbox-event">;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly payload: unknown;
  readonly correlationId: CounterId<"correlation"> | undefined;
  readonly idempotencyKey: string | undefined;
  readonly status: OutboxEventStatus;
  readonly attempts: number;
  readonly nextAttemptAt: Instant | undefined;
  readonly createdAt: Instant;
  readonly dispatchedAt: Instant | undefined;
  readonly errorClass: string | undefined;
  readonly owner: string | undefined;
}

// --- Input for appending ---

export interface OutboxEventInput {
  readonly id: CounterId<"outbox-event">;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly payload: unknown;
  readonly correlationId: CounterId<"correlation"> | undefined;
  readonly idempotencyKey: string | undefined;
}

// --- Repository interface ---

export interface OutboxRepository {
  append(
    events: readonly OutboxEventInput[],
    now: Instant,
  ): Result<readonly OutboxEvent[], CanonicalError>;
  claim(limit: number, owner: string, now: Instant): Result<readonly OutboxEvent[], CanonicalError>;
  markDispatched(
    ids: readonly CounterId<"outbox-event">[],
    now: Instant,
  ): Result<void, CanonicalError>;
  markFailed(
    id: CounterId<"outbox-event">,
    errorClass: string,
    now: Instant,
  ): Result<void, CanonicalError>;
  markDeadLetter(id: CounterId<"outbox-event">, owner: string): Result<void, CanonicalError>;
}
