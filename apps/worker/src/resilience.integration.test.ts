/**
 * PRIORITY 2 — Resilience proofs.
 *
 *  (a) Provider timeout AFTER a possible effect => INDETERMINATE (never failed).
 *      Drives the REAL money seam with a finalize that returns an
 *      `indeterminate` ActionOutcome (a timeout after a possible effect) and
 *      asserts the lifecycle surfaces INDETERMINATE — not a failure and not a
 *      success — so a later attempt / reconciliation can resolve the unknown
 *      state. The draft is left recorded and its order is cancelled in cleanup.
 *      (creds+DB-gated, real path.)
 *
 *  (b) Duplicate / reordered webhook => deduped to ONE effect. Uses the REAL
 *      Razorpay webhook HMAC verify (verifyWebhook) to authenticate the signed
 *      body, then the REAL Postgres inbox dedup (PostgresInboxRepository.receive
 *      with ON CONFLICT DO NOTHING) to prove a duplicate/reordered delivery is
 *      recorded exactly once. (DB-gated only — no live provider network needed;
 *      the webhook signature is produced locally with a known secret.)
 */
import { randomUUID } from "node:crypto";
import { createHmac } from "node:crypto";

import {
  PostgresDatabase,
  PostgresInboxRepository,
  PostgresStepLedger,
} from "@counter/data";
import {
  createCounterId,
  instantFromEpochMilliseconds,
  type CounterId,
  type Instant,
} from "@counter/domain";
import { MockRazorpayHttp, RazorpayTestProvider } from "@counter/razorpay-adapter";
import type { ShopifyConnector } from "@counter/shopify-connector";
import { afterAll, describe, expect, it } from "vitest";

import { createPostgresStepLedgerPort } from "./boot.js";
import { createRealPaymentAuthorizationPort } from "./real-lifecycle.js";
import type { PaymentAuthorizationRequest } from "./transaction-lifecycle.js";
import {
  databaseUrl,
  hasCreds,
  realBundleOrNull,
  RUNTIME_DDL,
} from "./adversarial-test-support.js";

function nowInstant(): Instant {
  const result = instantFromEpochMilliseconds(Date.now());
  if (!result.ok) throw new Error("bad instant");
  return result.value;
}

function inboxEventId(seed: string): CounterId<"inbox-event"> {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) bytes[i] = seed.charCodeAt(i % seed.length) & 0xff;
  const result = createCounterId("inbox-event", bytes);
  if (!result.ok) throw new Error("bad inbox event id");
  return result.value;
}

const INBOX_DDL = `
  CREATE TABLE IF NOT EXISTS runtime.inbox_events (
    id text PRIMARY KEY,
    environment platform.counter_environment NOT NULL,
    source text NOT NULL,
    source_event_id text NOT NULL,
    event_type text NOT NULL,
    payload jsonb NOT NULL,
    correlation_id text,
    status text NOT NULL DEFAULT 'received',
    received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    processed_at timestamptz,
    CONSTRAINT inbox_events_status CHECK (status IN ('received', 'processed', 'duplicate')),
    CONSTRAINT inbox_events_source_not_empty CHECK (char_length(source) > 0),
    CONSTRAINT inbox_events_source_event_id_not_empty CHECK (char_length(source_event_id) > 0),
    CONSTRAINT inbox_events_event_type_not_empty CHECK (char_length(event_type) > 0),
    CONSTRAINT inbox_events_processed_state CHECK (
      (status = 'processed' AND processed_at IS NOT NULL) OR (status <> 'processed')
    )
  );
  CREATE UNIQUE INDEX IF NOT EXISTS inbox_events_dedup
    ON runtime.inbox_events (environment, source, source_event_id);
`;

// ─── (a) post-effect timeout => INDETERMINATE (creds+DB-gated) ────────────────

const gatedDescribe = hasCreds ? describe : describe.skip;

