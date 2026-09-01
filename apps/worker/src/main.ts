/**
 * Deployment entry point for the worker.
 *
 * Constructs a PostgresDatabase from DATABASE_URL, builds a
 * PostgresJobRepository, wires the transaction-lifecycle handler, and runs the
 * durable poll/lease/execute loop with graceful SIGTERM/SIGINT shutdown.
 *
 * Provider selection: at boot the worker resolves Shopify + Razorpay
 * credentials via the shared credential-gating helper and selects the
 * PaymentAuthorizationPort. When BOTH credential sets are present it wires the
 * REAL connector-backed port (real Shopify connector + real Razorpay provider +
 * a CTP-signed CounterTestPaymentProvider for the unattended authorize/capture);
 * otherwise it falls back to the deterministic in-process stand-in in
 * local/test, and fails loud in prod-like environments when credentials are
 * missing. See boot.ts and real-lifecycle.ts.
 *
 * SECURITY: credentials are read from process.env only and are never logged.
 * Only the selected connector MODE (real vs deterministic) is logged.
 */

import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import {
  createCounterId,
  resolveCounterEnvironment,
  type CounterId,
  type Environment,
  type Instant,
} from "@counter/domain";
import {
  PostgresDatabase,
  PostgresJobRepository,
  PostgresOutboxRepository,
  PostgresStepLedger,
  PostgresKillSwitchStore,
  PostgresSpendLedger,
  PostgresPolicyStore,
  PostgresRecurringMandateReadStore,
  PostgresPaymentConnectionReadStore,
  PostgresRevocationStore,
} from "@counter/data";
import { APP_NAME } from "./index.js";
import { PostgresTransactionProjectionStore } from "./transaction-persistence.js";
import { createWorkerLoop, type LoopConfig, type TickLogger } from "./worker-loop.js";
import {
  selectPaymentAuthorizationPort,
  pilotMerchantId,
  resolveSpendLimitConfig,
} from "./boot.js";
import { isProdLike } from "./connector-env.js";
import {
  reconciliationEnabled,
  startReconciliationJob,
  type ReconciliationJobHandle,
} from "./reconciliation-job.js";
import { buildReconciliationScannerConfig } from "./reconciliation-boot.js";
import {
  createTransactionLifecycleHandler,
  TRANSACTION_LIFECYCLE_JOB_TYPE,
  type JobHandler,
  type PaymentAuthorizationPort,
  type ReceiptSink,
  type TransactionReceipt,
  type TransactionProjectionStore,
} from "./transaction-lifecycle.js";

const LEASE_DURATION_MS = 30_000;
const POLL_INTERVAL_MS = 1_000;
const BATCH_SIZE = 10;
const BASE_RETRY_DELAY_MS = 1_000;
const RECONCILIATION_INTERVAL_MS = 60_000;

const logger: TickLogger = {
  info(message, context): void {
    console.log(`[${APP_NAME}] ${message}`, context ?? {});
  },
  error(message, context): void {
    console.error(`[${APP_NAME}] ${message}`, context ?? {});
  },
};

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
              // The RAW opaque transaction reference (payload.transactionId).
              // The out-of-band reconciliation scanner joins on THIS key because
              // the durable step ledger is keyed on it (not on the derived
              // `transactionId` CounterId). Never a secret.
              idempotencyKey: receipt.idempotencyKey,
              phase: receipt.finalState.phase,
              payment: receipt.finalState.payment,
              order: receipt.finalState.order,
              providerReference: receipt.providerReference,
              reconciliation: receipt.reconciliation,
            },
            correlationId: undefined,
            idempotencyKey: receipt.idempotencyKey,
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

function buildHandlers(
  provider: PaymentAuthorizationPort,
  sink: ReceiptSink,
  projectionStore: TransactionProjectionStore | undefined,
): ReadonlyMap<string, JobHandler> {
  return new Map<string, JobHandler>([
    [
      TRANSACTION_LIFECYCLE_JOB_TYPE,
      createTransactionLifecycleHandler(provider, sink, projectionStore),
    ],
  ]);
}

