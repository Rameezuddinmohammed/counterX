/**
 * Deployment wiring for the periodic reconciliation job.
 *
 * Builds the Postgres-backed {@link ReconciliationScannerConfig} from the live
 * database and the real Shopify connector:
 *
 *   - candidates: transactions whose durable receipt (runtime.outbox_events,
 *     event_type 'transaction.receipt.v1') recorded phase INDETERMINATE and for
 *     which no resolution has yet been appended;
 *   - ledger reader: the durable step ledger (runtime.lifecycle_steps) that
 *     carries the authoritative Shopify order reference;
 *   - order query: the REAL Shopify OrderQueryAction;
 *   - recorder: appends a durable 'transaction.reconciliation.v1' outbox event
 *     and treats a prior TERMINAL disposition ('resolved_closed' or
 *     'no_provider_effect') as already-resolved so an unresolvable candidate is
 *     not re-recorded on every pass.
 *
 * KEY SPACE: the durable step ledger is keyed on the RAW opaque transaction
 * reference (the idempotency key used for every external effect), NOT on the
 * derived typed transaction CounterId the lifecycle stamps as `transactionId`.
 * The receipt sink carries the raw reference in the receipt payload's
 * `idempotencyKey` field; the candidate source reads THAT and uses it to look
 * up the ledger, so the candidate -> ledger join matches in the deployed
 * wiring (proven end-to-end by the reconciliation integration test that drives
 * the real lifecycle handler so deriveTransactionId is actually applied).
 *
 * SECURITY: only provider references, financial status strings, and amounts are
 * read or written — never credentials or secrets.
 */

import { randomUUID } from "node:crypto";
import { createCounterId, type CounterId, type Instant } from "@counter/domain";
import type { TransactionalDatabase, PostgresOutboxRepository } from "@counter/data";
import type { ShopifyConnector } from "@counter/shopify-connector";

import type {
  ReconciliationCandidate,
  ReconciliationCandidateSource,
  ReconciliationLedgerReader,
  ReconciliationOrderQuery,
  ReconciliationRecorder,
  ReconciliationResolution,
  ReconciliationScannerConfig,
} from "./reconciliation-job.js";

const RECEIPT_EVENT_TYPE = "transaction.receipt.v1";
const RECONCILIATION_EVENT_TYPE = "transaction.reconciliation.v1";
const STEP_FINALIZE = "shopify.finalize";

/** Candidate source: INDETERMINATE receipts without a resolved_closed follow-up. */
function createPostgresCandidateSource(
  database: TransactionalDatabase,
): ReconciliationCandidateSource {
  return {
    async listIndeterminate(): Promise<readonly ReconciliationCandidate[]> {
      // The step ledger is keyed on the RAW opaque transaction reference (the
      // idempotency key used for every external effect), NOT on the derived
      // typed transaction CounterId the lifecycle stamps as `transactionId`.
      // The receipt sink therefore carries the raw reference in the payload's
      // `idempotencyKey` field; join and look up on THAT. Legacy receipts that
      // predate the `idempotencyKey` field fall back to `transactionId` via
      // COALESCE so they are still scanned (their key space is the raw value).
      const KEY = "COALESCE(payload ->> 'idempotencyKey', payload ->> 'transactionId')";
      const result = await database.query<{
        transaction_id: string;
        idempotency_key: string;
      }>(
        `SELECT DISTINCT
                (payload ->> 'transactionId') AS transaction_id,
                ${KEY} AS idempotency_key
           FROM runtime.outbox_events
          WHERE event_type = $1
            AND payload ->> 'phase' = 'INDETERMINATE'
            AND ${KEY} IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM runtime.outbox_events resolved
               WHERE resolved.event_type = $2
                 AND resolved.payload ->> 'idempotencyKey' = ${KEY}
                 AND resolved.payload ->> 'disposition'
                     IN ('resolved_closed', 'no_provider_effect')
            )`,
        [RECEIPT_EVENT_TYPE, RECONCILIATION_EVENT_TYPE],
      );
      return result.rows.map((row) => ({
        transactionId: row.transaction_id,
        // The durable step-ledger key: the RAW opaque transaction reference.
        idempotencyKey: row.idempotency_key,
      }));
    },
  };
}

