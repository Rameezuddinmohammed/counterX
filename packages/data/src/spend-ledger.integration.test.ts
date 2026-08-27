/**
 * Atomic-concurrency integration proof for the durable rolling-spend ledger.
 *
 * PROVES the cross-instance invariant that a per-process in-memory ledger cannot
 * enforce: two CONCURRENT reserveSpend calls that each fit under the rolling 24h
 * cap on their own, but whose SUM would breach it, converge to EXACTLY ONE
 * success and one denial with code "ROLLING_TOTAL_EXCEEDED". Because reserveSpend
 * locks the wallet's windowed rows FOR UPDATE inside a single DB transaction, the
 * two racers serialize and the loser observes the winner's committed row. The
 * guarantee is enforced by Postgres, not by application control flow.
 *
 * Also proves idempotency: retrying the SAME reference is an allowed no-op
 * (alreadyReserved:true) that does NOT double-count the window total.
 *
 * SKIPPED unless TEST_DATABASE_URL or DATABASE_URL is present (mirrors the other
 * *.integration.test.ts gates). This test needs ONLY a database URL; reserveSpend
 * touches Postgres alone and no payment credentials. SAFETY: it writes rows under a
 * UNIQUE per-run wallet id and, in afterAll, deletes ONLY those rows. It never
 * truncates, drops, or migrates the shared schema.
 */
import { afterAll, describe, expect, it } from "vitest";
import { DEFAULT_SPEND_LIMIT_CONFIG, PostgresSpendLedger } from "./spend-ledger.js";
import { PostgresDatabase } from "./database.js";

const databaseUrl =
  process.env["TEST_DATABASE_URL"]?.trim() || process.env["DATABASE_URL"]?.trim() || undefined;
const databaseDescribe = databaseUrl === undefined ? describe.skip : describe;
const databaseHookTimeout = 30_000;

databaseDescribe("PostgresSpendLedger - atomic concurrency + idempotency (DB-gated)", () => {
  const database = new PostgresDatabase(databaseUrl as string);
  const ledger = new PostgresSpendLedger(database);

  // Unique per-run wallet id so this test never collides with or reads any other
  // rows, and afterAll can delete exactly its own rows.
  const walletId = `spend-test-${Date.now()}`;
  // Fixed clock so every reservation lands in the SAME rolling 24h window.
  const nowMs = Date.now();

  afterAll(async () => {
    try {
      await database.query(`DELETE FROM runtime.spend_ledger WHERE wallet_id = $1`, [walletId]);
    } finally {
      await database.close();
    }
  }, databaseHookTimeout);

  it(
    "serializes two racing over-cap reserves to EXACTLY ONE success + ROLLING_TOTAL_EXCEEDED",
    async () => {
      const cfg = DEFAULT_SPEND_LIMIT_CONFIG;
      // Arithmetic: cap = 1_000_000, per-transaction ceiling = 500_000.
      // Pre-reserve 600_000 in TWO 300_000 reservations (a single 600_000 reserve
      // would trip the per-transaction ceiling of 500_000 before the rolling-window
      // logic ran). Each 300_000 <= 500_000, so both are allowed and together commit
      // 600_000. Then TWO concurrent reserves of 300_000 each: either one alone
      // brings the total to 900_000 (allowed, and 300_000 <= 500_000 so the
      // per-transaction ceiling is not tripped first), but BOTH would be 1_200_000
      // (> cap). So exactly one must win.
      expect(cfg.maxRolling24hTotalMinor).toBe(1_000_000n);
      expect(cfg.maxTransactionAmountMinor).toBe(500_000n);

      const priorA = await ledger.reserveSpend({
        walletId,
        reference: `${walletId}-prior-a`,
        amountMinor: 300_000n,
        currency: "INR",
        nowMs,
      });
      const priorB = await ledger.reserveSpend({
        walletId,
        reference: `${walletId}-prior-b`,
        amountMinor: 300_000n,
        currency: "INR",
        nowMs,
      });
      expect(priorA.ok).toBe(true);
      expect(priorB.ok).toBe(true);
      if (priorA.ok) {
        expect(priorA.value.allowed).toBe(true);
      }
      if (priorB.ok) {
        expect(priorB.value.allowed).toBe(true);
      }
      expect(await ledger.windowTotalMinor(walletId, nowMs)).toBe(600_000n);

      const raceAmount = 300_000n;
      const [first, second] = await Promise.all([
        ledger.reserveSpend({
          walletId,
          reference: `${walletId}-race-a`,
          amountMinor: raceAmount,
          currency: "INR",
          nowMs,
        }),
        ledger.reserveSpend({
          walletId,
          reference: `${walletId}-race-b`,
          amountMinor: raceAmount,
          currency: "INR",
          nowMs,
        }),
      ]);

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      if (!first.ok || !second.ok) {
        throw new Error("reserveSpend returned an unexpected error result");
      }

      const outcomes = [first.value, second.value];
      const allowed = outcomes.filter((o) => o.allowed);
      const denied = outcomes.filter((o) => !o.allowed);

      // EXACTLY ONE winner and one loser: the core cross-instance invariant.
      expect(allowed).toHaveLength(1);
      expect(denied).toHaveLength(1);

      const loser = denied[0];
      if (loser === undefined || loser.allowed) {
        throw new Error("expected exactly one denied outcome");
      }
      expect(loser.code).toBe("ROLLING_TOTAL_EXCEEDED");

      // The winner committed exactly one 300_000 reservation on top of the prior
      // 600_000; the loser committed nothing. Postgres, not the app, enforced it.
      expect(await ledger.windowTotalMinor(walletId, nowMs)).toBe(900_000n);
    },
    databaseHookTimeout,
  );

  it(
    "retrying the same reference is an idempotent no-op that does not double-count",
    async () => {
      const reference = `${walletId}-idem`;
      const amountMinor = 50_000n;

      const before = await ledger.windowTotalMinor(walletId, nowMs);

      const firstReserve = await ledger.reserveSpend({
        walletId,
        reference,
        amountMinor,
        currency: "INR",
        nowMs,
      });
      expect(firstReserve.ok).toBe(true);
      if (firstReserve.ok && firstReserve.value.allowed) {
        expect(firstReserve.value.alreadyReserved).toBe(false);
      } else {
        throw new Error("first reserve should be allowed");
      }
      const afterFirst = await ledger.windowTotalMinor(walletId, nowMs);
      expect(afterFirst).toBe(before + amountMinor);

      // Same reference again: allowed no-op, NOT re-counted.
      const retry = await ledger.reserveSpend({
        walletId,
        reference,
        amountMinor,
        currency: "INR",
        nowMs,
      });
      expect(retry.ok).toBe(true);
      if (retry.ok && retry.value.allowed) {
        expect(retry.value.alreadyReserved).toBe(true);
      } else {
        throw new Error("retry should be an allowed no-op");
      }

      // The window total did NOT increase on the retry.
      const afterRetry = await ledger.windowTotalMinor(walletId, nowMs);
      expect(afterRetry).toBe(afterFirst);
    },
    databaseHookTimeout,
  );
});
