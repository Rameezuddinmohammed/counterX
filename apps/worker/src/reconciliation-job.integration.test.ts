/**
 * Creds+DB-gated integration test: the periodic reconciliation scanner resolves
 * a REAL INDETERMINATE transaction against authoritative Shopify evidence,
 * driven END-TO-END through the REAL transaction-lifecycle handler so the
 * derived transaction CounterId is actually applied.
 *
 * This is the regression proof for the key-mismatch defect (review issue 1):
 * the lifecycle stamps the receipt's `transactionId` as deriveTransactionId(
 * payload.transactionId) — a hashed CounterId — while the step ledger is keyed
 * on the RAW payload.transactionId. If the candidate source joined on the
 * derived id (as it did before the fix), reconciliation could NEVER find the
 * order and would degrade to `no_provider_effect`. Here we drive the REAL
 * handler (so deriveTransactionId runs) with a provider that returns
 * INDETERMINATE after a REAL Shopify draft+finalize, persist the receipt via a
 * sink identical to the deployed outbox sink, then run the REAL Postgres-backed
 * scanner and assert it resolves the candidate to `resolved_closed` by joining
 * on the RAW idempotency key carried in the receipt payload.
 *
 * SKIPPED unless SHOPIFY_ACCESS_TOKEN + RAZORPAY_KEY_ID + a database URL are
 * present. SAFETY: touches ONLY its own rows; does not drop/migrate the schema.
 * SECURITY: credentials are read from the environment only; nothing is logged.
 */
import { afterAll, expect, it, describe } from "vitest";

import { PostgresDatabase, PostgresOutboxRepository } from "@counter/data";
import { createCounterId, type CounterId, type Instant } from "@counter/domain";
import { randomUUID } from "node:crypto";

import { buildRealConnectorBundle } from "./boot.js";
import { requireRazorpayCredentials, requireShopifyCredentials } from "./connector-env.js";
import { buildReconciliationScannerConfig } from "./reconciliation-boot.js";
import { runReconciliationPass } from "./reconciliation-job.js";
import {
  createTransactionLifecycleHandler,
  type PaymentAuthorizationPort,
  type ReceiptSink,
  type TransactionReceipt,
  type HandledJob,
} from "./transaction-lifecycle.js";

const databaseUrl =
  process.env["TEST_DATABASE_URL"]?.trim() || process.env["DATABASE_URL"]?.trim() || undefined;
const hasCreds =
  (process.env["SHOPIFY_ACCESS_TOKEN"]?.trim() ?? "").length > 0 &&
  (process.env["RAZORPAY_KEY_ID"]?.trim() ?? "").length > 0 &&
  databaseUrl !== undefined;

const gatedDescribe = hasCreds ? describe : describe.skip;

function randomOutboxId(): CounterId<"outbox-event"> {
  const entropy = new Uint8Array(16);
  const uuid = randomUUID().replace(/-/g, "");
  for (let index = 0; index < 16; index += 1) {
    entropy[index] = Number.parseInt(uuid.slice(index * 2, index * 2 + 2), 16);
  }
  const result = createCounterId("outbox-event", entropy);
  if (!result.ok) throw new Error("bad outbox id");
  return result.value;
}

/**
 * A receipt sink identical in shape to the DEPLOYED outbox sink in main.ts: it
 * writes the DERIVED `transactionId` and the RAW `idempotencyKey` into the
 * receipt payload. The scanner MUST join on the raw idempotencyKey.
 */
function outboxReceiptSink(outbox: PostgresOutboxRepository): ReceiptSink {
  return {
    async record(receipt: TransactionReceipt): Promise<void> {
      const result = await outbox.append(
        [
          {
            id: randomOutboxId(),
            eventType: "transaction.receipt.v1",
            eventVersion: 1,
            payload: {
              transactionId: receipt.transactionId,
              idempotencyKey: receipt.idempotencyKey,
              phase: receipt.finalState.phase,
              providerReference: receipt.providerReference,
              reconciliation: receipt.reconciliation,
            },
            correlationId: undefined,
            idempotencyKey: receipt.idempotencyKey,
          },
        ],
        Date.now() as Instant,
      );
      if (!result.ok) throw new Error(`receipt append failed: ${result.error.message}`);
    },
  };
}

