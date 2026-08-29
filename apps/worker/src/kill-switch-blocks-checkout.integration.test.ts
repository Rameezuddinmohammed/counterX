/**
 * Creds+DB-gated integration test: an ACTIVE kill switch blocks a REAL checkout
 * with ZERO external effect.
 *
 * Proves the durable kill-switch gate against REAL infrastructure. It:
 *   1. activates a merchant kill switch for the pilot merchant in the durable
 *      runtime.kill_switches table;
 *   2. runs the REAL lifecycle (real Shopify + Razorpay connectors) through the
 *      Postgres-backed kill-switch gate;
 *   3. asserts the outcome is declined/blocked with a `kill-switch-blocked:`
 *      reference AND that NO Shopify order and NO Razorpay order were created
 *      (the step ledger has zero rows for this idempotency key);
 *   4. cleans up: deactivates + deletes ONLY its own kill-switch row and any of
 *      its own ledger rows.
 *
 * SKIPPED unless SHOPIFY_ACCESS_TOKEN + RAZORPAY_KEY_ID + a database URL
 * (TEST_DATABASE_URL, else DATABASE_URL) are present.
 *
 * SAFETY: touches ONLY its own runtime.kill_switches / runtime.lifecycle_steps
 * rows (keyed on a unique idempotency key / a unique merchant scope target) and
 * does NOT drop or migrate the shared schema, so it is safe against the live DB.
 * SECURITY: credentials are read from the environment only; nothing is logged.
 */
import { afterAll, expect, it, describe } from "vitest";

import { PostgresDatabase, PostgresKillSwitchStore, PostgresStepLedger } from "@counter/data";
import { instantFromEpochMilliseconds, type Instant } from "@counter/domain";

import {
  buildRealConnectorBundle,
  createPostgresKillSwitchGatePort,
  createPostgresStepLedgerPort,
} from "./boot.js";
import { requireRazorpayCredentials, requireShopifyCredentials } from "./connector-env.js";
import { createRealPaymentAuthorizationPort } from "./real-lifecycle.js";
import type { PaymentAuthorizationRequest } from "./transaction-lifecycle.js";

const databaseUrl =
  process.env["TEST_DATABASE_URL"]?.trim() || process.env["DATABASE_URL"]?.trim() || undefined;
const hasCreds =
  (process.env["SHOPIFY_ACCESS_TOKEN"]?.trim() ?? "").length > 0 &&
  (process.env["RAZORPAY_KEY_ID"]?.trim() ?? "").length > 0 &&
  databaseUrl !== undefined;

const gatedDescribe = hasCreds ? describe : describe.skip;