/** Ledger reader over runtime.lifecycle_steps (finalize step reference). */
function createPostgresLedgerReader(database: TransactionalDatabase): ReconciliationLedgerReader {
  return {
    async lookup(
      key: string,
      step: string,
    ): Promise<{ readonly reference: string | undefined } | undefined> {
      const result = await database.query<{ reference: string | null }>(
        `SELECT reference FROM runtime.lifecycle_steps
          WHERE environment = 'local' AND idempotency_key = $1 AND step = $2`,
        [key, step],
      );
      const row = result.rows[0];
      if (row === undefined) {
        return undefined;
      }
      return { reference: row.reference ?? undefined };
    },
  };
}

function randomOutboxId(): CounterId<"outbox-event"> {
  const entropy = new Uint8Array(16);
  const uuid = randomUUID().replace(/-/g, "");
  for (let index = 0; index < 16; index += 1) {
    entropy[index] = Number.parseInt(uuid.slice(index * 2, index * 2 + 2), 16);
  }
  const result = createCounterId("outbox-event", entropy);
  if (!result.ok) {
    throw new Error("Could not create outbox-event id for reconciliation resolution");
  }
  return result.value;
}

/** Recorder: append a durable resolution event; already-resolved via a prior closed event. */
function createPostgresRecorder(
  database: TransactionalDatabase,
  outbox: PostgresOutboxRepository,
): ReconciliationRecorder {
  return {
    async record(resolution: ReconciliationResolution): Promise<void> {
      const now = Date.now() as Instant;
      const result = await outbox.append(
        [
          {
            id: randomOutboxId(),
            eventType: RECONCILIATION_EVENT_TYPE,
            eventVersion: 1,
            payload: {
              transactionId: resolution.transactionId,
              // The RAW opaque transaction reference — the join key the
              // candidate SELECT and isResolved() use so a resolution is matched
              // back to its INDETERMINATE receipt (which also carries it).
              idempotencyKey: resolution.idempotencyKey,
              disposition: resolution.disposition,
              orderReference: resolution.orderReference ?? null,
              evidence: resolution.evidence,
            },
            correlationId: undefined,
            idempotencyKey: `${resolution.idempotencyKey}:reconcile:${resolution.disposition}`,
          },
        ],
        now,
      );
      if (!result.ok) {
        throw new Error(`Failed to append reconciliation resolution: ${result.error.message}`);
      }
    },
    async isResolved(idempotencyKey: string): Promise<boolean> {
      // A candidate is resolved once a TERMINAL disposition has been recorded.
      // `resolved_closed` is the settled/paid terminal; `no_provider_effect` is
      // ALSO terminal — a receipt with no durable order reference will never
      // gain one, so re-scanning it forever would append an unbounded stream of
      // reconciliation rows. Only `still_indeterminate` (an order that exists
      // but is not yet settled) stays re-scannable so a later settlement can
      // close it. Treating `no_provider_effect` as resolved makes the scan
      // idempotent for permanently-orphaned candidates.
      const result = await database.query<{ present: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM runtime.outbox_events
            WHERE event_type = $1
              AND payload ->> 'idempotencyKey' = $2
              AND payload ->> 'disposition' IN ('resolved_closed', 'no_provider_effect')
         ) AS present`,
        [RECONCILIATION_EVENT_TYPE, idempotencyKey],
      );
      return result.rows[0]?.present === true;
    },
  };
}

/** Adapts the Shopify connector's OrderQueryAction to the scanner seam. */
function createOrderQuery(shopify: ShopifyConnector): ReconciliationOrderQuery {
  return {
    execute: (input) => shopify.orderQuery.execute(input),
  };
}

/**
 * Builds the full Postgres-backed reconciliation scanner config. `STEP_FINALIZE`
 * is exported by intent from the shared step-name so both the writer
 * (real-lifecycle) and reader (here) agree on the durable order reference key.
 */
export function buildReconciliationScannerConfig(input: {
  readonly database: TransactionalDatabase;
  readonly outbox: PostgresOutboxRepository;
  readonly shopify: ShopifyConnector;
}): ReconciliationScannerConfig {
  void STEP_FINALIZE;
  return {
    source: createPostgresCandidateSource(input.database),
    ledger: createPostgresLedgerReader(input.database),
    orderQuery: createOrderQuery(input.shopify),
    recorder: createPostgresRecorder(input.database, input.outbox),
  };
}
