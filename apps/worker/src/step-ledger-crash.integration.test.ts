/**
 * Creds+DB-gated DURABLE-RESUME crash-simulation integration test.
 *
 * Proves the durable-idempotency guarantee for the Shopify legs against REAL
 * infrastructure: a worker crash BETWEEN the Shopify draft and finalize must
 * NOT create a second Shopify order after restart. It:
 *
 *   1. drives a REAL draft (attempt A) whose finalize is forced to throw
 *      (simulating a crash after the draft), so the draft is recorded in the
 *      durable Postgres step ledger and attempt A aborts;
 *   2. re-runs on a FRESH real port instance (a restart: new in-memory dedup)
 *      built from the SAME durable ledger + SAME idempotencyKey, and completes;
 *   3. asserts EXACTLY ONE Shopify draft/order reference exists for the
 *      transaction (the draft was RESUMED from the ledger, never re-created);
 *   4. cleans up: cancels the real Shopify order (connector.orderCancel) and
 *      deletes ONLY its own runtime.lifecycle_steps rows.
 *
 * SKIPPED unless SHOPIFY_ACCESS_TOKEN + RAZORPAY_KEY_ID + a database URL
 * (TEST_DATABASE_URL, else DATABASE_URL) are present, so it never affects the
 * default baseline and never needs secrets or network in CI.
 *
 * SAFETY: creates and deletes ONLY its own runtime.lifecycle_steps rows (keyed
 * on a unique idempotencyKey) and does NOT drop or migrate the shared schema,
 * so it is safe against the live DB. SECURITY: credentials are read from the
 * environment only; nothing is logged.
 */
import { afterAll, expect, it, describe } from "vitest";

import { PostgresDatabase, PostgresStepLedger } from "@counter/data";

import {
  buildRealConnectorBundle,
  createPostgresStepLedgerPort,
} from "./boot.js";
import { requireRazorpayCredentials, requireShopifyCredentials } from "./connector-env.js";
import {
  createRealPaymentAuthorizationPort,
  type StepLedgerPort,
} from "./real-lifecycle.js";
import type { PaymentAuthorizationRequest } from "./transaction-lifecycle.js";

const databaseUrl =
  process.env["TEST_DATABASE_URL"]?.trim() || process.env["DATABASE_URL"]?.trim() || undefined;
const hasCreds =
  (process.env["SHOPIFY_ACCESS_TOKEN"]?.trim() ?? "").length > 0 &&
  (process.env["RAZORPAY_KEY_ID"]?.trim() ?? "").length > 0 &&
  databaseUrl !== undefined;

const gatedDescribe = hasCreds ? describe : describe.skip;

// Idempotent DDL so the durable ledger table exists without migrating (or
// touching) the rest of the shared schema.
const LIFECYCLE_STEPS_DDL = `
  CREATE TABLE IF NOT EXISTS runtime.lifecycle_steps (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    environment platform.counter_environment NOT NULL,
    idempotency_key text NOT NULL,
    step text NOT NULL,
    status text NOT NULL,
    reference text,
    snapshot jsonb,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    completed_at timestamptz,
    CONSTRAINT lifecycle_steps_status CHECK (status IN ('completed', 'declined')),
    CONSTRAINT lifecycle_steps_step_not_empty CHECK (char_length(step) > 0),
    CONSTRAINT lifecycle_steps_key_not_empty CHECK (char_length(idempotency_key) > 0)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS lifecycle_steps_natural_key
    ON runtime.lifecycle_steps (environment, idempotency_key, step);
`;

