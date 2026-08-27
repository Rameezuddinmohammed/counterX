/**
 * apps/worker
 *
 * Outbox/job worker process: leases PostgreSQL jobs (FOR UPDATE SKIP LOCKED),
 * dispatches each to a typed handler that drives the durable transaction
 * lifecycle (intent -> execute -> provider evidence -> reconciliation ->
 * receipt), and records outcomes with retry/dead-letter semantics.
 *
 * This module is the testable surface: the tick function and loop factory are
 * unit-testable with an injected AsyncJobRepository. `main.ts` is the thin
 * deployment entrypoint.
 */

export const APP_NAME = "@counter/worker";

export {
  runTick,
  createWorkerLoop,
  type TickConfig,
  type TickResult,
  type TickLogger,
  type LoopConfig,
  type WorkerLoop,
} from "./worker-loop.js";

export {
  createTransactionLifecycleHandler,
  HandlerError,
  TRANSACTION_LIFECYCLE_JOB_TYPE,
  type JobHandler,
  type HandledJob,
  type PaymentAuthorizationPort,
  type PaymentAuthorizationRequest,
  type PaymentAuthorizationResult,
  type TransactionLifecyclePayload,
  type ReconciliationOutcome,
  type TransactionReceipt,
  type ReceiptSink,
} from "./transaction-lifecycle.js";

export {
  createRealPaymentAuthorizationPort,
  type RealLifecycleConfig,
  type LifecyclePolicyPort,
  type VariantResolverPort,
} from "./real-lifecycle.js";

export {
  selectPaymentAuthorizationPort,
  createDeterministicPaymentAuthorizationPort,
  type ConnectorMode,
  type SelectedPaymentPort,
} from "./boot.js";

export {
  resolveShopifyCredentials,
  resolveRazorpayCredentials,
  requireShopifyCredentials,
  requireRazorpayCredentials,
  isProdLike,
  type ShopifyCredentials,
  type RazorpayCredentials,
  type EnvironmentBag,
} from "./connector-env.js";