gatedDescribe(
  "reconciliation scanner resolves a real INDETERMINATE txn end-to-end (creds+DB-gated)",
  () => {
    const database = new PostgresDatabase(databaseUrl as string);
    const transactionId = `order-reconcile-e2e-${Date.now()}`;
    const shopifyCreds = hasCreds ? requireShopifyCredentials(process.env)! : null!;
    const razorpayCreds = hasCreds ? requireRazorpayCredentials(process.env)! : null!;
    const bundle = hasCreds
      ? buildRealConnectorBundle(shopifyCreds, razorpayCreds, process.env)
      : null!;
    let createdOrderId: string | undefined;

    afterAll(async () => {
      try {
        if (bundle !== null && createdOrderId !== undefined) {
          await bundle.shopify.orderCancel.execute({
            payload: {
              orderId: createdOrderId,
              reason: "OTHER",
              metadata: { correlationId: transactionId, idempotencyKey: transactionId },
            },
            idempotencyKey: `${transactionId}-cancel`,
            correlationId: transactionId,
            preconditions: [],
            timeoutMs: 20_000,
          });
        }
      } finally {
        await database.query(`DELETE FROM runtime.lifecycle_steps WHERE idempotency_key = $1`, [
          transactionId,
        ]);
        await database.query(
          `DELETE FROM runtime.outbox_events WHERE payload ->> 'idempotencyKey' = $1`,
          [transactionId],
        );
        await database.close();
      }
    });

    it("drives the REAL handler (deriveTransactionId applied), then reconciliation joins on the RAW key and closes it", async () => {
      // ── Drive a REAL order to PAID: draft -> finalize -> mark-paid. This is
      //    the authoritative order the scanner will find. Record the finalize
      //    reference in the durable ledger keyed on the RAW key, exactly as the
      //    real lifecycle does. ──
      const variantId = process.env["SHOPIFY_TEST_VARIANT_GID"]!;
      const draft = await bundle.shopify.draftOrderCreate.execute({
        payload: {
          lineItems: [{ variantId, quantity: 1 }],
          customerId: undefined,
          note: `reconcile-e2e ${transactionId}`,
          tags: ["counter-autonomous"],
          metadata: { correlationId: transactionId, idempotencyKey: transactionId },
        },
        idempotencyKey: transactionId,
        correlationId: transactionId,
        preconditions: [],
        timeoutMs: 20_000,
      });
      expect(draft.status).toBe("succeeded");
      const draftId = draft.status === "succeeded" ? draft.result.draftOrderId : "";

      const finalize = await bundle.shopify.orderFinalize.execute({
        payload: {
          draftOrderId: draftId,
          paymentPending: true,
          metadata: { correlationId: transactionId, idempotencyKey: transactionId },
        },
        idempotencyKey: transactionId,
        correlationId: transactionId,
        preconditions: [],
        timeoutMs: 20_000,
      });
      expect(finalize.status).toBe("succeeded");
      const orderId = finalize.status === "succeeded" ? finalize.result.orderId : "";
      createdOrderId = orderId;

      const markPaidPayload = {
        payload: {
          orderId,
          metadata: { correlationId: transactionId, idempotencyKey: transactionId },
        },
        idempotencyKey: transactionId,
        correlationId: transactionId,
        preconditions: [] as const,
        timeoutMs: 20_000,
      };
      let markPaid = await bundle.shopify.paymentRecord.execute(markPaidPayload);
      for (let attempt = 0; attempt < 5 && markPaid.status !== "succeeded"; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        markPaid = await bundle.shopify.paymentRecord.execute(markPaidPayload);
      }
      expect(markPaid.status).toBe("succeeded");

      // Record the durable finalize step (keyed on the RAW transaction ref).
      await database.query(
        `INSERT INTO runtime.lifecycle_steps (environment, idempotency_key, step, status, reference, created_at, completed_at)
         VALUES ('local', $1, 'shopify.finalize', 'completed', $2, clock_timestamp(), clock_timestamp())
         ON CONFLICT (environment, idempotency_key, step) DO UPDATE SET reference = EXCLUDED.reference`,
        [transactionId, orderId],
      );

      // ── Drive the REAL handler so it emits the INDETERMINATE receipt with a
      //    DERIVED transactionId + RAW idempotencyKey via the deployed-shape
      //    sink. A provider that returns indeterminate makes the handler write
      //    the receipt (with deriveTransactionId applied) and throw retryable. ──
      const indeterminateProvider: PaymentAuthorizationPort = {
        authorizeAndCapture: () =>
          Promise.resolve({
            status: "indeterminate" as const,
            capturedMinor: 0,
            providerReference: `provider-indeterminate:${transactionId}`,
            lastKnownState: "provider.timeout-after-effect",
          }),
      };
      const outbox = new PostgresOutboxRepository(database, "local");
      const handler = createTransactionLifecycleHandler(
        indeterminateProvider,
        outboxReceiptSink(outbox),
      );
      const job: HandledJob = {
        id: (() => {
          const r = createCounterId("job", new Uint8Array(16).fill(3));
          if (!r.ok) throw new Error("bad job id");
          return r.value;
        })(),
        type: "transaction.lifecycle",
        payload: { transactionId, amountMinor: 100, currency: "INR" },
      };
      await expect(handler.execute(job, Date.now() as Instant)).rejects.toThrow();

      // Confirm the receipt row was written with a DERIVED transactionId that is
      // DISTINCT from the raw key (proving deriveTransactionId ran) but carries
      // the raw key as idempotencyKey.
      const receipt = await database.query<{ transaction_id: string; idempotency_key: string }>(
        `SELECT payload ->> 'transactionId' AS transaction_id,
                payload ->> 'idempotencyKey' AS idempotency_key
           FROM runtime.outbox_events
          WHERE event_type = 'transaction.receipt.v1'
            AND payload ->> 'idempotencyKey' = $1`,
        [transactionId],
      );
      expect(receipt.rows).toHaveLength(1);
      expect(receipt.rows[0]!.idempotency_key).toBe(transactionId);
      // The stamped transactionId is the DERIVED CounterId, NOT the raw key.
      expect(receipt.rows[0]!.transaction_id).not.toBe(transactionId);
      // The stamped id is a well-formed derived transaction CounterId.
      expect(receipt.rows[0]!.transaction_id.startsWith("ctr_transaction_")).toBe(true);

      // ── Run the REAL scanner. It must join the receipt back to the ledger via
      //    the RAW idempotencyKey and resolve the candidate to closed. ──
      const config = buildReconciliationScannerConfig({
        database,
        outbox,
        shopify: bundle.shopify,
      });
      const resolutions = await runReconciliationPass(config);

      const mine = resolutions.find((r) => r.idempotencyKey === transactionId);
      expect(mine).toBeDefined();
      expect(mine?.disposition).toBe("resolved_closed");
      expect(mine?.orderReference).toBe(orderId);

      const resolved = await database.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM runtime.outbox_events
          WHERE event_type = 'transaction.reconciliation.v1'
            AND payload ->> 'idempotencyKey' = $1
            AND payload ->> 'disposition' = 'resolved_closed'`,
        [transactionId],
      );
      expect(resolved.rows[0]?.n).toBe("1");
    }, 180_000);
  },
);
