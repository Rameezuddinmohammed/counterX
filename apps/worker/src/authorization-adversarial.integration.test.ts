/**
 * PRIORITY 2 — Authorization adversarial proofs against the REAL path.
 *
 * Drives the REAL worker money seam (createRealPaymentAuthorizationPort with
 * real Shopify + Razorpay connectors) through the PRODUCTION authorization
 * policy — the exact `createProductionPolicy` the deployed worker wires via
 * boot.ts — and asserts every denial produces DENY WITH ZERO EXTERNAL EFFECT
 * for: amount over the per-transaction limit; cumulative over the rolling 24h
 * limit; a revoked mandate; an expired mandate; an expired authorization; a
 * wrong merchant scope; and a tampered amount (amount != quote).
 *
 * Unlike inline test predicates, each case here feeds the deployed policy an
 * authority envelope and lets the REAL policy make the call, so the proof binds
 * to enforced production behavior (review issues 2 and 5). The per-transaction /
 * rolling-limit decisions run through the REAL enforceTransactionLimits. In
 * EVERY case the decision runs BEFORE any external effect, so the assertions
 * are: (a) the outcome is declined; (b) the Shopify connector spy recorded ZERO
 * effectful calls; (c) the durable step ledger has ZERO rows for the key.
 *
 * SKIPPED unless SHOPIFY_ACCESS_TOKEN + RAZORPAY_KEY_ID + a database URL are
 * present. SAFETY: touches only its own runtime.lifecycle_steps rows (unique
 * key) and never drops/migrates the schema. SECURITY: creds from env only.
 */
import { DEFAULT_LIMIT_CONFIG, InMemoryTransactionLedger } from "@counter/payment-sdk";
import { PostgresDatabase, PostgresStepLedger } from "@counter/data";
import { afterAll, describe, expect, it } from "vitest";

import { createPostgresStepLedgerPort } from "./boot.js";
import { createProductionPolicy, __testing as policyTesting } from "./lifecycle-policy.js";
import { createRealPaymentAuthorizationPort } from "./real-lifecycle.js";
import type { AuthorityEnvelope, PaymentAuthorizationRequest } from "./transaction-lifecycle.js";
import {
  databaseUrl,
  hasCreds,
  ledgerRowCount,
  realBundleOrNull,
  RUNTIME_DDL,
  spyOnShopify,
  type SpyConnector,
} from "./adversarial-test-support.js";

const gatedDescribe = hasCreds ? describe : describe.skip;

