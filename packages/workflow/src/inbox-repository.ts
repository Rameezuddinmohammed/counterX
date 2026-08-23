import type { CanonicalError, CounterId, Instant } from "@counter/domain";
import type { Result } from "@counter/domain";

// --- Status types ---

export type InboxEventStatus = "received" | "processed" | "duplicate";

// --- Event entity ---

export interface InboxEvent {
  readonly id: CounterId<"inbox-event">;
  readonly source: string;
  readonly sourceEventId: string;
  readonly eventType: string;
  readonly payload: unknown;
  readonly correlationId: CounterId<"correlation"> | undefined;
  readonly status: InboxEventStatus;
  readonly receivedAt: Instant;
  readonly processedAt: Instant | undefined;
}

// --- Receive result variants ---

export interface InboxReceiveNew {
  readonly outcome: "new";
  readonly event: InboxEvent;
}

export interface InboxReceiveDuplicate {
  readonly outcome: "duplicate";
}

export type InboxReceiveResult = InboxReceiveNew | InboxReceiveDuplicate;

// --- Input for receiving ---

export interface InboxEventInput {
  readonly id: CounterId<"inbox-event">;
  readonly source: string;
  readonly sourceEventId: string;
  readonly eventType: string;
  readonly payload: unknown;
  readonly correlationId: CounterId<"correlation"> | undefined;
}

// --- Repository interface ---

export interface InboxRepository {
  receive(input: InboxEventInput, now: Instant): Result<InboxReceiveResult, CanonicalError>;
  markProcessed(id: CounterId<"inbox-event">, now: Instant): Result<void, CanonicalError>;
}
