import type { CanonicalError, Instant, Sha256Digest } from "@counter/domain";
import type { Result } from "@counter/domain";

// --- Status types ---

export type IdempotencyKeyStatus = "pending" | "completed" | "failed";

// --- Stored entry ---

export interface IdempotencyEntry {
  readonly key: string;
  readonly digest: Sha256Digest;
  readonly status: IdempotencyKeyStatus;
  readonly responseSnapshot: unknown | undefined;
  readonly createdAt: Instant;
  readonly completedAt: Instant | undefined;
}

// --- Acquire result variants ---

export interface IdempotencyAcquired {
  readonly outcome: "acquired";
  readonly entry: IdempotencyEntry;
}

export interface IdempotencyReplay {
  readonly outcome: "replay";
  readonly responseSnapshot: unknown;
}

export interface IdempotencyInFlight {
  readonly outcome: "in_flight";
}

export interface IdempotencyDigestConflict {
  readonly outcome: "digest_conflict";
}

export type IdempotencyAcquireResult =
  | IdempotencyAcquired
  | IdempotencyReplay
  | IdempotencyInFlight
  | IdempotencyDigestConflict;

// --- Store interface ---

export interface IdempotencyStore {
  acquire(key: string, digest: Sha256Digest, now: Instant): Result<IdempotencyAcquireResult, CanonicalError>;
  complete(key: string, responseSnapshot: unknown, now: Instant): Result<void, CanonicalError>;
  fail(key: string): Result<void, CanonicalError>;
}
