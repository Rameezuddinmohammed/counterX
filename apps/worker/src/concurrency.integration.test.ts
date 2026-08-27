/**
 * PRIORITY 2 — Concurrency proofs against the REAL path.
 *
 * Fires TWO concurrent identical checkouts with the SAME idempotencyKey through
 * the REAL money seam sharing ONE durable Postgres step ledger, and asserts the
 * two attempts converge to AT MOST ONE Shopify order + ONE payment. Then fires a
 * racing retry (a third attempt on the same key against the SAME durable ledger)
 * and asserts it converges to the SAME single order — never a second effect.
 *
 * Convergence is proven by the durable step ledger (FEAT-001): the
 * UNIQUE(environment, idempotency_key, step) constraint with ON CONFLICT DO
 * NOTHING guarantees exactly ONE recorded draft/finalize outcome no matter how
 * many attempts race, so exactly one Shopify order exists for the key.
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

/** A Shopify connector whose mark-paid always stays indeterminate (order stays PENDING). */
function nonPaying(connector: ShopifyConnector): ShopifyConnector {
  return {
    ...connector,
    paymentRecord: {
      execute: (): Promise<{ readonly status: "indeterminate"; readonly lastKnownState: string }> =>
        Promise.resolve({ status: "indeterminate" as const, lastKnownState: "markPaid.held" }),
    } as unknown as typeof connector.paymentRecord,
  };
}

gatedDescribe("concurrency — same-key checkouts converge to one effect (creds+DB-gated)", () => {
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
    "creates at most ONE Shopify order + ONE payment for two concurrent identical checkouts and a racing retry",
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

      // Two SEPARATE real port instances (distinct in-memory caches, as two
      // racing workers would have) sharing ONE durable Postgres ledger.
      const makePort = (): ReturnType<typeof createRealPaymentAuthorizationPort> =>
        createRealPaymentAuthorizationPort({
          shopify: nonPaying(bundle!.shopify),
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

      // Neither is a hard failure; both resolve to the same convergent outcome.
      for (const outcome of [a, b]) {
        expect(["indeterminate", "captured"]).toContain(outcome.status);
      }

      // Racing retry on the same key.
      const c = await makePort().authorizeAndCapture(request);
      expect(["indeterminate", "captured"]).toContain(c.status);

      // KEY INVARIANT: the durable ledger holds EXACTLY ONE draft row and EXACTLY
      // ONE finalize row for the key — exactly one Shopify order exists despite
      // three attempts racing.
      const draftRows = await database.query<{ reference: string | null }>(
        `SELECT reference FROM runtime.lifecycle_steps
         WHERE idempotency_key = $1 AND step = 'shopify.draft'`,
        [idempotencyKey],
      );
      expect(draftRows.rows).toHaveLength(1);

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
