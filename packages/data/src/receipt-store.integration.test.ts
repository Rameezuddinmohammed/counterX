/**
 * Integration proof for PostgresReceiptStore, driven through the REAL
 * @counter/evidence issueReceipt pipeline (not a hand-built row) - proves
 * the exact seam the worker will use: issueReceipt(...) -> store.append(...)
 * -> a later store.getById/getLatestByTransactionAndAudience read returns
 * back a record that round-trips correctly through Postgres (branded
 * CounterId/Sha256Digest/Instant fields reconstructed, not just passed
 * through in memory).
 *
 * SKIPPED unless TEST_DATABASE_URL or DATABASE_URL is present (mirrors the
 * other *.integration.test.ts gates). SAFETY: every row is written under a
 * UNIQUE per-run transaction id (via createCounterId, real 128-bit entropy,
 * not a fixed literal) and, in afterAll, deletes ONLY those rows. It never
 * truncates, drops, or migrates the shared schema.
 */
import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { CounterId, Instant } from "@counter/domain";
import { createCounterId } from "@counter/domain";
import type { CommercialTotals, ReceiptItem } from "@counter/trust-protocol";
import { createTestSignerA } from "@counter/trust-protocol";
import { issueReceipt } from "@counter/evidence";
import type { ReceiptIssuanceConfig, ReceiptIssuanceInput } from "@counter/evidence";
import { PostgresDatabase } from "./database.js";
import { PostgresReceiptStore } from "./receipt-store.js";

const databaseUrl =
  process.env["TEST_DATABASE_URL"]?.trim() || process.env["DATABASE_URL"]?.trim() || undefined;
const databaseDescribe = databaseUrl === undefined ? describe.skip : describe;
const databaseHookTimeout = 30_000;

function freshId<Kind extends "receipt" | "transaction">(kind: Kind): CounterId<Kind> {
  const result = createCounterId(kind, randomBytes(16));
  if (!result.ok) {
    throw new Error(`Failed to generate a fresh ${kind} id for this test run`);
  }
  return result.value;
}

const TEST_ITEMS: readonly ReceiptItem[] = [
  {
    item_id: "item-001",
    quantity: 1,
    unit_price_minor_units: 5000,
    total_minor_units: 5000,
    currency: "INR",
  },
];

const TEST_TOTALS: CommercialTotals = {
  subtotal_minor_units: 5000,
  tax_minor_units: 0,
  shipping_minor_units: 0,
  total_minor_units: 5000,
  currency: "INR",
};

const TEST_CONFIG: ReceiptIssuanceConfig = {
  issuer: "counter://test/issuer-a",
  environment: "sandbox",
  validityDurationMs: 3_600_000,
};

const TEST_NOW = Date.now() as Instant;

