/**
 * Durable poll/lease/execute worker loop.
 *
 * `runTick` performs one poll/lease/execute/complete cycle against an injected
 * AsyncJobRepository (the PostgresJobRepository in production, an in-memory or
 * hand-rolled fake in unit tests). `createWorkerLoop` runs ticks on an interval
 * with cooperative shutdown.
 */

import type { CounterId, Instant } from "@counter/domain";
import { instantFromEpochMilliseconds } from "@counter/domain";
import type { AsyncJobRepository } from "@counter/data";
import type { Job } from "@counter/workflow";
import { HandlerError, type JobHandler } from "./transaction-lifecycle.js";

export interface TickConfig {
  /** Job types this worker will claim. */
  readonly jobTypes: readonly string[];
  /** Stable identifier for this worker instance (hostname + random). */
  readonly leaseOwner: string;
  /** How long a lease is held before it is considered expired. */
  readonly leaseDurationMs: number;
  /** Max jobs claimed per tick. */
  readonly batchSize: number;
  /** Base delay for exponential backoff on retryable failures. */
  readonly baseRetryDelayMs: number;
  /** Handlers keyed by job.type. */
  readonly handlers: ReadonlyMap<string, JobHandler>;
}

export interface TickResult {
  readonly claimed: number;
  readonly completed: number;
  readonly failed: number;
}

export interface TickLogger {
  info(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

const NOOP_LOGGER: TickLogger = {
  info: () => undefined,
  error: () => undefined,
};

function nowInstant(): Instant {
  const result = instantFromEpochMilliseconds(Date.now());
  if (!result.ok) {
    // Date.now() is always in range; this is defensive only.
    throw new Error("Failed to derive current instant");
  }
  return result.value;
}

function classifyError(error: unknown): { errorClass: string; message: string; retryable: boolean } {
  if (error instanceof HandlerError) {
    return { errorClass: error.errorClass, message: error.message, retryable: error.retryable };
  }
  if (error instanceof Error) {
    // Unknown errors are treated as retryable transient failures.
    return { errorClass: "handler.unexpected", message: error.message, retryable: true };
  }
  return { errorClass: "handler.unexpected", message: String(error), retryable: true };
}

/**
 * Execute a single poll/lease/execute/complete cycle.
 *
 * - Claims jobs (FOR UPDATE SKIP LOCKED via the repository).
 * - Dispatches each to a typed handler by job.type.
 * - On success: `repo.complete`.
 * - On failure: `repo.fail` (exponential backoff + auto dead-letter at
 *   max attempts). Terminal (non-retryable) failures use a distinct
 *   errorClass but still go through `fail` so attempts are recorded.
 */
export async function runTick(
  repo: AsyncJobRepository,
  config: TickConfig,
  logger: TickLogger = NOOP_LOGGER,
  clock: () => Instant = nowInstant,
): Promise<TickResult> {
  const now = clock();
  const claimResult = await repo.claim(
    config.jobTypes,
    config.leaseOwner,
    config.leaseDurationMs,
    now,
    config.batchSize,
  );

  if (!claimResult.ok) {
    logger.error("claim failed", { error: claimResult.error.message });
    return { claimed: 0, completed: 0, failed: 0 };
  }

  const jobs: readonly Job[] = claimResult.value;
  if (jobs.length === 0) {
    return { claimed: 0, completed: 0, failed: 0 };
  }

  let completed = 0;
  let failed = 0;

  for (const job of jobs) {
    const handler = config.handlers.get(job.type);
    if (handler === undefined) {
      failed += 1;
      await failJob(
        repo,
        job.id,
        config,
        "handler.missing",
        `No handler registered for job type ${job.type}`,
        clock,
        logger,
      );
      continue;
    }

    try {
      await handler.execute({ id: job.id, type: job.type, payload: job.payload }, clock());
      const completeResult = await repo.complete(job.id, config.leaseOwner, clock());
      if (!completeResult.ok) {
        logger.error("complete failed", {
          jobId: job.id,
          error: completeResult.error.message,
        });
        failed += 1;
        continue;
      }
      completed += 1;
    } catch (error) {
      failed += 1;
      const classified = classifyError(error);
      logger.error("handler failed", {
        jobId: job.id,
        errorClass: classified.errorClass,
        retryable: classified.retryable,
        message: classified.message,
      });
      await failJob(
        repo,
        job.id,
        config,
        classified.errorClass,
        classified.message,
        clock,
        logger,
      );
    }
  }

  return { claimed: jobs.length, completed, failed };
}

async function failJob(
  repo: AsyncJobRepository,
  id: CounterId<"job">,
  config: TickConfig,
  errorClass: string,
  message: string,
  clock: () => Instant,
  logger: TickLogger,
): Promise<void> {
  const failResult = await repo.fail(
    id,
    config.leaseOwner,
    errorClass,
    message,
    config.baseRetryDelayMs,
    clock(),
  );
  if (!failResult.ok) {
    logger.error("fail bookkeeping failed", { jobId: id, error: failResult.error.message });
  }
}

// ─── Loop ────────────────────────────────────────────────────────────────────

export interface WorkerLoop {
  /** Resolves once the loop has stopped after `stop()` is called. */
  readonly done: Promise<void>;
  stop(): void;
}

export interface LoopConfig extends TickConfig {
  /** Delay between ticks (also the idle poll interval). */
  readonly pollIntervalMs: number;
}

/**
 * Runs `runTick` repeatedly until `stop()` is called. Ticks never overlap; a
 * failure inside a tick is logged and the loop continues.
 */
export function createWorkerLoop(
  repo: AsyncJobRepository,
  config: LoopConfig,
  logger: TickLogger = NOOP_LOGGER,
  clock: () => Instant = nowInstant,
): WorkerLoop {
  let running = true;
  let wake: (() => void) | undefined;

  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const timer = setTimeout(() => {
        wake = undefined;
        resolve();
      }, ms);
      wake = () => {
        clearTimeout(timer);
        wake = undefined;
        resolve();
      };
    });

  const done = (async () => {
    logger.info("worker loop started", { leaseOwner: config.leaseOwner });
    while (running) {
      try {
        await runTick(repo, config, logger, clock);
      } catch (error) {
        logger.error("tick threw", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      if (running) {
        await sleep(config.pollIntervalMs);
      }
    }
    logger.info("worker loop stopped", { leaseOwner: config.leaseOwner });
  })();

  return {
    done,
    stop(): void {
      running = false;
      if (wake !== undefined) {
        wake();
      }
    },
  };
}
