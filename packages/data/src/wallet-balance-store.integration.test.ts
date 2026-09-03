/**
 * Integration proof for PostgresWalletBalanceStore against the real
 * wallet.balances / wallet.balance_events tables (migration 0021).
 *
 * The concurrency tests below are the real point of this file: they prove,
 * against REAL Postgres row-locking (not a mock), that two concurrent calls
 * with the SAME idempotency reference can never both apply — this was a
 * genuine race in an earlier version of topUp()/debit() (the idempotency
 * check read wallet.balance_events BEFORE the lock/insert that actually
 * enforces uniqueness, so two concurrent calls could both observe "not yet
 * applied" and both mutate the balance). Fixed by moving the atomic claim
 * (topUp: the balance_events INSERT itself; debit: the FOR UPDATE lock)
 * before the idempotency check, not after.
 *
 * SKIPPED unless TEST_DATABASE_URL or DATABASE_URL is present (mirrors the
 * other *.integration.test.ts gates). SAFETY: every row is written under a
 * UNIQUE per-run wallet id (via createCounterId, real 128-bit entropy) and,
 * in afterAll, deletes ONLY those rows. It never truncates, drops, or
 * migrates the shared schema.
 */
import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createCounterId } from "@counter/domain";
import type { CounterId } from "@counter/domain";
import { PostgresDatabase } from "./database.js";
import { PostgresWalletBalanceStore } from "./wallet-balance-store.js";

const databaseUrl =
  process.env["TEST_DATABASE_URL"]?.trim() || process.env["DATABASE_URL"]?.trim() || undefined;
const databaseDescribe = databaseUrl === undefined ? describe.skip : describe;
const databaseHookTimeout = 30_000;

function freshWalletId(): CounterId<"wallet"> {
  const result = createCounterId("wallet", randomBytes(16));
  if (!result.ok) {
    throw new Error("Failed to generate a fresh wallet id");
  }
  return result.value;
}