async function main(): Promise<void> {
  const databaseUrl = process.env["DATABASE_URL"];
  if (databaseUrl === undefined || databaseUrl.trim().length === 0) {
    console.error(`[${APP_NAME}] DATABASE_URL is required`);
    process.exit(1);
    return;
  }

  // The durable-data partition (bound into every runtime.* query below) is
  // resolved from COUNTER_ENV alone — NODE_ENV's vocabulary ("development")
  // is not a valid Counter environment. A production-like deployment with an
  // absent/invalid COUNTER_ENV fails loud rather than silently writing to the
  // wrong (or a guessed) partition.
  const runtimeEnvironmentResult = resolveCounterEnvironment(
    process.env["COUNTER_ENV"],
    isProdLike(process.env),
  );
  if (!runtimeEnvironmentResult.ok) {
    console.error(`[${APP_NAME}] ${runtimeEnvironmentResult.error.message}`);
    process.exit(1);
    return;
  }
  const runtimeEnvironment: Environment = runtimeEnvironmentResult.value;

  const database = new PostgresDatabase(databaseUrl);
  const jobRepository = new PostgresJobRepository(database, runtimeEnvironment);
  const outboxRepository = new PostgresOutboxRepository(database, runtimeEnvironment);
  const sink = createOutboxReceiptSink(outboxRepository);

  // Resolve the operating merchant's spend-limit ceilings before constructing
  // the durable ledger: an optional per-merchant override read from the
  // merchant's policy config (settable via the console's policy API without a
  // code deploy — only a worker restart, since this is read once at boot),
  // falling back to the platform default when absent or malformed. A policy
  // lookup failure also falls back to the default rather than blocking boot,
  // since the default is a known-safe ceiling, not "no limit".
  const policyStore = new PostgresPolicyStore(database, runtimeEnvironment);
  const policyEntryResult = await policyStore.get(pilotMerchantId());
  if (!policyEntryResult.ok) {
    logger.error("failed to load merchant policy config; using default spend limits", {
      error: policyEntryResult.error.message,
    });
  }
  const spendLimitConfig = resolveSpendLimitConfig(
    policyEntryResult.ok ? policyEntryResult.value : undefined,
  );

  // Select the payment connector from the environment. In a prod-like
  // environment with missing credentials this throws (fail loud) before the
  // loop starts. The durable Postgres-backed step ledger and kill-switch store
  // are threaded in so the Shopify legs dedup across restarts and an active
  // kill switch blocks a checkout BEFORE any external effect.
  const selection = await selectPaymentAuthorizationPort(process.env, undefined, {
    stepLedger: new PostgresStepLedger(database, runtimeEnvironment),
    killSwitchStore: new PostgresKillSwitchStore(database, runtimeEnvironment),
    spendLedger: new PostgresSpendLedger(database, runtimeEnvironment, spendLimitConfig),
    recurringMandateStore: new PostgresRecurringMandateReadStore(database, runtimeEnvironment),
    paymentConnectionStore: new PostgresPaymentConnectionReadStore(database, runtimeEnvironment),
    revocationStore: new PostgresRevocationStore(database, runtimeEnvironment),
  });
  logger.info("payment connector selected", {
    mode: selection.mode,
    environment: runtimeEnvironment,
  });

  // Only the real connector bundle has a configured merchant scope. Persist its
  // transaction spine before effects so the control plane can project it. Local
  // deterministic runs remain dependency-free unless a test injects a store.
  const projectionStore =
    selection.bundle === undefined
      ? undefined
      : new PostgresTransactionProjectionStore(
          database,
          runtimeEnvironment,
          selection.bundle.merchantId,
        );

  const config: LoopConfig = {
    jobTypes: [TRANSACTION_LIFECYCLE_JOB_TYPE],
    leaseOwner: `${hostname()}-${randomUUID()}`,
    leaseDurationMs: LEASE_DURATION_MS,
    batchSize: BATCH_SIZE,
    baseRetryDelayMs: BASE_RETRY_DELAY_MS,
    pollIntervalMs: POLL_INTERVAL_MS,
    handlers: buildHandlers(selection.port, sink, projectionStore),
  };

  const loop = createWorkerLoop(jobRepository, config, logger);

  // Periodic reconciliation: env-guarded and only when the REAL connector is
  // active (a real Shopify connector is required to query authoritative order
  // state). Inert in unit/local runs and when RECONCILIATION_ENABLED is unset.
  let reconciliation: ReconciliationJobHandle | undefined;
  if (
    reconciliationEnabled(process.env) &&
    selection.mode === "real" &&
    selection.bundle !== undefined
  ) {
    const scannerConfig = buildReconciliationScannerConfig({
      database,
      outbox: outboxRepository,
      shopify: selection.bundle.shopify,
    });
    reconciliation = startReconciliationJob(scannerConfig, RECONCILIATION_INTERVAL_MS, logger);
    logger.info("reconciliation job started", { intervalMs: RECONCILIATION_INTERVAL_MS });
  }

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info("shutting down", { signal });
    loop.stop();
    void loop.done
      .then(() => (reconciliation !== undefined ? reconciliation.stop() : undefined))
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

main().catch((error: unknown) => {
  console.error(
    `[${APP_NAME}] fatal startup error`,
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
