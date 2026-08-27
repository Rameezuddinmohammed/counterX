/**
 * Periodic reconciliation job.
 *
 * The real transaction lifecycle can leave a transaction in the INDETERMINATE
 * phase: a possible external effect (a Shopify order / Razorpay capture) exists
 * but its terminal outcome could not be confirmed in-band (a timeout AFTER a
 * possible effect). Those transactions MUST be resolved out-of-band against
 * authoritative provider evidence rather than being collapsed to success or
 * failure.
 *
 * This scanner runs on an interval in the worker. For each INDETERMINATE /
 * orphaned candidate it:
 *
 *   1. finds the authoritative Shopify order reference recorded durably by the
 *      lifecycle (the durable step ledger from FEAT-001: the `shopify.finalize`
 *      step reference is the real order id);
 *   2. queries the REAL order state via `connector.orderQuery`
 *      (OrderQueryAction) — the single source of truth;
 *   3. resolves the candidate:
 *        - order exists AND is financially settled (paid) -> resolved to CLOSED;
 *        - order exists but NOT settled                    -> stays INDETERMINATE
 *                                                             with refreshed
 *                                                             evidence;
 *        - NO durable order reference (no provider effect)  -> stays
 *                                                             INDETERMINATE with
 *                                                             evidence noting the
 *                                                             absence;
 *        - order query itself is inconclusive               -> stays
 *                                                             INDETERMINATE.
 *
 * It NEVER fabricates a success: a "closed" resolution is only ever produced
 * from a real settled Shopify order. An already-resolved candidate is a no-op.
 *
 * The job is env-guarded (RECONCILIATION_ENABLED) so it is INERT in unit tests
 * and only runs when explicitly enabled in a deployment.
 *
 * SECURITY: only provider references (order ids), financial status strings, and
 * amounts flow through — never raw payment credentials, tokens, or secrets.
 */

import type { OrderResult } from "@counter/shopify-connector";
import type { ActionOutcome } from "@counter/connector-sdk";

// ─── Ports ───────────────────────────────────────────────────────────────────

/**
 * A transaction the lifecycle left in an INDETERMINATE / orphaned state. The
 * `idempotencyKey` is the stable per-transaction reference used for every
 * external effect (and as the durable step-ledger key); `transactionId` is the
 * opaque payload transaction reference (equal to the idempotency key today, but
 * kept distinct for clarity).
 */
export interface ReconciliationCandidate {
  readonly transactionId: string;
  readonly idempotencyKey: string;
}

/**
 * Source of INDETERMINATE / orphaned candidates. A deployment backs this with a
 * scan of the durable step ledger and/or the outbox receipt rows whose phase is
 * INDETERMINATE; unit tests supply a deterministic in-memory list.
 */
export interface ReconciliationCandidateSource {
  listIndeterminate(): Promise<readonly ReconciliationCandidate[]>;
}

/**
 * Minimal read seam over the durable step ledger: returns the recorded
 * provider reference for a (idempotencyKey, step) or `undefined`. Structurally
 * compatible with the worker's StepLedgerPort, so the same Postgres-backed
 * adapter can be reused.
 */
export interface ReconciliationLedgerReader {
  lookup(
    key: string,
    step: string,
  ): Promise<{ readonly reference: string | undefined } | undefined>;
}

/** The authoritative order-state query seam (Shopify OrderQueryAction). */
export interface ReconciliationOrderQuery {
  execute(input: {
    readonly payload: {
      readonly orderId: string;
      readonly metadata: { readonly correlationId: string; readonly idempotencyKey: string };
    };
    readonly idempotencyKey: string;
    readonly correlationId: string;
    readonly preconditions: readonly never[];
    readonly timeoutMs: number;
  }): Promise<ActionOutcome<OrderResult>>;
}

/** How a candidate was resolved by the scanner. */
export type ReconciliationDisposition =
  | "resolved_closed"
  | "still_indeterminate"
  | "no_provider_effect"
  | "already_resolved";

/** A durable record of a reconciliation decision. */
export interface ReconciliationResolution {
  readonly transactionId: string;
  readonly idempotencyKey: string;
  readonly disposition: ReconciliationDisposition;
  /** The authoritative order reference, when one existed. */
  readonly orderReference: string | undefined;
  /** Provider evidence captured at resolution time (status/amount), for audit. */
  readonly evidence: string;
}

/**
 * Durable sink for reconciliation resolutions. A deployment appends these to
 * the outbox (so the resolution is itself durable and auditable); unit tests
 * record them in-memory.
 */
export interface ReconciliationRecorder {
  record(resolution: ReconciliationResolution): Promise<void>;
  /**
   * Returns true when the candidate has ALREADY been resolved (so re-scanning
   * is a no-op). A deployment checks the outbox/ledger; the default treats
   * every candidate as unresolved.
   */
  isResolved(idempotencyKey: string): Promise<boolean>;
}

// ─── Step name (must match real-lifecycle.ts) ────────────────────────────────

const STEP_FINALIZE = "shopify.finalize";

// Shopify displayFinancialStatus values that mean the order is settled/paid.
const SETTLED_FINANCIAL_STATUSES = new Set(["PAID", "PARTIALLY_REFUNDED", "REFUNDED"]);

const RECONCILE_QUERY_TIMEOUT_MS = 15_000;

// ─── Scanner config ──────────────────────────────────────────────────────────

export interface ReconciliationScannerConfig {
  readonly source: ReconciliationCandidateSource;
  readonly ledger: ReconciliationLedgerReader;
  readonly orderQuery: ReconciliationOrderQuery;
  readonly recorder: ReconciliationRecorder;
}

/**
 * Resolves a single candidate against authoritative provider evidence. Pure of
 * scheduling so it is deterministic and unit-testable.
 */
