/**
 * Integration proof for pending settlement AND for the two read-model fixes it
 * depends on, against a REAL Postgres (DB-gated, skipped without DATABASE_URL).
 *
 * transaction-projection.integration.test.ts already proves the happy-path
 * projection. It does NOT create the two conditions the read-model fixes are
 * about, so on its own it would let both fixes pass as "reasoned" rather than
 * observed. This file seeds those conditions deliberately:
 *
 *   TXN_DUP  — TWO runtime.workflow_intents rows for ONE transaction_id, AND TWO
 *              runtime.spend_ledger rows for that same reference under different
 *              wallets (which the ledger's (environment, wallet, reference) key
 *              allows).
 *
 *              How a duplicate intent can actually arise, established by
 *              execution rather than assumed: `workflow_intents_dedup` is UNIQUE
 *              on (environment, transaction_id, command_type, command_digest)
 *              — migration 0005 — so a plain re-drive of the SAME command is
 *              rejected by the database outright. That is the constraint doing
 *              its job. A second row therefore requires a different
 *              command_type or a different command_digest for the same
 *              transaction, which is what this seed uses. Narrower than "any
 *              retry", but real, and the 2026-08-27 review of this slice called
 *              it out in exactly those terms.
 *              Proves: listed once, not twice; amount is the SUM of both ledger
 *              rows, not an arbitrary one of them.
 *              The OLDER intent is deliberately status='failed' and the newer
 *              'completed', so if the dedup ever picked the wrong row the
 *              derived state would flip to 'failed' and this test would fail
 *              loudly rather than silently agreeing.
 *
 *   TXN_MID  — finalize but NO markPaid: money not collected, so it must NOT be
 *              counted toward what Counter owes the merchant.
 *
 *   TXN_OK   — an ordinary single-row settled transaction, with a non-round
 *              amount so a rupees-vs-paise slip would show up.
 *
 * Seeds under its own uniquely-suffixed merchant/transaction ids in the
 * 'sandbox' environment, and deletes exactly what it inserted. It never drops,
 * truncates, or migrates anything.
 */
import { afterAll, beforeAll, expect } from "vitest";
import { describe as vitestDescribe, it as vitestIt } from "vitest";
import { PostgresDatabase } from "@counter/data";
import { createPostgresTransactionStore } from "./transaction-store-postgres.js";

const databaseUrl = process.env["DATABASE_URL"];
const gatedDescribe = databaseUrl ? vitestDescribe : vitestDescribe.skip;

const TEST_ENV = "sandbox";
const RUN_ID = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const MERCHANT = `ctr_merchant_setl${RUN_ID}`;

const TXN_DUP = `ctr_txn_setl_dup_${RUN_ID}`;
const TXN_MID = `ctr_txn_setl_mid_${RUN_ID}`;
const TXN_OK = `ctr_txn_setl_ok_${RUN_ID}`;
const ALL_TXNS = [TXN_DUP, TXN_MID, TXN_OK];

const WALLET_A = `ctr_wallet_setlA${RUN_ID}`;
const WALLET_B = `ctr_wallet_setlB${RUN_ID}`;

// TXN_DUP is funded by two ledger rows; the SUM is what the merchant is owed.
const DUP_PART_1 = 100_000n; // ₹1,000.00
const DUP_PART_2 = 50_000n; // ₹500.00
const OK_AMOUNT = 24_550n; // ₹245.50 — deliberately not a round rupee figure
const MID_AMOUNT = 999_900n; // in flight, must be excluded entirely

const EXPECTED_PENDING = DUP_PART_1 + DUP_PART_2 + OK_AMOUNT; // 174550

// Distinct digests are what make two intents for one transaction insertable at
// all — see this file's header on workflow_intents_dedup.
const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;

