/**
 * Integration proof that TransactionReadModel.get() enforces buyer-wallet
 * ownership when a `callerWalletId` is supplied — the fix for a real gap
 * found while allowing wallet-scoped callers onto the merchant runtime
 * routes (see merchant-routes.ts's verifyTenantAccess): a wallet-scoped
 * buyer must not be able to read or act on another buyer's transaction just
 * by knowing/guessing its transactionId.
 *
 * SKIPPED unless TEST_DATABASE_URL or DATABASE_URL is present (mirrors
 * every other *.integration.test.ts gate in this repo). SAFETY: every row
 * is written under a unique per-run id; afterAll deletes only those rows.
 * Never truncates, drops, or migrates the shared schema.
 */
import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createCounterId } from "@counter/domain";
import type { Environment } from "@counter/domain";
import { PostgresDatabase } from "@counter/data";
import { TransactionReadModel } from "./transaction-read-model.js";

const databaseUrl =
  process.env["TEST_DATABASE_URL"]?.trim() || process.env["DATABASE_URL"]?.trim() || undefined;
const databaseDescribe = databaseUrl === undefined ? describe.skip : describe;
const databaseHookTimeout = 30_000;
const ENVIRONMENT: Environment = "test";
const MERCHANT_ID = "ctr_merchant_AAAAAAAAAAAAAAAAAAAAAA";

function freshTransactionId(): string {
  const result = createCounterId("transaction", randomBytes(16));
  if (!result.ok) throw new Error("Failed to generate a fresh transaction id");
  return result.value;
}

databaseDescribe(
  "TransactionReadModel — buyer-wallet ownership enforcement (real Postgres)",
  () => {
    const database = new PostgresDatabase(databaseUrl as string);
    const readModel = new TransactionReadModel(database, ENVIRONMENT);
    const writtenIntentIds: string[] = [];

    afterAll(async () => {
      for (const id of writtenIntentIds) {
        await database.query(`DELETE FROM runtime.workflow_intents WHERE id = $1`, [id]);
      }
    }, databaseHookTimeout);

    async function seedIntent(
      transactionId: string,
      authorityContext: Record<string, unknown>,
    ): Promise<void> {
      const intentId = `test-intent-${randomBytes(8).toString("hex")}`;
      writtenIntentIds.push(intentId);
      await database.query(
        `INSERT INTO runtime.workflow_intents
         (id, transaction_id, environment, scope_kind, scope_id, command_type, command_digest, authority_context, status)
       VALUES ($1, $2, $3, 'merchant', $4, 'test.command', 'test-digest', $5, 'completed')`,
        [intentId, transactionId, ENVIRONMENT, MERCHANT_ID, JSON.stringify(authorityContext)],
      );
    }

    it(
      "a caller supplying the transaction's own bound buyer walletId can read it",
      async () => {
        const transactionId = freshTransactionId();
        const buyerWalletId = "ctr_wallet_BUYER0000000000000000000";
        await seedIntent(transactionId, { amountMinor: 12_345, walletId: buyerWalletId });

        const record = await readModel.get(transactionId, MERCHANT_ID, buyerWalletId);
        expect(record).toBeDefined();
        expect(record?.transactionId).toBe(transactionId);
      },
      databaseHookTimeout,
    );

    it(
      "a different wallet's id gets undefined (existence-hiding, not a 403)",
      async () => {
        const transactionId = freshTransactionId();
        const buyerWalletId = "ctr_wallet_BUYER1111111111111111111";
        const otherWalletId = "ctr_wallet_INTRUDER22222222222222222";
        await seedIntent(transactionId, { amountMinor: 12_345, walletId: buyerWalletId });

        const record = await readModel.get(transactionId, MERCHANT_ID, otherWalletId);
        expect(record).toBeUndefined();
      },
      databaseHookTimeout,
    );

    it(
      "a caller with no callerWalletId (merchant/platform) still reads it, unaffected",
      async () => {
        const transactionId = freshTransactionId();
        const buyerWalletId = "ctr_wallet_BUYER2222222222222222222";
        await seedIntent(transactionId, { amountMinor: 12_345, walletId: buyerWalletId });

        const record = await readModel.get(transactionId, MERCHANT_ID);
        expect(record).toBeDefined();
      },
      databaseHookTimeout,
    );

    it(
      "a transaction with no real bound buyer wallet (falls back to merchantId) is unreadable by any wallet caller",
      async () => {
        const transactionId = freshTransactionId();
        // Mirrors transactionCreate's own fallback: `walletId: buyerWalletId ?? ctx.merchantId`
        // for a transaction created without a real signed buyer envelope.
        await seedIntent(transactionId, { amountMinor: 12_345, walletId: MERCHANT_ID });

        const record = await readModel.get(
          transactionId,
          MERCHANT_ID,
          "ctr_wallet_ANYONE000000000000000000",
        );
        expect(record).toBeUndefined();
      },
      databaseHookTimeout,
    );
  },
);
