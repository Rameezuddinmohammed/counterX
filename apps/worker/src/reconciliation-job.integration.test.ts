/**
 * Creds+DB-gated integration test: the periodic reconciliation scanner resolves
 * a REAL INDETERMINATE transaction against authoritative Shopify evidence.
 *
 * Proves the reconciliation path end-to-end against REAL infrastructure. It:
 *   1. drives a REAL Shopify order to a settled (PAID) state
 *      (draft -> finalize -> mark-paid) and records the finalize order id in the
 *      durable step ledger (as the lifecycle would);
 *   2. seeds a durable INDETERMINATE receipt for that transaction in the outbox
 *      (as the lifecycle emits on an indeterminate outcome);
 *   3. runs the REAL Postgres-backed reconciliation scanner
 *      (buildReconciliationScannerConfig), which queries the REAL order and
 *      resolves the candidate to `resolved_closed`;
 *   4. cleans up: cancels the real Shopify order, deletes its own ledger +
 *      outbox rows.
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

gatedDescribe("reconciliation scanner resolves a real INDETERMINATE txn (creds+DB-gated)", () => {
  const database = new PostgresDatabase(databaseUrl as string);
  const transactionId = `order-reconcile-${Date.now()}`;
  const shopifyCreds = hasCreds ? requireShopifyCredentials(process.env)! : null!;
  const razorpayCreds = hasCreds ? requireRazorpayCredentials(process.env)! : null!;
  const bundle = hasCreds ? buildRealConnectorBundle(shopifyCreds, razorpayCreds) : null!;
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
        `DELETE FROM runtime.outbox_events WHERE payload ->> 'transactionId' = $1`,
        [transactionId],
      );
      await database.close();
    }
  });

  it(
    "resolves an INDETERMINATE receipt to closed when the real Shopify order is settled",
    async () => {
      // ── Drive a REAL order to PAID: draft -> finalize -> mark-paid. ──
      const variantId = process.env["SHOPIFY_TEST_VARIANT_GID"]!;
      const draft = await bundle.shopify.draftOrderCreate.execute({
        payload: {
          lineItems: [{ variantId, quantity: 1 }],
          customerId: undefined,
          note: `reconcile-int ${transactionId}`,
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

      // Mark-paid can transiently fail right after finalize ("Order is
      // temporarily unavailable to be modified") — retry as the real lifecycle
      // does until the order settles.
      const markPaidPayload = {
        payload: { orderId, metadata: { correlationId: transactionId, idempotencyKey: transactionId } },
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

      // ── Seed the durable finalize step (as the lifecycle records it). ──
      await database.query(
        `INSERT INTO runtime.lifecycle_steps (environment, idempotency_key, step, status, reference, created_at, completed_at)
         VALUES ('local', $1, 'shopify.finalize', 'completed', $2, clock_timestamp(), clock_timestamp())
         ON CONFLICT (environment, idempotency_key, step) DO UPDATE SET reference = EXCLUDED.reference`,
        [transactionId, orderId],
      );

      // ── Seed a durable INDETERMINATE receipt (as the lifecycle emits). ──
      const outbox = new PostgresOutboxRepository(database);
      const appended = await outbox.append(
        [
          {
            id: randomOutboxId(),
            eventType: "transaction.receipt.v1",
            eventVersion: 1,
            payload: { transactionId, phase: "INDETERMINATE" },
            correlationId: undefined,
            idempotencyKey: `${transactionId}:receipt`,
          },
        ],
        Date.now() as Instant,
      );
      expect(appended.ok).toBe(true);

      // ── Run the REAL scanner pass. ──
      const config = buildReconciliationScannerConfig({
        database,
        outbox,
        shopify: bundle.shopify,
      });
      const resolutions = await runReconciliationPass(config);

      const mine = resolutions.find((r) => r.transactionId === transactionId);
      expect(mine).toBeDefined();
      expect(mine?.disposition).toBe("resolved_closed");
      expect(mine?.orderReference).toBe(orderId);

      // A durable resolution event was appended.
      const resolved = await database.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM runtime.outbox_events
          WHERE event_type = 'transaction.reconciliation.v1'
            AND payload ->> 'transactionId' = $1
            AND payload ->> 'disposition' = 'resolved_closed'`,
        [transactionId],
      );
      expect(resolved.rows[0]?.n).toBe("1");
    },
    120_000,
  );
});
