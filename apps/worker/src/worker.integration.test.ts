import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  createCounterId,
  instantFromEpochMilliseconds,
  type CounterId,
  type Instant,
} from "@counter/domain";
import {
  loadMigrations,
  MigrationRunner,
  PostgresDatabase,
  PostgresJobRepository,
} from "@counter/data";
import { runTick, type TickConfig } from "./worker-loop.js";
import {
  createTransactionLifecycleHandler,
  TRANSACTION_LIFECYCLE_JOB_TYPE,
  type JobHandler,
  type PaymentAuthorizationPort,
  type PaymentAuthorizationResult,
  type ReceiptSink,
} from "./transaction-lifecycle.js";

const testDatabaseUrl = process.env["TEST_DATABASE_URL"]?.trim() || undefined;
const dbDescribe = testDatabaseUrl === undefined ? describe.skip : describe;
const migrationsDirectory = fileURLToPath(new URL("../../../packages/data/migrations", import.meta.url));
const hookTimeout = 30_000;

function instant(ms: number): Instant {
  const result = instantFromEpochMilliseconds(ms);
  if (!result.ok) {
    throw new Error("bad instant");
  }
  return result.value;
}

function jobId(seed: number): CounterId<"job"> {
  const result = createCounterId("job", new Uint8Array(16).fill(seed));
  if (!result.ok) {
    throw new Error("bad job id");
  }
  return result.value;
}

const capturingProvider: PaymentAuthorizationPort = {
  authorizeAndCapture: (request): Promise<PaymentAuthorizationResult> =>
    Promise.resolve({
      status: "captured",
      capturedMinor: request.amountMinor,
      providerReference: `pay_${randomUUID()}`,
    }),
};

const noopSink: ReceiptSink = { record: (): Promise<void> => Promise.resolve() };

dbDescribe("worker integration (DB-gated)", () => {
  const database = new PostgresDatabase(testDatabaseUrl ?? "");
  const repo = new PostgresJobRepository(database);
  const createdJobIds: CounterId<"job">[] = [];

  afterAll(async () => {
    for (const id of createdJobIds) {
      await database.query("DELETE FROM runtime.job_attempts WHERE job_id = $1", [id]);
      await database.query("DELETE FROM runtime.jobs WHERE id = $1", [id]);
    }
    await database.close();
  }, hookTimeout);

  it(
    "enqueues a lifecycle job and completes it in one tick",
    async () => {
      const migrations = await loadMigrations(migrationsDirectory);
      await new MigrationRunner(database, migrations).up();

      const id = jobId(Math.floor(Math.random() * 200) + 40);
      createdJobIds.push(id);
      const now = instant(Date.now());

      const enqueued = await repo.enqueue(
        {
          id,
          type: TRANSACTION_LIFECYCLE_JOB_TYPE,
          payload: { transactionId: `order-${randomUUID()}`, amountMinor: 4999, currency: "INR" },
          correlationId: undefined,
          availableAt: now,
          maxAttempts: 3,
        },
        now,
      );
      expect(enqueued.ok).toBe(true);

      const config: TickConfig = {
        jobTypes: [TRANSACTION_LIFECYCLE_JOB_TYPE],
        leaseOwner: `it-${randomUUID()}`,
        leaseDurationMs: 30_000,
        batchSize: 10,
        baseRetryDelayMs: 1_000,
        handlers: new Map<string, JobHandler>([
          [
            TRANSACTION_LIFECYCLE_JOB_TYPE,
            createTransactionLifecycleHandler(capturingProvider, noopSink),
          ],
        ]),
      };

      const result = await runTick(repo, config);
      expect(result.completed).toBe(1);

      const jobRow = await database.query<{ status: string }>(
        "SELECT status FROM runtime.jobs WHERE id = $1",
        [id],
      );
      expect(jobRow.rows[0]?.status).toBe("completed");

      const attemptRow = await database.query<{ status: string }>(
        "SELECT status FROM runtime.job_attempts WHERE job_id = $1 ORDER BY attempt_number DESC LIMIT 1",
        [id],
      );
      expect(attemptRow.rows[0]?.status).toBe("succeeded");
    },
    hookTimeout,
  );
});