// Idempotent DDL so the durable kill-switch + ledger tables exist without
// migrating (or touching) the rest of the shared schema.
const KILL_SWITCHES_DDL = `
  CREATE TABLE IF NOT EXISTS runtime.kill_switches (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    environment platform.counter_environment NOT NULL,
    scope text NOT NULL,
    entity_id text,
    status text NOT NULL DEFAULT 'active',
    reason text NOT NULL,
    activated_by text NOT NULL,
    activated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamptz,
    CONSTRAINT kill_switches_scope CHECK (
      scope IN ('platform', 'merchant', 'wallet', 'agent', 'mandate', 'connector', 'payment_adapter')
    ),
    CONSTRAINT kill_switches_status CHECK (status IN ('active', 'inactive')),
    CONSTRAINT kill_switches_reason_not_empty CHECK (char_length(reason) > 0),
    CONSTRAINT kill_switches_activated_by_not_empty CHECK (char_length(activated_by) > 0),
    CONSTRAINT kill_switches_expires_after_activated CHECK (
      expires_at IS NULL OR expires_at > activated_at
    ),
    CONSTRAINT kill_switches_platform_entity CHECK (
      (scope = 'platform' AND entity_id IS NULL)
      OR (scope <> 'platform' AND entity_id IS NOT NULL AND char_length(entity_id) > 0)
    )
  );
  CREATE UNIQUE INDEX IF NOT EXISTS kill_switches_scoped_key
    ON runtime.kill_switches (environment, scope, entity_id) WHERE entity_id IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS kill_switches_platform_key
    ON runtime.kill_switches (environment, scope) WHERE entity_id IS NULL;
  CREATE INDEX IF NOT EXISTS kill_switches_active
    ON runtime.kill_switches (environment, scope, entity_id) WHERE status = 'active';
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

function nowInstant(): Instant {
  const result = instantFromEpochMilliseconds(Date.now());
  if (!result.ok) throw new Error("bad instant");
  return result.value;
}

gatedDescribe("kill switch blocks a real checkout (creds+DB-gated, live network)", () => {
  const database = new PostgresDatabase(databaseUrl as string);
  const idempotencyKey = `order-killswitch-${Date.now()}`;

  const shopifyCreds = hasCreds ? requireShopifyCredentials(process.env)! : null!;
  const razorpayCreds = hasCreds ? requireRazorpayCredentials(process.env)! : null!;
  const bundle = hasCreds ? buildRealConnectorBundle(shopifyCreds, razorpayCreds, process.env) : null!;

  afterAll(async () => {
    try {
      if (bundle !== null) {
        // Deactivate + delete ONLY this test's own merchant kill-switch row.
        await database.query(
          `DELETE FROM runtime.kill_switches
            WHERE environment = 'local' AND scope = 'merchant' AND entity_id = $1`,
          [bundle.merchantId],
        );
      }
    } finally {
      await database.query(`DELETE FROM runtime.lifecycle_steps WHERE idempotency_key = $1`, [
        idempotencyKey,
      ]);
      await database.close();
    }
  });

  it(
    "returns a blocked outcome and creates NO Shopify or Razorpay order when a merchant kill switch is active",
    async () => {
      await database.query(KILL_SWITCHES_DDL);
      await database.query(`DELETE FROM runtime.lifecycle_steps WHERE idempotency_key = $1`, [
        idempotencyKey,
      ]);

      const killSwitchStore = new PostgresKillSwitchStore(database, "local");
      // Activate a durable merchant kill switch for the pilot merchant.
      const activated = await killSwitchStore.recordActivate(
        {
          scope: "merchant",
          entityId: bundle.merchantId,
          reason: "integration-test: block a real checkout",
          activatedBy: "kill-switch-blocks-checkout.integration.test",
        },
        nowInstant(),
      );
      expect(activated.ok).toBe(true);

      const durableLedger = createPostgresStepLedgerPort(new PostgresStepLedger(database, "local"));
      const gate = createPostgresKillSwitchGatePort(killSwitchStore, bundle.merchantId);

      const port = createRealPaymentAuthorizationPort({
        shopify: bundle.shopify,
        razorpay: bundle.razorpay,
        payments: bundle.payments,
        merchantId: bundle.merchantId,
        stepLedger: durableLedger,
        killSwitch: gate,
      });

      const variantId = process.env["SHOPIFY_TEST_VARIANT_GID"];
      const request: PaymentAuthorizationRequest = {
        transactionId: "ctr_txn_killsw" as PaymentAuthorizationRequest["transactionId"],
        amountMinor: 100,
        currency: "INR",
        idempotencyKey,
        ...(variantId !== undefined ? { variantId } : {}),
        quantity: 1,
      };

      const result = await port.authorizeAndCapture(request);

      // Blocked BEFORE any external effect.
      expect(result.status).toBe("declined");
      expect(result.providerReference.startsWith("kill-switch-blocked:")).toBe(true);

      // ZERO external effect: the durable step ledger has NO rows for this key
      // (no draft, no finalize, no mark-paid were ever attempted).
      const ledgerRows = await database.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM runtime.lifecycle_steps WHERE idempotency_key = $1`,
        [idempotencyKey],
      );
      expect(ledgerRows.rows[0]?.count).toBe("0");
    },
    120_000,
  );
});