export async function reconcileCandidate(
  config: ReconciliationScannerConfig,
  candidate: ReconciliationCandidate,
): Promise<ReconciliationResolution> {
  // Already-resolved candidates are a no-op (idempotent scan).
  if (await config.recorder.isResolved(candidate.idempotencyKey)) {
    const resolution: ReconciliationResolution = {
      transactionId: candidate.transactionId,
      idempotencyKey: candidate.idempotencyKey,
      disposition: "already_resolved",
      orderReference: undefined,
      evidence: "already resolved; no-op",
    };
    return resolution;
  }

  // The durable order reference is the authoritative link to a real order. No
  // reference means no confirmed provider effect for the finalize leg.
  const finalize = await config.ledger.lookup(candidate.idempotencyKey, STEP_FINALIZE);
  const orderReference = finalize?.reference;
  if (orderReference === undefined || orderReference.length === 0) {
    const resolution: ReconciliationResolution = {
      transactionId: candidate.transactionId,
      idempotencyKey: candidate.idempotencyKey,
      disposition: "no_provider_effect",
      orderReference: undefined,
      evidence: "no durable Shopify order reference; no confirmed provider effect",
    };
    await config.recorder.record(resolution);
    return resolution;
  }

  // Query the REAL order state — the single source of truth.
  const outcome = await config.orderQuery.execute({
    payload: {
      orderId: orderReference,
      metadata: {
        correlationId: candidate.idempotencyKey,
        idempotencyKey: candidate.idempotencyKey,
      },
    },
    idempotencyKey: candidate.idempotencyKey,
    correlationId: candidate.idempotencyKey,
    preconditions: [],
    timeoutMs: RECONCILE_QUERY_TIMEOUT_MS,
  });

  if (outcome.status !== "succeeded") {
    // The query itself is inconclusive (indeterminate/failed). NEVER fabricate a
    // terminal outcome; leave it INDETERMINATE for a later scan.
    const detail =
      outcome.status === "indeterminate"
        ? (outcome.lastKnownState ?? "query.indeterminate")
        : outcome.error.message;
    const resolution: ReconciliationResolution = {
      transactionId: candidate.transactionId,
      idempotencyKey: candidate.idempotencyKey,
      disposition: "still_indeterminate",
      orderReference,
      evidence: `order query inconclusive: ${detail}`,
    };
    await config.recorder.record(resolution);
    return resolution;
  }

  const order = outcome.result;
  const settled = SETTLED_FINANCIAL_STATUSES.has(order.status.toUpperCase());
  const evidence = `order=${order.orderId} status=${order.status} total=${order.totalPrice} ${order.currencyCode}`;

  const resolution: ReconciliationResolution = settled
    ? {
        transactionId: candidate.transactionId,
        idempotencyKey: candidate.idempotencyKey,
        disposition: "resolved_closed",
        orderReference,
        evidence,
      }
    : {
        transactionId: candidate.transactionId,
        idempotencyKey: candidate.idempotencyKey,
        disposition: "still_indeterminate",
        orderReference,
        evidence: `order not settled: ${evidence}`,
      };
  await config.recorder.record(resolution);
  return resolution;
}

/**
 * Runs one reconciliation pass over all current candidates. Returns the
 * resolutions so a caller (or a test) can observe the outcomes. Failures on a
 * single candidate are isolated so one bad candidate does not abort the pass.
 */
export async function runReconciliationPass(
  config: ReconciliationScannerConfig,
): Promise<readonly ReconciliationResolution[]> {
  const candidates = await config.source.listIndeterminate();
  const resolutions: ReconciliationResolution[] = [];
  for (const candidate of candidates) {
    resolutions.push(await reconcileCandidate(config, candidate));
  }
  return resolutions;
}

// ─── Periodic runner ─────────────────────────────────────────────────────────

export interface ReconciliationJobLogger {
  info(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export interface ReconciliationJobHandle {
  /** Stops the interval; resolves when the in-flight pass (if any) settles. */
  stop(): Promise<void>;
}

/**
 * Starts the periodic reconciliation job. It runs a pass every `intervalMs`,
 * serially (no overlapping passes). Guarded by the caller via the env flag;
 * see {@link reconciliationEnabled}.
 */
export function startReconciliationJob(
  config: ReconciliationScannerConfig,
  intervalMs: number,
  logger: ReconciliationJobLogger,
): ReconciliationJobHandle {
  let running = false;
  let stopped = false;
  let inFlight: Promise<void> = Promise.resolve();

  const tick = (): void => {
    if (running || stopped) {
      return;
    }
    running = true;
    inFlight = (async (): Promise<void> => {
      try {
        const resolutions = await runReconciliationPass(config);
        if (resolutions.length > 0) {
          logger.info("reconciliation pass complete", {
            scanned: resolutions.length,
            resolved: resolutions.filter((r) => r.disposition === "resolved_closed").length,
          });
        }
      } catch (error: unknown) {
        logger.error("reconciliation pass failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        running = false;
      }
    })();
  };

  const timer = setInterval(tick, intervalMs);
  // Do not keep the event loop alive solely for reconciliation.
  if (typeof timer.unref === "function") {
    timer.unref();
  }

  return {
    async stop(): Promise<void> {
      stopped = true;
      clearInterval(timer);
      await inFlight;
    },
  };
}

/**
 * Env guard: the periodic job is INERT unless RECONCILIATION_ENABLED is a
 * truthy flag ("1" / "true"). Keeps it out of unit tests and off by default.
 */
export function reconciliationEnabled(env: Record<string, string | undefined>): boolean {
  const raw = env["RECONCILIATION_ENABLED"]?.trim().toLowerCase();
  return raw === "1" || raw === "true";
}