gatedDescribe("authorization adversarial — DENY with zero external effect (creds+DB-gated)", () => {
  const database = new PostgresDatabase(databaseUrl as string);
  const bundle = realBundleOrNull();
  const keys: string[] = [];
  const operatingMerchantId = bundle !== null ? String(bundle.merchantId) : "";

  const uniqueKey = (label: string): string => {
    const key = `adv-authz-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    keys.push(key);
    return key;
  };

  afterAll(async () => {
    try {
      for (const key of keys) {
        await database.query(`DELETE FROM runtime.lifecycle_steps WHERE idempotency_key = $1`, [
          key,
        ]);
      }
    } finally {
      await database.close();
    }
  });

  /**
   * Runs the real port with the PRODUCTION policy against a request the policy
   * must DENY, asserting zero external effect. The authority envelope drives the
   * real predicate; `ledger` seeds the rolling-window check when supplied.
   */
  async function assertDeniedNoEffect(
    key: string,
    request: {
      readonly amountMinor: number;
      readonly authority?: AuthorityEnvelope | undefined;
    },
    ledger?: InMemoryTransactionLedger,
  ): Promise<SpyConnector> {
    await database.query(RUNTIME_DDL);
    await database.query(`DELETE FROM runtime.lifecycle_steps WHERE idempotency_key = $1`, [key]);

    const spy = spyOnShopify(bundle!.shopify);
    const policy = createProductionPolicy({
      operatingMerchantId,
      ...(ledger !== undefined ? { ledger } : {}),
    });
    const port = createRealPaymentAuthorizationPort({
      shopify: spy.connector,
      razorpay: bundle!.razorpay,
      payments: bundle!.payments,
      merchantId: bundle!.merchantId,
      stepLedger: createPostgresStepLedgerPort(new PostgresStepLedger(database, "local")),
      policy,
      actionTimeoutMs: 20_000,
    });

    const variantId = process.env["SHOPIFY_TEST_VARIANT_GID"];
    const authReq: PaymentAuthorizationRequest = {
      transactionId: "ctr_txn_advauthz" as PaymentAuthorizationRequest["transactionId"],
      amountMinor: request.amountMinor,
      currency: "INR",
      idempotencyKey: key,
      ...(variantId !== undefined ? { variantId } : {}),
      quantity: 1,
      ...(request.authority !== undefined ? { authority: request.authority } : {}),
    };

    const result = await port.authorizeAndCapture(authReq);

    // (a) Declined outcome, (b) ZERO Shopify effect, (c) ZERO ledger rows —
    //     so NO Shopify order and NO Razorpay order were ever created.
    expect(result.status).toBe("declined");
    expect(result.providerReference.startsWith("policy-declined:")).toBe(true);
    expect(spy.calls.draft).toBe(0);
    expect(spy.calls.finalize).toBe(0);
    expect(spy.calls.markPaid).toBe(0);
    expect(await ledgerRowCount(database, key)).toBe(0);
    return spy;
  }

  it("denies an amount OVER the per-transaction limit — no effect (real policy + enforceTransactionLimits)", async () => {
    const over = Number(DEFAULT_LIMIT_CONFIG.maxTransactionAmountMinor + 1n);
    await assertDeniedNoEffect(uniqueKey("overtxn"), { amountMinor: over });
  }, 120_000);

  it("denies when cumulative is OVER the rolling 24h limit — no effect (real policy + real ledger)", async () => {
    const walletRef = "adv-wallet-rolling";
    const ledger = new InMemoryTransactionLedger();
    // Seed the SAME derived wallet the policy uses to the rolling ceiling.
    ledger.recordAttempt({
      walletId: policyTesting.deriveWalletId(walletRef),
      amountMinor: DEFAULT_LIMIT_CONFIG.maxRolling24hTotalMinor,
      timestamp: Date.now() as never,
      idempotencyKey: "adv-seed-rolling",
    });
    await assertDeniedNoEffect(
      uniqueKey("overrolling"),
      { amountMinor: 100, authority: { walletId: walletRef } },
      ledger,
    );
  }, 120_000);

  it("blocks a REVOKED mandate — no effect (real policy)", async () => {
    await assertDeniedNoEffect(uniqueKey("revoked"), {
      amountMinor: 100,
      authority: { revokedAtMs: Date.now() - 60_000 },
    });
  }, 120_000);

  it("denies an EXPIRED mandate — no effect (real policy)", async () => {
    await assertDeniedNoEffect(uniqueKey("expmandate"), {
      amountMinor: 100,
      authority: { mandateExpiresAtMs: Date.now() - 60_000 },
    });
  }, 120_000);

  it("denies an EXPIRED authorization — no effect (real policy)", async () => {
    await assertDeniedNoEffect(uniqueKey("expauth"), {
      amountMinor: 100,
      authority: { authorizationExpiresAtMs: Date.now() - 1 },
    });
  }, 120_000);

  it("denies a WRONG merchant scope — no effect (real policy)", async () => {
    await assertDeniedNoEffect(uniqueKey("wrongscope"), {
      amountMinor: 100,
      authority: { authorizedMerchantId: "ctr_merchant_unauthorized" },
    });
  }, 120_000);

  it("denies a TAMPERED amount (amount != quote) — no effect (real policy)", async () => {
    await assertDeniedNoEffect(uniqueKey("quotetamper"), {
      amountMinor: 200,
      authority: { quotedAmountMinor: 100 },
    });
  }, 120_000);
});