gatedDescribe("pending settlement + read-model dedup/aggregate (DB-gated)", () => {
  const database = new PostgresDatabase(databaseUrl as string);

  beforeAll(async () => {
    const insertIntent = `INSERT INTO runtime.workflow_intents
        (id, transaction_id, environment, scope_kind, scope_id, command_type,
         command_digest, authority_context, status, created_at)
      VALUES ($1, $2, $3, 'merchant', $4, 'checkout', $8, $5, $6, $7::timestamptz)`;

    const insertStep = `INSERT INTO runtime.lifecycle_steps
        (environment, idempotency_key, step, status, reference, snapshot, created_at, completed_at)
      VALUES ($1, $2, $3, $4, $5, NULL, $6::timestamptz, $6::timestamptz)`;

    const insertLedger = `INSERT INTO runtime.spend_ledger
        (environment, wallet_id, reference, amount_minor, currency, spent_at)
      VALUES ($1, $2, $3, $4, 'INR', now())`;

    // --- TXN_DUP: two intents (older 'failed', newer 'completed') ---
    await database.query(insertIntent, [
      `wfi_dup_old_${RUN_ID}`,
      TXN_DUP,
      TEST_ENV,
      MERCHANT,
      JSON.stringify({ buyerRef: "buyer_setl", method: "upi" }),
      "failed",
      "2025-02-01T10:00:00.000Z",
      DIGEST_A,
    ]);
    await database.query(insertIntent, [
      `wfi_dup_new_${RUN_ID}`,
      TXN_DUP,
      TEST_ENV,
      MERCHANT,
      JSON.stringify({ buyerRef: "buyer_setl", method: "upi" }),
      "completed",
      "2025-02-01T11:00:00.000Z",
      DIGEST_B,
    ]);
    for (const [step, at] of [
      ["shopify.draft", "2025-02-01T11:01:00.000Z"],
      ["shopify.finalize", "2025-02-01T11:02:00.000Z"],
      ["shopify.markPaid", "2025-02-01T11:03:00.000Z"],
    ] as const) {
      await database.query(insertStep, [TEST_ENV, TXN_DUP, step, "completed", "ord_setl_dup", at]);
    }
    // Two ledger rows, same reference, different wallets.
    await database.query(insertLedger, [TEST_ENV, WALLET_A, TXN_DUP, DUP_PART_1.toString()]);
    await database.query(insertLedger, [TEST_ENV, WALLET_B, TXN_DUP, DUP_PART_2.toString()]);

    // --- TXN_MID: finalize but no markPaid (in flight) ---
    await database.query(insertIntent, [
      `wfi_mid_${RUN_ID}`,
      TXN_MID,
      TEST_ENV,
      MERCHANT,
      JSON.stringify({ buyerRef: "buyer_setl", method: "upi" }),
      "executing",
      "2025-02-02T10:00:00.000Z",
      DIGEST_A,
    ]);
    for (const [step, at] of [
      ["shopify.draft", "2025-02-02T10:01:00.000Z"],
      ["shopify.finalize", "2025-02-02T10:02:00.000Z"],
    ] as const) {
      await database.query(insertStep, [TEST_ENV, TXN_MID, step, "completed", "ord_setl_mid", at]);
    }
    await database.query(insertLedger, [TEST_ENV, WALLET_A, TXN_MID, MID_AMOUNT.toString()]);

    // --- TXN_OK: ordinary settled transaction ---
    await database.query(insertIntent, [
      `wfi_ok_${RUN_ID}`,
      TXN_OK,
      TEST_ENV,
      MERCHANT,
      JSON.stringify({ buyerRef: "buyer_setl", method: "upi" }),
      "completed",
      "2025-02-03T10:00:00.000Z",
      DIGEST_A,
    ]);
    for (const [step, at] of [
      ["shopify.draft", "2025-02-03T10:01:00.000Z"],
      ["shopify.finalize", "2025-02-03T10:02:00.000Z"],
      ["shopify.markPaid", "2025-02-03T10:03:00.000Z"],
    ] as const) {
      await database.query(insertStep, [TEST_ENV, TXN_OK, step, "completed", "ord_setl_ok", at]);
    }
    await database.query(insertLedger, [TEST_ENV, WALLET_A, TXN_OK, OK_AMOUNT.toString()]);
  }, 60_000);

  afterAll(async () => {
    try {
      for (const txn of ALL_TXNS) {
        await database.query(
          `DELETE FROM runtime.workflow_intents WHERE environment = $1 AND transaction_id = $2`,
          [TEST_ENV, txn],
        );
        await database.query(
          `DELETE FROM runtime.lifecycle_steps WHERE environment = $1 AND idempotency_key = $2`,
          [TEST_ENV, txn],
        );
        await database.query(
          `DELETE FROM runtime.spend_ledger WHERE environment = $1 AND reference = $2`,
          [TEST_ENV, txn],
        );
      }
    } finally {
      await database.close();
    }
  }, 60_000);

  vitestIt(
    "lists a duplicated-intent transaction exactly ONCE, keeping the newest intent",
    async () => {
      const store = createPostgresTransactionStore(database, TEST_ENV);
      const list = await store.list(MERCHANT, { limit: 50, offset: 0 }, TEST_ENV);

      // Three transactions were seeded across FOUR intent rows.
      expect(list).toHaveLength(3);
      const ids = list.map((t) => t.transactionId);
      expect(new Set(ids).size).toBe(3);
      expect(ids).toContain(TXN_DUP);

      // The newer ('completed', DIGEST_B) intent won: state comes from the
      // steps. Had the dedup kept the older 'failed' intent, this would be
      // 'failed' — so this assertion fails loudly on a wrong-row pick rather
      // than quietly agreeing.
      const dup = list.find((t) => t.transactionId === TXN_DUP);
      expect(dup?.currentState).toBe("settled");
    },
    60_000,
  );

  vitestIt(
    "sums every spend_ledger row for a reference instead of picking one",
    async () => {
      const store = createPostgresTransactionStore(database, TEST_ENV);
      const list = await store.list(MERCHANT, { limit: 50, offset: 0 }, TEST_ENV);
      const dup = list.find((t) => t.transactionId === TXN_DUP);

      // 100000 + 50000 = 150000 minor => 1500 major. Picking one row would have
      // produced 1000 or 500.
      expect(dup?.amount).toBe(1500);
    },
    60_000,
  );

  vitestIt(
    "totals ONLY collected (settled) transactions, in integer minor units",
    async () => {
      const store = createPostgresTransactionStore(database, TEST_ENV);
      const summary = await store.settlementSummary(MERCHANT, TEST_ENV);

      // TXN_DUP (150000, counted once despite two intents) + TXN_OK (24550).
      // TXN_MID's 999900 is in flight and must not appear.
      expect(summary.pendingMinor).toBe(EXPECTED_PENDING.toString());
      expect(summary.orderCount).toBe(2);
      expect(summary.currency).toBe("INR");
      expect(summary.truncated).toBe(false);
    },
    60_000,
  );

  vitestIt(
    "reports zero for a merchant that has collected nothing, rather than failing",
    async () => {
      const store = createPostgresTransactionStore(database, TEST_ENV);
      const summary = await store.settlementSummary(`ctr_merchant_none${RUN_ID}`, TEST_ENV);

      expect(summary.pendingMinor).toBe("0");
      expect(summary.orderCount).toBe(0);
      expect(summary.truncated).toBe(false);
    },
    60_000,
  );
});
