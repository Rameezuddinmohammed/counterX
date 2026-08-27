/**
 * PRIORITY 2 — Concurrency proofs against the REAL path.
 *
 * Fires TWO concurrent identical checkouts with the SAME idempotencyKey through
 * the REAL money seam sharing ONE durable Postgres step ledger, plus a racing
 * retry, and asserts the attempts converge to AT MOST ONE Shopify draft ORDER —
 * not merely one ledger row.
 *
 * The Shopify draftOrderCreate mutation has NO native idempotency key and the
 * connector's idempotency store is per-instance in-memory, so without a durable
 * pre-claim two racing workers could each create a REAL draft while only one
 * ledger row survives the ON CONFLICT. This test therefore counts the number of
 * times the REAL draftOrderCreate.execute is invoked across BOTH instances (via
 * a shared spy) and asserts it is called EXACTLY ONCE — proving the durable
 * pre-claim (FEAT-001 + issue-3 fix) lets only the claim winner create the
 * draft. It also asserts exactly one durable draft + finalize ledger row.
 *
 * The created order is left PENDING (mark-paid is forced indeterminate) so it is
 * cancellable, and afterAll cancels it via connector.orderCancel and deletes the
 * test's own ledger rows.
 *
 * SKIPPED unless creds + a database URL are present. SAFETY: touches only its
 * own runtime.lifecycle_steps rows and never drops/migrates the schema.
 */
import { PostgresDatabase, PostgresStepLedger } from "@counter/data";
import { afterAll, describe, expect, it } from "vitest";

import { createPostgresStepLedgerPort } from "./boot.js";
import { createRealPaymentAuthorizationPort } from "./real-lifecycle.js";
import type { ShopifyConnector } from "@counter/shopify-connector";
import type { PaymentAuthorizationRequest } from "./transaction-lifecycle.js";
import {
  cancelShopifyOrder,
  databaseUrl,
  hasCreds,
  realBundleOrNull,
  RUNTIME_DDL,
} from "./adversarial-test-support.js";

const gatedDescribe = hasCreds ? describe : describe.skip;

/**
 * Wraps a connector so mark-paid stays indeterminate (order stays PENDING) AND
 * every REAL draftOrderCreate.execute increments a SHARED counter, so two port
 * instances that share this connector share the draft-call count.
 */
function instrument(
  connector: ShopifyConnector,
  counter: { draftCalls: number },
): ShopifyConnector {
  const realDraft = connector.draftOrderCreate;
  const boundDraft = (realDraft.execute as (...a: never[]) => unknown).bind(realDraft);
  return {
    ...connector,
    draftOrderCreate: {
      ...realDraft,
      execute: (...args: never[]) => {
        counter.draftCalls += 1;
        return boundDraft(...args);
      },
    } as unknown as typeof connector.draftOrderCreate,
    paymentRecord: {
      execute: (): Promise<{ readonly status: "indeterminate"; readonly lastKnownState: string }> =>
        Promise.resolve({ status: "indeterminate" as const, lastKnownState: "markPaid.held" }),
    } as unknown as typeof connector.paymentRecord,
  };
}

gatedDescribe("concurrency — same-key checkouts create at most ONE real draft (creds+DB-gated)", () => {
  const database = new PostgresDatabase(databaseUrl as string);
  const bundle = realBundleOrNull();
  const idempotencyKey = `concurrency-${Date.now()}`;

  afterAll(async () => {
    try {
      const orderRow = (
        await database.query<{ reference: string | null }>(
          `SELECT reference FROM runtime.lifecycle_steps
           WHERE idempotency_key = $1 AND step = 'shopify.finalize'`,
          [idempotencyKey],
        )
      ).rows[0];
      const orderId = orderRow?.reference ?? undefined;
      if (bundle !== null && orderId !== undefined && orderId.length > 0) {
        await cancelShopifyOrder(bundle.shopify, orderId, idempotencyKey);
      }
    } finally {
      await database.query(`DELETE FROM runtime.lifecycle_steps WHERE idempotency_key = $1`, [
        idempotencyKey,
      ]);
      await database.close();
    }
  });

  it(
    "invokes the real draftOrderCreate EXACTLY ONCE for two concurrent checkouts and a racing retry",
    async () => {
      await database.query(RUNTIME_DDL);
      await database.query(`DELETE FROM runtime.lifecycle_steps WHERE idempotency_key = $1`, [
        idempotencyKey,
      ]);

      const variantId = process.env["SHOPIFY_TEST_VARIANT_GID"];
      const request: PaymentAuthorizationRequest = {
        transactionId: "ctr_txn_concurrency" as PaymentAuthorizationRequest["transactionId"],
        amountMinor: 100,
        currency: "INR",
        idempotencyKey,
        ...(variantId !== undefined ? { variantId } : {}),
        quantity: 1,
      };

      // SHARED draft-call counter across both instances, exactly as two racing
      // workers hitting the same real Shopify store would share the store.
      const counter = { draftCalls: 0 };

      // Two SEPARATE real port instances (distinct per-instance in-memory caches
      // and connector idempotency stores, as two racing workers would have)
      // sharing ONE durable Postgres ledger and ONE instrumented connector.
      const makePort = (): ReturnType<typeof createRealPaymentAuthorizationPort> =>
        createRealPaymentAuthorizationPort({
          shopify: instrument(bundle!.shopify, counter),
          razorpay: bundle!.razorpay,
          payments: bundle!.payments,
          merchantId: bundle!.merchantId,
          stepLedger: createPostgresStepLedgerPort(new PostgresStepLedger(database)),
          actionTimeoutMs: 30_000,
        });

      // Fire two concurrent identical checkouts.
      const [a, b] = await Promise.all([
        makePort().authorizeAndCapture(request),
        makePort().authorizeAndCapture(request),
      ]);
      for (const outcome of [a, b]) {
        expect(["indeterminate", "captured"]).toContain(outcome.status);
      }

      // Racing retry on the same key.
      const c = await makePort().authorizeAndCapture(request);
      expect(["indeterminate", "captured"]).toContain(c.status);

      // PRIMARY INVARIANT: the REAL draftOrderCreate was invoked exactly ONCE
      // across all racing attempts — the durable pre-claim let only the winner
      // create the draft, so at most ONE real Shopify draft order exists.
      expect(counter.draftCalls).toBe(1);

      // The durable ledger corroborates: exactly ONE draft row and ONE finalize
      // row for the key.
      const draftRows = await database.query(
        `SELECT 1 FROM runtime.lifecycle_steps
         WHERE idempotency_key = $1 AND step = 'shopify.draft'`,
        [idempotencyKey],
      );
      expect(draftRows.rowCount).toBe(1);

      const finalizeRows = await database.query<{ reference: string | null }>(
        `SELECT reference FROM runtime.lifecycle_steps
         WHERE idempotency_key = $1 AND step = 'shopify.finalize'`,
        [idempotencyKey],
      );
      expect(finalizeRows.rows).toHaveLength(1);
      expect(finalizeRows.rows[0]!.reference).toBeTruthy();
    },
    180_000,
  );
});