databaseDescribe("PostgresReceiptStore (DB-gated)", () => {
  const database = new PostgresDatabase(databaseUrl as string);
  const store = new PostgresReceiptStore(database, "local");
  const signer = createTestSignerA();

  const writtenTransactionIds: CounterId<"transaction">[] = [];

  afterAll(async () => {
    try {
      for (const transactionId of writtenTransactionIds) {
        await database.query(`DELETE FROM runtime.receipts WHERE transaction_id = $1`, [
          transactionId,
        ]);
      }
    } finally {
      await database.close();
    }
  }, databaseHookTimeout);

  function makeInput(
    transactionId: CounterId<"transaction">,
    overrides: Partial<ReceiptIssuanceInput> = {},
  ): ReceiptIssuanceInput {
    writtenTransactionIds.push(transactionId);
    return {
      transactionId,
      intentId: "intent-001",
      merchantId: "merchant-001",
      orchestrationPhase: "payment_confirmed",
      paymentState: "captured",
      orderState: "committed",
      fulfillmentState: "pending",
      returnState: undefined,
      items: TEST_ITEMS,
      commercialTotals: TEST_TOTALS,
      mandateDigest: "sha256:mandate-digest-placeholder",
      authorityDigest: "sha256:authority-digest-placeholder",
      policyDecisionDigest: "sha256:policy-decision-digest-placeholder",
      paymentAuthorizationClass: "card_on_file",
      paymentProviderState: "provider_captured",
      paymentEvidenceTime: "2025-01-15T10:00:00.000Z",
      orderEvidenceTime: "2025-01-15T10:01:00.000Z",
      fulfillmentEvidenceTime: undefined,
      refundState: undefined,
      refundEvidenceTime: undefined,
      findings: [],
      unresolvedLimitations: [],
      findingsSeverityCounts: {},
      assuranceLevel: "standard",
      evidenceRootDigest: "sha256:evidence-root-placeholder",
      ...overrides,
    };
  }

  it(
    "issues a receipt, persists it, and round-trips it back correctly",
    async () => {
      const transactionId = freshId("transaction");
      const receiptId = freshId("receipt");
      const input = makeInput(transactionId);

      const issued = await issueReceipt(
        input,
        "merchant",
        receiptId,
        signer,
        store,
        TEST_CONFIG,
        TEST_NOW,
      );
      expect(issued.ok).toBe(true);
      if (!issued.ok) {
        throw new Error("issueReceipt failed");
      }
      expect(issued.value.record.id).toBe(receiptId);
      expect(issued.value.record.version).toBe(1);

      const fetched = await store.getById(receiptId);
      expect(fetched).toBeDefined();
      expect(fetched?.id).toBe(receiptId);
      expect(fetched?.transactionId).toBe(transactionId);
      expect(fetched?.audience).toBe("merchant");
      expect(fetched?.version).toBe(1);
      expect(fetched?.canonicalCommitmentDigest).toBe(
        issued.value.record.canonicalCommitmentDigest,
      );
      expect(fetched?.signingKeyId).toBe(signer.kid);
      expect(fetched?.predecessorReceiptId).toBeUndefined();
      // The signed envelope round-trips through jsonb, not just an opaque blob.
      expect(fetched?.receiptEnvelope.payload.transaction_id).toBe(transactionId);
      expect(fetched?.receiptEnvelope.signature).toBeDefined();
    },
    databaseHookTimeout,
  );

  it(
    "refuses a duplicate id the same way InMemoryReceiptStore does",
    async () => {
      const transactionId = freshId("transaction");
      const receiptId = freshId("receipt");
      const input = makeInput(transactionId);

      const first = await issueReceipt(
        input,
        "merchant",
        receiptId,
        signer,
        store,
        TEST_CONFIG,
        TEST_NOW,
      );
      expect(first.ok).toBe(true);

      // Directly re-append the SAME record (bypassing issueReceipt's own
      // fresh-id generation) to prove the store itself rejects the duplicate.
      if (!first.ok) {
        throw new Error("first issuance failed");
      }
      const duplicate = await store.append(first.value.record);
      expect(duplicate.ok).toBe(false);
      if (!duplicate.ok) {
        expect(duplicate.error.code).toBe("CONFLICT");
      }
    },
    databaseHookTimeout,
  );

  it(
    "a second issuance for the same transaction+audience becomes version 2, chained to its predecessor",
    async () => {
      const transactionId = freshId("transaction");
      const firstReceiptId = freshId("receipt");
      const secondReceiptId = freshId("receipt");

      const first = await issueReceipt(
        makeInput(transactionId),
        "merchant",
        firstReceiptId,
        signer,
        store,
        TEST_CONFIG,
        TEST_NOW,
      );
      expect(first.ok).toBe(true);

      const second = await issueReceipt(
        makeInput(transactionId, { orderState: "fulfilled" }),
        "merchant",
        secondReceiptId,
        signer,
        store,
        TEST_CONFIG,
        TEST_NOW,
      );
      expect(second.ok).toBe(true);
      if (!second.ok) {
        throw new Error("second issuance failed");
      }
      expect(second.value.record.version).toBe(2);
      expect(second.value.record.predecessorReceiptId).toBe(firstReceiptId);

      const latest = await store.getLatestByTransactionAndAudience(transactionId, "merchant");
      expect(latest?.id).toBe(secondReceiptId);
      expect(latest?.version).toBe(2);

      const all = await store.getByTransactionAndAudience(transactionId, "merchant");
      expect(all).toHaveLength(2);
      expect(all.map((r) => r.version).sort()).toEqual([1, 2]);
    },
    databaseHookTimeout,
  );

  it(
    "keeps merchant and wallet audiences as independent version chains",
    async () => {
      const transactionId = freshId("transaction");
      const merchantReceiptId = freshId("receipt");
      const walletReceiptId = freshId("receipt");

      await issueReceipt(
        makeInput(transactionId),
        "merchant",
        merchantReceiptId,
        signer,
        store,
        TEST_CONFIG,
        TEST_NOW,
      );
      await issueReceipt(
        makeInput(transactionId),
        "wallet",
        walletReceiptId,
        signer,
        store,
        TEST_CONFIG,
        TEST_NOW,
      );

      const merchantLatest = await store.getLatestByTransactionAndAudience(
        transactionId,
        "merchant",
      );
      const walletLatest = await store.getLatestByTransactionAndAudience(transactionId, "wallet");
      expect(merchantLatest?.version).toBe(1);
      expect(walletLatest?.version).toBe(1);
      expect(merchantLatest?.id).toBe(merchantReceiptId);
      expect(walletLatest?.id).toBe(walletReceiptId);

      const byTransaction = await store.getByTransaction(transactionId);
      expect(byTransaction).toHaveLength(2);
    },
    databaseHookTimeout,
  );
});