databaseDescribe("PostgresWalletBalanceStore (real Postgres)", () => {
  const database = new PostgresDatabase(databaseUrl as string);
  const store = new PostgresWalletBalanceStore(database, "test");
  const writtenWalletIds: string[] = [];

  afterAll(async () => {
    for (const walletId of writtenWalletIds) {
      await database.query(
        `DELETE FROM wallet.balance_events WHERE environment = 'test' AND wallet_id = $1`,
        [walletId],
      );
      await database.query(
        `DELETE FROM wallet.balances WHERE environment = 'test' AND wallet_id = $1`,
        [walletId],
      );
      await database.query(
        `DELETE FROM wallet.scopes WHERE environment = 'test' AND wallet_id = $1`,
        [walletId],
      );
      await database.query(
        `DELETE FROM identity.scope_registry WHERE environment = 'test' AND scope_id = $1`,
        [walletId],
      );
    }
    await database.close();
  }, databaseHookTimeout);

  async function seedWallet(): Promise<string> {
    const walletId = freshWalletId();
    const now = new Date().toISOString();
    await database.query(
      `INSERT INTO identity.scope_registry (environment, scope_kind, scope_id, created_at)
       VALUES ('test', 'wallet', $1, $2)`,
      [walletId, now],
    );
    await database.query(
      `INSERT INTO wallet.scopes (environment, wallet_id, created_at) VALUES ('test', $1, $2)`,
      [walletId, now],
    );
    writtenWalletIds.push(walletId);
    return walletId;
  }

  it(
    "credits, then debits, and getBalance reflects the real committed state",
    async () => {
      const walletId = await seedWallet();

      const topUp = await store.topUp({
        walletId,
        reference: `pay_${walletId}_topup1`,
        amountMinor: 500_000n,
        currency: "INR",
        providerPaymentId: `pay_${walletId}_topup1`,
      });
      expect(topUp.ok).toBe(true);
      if (topUp.ok) {
        expect(topUp.value.alreadyApplied).toBe(false);
        expect(topUp.value.balanceMinor).toBe(500_000n);
      }
      expect(await store.getBalance(walletId)).toBe(500_000n);

      const debit = await store.debit({
        walletId,
        reference: `txn_${walletId}_1`,
        amountMinor: 49_900n,
        currency: "INR",
      });
      expect(debit.ok).toBe(true);
      if (debit.ok && debit.value.allowed) {
        expect(debit.value.alreadyDebited).toBe(false);
        expect(debit.value.balanceMinor).toBe(450_100n);
      }
      expect(await store.getBalance(walletId)).toBe(450_100n);
    },
    databaseHookTimeout,
  );

  it(
    "declines a debit that exceeds the balance, with zero balance change",
    async () => {
      const walletId = await seedWallet();
      await store.topUp({
        walletId,
        reference: `pay_${walletId}_topup1`,
        amountMinor: 500_000n,
        currency: "INR",
        providerPaymentId: `pay_${walletId}_topup1`,
      });

      const overResult = await store.debit({
        walletId,
        reference: `txn_${walletId}_over`,
        amountMinor: 750_000n,
        currency: "INR",
      });
      expect(overResult.ok).toBe(true);
      if (overResult.ok) {
        expect(overResult.value.allowed).toBe(false);
        if (!overResult.value.allowed) {
          expect(overResult.value.code).toBe("INSUFFICIENT_BALANCE");
        }
      }
      expect(await store.getBalance(walletId)).toBe(500_000n);
    },
    databaseHookTimeout,
  );

  it(
    "is idempotent: replaying the SAME topUp reference sequentially never double-credits",
    async () => {
      const walletId = await seedWallet();
      const reference = `pay_${walletId}_replay`;

      const first = await store.topUp({
        walletId,
        reference,
        amountMinor: 500_000n,
        currency: "INR",
        providerPaymentId: reference,
      });
      const second = await store.topUp({
        walletId,
        reference,
        amountMinor: 500_000n,
        currency: "INR",
        providerPaymentId: reference,
      });

      expect(first.ok && !first.value.alreadyApplied).toBe(true);
      expect(second.ok && second.value.alreadyApplied).toBe(true);
      expect(await store.getBalance(walletId)).toBe(500_000n);
    },
    databaseHookTimeout,
  );

  it(
    "CONCURRENCY: N simultaneous topUp() calls with the SAME reference credit the wallet exactly ONCE",
    async () => {
      const walletId = await seedWallet();
      const reference = `pay_${walletId}_concurrent`;
      const CONCURRENT_CALLS = 8;

      const results = await Promise.all(
        Array.from({ length: CONCURRENT_CALLS }, () =>
          store.topUp({
            walletId,
            reference,
            amountMinor: 500_000n,
            currency: "INR",
            providerPaymentId: reference,
          }),
        ),
      );

      for (const result of results) {
        expect(result.ok).toBe(true);
      }
      const appliedCount = results.filter((r) => r.ok && !r.value.alreadyApplied).length;
      // Exactly one caller must have been the real applier; every other
      // racing call must observe alreadyApplied === true.
      expect(appliedCount).toBe(1);

      // The real, authoritative proof: the DB balance itself reflects
      // exactly ONE credit, not CONCURRENT_CALLS credits.
      expect(await store.getBalance(walletId)).toBe(500_000n);
    },
    databaseHookTimeout,
  );

  it(
    "CONCURRENCY: N simultaneous debit() calls with the SAME reference debit the wallet exactly ONCE",
    async () => {
      const walletId = await seedWallet();
      await store.topUp({
        walletId,
        reference: `pay_${walletId}_topup1`,
        amountMinor: 500_000n,
        currency: "INR",
        providerPaymentId: `pay_${walletId}_topup1`,
      });

      const reference = `txn_${walletId}_concurrent`;
      const CONCURRENT_CALLS = 8;

      const results = await Promise.all(
        Array.from({ length: CONCURRENT_CALLS }, () =>
          store.debit({
            walletId,
            reference,
            amountMinor: 49_900n,
            currency: "INR",
          }),
        ),
      );

      for (const result of results) {
        expect(result.ok).toBe(true);
      }
      const appliedCount = results.filter(
        (r) => r.ok && r.value.allowed && !r.value.alreadyDebited,
      ).length;
      expect(appliedCount).toBe(1);

      // 500,000 - 49,900 = 450,100 — proves exactly one debit reached the DB,
      // not CONCURRENT_CALLS debits (which would drive the balance negative
      // or trip the CHECK constraint).
      expect(await store.getBalance(walletId)).toBe(450_100n);
    },
    databaseHookTimeout,
  );

  it(
    "CONCURRENCY: simultaneous debits for DIFFERENT references never both succeed past the balance",
    async () => {
      const walletId = await seedWallet();
      await store.topUp({
        walletId,
        reference: `pay_${walletId}_topup1`,
        amountMinor: 500_000n,
        currency: "INR",
        providerPaymentId: `pay_${walletId}_topup1`,
      });

      // Two DIFFERENT-reference debits, each individually within the
      // balance, but their SUM exceeds it — real row locking must
      // serialize them so at most one succeeds.
      const [first, second] = await Promise.all([
        store.debit({
          walletId,
          reference: `txn_${walletId}_a`,
          amountMinor: 300_000n,
          currency: "INR",
        }),
        store.debit({
          walletId,
          reference: `txn_${walletId}_b`,
          amountMinor: 300_000n,
          currency: "INR",
        }),
      ]);

      const succeeded = [first, second].filter((r) => r.ok && r.value.allowed);
      const declined = [first, second].filter((r) => r.ok && !r.value.allowed);
      expect(succeeded).toHaveLength(1);
      expect(declined).toHaveLength(1);
      expect(await store.getBalance(walletId)).toBe(200_000n);
    },
    databaseHookTimeout,
  );
});
