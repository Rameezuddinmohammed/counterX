/**
 * PRIORITY 2 — Revocation mid-flight against the REAL path.
 *
 * Models a mandate/authorization revoked during the COMMITTING window: the real
 * lifecycle has already drafted + finalized a REAL Shopify order (the effect
 * that was in flight) when the revocation lands, so the NEXT consequential step
 * (mark-paid) must be BLOCKED rather than completed. The proof asserts:
 *   - the transaction outcome is INDETERMINATE (routed to reconciliation), NOT a
 *     silent failure and NOT a captured success;
 *   - there is NO COMPOUNDING effect: exactly ONE Shopify order (one draft, one
 *     finalize) exists and mark-paid recorded NO durable completed row;
 * i.e. revocation mid-flight halts progression without duplicating or completing
 * the payment.
 *
 * The order is left PENDING (never marked paid), so afterAll cancels it via
 * connector.orderCancel and deletes the test's own ledger rows.
 *
 * SKIPPED unless creds + a database URL are present. SAFETY: touches only its
 * own runtime.lifecycle_steps rows and never drops/migrates the schema.
 */
import { PostgresDatabase, PostgresStepLedger } from "@counter/data";
import type { ShopifyConnector } from "@counter/shopify-connector";
import { afterAll, describe, expect, it } from "vitest";

import { createPostgresStepLedgerPort } from "./boot.js";
import { createRealPaymentAuthorizationPort } from "./real-lifecycle.js";
import type { PaymentAuthorizationRequest } from "./transaction-lifecycle.js";
import {
  cancelShopifyOrder,
  databaseUrl,
  hasCreds,
  realBundleOrNull,
  RUNTIME_DDL,
} from "./adversarial-test-support.js";

const gatedDescribe = hasCreds ? describe : describe.skip;

gatedDescribe("revocation mid-flight — blocks next step, routes to INDETERMINATE (creds+DB-gated)", () => {
  const database = new PostgresDatabase(databaseUrl as string);
  const bundle = realBundleOrNull();
  const idempotencyKey = `revoke-midflight-${Date.now()}`;

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
    "blocks the consequential mark-paid step after a mid-flight revocation and leaves the order PENDING (no compounding effect)",
    async () => {
      await database.query(RUNTIME_DDL);
      await database.query(`DELETE FROM runtime.lifecycle_steps WHERE idempotency_key = $1`, [
        idempotencyKey,
      ]);

      // Revocation lands AFTER finalize (during COMMITTING). We model the
      // consequential mark-paid step being blocked by returning an
      // indeterminate outcome from paymentRecord — the real lifecycle surfaces
      // this as INDETERMINATE (routed to reconciliation), never as failed or
      // captured, and records NO durable mark-paid completion.
      let finalizeCompleted = false;
      const revokingShopify: ShopifyConnector = {
        ...bundle!.shopify,
        orderFinalize: {
          execute: async (input: Parameters<ShopifyConnector["orderFinalize"]["execute"]>[0]) => {
            const outcome = await bundle!.shopify.orderFinalize.execute(input);
            finalizeCompleted = true;
            return outcome;
          },
        } as unknown as ShopifyConnector["orderFinalize"],
        paymentRecord: {
          execute: (): Promise<{
            readonly status: "indeterminate";
            readonly lastKnownState: string;
          }> => {
            // The revocation blocks the next consequential step.
            expect(finalizeCompleted).toBe(true);
            return Promise.resolve({
              status: "indeterminate" as const,
              lastKnownState: "markPaid.blocked-by-revocation",
            });
          },
        } as unknown as ShopifyConnector["paymentRecord"],
      };

      const port = createRealPaymentAuthorizationPort({
        shopify: revokingShopify,
        razorpay: bundle!.razorpay,
        payments: bundle!.payments,
        merchantId: bundle!.merchantId,
        stepLedger: createPostgresStepLedgerPort(new PostgresStepLedger(database)),
        actionTimeoutMs: 30_000,
      });

      const variantId = process.env["SHOPIFY_TEST_VARIANT_GID"];
      const request: PaymentAuthorizationRequest = {
        transactionId: "ctr_txn_revoke" as PaymentAuthorizationRequest["transactionId"],
        amountMinor: 100,
        currency: "INR",
        idempotencyKey,
        ...(variantId !== undefined ? { variantId } : {}),
        quantity: 1,
      };

      const result = await port.authorizeAndCapture(request);

      // Routed to reconciliation — INDETERMINATE, never failed, never captured.
      expect(result.status).toBe("indeterminate");

      // No compounding effect: exactly ONE draft + ONE finalize, and NO durable
      // mark-paid completion row (the consequential step was blocked).
      const draftRows = await database.query(
        `SELECT 1 FROM runtime.lifecycle_steps WHERE idempotency_key = $1 AND step = 'shopify.draft'`,
        [idempotencyKey],
      );
      expect(draftRows.rowCount).toBe(1);
      const finalizeRows = await database.query(
        `SELECT 1 FROM runtime.lifecycle_steps WHERE idempotency_key = $1 AND step = 'shopify.finalize'`,
        [idempotencyKey],
      );
      expect(finalizeRows.rowCount).toBe(1);
      const markPaidRows = await database.query(
        `SELECT 1 FROM runtime.lifecycle_steps WHERE idempotency_key = $1 AND step = 'shopify.markPaid'`,
        [idempotencyKey],
      );
      expect(markPaidRows.rowCount).toBe(0);
    },
    180_000,
  );
});
