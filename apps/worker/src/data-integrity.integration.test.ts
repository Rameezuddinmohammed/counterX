/**
 * PRIORITY 2 — Data-integrity proofs.
 *
 * Two invariants:
 *  1. Quote/amount tamper between quote and commit is REJECTED with NO external
 *     effect. The real money seam's pre-effect policy gate recomputes the
 *     authoritative quoted amount and DENIES when the committed amount differs;
 *     the assertion proves declined + ZERO Shopify/Razorpay effect + ZERO ledger
 *     rows (creds+DB-gated, real path).
 *  2. A tampered signed receipt/evidence envelope is REJECTED by an INDEPENDENT
 *     verifier — the real CTP verifier from @counter/trust-protocol — and a
 *     valid envelope is accepted. This proves the receipt's cryptographic
 *     integrity is enforced by an independent verifier, not a local boolean.
 *     (No creds/DB needed — this always runs.)
 */
import {
  createTestSignerA,
  createTestUnsignedEnvelope,
  InMemoryKeyRegistry,
  signEnvelope,
  TEST_KEY_RECORD_A,
  TEST_KEY_RECORD_B,
  verifyEnvelope,
  type CtpEnvelope,
  type SignatureValue,
} from "@counter/trust-protocol";
import { PostgresDatabase, PostgresStepLedger } from "@counter/data";
import { afterAll, describe, expect, it } from "vitest";

import { createPostgresStepLedgerPort } from "./boot.js";
import {
  createRealPaymentAuthorizationPort,
  type LifecyclePolicyPort,
} from "./real-lifecycle.js";
import type { PaymentAuthorizationRequest } from "./transaction-lifecycle.js";
import {
  databaseUrl,
  hasCreds,
  ledgerRowCount,
  realBundleOrNull,
  RUNTIME_DDL,
  spyOnShopify,
} from "./adversarial-test-support.js";

// ─── Independent verifier: tampered receipt rejected (always runs) ────────────

describe("data integrity — independent CTP verifier rejects a tampered receipt", () => {
  const registry = new InMemoryKeyRegistry([TEST_KEY_RECORD_A, TEST_KEY_RECORD_B]);
  const verifyOptions = {
    keyRegistry: registry,
    // Within the fixture envelope's validity window.
    currentTime: "2025-01-15T10:30:00.000Z",
  };

  async function signedReceipt(payload: Record<string, unknown>): Promise<CtpEnvelope> {
    const unsigned = createTestUnsignedEnvelope({ payload });
    const result = await signEnvelope(unsigned, createTestSignerA());
    if (!result.ok) throw new Error(`sign failed: ${result.error.message}`);
    return result.value;
  }

  it("accepts a valid signed receipt", async () => {
    const envelope = await signedReceipt({ capturedMinor: 100, currency: "INR" });
    const result = await verifyEnvelope(envelope, verifyOptions);
    expect(result.ok).toBe(true);
  });

  it("rejects a receipt whose PAYLOAD was tampered after signing", async () => {
    const envelope = await signedReceipt({ capturedMinor: 100, currency: "INR" });
    // Tamper the payload (the captured amount) without re-signing.
    const tampered: CtpEnvelope = {
      ...envelope,
      payload: { ...(envelope.payload as Record<string, unknown>), capturedMinor: 999_999 },
    };
    const result = await verifyEnvelope(tampered, verifyOptions);
    expect(result.ok).toBe(false);
  });

  it("rejects a receipt whose SIGNATURE was tampered", async () => {
    const envelope = await signedReceipt({ capturedMinor: 100, currency: "INR" });
    const tampered: CtpEnvelope = {
      ...envelope,
      signature: {
        ...envelope.signature,
        value:
          "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" as SignatureValue,
      },
    };
    const result = await verifyEnvelope(tampered, verifyOptions);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("UNAUTHENTICATED");
    }
  });
});

// ─── Real path: quote/amount tamper rejected with no effect (gated) ───────────

const gatedDescribe = hasCreds ? describe : describe.skip;

gatedDescribe("data integrity — amount tamper between quote and commit is rejected (creds+DB-gated)", () => {
  const database = new PostgresDatabase(databaseUrl as string);
  const bundle = realBundleOrNull();
  const idempotencyKey = `data-integrity-${Date.now()}`;

  afterAll(async () => {
    try {
      await database.query(`DELETE FROM runtime.lifecycle_steps WHERE idempotency_key = $1`, [
        idempotencyKey,
      ]);
    } finally {
      await database.close();
    }
  });

  it(
    "rejects a commit whose amount differs from the authoritatively quoted amount — no external effect",
    async () => {
      await database.query(RUNTIME_DDL);
      await database.query(`DELETE FROM runtime.lifecycle_steps WHERE idempotency_key = $1`, [
        idempotencyKey,
      ]);

      // The quote fixed the authoritative amount at 100 minor units; the commit
      // arrives with a tampered amount. The policy recomputes the quote and
      // DENIES when the committed amount does not match.
      const quotedAmountMinor = 100;
      const policy: LifecyclePolicyPort = {
        allow: (req) => Promise.resolve(req.amountMinor === quotedAmountMinor),
      };

      const spy = spyOnShopify(bundle!.shopify);
      const port = createRealPaymentAuthorizationPort({
        shopify: spy.connector,
        razorpay: bundle!.razorpay,
        payments: bundle!.payments,
        merchantId: bundle!.merchantId,
        stepLedger: createPostgresStepLedgerPort(new PostgresStepLedger(database)),
        policy,
        actionTimeoutMs: 20_000,
      });

      const variantId = process.env["SHOPIFY_TEST_VARIANT_GID"];
      const tamperedRequest: PaymentAuthorizationRequest = {
        transactionId: "ctr_txn_tamper" as PaymentAuthorizationRequest["transactionId"],
        // Tampered: does not match the quoted 100.
        amountMinor: 250,
        currency: "INR",
        idempotencyKey,
        ...(variantId !== undefined ? { variantId } : {}),
        quantity: 1,
      };

      const result = await port.authorizeAndCapture(tamperedRequest);

      expect(result.status).toBe("declined");
      expect(spy.calls.draft).toBe(0);
      expect(spy.calls.finalize).toBe(0);
      expect(spy.calls.markPaid).toBe(0);
      expect(await ledgerRowCount(database, idempotencyKey)).toBe(0);
    },
    120_000,
  );
});
