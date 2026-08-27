/**
 * Deployment entry point for the worker.
 *
 * Constructs a PostgresDatabase from DATABASE_URL, builds a
 * PostgresJobRepository, wires the real transaction-lifecycle handler, and runs
 * the durable poll/lease/execute loop with graceful SIGTERM/SIGINT shutdown.
 *
 * Provider selection: by default the handler uses a deterministic in-process
 * payment authorization (representing the connector mock client). A real HTTP
 * provider can be wired here behind env config; see findings.
 */

import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { createCounterId, type CounterId, type Instant } from "@counter/domain";
import { PostgresDatabase, PostgresJobRepository, PostgresOutboxRepository } from "@counter/data";
import { APP_NAME } from "./index.js";
import { createWorkerLoop, type LoopConfig, type TickLogger } from "./worker-loop.js";
import {
  createTransactionLifecycleHandler,
  TRANSACTION_LIFECYCLE_JOB_TYPE,
  type JobHandler,
  type PaymentAuthorizationPort,
  type PaymentAuthorizationResult,
  type ReceiptSink,
  type TransactionReceipt,
} from "./transaction-lifecycle.js";

const LEASE_DURATION_MS = 30_000;
const POLL_INTERVAL_MS = 1_000;
const BATCH_SIZE = 10;
const BASE_RETRY_DELAY_MS = 1_000;

const logger: TickLogger = {
  info(message, context): void {
    console.log(`[${APP_NAME}] ${message}`, context ?? {});
  },
  error(message, context): void {
    console.error(`[${APP_NAME}] ${message}`, context ?? {});
  },
};

/**
 * Default payment provider: a deterministic, in-process implementation standing
 * in for the connector mock client. Captures exactly the intended amount so the
 * lifecycle reconciles and closes. Replace with the real HTTP client
 * (@counter/razorpay-adapter RazorpayTestProvider / @counter/shopify-connector
 * order actions) behind env config for live provider calls.
 */
function createDefaultPaymentProvider(): PaymentAuthorizationPort {
  return {
    authorizeAndCapture: (request): Promise<PaymentAuthorizationResult> =>
      Promise.resolve({
        status: "captured",
        capturedMinor: request.amountMinor,
        providerReference: `mock_${randomUUID()}`,
      }),
  };
}

/** Generates a random 16-byte-entropy CounterId for a given kind. */
function randomCounterId<Kind extends Parameters<typeof createCounterId>[0]>(
  kind: Kind,
): CounterId<Kind> {
  const entropy = new Uint8Array(16);
  const uuid = randomUUID().replace(/-/g, "");
  for (let index = 0; index < 16; index += 1) {
    entropy[index] = Number.parseInt(uuid.slice(index * 2, index * 2 + 2), 16);
  }
  const result = createCounterId(kind, entropy);
  if (!result.ok) {
    throw new Error(`Could not create ${String(kind)} id`);
  }
  return result.value;
}

/** Receipt sink that appends a durable evidence event to the outbox. */
function createOutboxReceiptSink(outbox: PostgresOutboxRepository): ReceiptSink {
  return {
    async record(receipt: TransactionReceipt): Promise<void> {
      const eventId = randomCounterId("outbox-event");
      const now = Date.now() as Instant;
      const result = await outbox.append(
        [
          {
            id: eventId,
            eventType: "transaction.receipt.v1",
            eventVersion: 1,
            payload: {
              transactionId: receipt.transactionId,
              phase: receipt.finalState.phase,
              payment: receipt.finalState.payment,
              order: receipt.finalState.order,
              providerReference: receipt.providerReference,
              reconciliation: receipt.reconciliation,
            },
            correlationId: undefined,
            idempotencyKey: receipt.transactionId,
          },
        ],
        now,
      );
      if (!result.ok) {
        logger.error("failed to append receipt to outbox", { error: result.error.message });
      }
    },
  };
}

function buildHandlers(sink: ReceiptSink): ReadonlyMap<string, JobHandler> {
  const provider = createDefaultPaymentProvider();
  return new Map<string, JobHandler>([
    [TRANSACTION_LIFECYCLE_JOB_TYPE, createTransactionLifecycleHandler(provider, sink)],
  ]);
}

function main(): void {
  const databaseUrl = process.env["DATABASE_URL"];
  if (databaseUrl === undefined || databaseUrl.trim().length === 0) {
    console.error(`[${APP_NAME}] DATABASE_URL is required`);
    process.exit(1);
    return;
  }

  const database = new PostgresDatabase(databaseUrl);
  const jobRepository = new PostgresJobRepository(database);
  const outboxRepository = new PostgresOutboxRepository(database);
  const sink = createOutboxReceiptSink(outboxRepository);

  const config: LoopConfig = {
    jobTypes: [TRANSACTION_LIFECYCLE_JOB_TYPE],
    leaseOwner: `${hostname()}-${randomUUID()}`,
    leaseDurationMs: LEASE_DURATION_MS,
    batchSize: BATCH_SIZE,
    baseRetryDelayMs: BASE_RETRY_DELAY_MS,
    pollIntervalMs: POLL_INTERVAL_MS,
    handlers: buildHandlers(sink),
  };

  const loop = createWorkerLoop(jobRepository, config, logger);

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info("shutting down", { signal });
    loop.stop();
    void loop.done
      .then(() => database.close())
      .then(() => {
        process.exit(0);
      })
      .catch((error: unknown) => {
        logger.error("shutdown error", {
          error: error instanceof Error ? error.message : String(error),
        });
        process.exit(1);
      });
  };

  process.on("SIGTERM", () => {
    shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    shutdown("SIGINT");
  });

  logger.info("started", { leaseOwner: config.leaseOwner });
}

main();