gatedDescribe("durable step-ledger crash-resume (creds+DB-gated, live network)", () => {
  const database = new PostgresDatabase(databaseUrl as string);
  const idempotencyKey = `order-crash-${Date.now()}`;

  // Resolve credentials only under the gate so the suite skips cleanly
  // (describe.skip still evaluates this body to collect tests, and a
  // production-like env with missing creds would otherwise fail-loud here).
  const shopifyCreds = hasCreds ? requireShopifyCredentials(process.env)! : null!;
  const razorpayCreds = hasCreds ? requireRazorpayCredentials(process.env)! : null!;

  afterAll(async () => {
    try {
      // Cancel the real finalized Shopify order (if any) so the store is clean.
      const orderRow = (
        await database.query<{ reference: string | null }>(
          `SELECT reference FROM runtime.lifecycle_steps
           WHERE idempotency_key = $1 AND step = 'shopify.finalize'`,
          [idempotencyKey],
        )
      ).rows[0];
      const orderId = orderRow?.reference ?? undefined;
      if (orderId !== undefined && orderId.length > 0) {
        const bundle = buildRealConnectorBundle(shopifyCreds, razorpayCreds, process.env);
        await bundle.shopify.orderCancel.execute({
          payload: {
            orderId,
            reason: "OTHER",
            metadata: { correlationId: idempotencyKey, idempotencyKey },
          },
          idempotencyKey: `${idempotencyKey}-cancel`,
          correlationId: idempotencyKey,
          preconditions: [],
          timeoutMs: 20_000,
        });
      }
    } finally {
      await database.query(
        `DELETE FROM runtime.lifecycle_steps WHERE idempotency_key = $1`,
        [idempotencyKey],
      );
      await database.close();
    }
  });

  it(
    "does not create a SECOND Shopify order when resuming after a crash between draft and finalize",
    async () => {
      await database.query(LIFECYCLE_STEPS_DDL);
      await database.query(
        `DELETE FROM runtime.lifecycle_steps WHERE idempotency_key = $1`,
        [idempotencyKey],
      );

      const durableLedger: StepLedgerPort = createPostgresStepLedgerPort(
        new PostgresStepLedger(database, "local"),
      );

      const variantId = process.env["SHOPIFY_TEST_VARIANT_GID"];
      const request: PaymentAuthorizationRequest = {
        transactionId: "ctr_txn_crashsim" as PaymentAuthorizationRequest["transactionId"],
        amountMinor: 100,
        currency: "INR",
        idempotencyKey,
        ...(variantId !== undefined ? { variantId } : {}),
        quantity: 1,
      };

      // ── Attempt A: REAL connectors, but finalize is forced to throw AFTER the
      //    real draft runs (a crash between draft and finalize). ──
      const bundleA = buildRealConnectorBundle(shopifyCreds, razorpayCreds, process.env);
      const crashingShopify = {
        ...bundleA.shopify,
        orderFinalize: {
          execute: (): Promise<never> =>
            Promise.reject(new Error("simulated crash after draft, before finalize")),
        } as unknown as typeof bundleA.shopify.orderFinalize,
      };
      const portA = createRealPaymentAuthorizationPort({
        shopify: crashingShopify,
        razorpay: bundleA.razorpay,
        payments: bundleA.payments,
        merchantId: bundleA.merchantId,
        stepLedger: durableLedger,
        actionTimeoutMs: 20_000,
      });

      await expect(portA.authorizeAndCapture(request)).rejects.toThrow();

      // The real draft ran once and its outcome is durably recorded.
      const draftRow = (
        await database.query<{ reference: string | null }>(
          `SELECT reference FROM runtime.lifecycle_steps
           WHERE idempotency_key = $1 AND step = 'shopify.draft'`,
          [idempotencyKey],
        )
      ).rows[0];
      expect(draftRow).toBeDefined();
      expect(draftRow!.reference).toBeTruthy();
      const draftReferenceAfterA = draftRow!.reference;

      // ── Attempt B: a FRESH real port + FRESH connectors (a restart) with the
      //    SAME durable ledger + SAME key. Finalize now works; the lifecycle
      //    RESUMES from the recorded draft and finalizes the REAL order. The
      //    mark-paid leg is forced to stay INDETERMINATE so the resumed order is
      //    left in PENDING (unpaid) — this keeps the proof focused on the
      //    draft/finalize resume AND lets the connector cancel it cleanly in
      //    afterAll (Shopify refuses a no-refund cancel on a PAID order). ──
      const bundleB = buildRealConnectorBundle(shopifyCreds, razorpayCreds, process.env);
      const nonPayingShopify = {
        ...bundleB.shopify,
        paymentRecord: {
          execute: (): Promise<{
            readonly status: "indeterminate";
            readonly lastKnownState: string;
          }> =>
            Promise.resolve({
              status: "indeterminate" as const,
              lastKnownState: "markPaid.simulated-unpaid",
            }),
        } as unknown as typeof bundleB.shopify.paymentRecord,
      };
      const portB = createRealPaymentAuthorizationPort({
        shopify: nonPayingShopify,
        razorpay: bundleB.razorpay,
        payments: bundleB.payments,
        merchantId: bundleB.merchantId,
        stepLedger: durableLedger,
        actionTimeoutMs: 20_000,
      });

      const second = await portB.authorizeAndCapture(request);
      // The draft was RESUMED and the REAL order was finalized; mark-paid stays
      // indeterminate by injection, so the order is left PENDING (cancellable).
      // A declined/failed here would be a resume bug.
      expect(second.status).toBe("indeterminate");

      // KEY INVARIANT: exactly ONE draft reference, unchanged from attempt A —
      // the draft was RESUMED, never re-created.
      const draftRows = (
        await database.query<{ reference: string | null }>(
          `SELECT reference FROM runtime.lifecycle_steps
           WHERE idempotency_key = $1 AND step = 'shopify.draft'`,
          [idempotencyKey],
        )
      ).rows;
      expect(draftRows).toHaveLength(1);
      expect(draftRows[0]!.reference).toBe(draftReferenceAfterA);
    },
    120_000,
  );
});
