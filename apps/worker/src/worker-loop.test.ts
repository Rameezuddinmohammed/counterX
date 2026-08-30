import { describe, expect, it } from "vitest";
import {
  createCounterId,
  instantFromEpochMilliseconds,
  type CanonicalError,
  type CounterId,
  type Instant,
  type Result,
} from "@counter/domain";
import { InMemoryJobRepository, type Job, type JobInput } from "@counter/workflow";
import type { AsyncJobRepository } from "@counter/data";
import { runTick, type TickConfig } from "./worker-loop.js";
import { HandlerError, type HandledJob, type JobHandler } from "./transaction-lifecycle.js";

// ─── Test helpers ─────────────────────────────────────────────────────────────

function counterId<Kind extends Parameters<typeof createCounterId>[0]>(
  kind: Kind,
  seed: number,
): CounterId<Kind> {
  const result = createCounterId(kind, new Uint8Array(16).fill(seed));
  if (!result.ok) {
    throw new Error(`Could not create ${String(kind)} id`);
  }
  return result.value;
}

function instant(ms: number): Instant {
  const result = instantFromEpochMilliseconds(ms);
  if (!result.ok) {
    throw new Error("bad instant");
  }
  return result.value;
}

/**
 * Adapts the synchronous InMemoryJobRepository to the async repository contract
 * the worker loop consumes. This exercises the exact same claim/complete/fail
 * semantics the Postgres repository implements (backoff + dead-letter).
 */
class AsyncInMemoryJobRepository implements AsyncJobRepository {
  readonly inner = new InMemoryJobRepository();

  enqueue(input: JobInput, now: Instant): Promise<Result<Job, CanonicalError>> {
    return Promise.resolve(this.inner.enqueue(input, now));
  }
  claim(
    types: readonly string[],
    leaseOwner: string,
    leaseDurationMs: number,
    now: Instant,
    _limit?: number,
  ): Promise<Result<readonly Job[], CanonicalError>> {
    return Promise.resolve(this.inner.claim(types, leaseOwner, leaseDurationMs, now));
  }
  renewLease(
    id: CounterId<"job">,
    owner: string,
    leaseDurationMs: number,
    now: Instant,
  ): Promise<Result<void, CanonicalError>> {
    return Promise.resolve(this.inner.renewLease(id, owner, leaseDurationMs, now));
  }
  complete(
    id: CounterId<"job">,
    owner: string,
    now: Instant,
  ): Promise<Result<void, CanonicalError>> {
    return Promise.resolve(this.inner.complete(id, owner, now));
  }
  fail(
    id: CounterId<"job">,
    owner: string,
    errorClass: string,
    errorMessage: string,
    baseDelayMs: number,
    now: Instant,
  ): Promise<Result<void, CanonicalError>> {
    return Promise.resolve(this.inner.fail(id, owner, errorClass, errorMessage, baseDelayMs, now));
  }
  deadLetter(
    id: CounterId<"job">,
    owner: string,
    reason: string,
  ): Promise<Result<void, CanonicalError>> {
    return Promise.resolve(this.inner.deadLetter(id, owner, reason));
  }
}

const JOB_TYPE = "test.job";

function makeConfig(handler: JobHandler): TickConfig {
  return {
    jobTypes: [JOB_TYPE],
    leaseOwner: "worker-1",
    leaseDurationMs: 30_000,
    batchSize: 10,
    baseRetryDelayMs: 1_000,
    handlers: new Map<string, JobHandler>([[JOB_TYPE, handler]]),
  };
}

function enqueue(
  repo: AsyncInMemoryJobRepository,
  id: number,
  maxAttempts: number,
): CounterId<"job"> {
  const jobId = counterId("job", id);
  repo.inner.enqueue(
    {
      id: jobId,
      type: JOB_TYPE,
      payload: { hello: "world" },
      correlationId: undefined,
      availableAt: instant(1_000),
      maxAttempts,
    },
    instant(1_000),
  );
  return jobId;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("runTick", () => {
  it("leases, executes, and completes a claimable job", async () => {
    const repo = new AsyncInMemoryJobRepository();
    const jobId = enqueue(repo, 1, 3);
    const seen: HandledJob[] = [];
    const handler: JobHandler = {
      execute: (job): Promise<void> => {
        seen.push(job);
        return Promise.resolve();
      },
    };

    const result = await runTick(repo, makeConfig(handler), undefined, () => instant(2_000));

    expect(result).toEqual({ claimed: 1, completed: 1, failed: 0 });
    expect(seen).toHaveLength(1);
    const job = repo.inner.getJob(jobId);
    expect(job?.status).toBe("completed");
  });

  it("requeues with incremented attempt on a retryable failure", async () => {
    const repo = new AsyncInMemoryJobRepository();
    const jobId = enqueue(repo, 2, 3);
    const handler: JobHandler = {
      execute: (): Promise<void> => Promise.reject(new HandlerError("transient", "boom", true)),
    };

    const result = await runTick(repo, makeConfig(handler), undefined, () => instant(2_000));

    expect(result).toEqual({ claimed: 1, completed: 0, failed: 1 });
    const job = repo.inner.getJob(jobId);
    expect(job?.status).toBe("available");
    expect(job?.attemptCount).toBe(1);
    expect(job?.lastErrorClass).toBe("transient");
    // Backoff pushed availability into the future.
    expect(job?.availableAt).toBeGreaterThan(2_000);
  });

  it("dead-letters a job that exhausts its attempts", async () => {
    const repo = new AsyncInMemoryJobRepository();
    const jobId = enqueue(repo, 3, 1);
    const handler: JobHandler = {
      execute: (): Promise<void> => Promise.reject(new HandlerError("transient", "boom", true)),
    };

    const result = await runTick(repo, makeConfig(handler), undefined, () => instant(2_000));

    expect(result.failed).toBe(1);
    const job = repo.inner.getJob(jobId);
    expect(job?.status).toBe("dead_letter");
  });

  it("is a no-op when there are no claimable jobs", async () => {
    const repo = new AsyncInMemoryJobRepository();
    let executed = 0;
    const handler: JobHandler = {
      execute: (): Promise<void> => {
        executed += 1;
        return Promise.resolve();
      },
    };

    const result = await runTick(repo, makeConfig(handler), undefined, () => instant(2_000));

    expect(result).toEqual({ claimed: 0, completed: 0, failed: 0 });
    expect(executed).toBe(0);
  });

  it("fails a job whose type has no registered handler", async () => {
    const repo = new AsyncInMemoryJobRepository();
    const jobId = enqueue(repo, 4, 3);
    const config: TickConfig = {
      jobTypes: [JOB_TYPE],
      leaseOwner: "worker-1",
      leaseDurationMs: 30_000,
      batchSize: 10,
      baseRetryDelayMs: 1_000,
      handlers: new Map(),
    };

    const result = await runTick(repo, config, undefined, () => instant(2_000));

    expect(result.failed).toBe(1);
    const job = repo.inner.getJob(jobId);
    expect(job?.lastErrorClass).toBe("handler.missing");
  });
});