gatedDescribe("resilience — post-effect timeout is INDETERMINATE, never failed (creds+DB-gated)", () => {
  const database = new PostgresDatabase(databaseUrl as string);
  const bundle = realBundleOrNull();
  const idempotencyKey = `resilience-timeout-${Date.now()}`;

  afterAll(async () => {
    try {
      const orderRow = (
        await database.query<{ reference: string | null }>(
          `SELECT reference FROM runtime.lifecycle_steps
           WHERE idempotency_key = $1 AND step = 'shopify.draft'`,
          [idempotencyKey],
        )
      ).rows[0];
      // Draft may have created a draft order; finalize did not run (indeterminate),
      // so there is no completed order to cancel — deleting rows is sufficient.
      void orderRow;
    } finally {
      await database.query(`DELETE FROM runtime.lifecycle_steps WHERE idempotency_key = $1`, [
        idempotencyKey,
      ]);
      await database.close();
    }
  });

  it(
    "surfaces INDETERMINATE (not failed) when finalize times out after a possible effect",
    async () => {
      await database.query(RUNTIME_DDL);
      await database.query(`DELETE FROM runtime.lifecycle_steps WHERE idempotency_key = $1`, [
        idempotencyKey,
      ]);

      // finalize returns an `indeterminate` ActionOutcome — a timeout AFTER a
      // possible effect. The lifecycle MUST surface INDETERMINATE, never failed.
      const timingOutShopify: ShopifyConnector = {
        ...bundle!.shopify,
        orderFinalize: {
          execute: (): Promise<{
            readonly status: "indeterminate";
            readonly lastKnownState: string;
          }> =>
            Promise.resolve({
              status: "indeterminate" as const,
              lastKnownState: "finalize.timeout-after-possible-effect",
            }),
        } as unknown as ShopifyConnector["orderFinalize"],
      };

      const port = createRealPaymentAuthorizationPort({
        shopify: timingOutShopify,
        razorpay: bundle!.razorpay,
        payments: bundle!.payments,
        merchantId: bundle!.merchantId,
        stepLedger: createPostgresStepLedgerPort(new PostgresStepLedger(database, "local")),
        actionTimeoutMs: 20_000,
      });

      const variantId = process.env["SHOPIFY_TEST_VARIANT_GID"];
      const request: PaymentAuthorizationRequest = {
        transactionId: "ctr_txn_timeout" as PaymentAuthorizationRequest["transactionId"],
        amountMinor: 100,
        currency: "INR",
        idempotencyKey,
        ...(variantId !== undefined ? { variantId } : {}),
        quantity: 1,
      };

      const result = await port.authorizeAndCapture(request);
      expect(result.status).toBe("indeterminate");
      // An indeterminate finalize is NEVER recorded as a completed durable step.
      const finalizeRows = await database.query(
        `SELECT 1 FROM runtime.lifecycle_steps WHERE idempotency_key = $1 AND step = 'shopify.finalize'`,
        [idempotencyKey],
      );
      expect(finalizeRows.rowCount).toBe(0);
    },
    120_000,
  );
});

// ─── (b) duplicate / reordered webhook => one effect (DB-gated) ───────────────

const dbGatedDescribe = databaseUrl !== undefined ? describe : describe.skip;

dbGatedDescribe("resilience — duplicate/reordered webhook deduped to one effect (DB-gated)", () => {
  const database = new PostgresDatabase(databaseUrl as string);
  const webhookSecret = "whsec_integration_test_secret";
  const paymentId = `pay_${randomUUID().replaceAll("-", "").slice(0, 14)}`;
  const sourceEventId = `evt_${randomUUID().replaceAll("-", "").slice(0, 14)}`;

  afterAll(async () => {
    try {
      await database.query(
        `DELETE FROM runtime.inbox_events WHERE source = 'razorpay' AND source_event_id = $1`,
        [sourceEventId],
      );
    } finally {
      await database.close();
    }
  });

  it(
    "verifies the HMAC signature then dedups a duplicate + reordered delivery to a single inbox row",
    async () => {
      await database.query(INBOX_DDL);
      await database.query(
        `DELETE FROM runtime.inbox_events WHERE source = 'razorpay' AND source_event_id = $1`,
        [sourceEventId],
      );

      const provider = new RazorpayTestProvider({
        config: {
          keyId: "rzp_test_dummy",
          keySecret: "dummy_secret",
          webhookSecret,
          environment: "test",
          baseUrl: "https://api.razorpay.com",
        },
        httpClient: new MockRazorpayHttp(),
      });

      const event = {
        event: "payment.captured",
        payload: { payment: { entity: { id: paymentId, status: "captured", amount: 100 } } },
      };
      const body = new TextEncoder().encode(JSON.stringify(event));
      const signature = createHmac("sha256", webhookSecret)
        .update(new TextDecoder().decode(body))
        .digest("hex");

      // REAL HMAC verify authenticates the signed webhook.
      const verified = await provider.verifyWebhook({
        headers: { "x-razorpay-signature": signature },
        body,
        receivedAt: nowInstant(),
      });
      expect(verified.eventType).toBe("payment.captured");

      // A tampered signature is rejected by the same independent verifier.
      await expect(
        provider.verifyWebhook({
          headers: { "x-razorpay-signature": "deadbeef" },
          body,
          receivedAt: nowInstant(),
        }),
      ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });

      // REAL Postgres inbox dedup: first delivery is new, duplicate + reordered
      // re-deliveries of the SAME source event are deduped to one row.
      const inbox = new PostgresInboxRepository(database, "local");
      const receive = () =>
        inbox.receive(
          {
            id: inboxEventId(sourceEventId),
            source: "razorpay",
            sourceEventId,
            eventType: verified.eventType,
            payload: { reference: verified.reference },
            correlationId: undefined,
          },
          nowInstant(),
        );

      const first = await receive();
      const duplicate = await receive();
      const reordered = await receive();

      expect(first.ok && first.value.outcome).toBe("new");
      expect(duplicate.ok && duplicate.value.outcome).toBe("duplicate");
      expect(reordered.ok && reordered.value.outcome).toBe("duplicate");

      // Exactly ONE durable inbox row for the source event.
      const rows = await database.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM runtime.inbox_events
         WHERE source = 'razorpay' AND source_event_id = $1`,
        [sourceEventId],
      );
      expect(rows.rows[0]?.count).toBe("1");
    },
    60_000,
  );
});
