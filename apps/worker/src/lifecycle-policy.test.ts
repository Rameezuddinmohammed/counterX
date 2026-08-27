/**
 * Deterministic unit tests for the production authorization policy.
 *
 * Proves the SAME policy the deployed worker wires (createProductionPolicy)
 * denies each real money predicate — amount-vs-quote tamper, revocation,
 * mandate/authorization expiry, wrong merchant scope, and over-limit via the
 * REAL enforceTransactionLimits — and allows a clean request. No network, no DB.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_LIMIT_CONFIG,
  InMemoryTransactionLedger,
} from "@counter/payment-sdk";
import { type Instant } from "@counter/domain";

import { createProductionPolicy, __testing } from "./lifecycle-policy.js";
import type { AuthorityEnvelope } from "./transaction-lifecycle.js";
import type { PaymentAuthorizationRequest } from "./transaction-lifecycle.js";

const MERCHANT = "ctr_merchant_operator";
const NOW = 1_000_000_000_000;

function req(
  amountMinor: number,
  authority?: AuthorityEnvelope,
): PaymentAuthorizationRequest {
  return {
    transactionId: "ctr_txn_policy" as PaymentAuthorizationRequest["transactionId"],
    amountMinor,
    currency: "INR",
    idempotencyKey: "policy-key",
    quantity: 1,
    ...(authority !== undefined ? { authority } : {}),
  };
}

function policy(overrides: Partial<Parameters<typeof createProductionPolicy>[0]> = {}) {
  return createProductionPolicy({
    operatingMerchantId: MERCHANT,
    now: () => NOW as Instant,
    ...overrides,
  });
}

describe("createProductionPolicy", () => {
  it("allows a clean, in-limit, in-scope, quoted, unexpired request", async () => {
    const p = policy();
    const allowed = await p.allow(
      req(100, {
        quotedAmountMinor: 100,
        authorizedMerchantId: MERCHANT,
        authorizationExpiresAtMs: NOW + 60_000,
        mandateExpiresAtMs: NOW + 60_000,
      }),
    );
    expect(allowed).toBe(true);
  });

  it("denies a TAMPERED amount (amount != quotedAmountMinor)", async () => {
    const p = policy();
    expect(await p.allow(req(200, { quotedAmountMinor: 100 }))).toBe(false);
  });

  it("denies a REVOKED mandate (revokedAtMs <= now)", async () => {
    const p = policy();
    expect(await p.allow(req(100, { revokedAtMs: NOW - 1 }))).toBe(false);
  });

  it("denies an EXPIRED mandate", async () => {
    const p = policy();
    expect(await p.allow(req(100, { mandateExpiresAtMs: NOW - 1 }))).toBe(false);
  });

  it("denies an EXPIRED authorization", async () => {
    const p = policy();
    expect(await p.allow(req(100, { authorizationExpiresAtMs: NOW - 1 }))).toBe(false);
  });

  it("denies a WRONG merchant scope", async () => {
    const p = policy();
    expect(await p.allow(req(100, { authorizedMerchantId: "ctr_merchant_other" }))).toBe(false);
  });

  it("denies an amount OVER the per-transaction limit (real enforceTransactionLimits)", async () => {
    const p = policy();
    const over = Number(DEFAULT_LIMIT_CONFIG.maxTransactionAmountMinor + 1n);
    expect(await p.allow(req(over))).toBe(false);
  });

  it("denies when the wallet rolling 24h total would be exceeded (real ledger)", async () => {
    const ledger = new InMemoryTransactionLedger();
    const walletRef = "wallet-abc";
    // Seed the SAME derived wallet the policy uses to the rolling ceiling.
    ledger.recordAttempt({
      walletId: __testing.deriveWalletId(walletRef),
      amountMinor: DEFAULT_LIMIT_CONFIG.maxRolling24hTotalMinor,
      timestamp: NOW as Instant,
      idempotencyKey: "seed-rolling",
    });
    const p = policy({ ledger });
    // Any further spend on that wallet is over the rolling cap -> denied.
    expect(await p.allow(req(100, { walletId: walletRef }))).toBe(false);
    // A DIFFERENT wallet is unaffected -> allowed (proves the check is real).
    expect(await p.allow(req(100, { walletId: "wallet-clean" }))).toBe(true);
  });
});
