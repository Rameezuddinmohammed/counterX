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
  Job,
  JobInput,
  JobRepository,
} from "./job-repository.js";

export class InMemoryJobRepository implements JobRepository {
  readonly #jobs: Map<CounterId<"job">, Job> = new Map();

  public enqueue(input: JobInput, now: Instant): Result<Job, CanonicalError> {
    const job: Job = Object.freeze({
      id: input.id,
      type: input.type,
      payload: input.payload,
      correlationId: input.correlationId,
      status: "available",
      availableAt: input.availableAt,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      attemptCount: 0,
      maxAttempts: input.maxAttempts,
      lastErrorClass: undefined,
      createdAt: now,
      completedAt: undefined,
    });
    this.#jobs.set(input.id, job);
    return ok(job);
  }

  public claim(
    types: readonly string[],
    leaseOwner: string,
    leaseDurationMs: number,
    now: Instant,
  ): Result<readonly Job[], CanonicalError> {
    const typeSet = new Set(types);
    const claimed: Job[] = [];

    for (const [id, job] of this.#jobs) {
      if (!typeSet.has(job.type)) continue;

      const isAvailable = job.status === "available" && job.availableAt <= now;
      const isExpiredLease =
        job.status === "leased" &&
        job.leaseExpiresAt !== undefined &&
        job.leaseExpiresAt < now;

      if (!isAvailable && !isExpiredLease) continue;

      const leaseExpiresAt = (now + leaseDurationMs) as Instant;
      const updated: Job = Object.freeze({
        ...job,
        status: "leased" as const,
        leaseOwner,
        leaseExpiresAt,
        attemptCount: job.attemptCount + 1,
      });
      this.#jobs.set(id, updated);
      claimed.push(updated);
    }

    return ok(Object.freeze(claimed));
  }

  public renewLease(
    id: CounterId<"job">,
    owner: string,
    leaseDurationMs: number,
    now: Instant,
  ): Result<void, CanonicalError> {
    const job = this.#jobs.get(id);
    if (job === undefined) {
      return err(
        createCanonicalError({
          category: "validation",
          code: "INVALID_FORMAT",
          message: "Job not found",
        }),
      );
    }
    if (job.status !== "leased" || job.leaseOwner !== owner) {
      return err(
        createCanonicalError({
          category: "conflict",
          code: "CONFLICT",
          message: "Job is not leased by the specified owner",
        }),
      );
    }

    const leaseExpiresAt = (now + leaseDurationMs) as Instant;
    const updated: Job = Object.freeze({
      ...job,
      leaseExpiresAt,
    });
    this.#jobs.set(id, updated);
    return ok(undefined);
  }

  public complete(
    id: CounterId<"job">,
    owner: string,
    now: Instant,
  ): Result<void, CanonicalError> {
    const job = this.#jobs.get(id);
    if (job === undefined) {
      return err(
        createCanonicalError({
          category: "validation",
          code: "INVALID_FORMAT",
          message: "Job not found",
        }),
      );
    }
    if (job.status !== "leased" || job.leaseOwner !== owner) {
      return err(
        createCanonicalError({
          category: "conflict",
          code: "CONFLICT",
          message: "Job is not leased by the specified owner",
        }),
      );
    }

    const updated: Job = Object.freeze({
      ...job,
      status: "completed" as const,
      completedAt: now,
    });
    this.#jobs.set(id, updated);
    return ok(undefined);
  }

  public fail(
    id: CounterId<"job">,
    owner: string,
    errorClass: string,
    _errorMessage: string,
    baseDelayMs: number,
    now: Instant,
  ): Result<void, CanonicalError> {
    const job = this.#jobs.get(id);
    if (job === undefined) {
      return err(
        createCanonicalError({
          category: "validation",
          code: "INVALID_FORMAT",
          message: "Job not found",
        }),
      );
    }
    if (job.status !== "leased" || job.leaseOwner !== owner) {
      return err(
        createCanonicalError({
          category: "conflict",
          code: "CONFLICT",
          message: "Job is not leased by the specified owner",
        }),
      );
    }

    // Exponential backoff: baseDelay * 2^(attemptCount - 1)
    const backoffMs = baseDelayMs * Math.pow(2, job.attemptCount - 1);
    const nextAvailableAt = (now + backoffMs) as Instant;

    // If max attempts reached, move to dead_letter
    if (job.attemptCount >= job.maxAttempts) {
      const updated: Job = Object.freeze({
        ...job,
        status: "dead_letter" as const,
        lastErrorClass: errorClass,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
      });
      this.#jobs.set(id, updated);
      return ok(undefined);
    }

    const updated: Job = Object.freeze({
      ...job,
      status: "available" as const,
      lastErrorClass: errorClass,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      availableAt: nextAvailableAt,
    });
    this.#jobs.set(id, updated);
    return ok(undefined);
  }

  public deadLetter(
    id: CounterId<"job">,
    owner: string,
    _reason: string,
  ): Result<void, CanonicalError> {
    const job = this.#jobs.get(id);
    if (job === undefined) {
      return err(
        createCanonicalError({
          category: "validation",
          code: "INVALID_FORMAT",
          message: "Job not found",
        }),
      );
    }
    if (job.status !== "leased" || job.leaseOwner !== owner) {
      return err(
        createCanonicalError({
          category: "conflict",
          code: "CONFLICT",
          message: "Job is not leased by the specified owner",
        }),
      );
    }

    const updated: Job = Object.freeze({
      ...job,
      status: "dead_letter" as const,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
    });
    this.#jobs.set(id, updated);
    return ok(undefined);
  }

  /** Test helper: get job by ID. */
  public getJob(id: CounterId<"job">): Job | undefined {
    return this.#jobs.get(id);
  }
}
