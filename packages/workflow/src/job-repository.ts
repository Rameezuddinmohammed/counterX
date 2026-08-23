import type { CanonicalError, CounterId, Instant } from "@counter/domain";
import type { Result } from "@counter/domain";

// --- Status types ---

export type JobStatus = "available" | "leased" | "completed" | "failed" | "dead_letter";
export type JobAttemptStatus = "running" | "succeeded" | "failed";

// --- Job entity ---

export interface Job {
  readonly id: CounterId<"job">;
  readonly type: string;
  readonly payload: unknown;
  readonly correlationId: CounterId<"correlation"> | undefined;
  readonly status: JobStatus;
  readonly availableAt: Instant;
  readonly leaseOwner: string | undefined;
  readonly leaseExpiresAt: Instant | undefined;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly lastErrorClass: string | undefined;
  readonly createdAt: Instant;
  readonly completedAt: Instant | undefined;
}

// --- Job attempt entity ---

export interface JobAttempt {
  readonly jobId: CounterId<"job">;
  readonly attemptNumber: number;
  readonly startedAt: Instant;
  readonly completedAt: Instant | undefined;
  readonly status: JobAttemptStatus;
  readonly errorClass: string | undefined;
  readonly errorMessage: string | undefined;
}

// --- Input for enqueuing ---

export interface JobInput {
  readonly id: CounterId<"job">;
  readonly type: string;
  readonly payload: unknown;
  readonly correlationId: CounterId<"correlation"> | undefined;
  readonly availableAt: Instant;
  readonly maxAttempts: number;
}

// --- Repository interface ---

export interface JobRepository {
  enqueue(input: JobInput, now: Instant): Result<Job, CanonicalError>;
  claim(
    types: readonly string[],
    leaseOwner: string,
    leaseDurationMs: number,
    now: Instant,
  ): Result<readonly Job[], CanonicalError>;
  renewLease(
    id: CounterId<"job">,
    owner: string,
    leaseDurationMs: number,
    now: Instant,
  ): Result<void, CanonicalError>;
  complete(id: CounterId<"job">, owner: string, now: Instant): Result<void, CanonicalError>;
  fail(
    id: CounterId<"job">,
    owner: string,
    errorClass: string,
    errorMessage: string,
    baseDelayMs: number,
    now: Instant,
  ): Result<void, CanonicalError>;
  deadLetter(id: CounterId<"job">, owner: string, reason: string): Result<void, CanonicalError>;
}
