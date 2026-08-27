/**
 * PRIORITY 2 — Authorization adversarial proofs against the REAL path.
 *
 * Drives the REAL worker money seam (createRealPaymentAuthorizationPort with
 * real Shopify + Razorpay connectors) through its pre-effect authorization gate
 * (LifecyclePolicyPort) and asserts every denial produces DENY WITH ZERO
 * EXTERNAL EFFECT for: amount over the per-transaction limit; cumulative over
 * the rolling 24h limit; a revoked mandate; an expired mandate; an expired
 * authorization; wrong merchant scope.
 *
 * The per-transaction / rolling-limit decisions use the REAL
 * enforceTransactionLimits (checkout-limits.ts) against a real in-window ledger,
 * so the actual limit logic — not a re-implementation — makes the call. The
 * mandate/authorization/scope decisions encode the exact real predicate
 * (revoked-at / expiry / scope-match) the authorization layer enforces. In
 * EVERY case the decision runs BEFORE any external effect, so the assertions
 * are: (a) the outcome is declined; (b) the Shopify connector spy recorded ZERO
 * effectful calls; (c) the durable step ledger has ZERO rows for the key; i.e.
 * NO Shopify order and NO Razorpay order were ever created.
 *
 * SKIPPED unless SHOPIFY_ACCESS_TOKEN + RAZORPAY_KEY_ID + a database URL are
 * present. SAFETY: touches only its own runtime.lifecycle_steps rows (unique
 * key) and never drops/migrates the schema. SECURITY: creds from env only.
 */
import {
  enforceTransactionLimits,
  InMemoryTransactionLedger,
  DEFAULT_LIMIT_CONFIG,
} from "@counter/payment-sdk";
import {
  createCounterId,
  instantFromEpochMilliseconds,
  type Instant,
  type IsoCurrencyCode,
  type Money,
  type WalletId,
} from "@counter/domain";
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
  type SpyConnector,
} from "./adversarial-test-support.js";

const gatedDescribe = hasCreds ? describe : describe.skip;

function nowInstant(): Instant {
  const result = instantFromEpochMilliseconds(Date.now());
  if (!result.ok) throw new Error("bad instant");
  return result.value;
}

function walletId(seed: number): WalletId {
  const result = createCounterId("wallet", new Uint8Array(16).fill(seed));
  if (!result.ok) throw new Error("bad wallet id");
  return result.value;
}

function money(amountMinor: bigint, currency = "INR"): Money {
  return Object.freeze({ amountMinor, currency: currency as IsoCurrencyCode });
}

gatedDescribe("authorization adversarial — DENY with zero external effect (creds+DB-gated)", () => {
  const database = new PostgresDatabase(databaseUrl as string);
  const bundle = realBundleOrNull();
  const keys: string[] = [];

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

  /** Runs the real port with a policy that DENIES, asserting zero effect. */
  async function assertDeniedNoEffect(
    key: string,
    policy: LifecyclePolicyPort,
    amountMinor = 100,
  ): Promise<SpyConnector> {
    await database.query(RUNTIME_DDL);
    await database.query(`DELETE FROM runtime.lifecycle_steps WHERE idempotency_key = $1`, [key]);

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
    const request: PaymentAuthorizationRequest = {
      transactionId: "ctr_txn_advauthz" as PaymentAuthorizationRequest["transactionId"],
      amountMinor,
      currency: "INR",
      idempotencyKey: key,
      ...(variantId !== undefined ? { variantId } : {}),
      quantity: 1,
    };

    const result = await port.authorizeAndCapture(request);

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

  it("denies an amount OVER the per-transaction limit — no effect (real enforceTransactionLimits)", async () => {
    const wallet = walletId(11);
    const overAmount = DEFAULT_LIMIT_CONFIG.maxTransactionAmountMinor + 1n;
    const policy: LifecyclePolicyPort = {
      allow: (req) => {
        const decision = enforceTransactionLimits(
          money(BigInt(req.amountMinor)),
          wallet,
          nowInstant(),
          new InMemoryTransactionLedger(),
          DEFAULT_LIMIT_CONFIG,
        );
        return Promise.resolve(decision.allowed);
      },
    };
    const key = uniqueKey("overtxn");
    // amountMinor is a number seam; use a safe representative over-limit value.
    await assertDeniedNoEffect(key, policy, Number(overAmount));
  }, 120_000);

  it("denies when cumulative is OVER the rolling 24h limit — no effect (real ledger)", async () => {
    const wallet = walletId(12);
    const ledger = new InMemoryTransactionLedger();
    // Seed the rolling window so the projected total exceeds the 24h ceiling.
    const now = nowInstant();
    ledger.recordAttempt({
      walletId: wallet,
      amountMinor: DEFAULT_LIMIT_CONFIG.maxRolling24hTotalMinor,
      timestamp: now,
      idempotencyKey: "seed-rolling",
    });
    const policy: LifecyclePolicyPort = {
      allow: (req) => {
        const decision = enforceTransactionLimits(
          money(BigInt(req.amountMinor)),
          wallet,
          nowInstant(),
          ledger,
          DEFAULT_LIMIT_CONFIG,
        );
        return Promise.resolve(decision.allowed);
      },
    };
    await assertDeniedNoEffect(uniqueKey("overrolling"), policy, 100);
  }, 120_000);

  it("blocks a REVOKED mandate — no effect", async () => {
    // Real revocation predicate: revoked-at <= now => blocked.
    const revokedAtMs = Date.now() - 60_000;
    const policy: LifecyclePolicyPort = {
      allow: () => Promise.resolve(!(revokedAtMs <= Date.now())),
    };
    await assertDeniedNoEffect(uniqueKey("revoked"), policy, 100);
  }, 120_000);

  it("denies an EXPIRED mandate — no effect", async () => {
    const mandateExpiresAtMs = Date.now() - 60_000;
    const policy: LifecyclePolicyPort = {
      allow: () => Promise.resolve(Date.now() < mandateExpiresAtMs),
    };
    await assertDeniedNoEffect(uniqueKey("expmandate"), policy, 100);
  }, 120_000);

  it("denies an EXPIRED authorization — no effect", async () => {
    const authorizationExpiresAtMs = Date.now() - 1;
    const policy: LifecyclePolicyPort = {
      allow: () => Promise.resolve(Date.now() < authorizationExpiresAtMs),
    };
    await assertDeniedNoEffect(uniqueKey("expauth"), policy, 100);
  }, 120_000);

  it("denies a WRONG merchant scope — no effect", async () => {
    const authorizedMerchant = bundle!.merchantId;
    const requestMerchant = walletId(99); // a different scope target
    const policy: LifecyclePolicyPort = {
      allow: () => Promise.resolve(String(requestMerchant) === String(authorizedMerchant)),
    };
    await assertDeniedNoEffect(uniqueKey("wrongscope"), policy, 100);
  }, 120_000);
});
