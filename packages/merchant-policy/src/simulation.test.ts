import { describe, expect, it } from "vitest";

import type { CounterId, DecimalQuantity, Instant, IsoCurrencyCode, Money } from "@counter/domain";
import type { BuyerPolicyConstraints } from "@counter/policy";

import { compileMerchantPolicy } from "./compiler.js";
import type { MerchantPolicyRuleSet } from "./policy-config.js";
import { simulateWalletAuthority } from "./simulation.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const INR = "INR" as IsoCurrencyCode;
const now = Date.now() as Instant;
const later = (now + 86_400_000) as Instant;
const testQuantity: DecimalQuantity = { value: "1", unit: "item" as DecimalQuantity["unit"] };
const transactionId = "txn_sim_001" as CounterId<"transaction">;

function makeMoney(amountMinor: bigint, currency: IsoCurrencyCode = INR): Money {
  return { amountMinor, currency };
}

function makeWalletAuthority(overrides: Partial<BuyerPolicyConstraints> = {}): BuyerPolicyConstraints {
  return {
    version: 1,
    source: "wallet:buyer_001",
    merchantAllowlist: [],
    domainAllowlist: [],
    indiaGeographyRequired: true,
    allowedCategories: ["electronics"],
    allowedSkus: ["premium_widget"],
    inrCurrencyOnly: true,
    perTransactionLimit: { maxAmount: makeMoney(1_000_000n) },
    rollingPeriodLimit: { maxAmount: makeMoney(5_000_000n), windowDurationMs: 86_400_000 },
    aggregateLimit: { maxTotalAmount: makeMoney(50_000_000n) },
    quantityLimit: { maxQuantity: { value: "100", unit: "item" as DecimalQuantity["unit"] } },
    countLimit: { maxCount: 50, windowDurationMs: 86_400_000 },
    allowedOperations: ["payment"],
    timeWindow: { allowedFrom: now, allowedUntil: later },
    approvalThreshold: { thresholdAmount: makeMoney(500_000n), requiresApproval: true },
    ...overrides,
  };
}

function compiledPolicy(rules: MerchantPolicyRuleSet["rules"]) {
  const ruleSet: MerchantPolicyRuleSet = {
    version: 1,
    merchantId: "merchant_sim",
    rules,
    effectiveFrom: now,
    effectiveUntil: later,
  };
  const result = compileMerchantPolicy(ruleSet, now);
  if (!result.ok) throw new Error("Failed to compile test policy");
  return result.value;
}

// ---------------------------------------------------------------------------
// ALLOW cases - compatible intersection
// ---------------------------------------------------------------------------

describe("simulateWalletAuthority - ALLOW", () => {
  it("allows when buyer and merchant constraints are compatible", () => {
    const policy = compiledPolicy([
      { kind: "product-allowlist", products: ["premium_widget"] },
      { kind: "category-allowlist", categories: ["electronics"] },
      { kind: "inr-only" },
      { kind: "payment-path", allowedMethods: ["upi"] },
    ]);

    const result = simulateWalletAuthority({
      compiledPolicy: policy,
      walletAuthority: makeWalletAuthority(),
      transactionId,
      requestedAmount: makeMoney(100_000n),
      requestedAt: (now + 1000) as Instant,
      merchantId: "merchant_sim",
      merchantDomain: "merchant.example.com",
      merchantCategory: "electronics",
      buyerCountry: "IN",
      sku: "premium_widget",
      quantity: testQuantity,
      paymentMethod: "upi",
      destination: "IN",
      operationType: "payment",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.decision.outcome).toBe("ALLOW");
  });
});

// ---------------------------------------------------------------------------
// DENY cases - incompatible intersection
// ---------------------------------------------------------------------------

describe("simulateWalletAuthority - DENY", () => {
  it("denies when merchant category is not in buyer allowlist", () => {
    const policy = compiledPolicy([
      { kind: "category-allowlist", categories: ["fashion"] },
      { kind: "inr-only" },
    ]);

    const result = simulateWalletAuthority({
      compiledPolicy: policy,
      walletAuthority: makeWalletAuthority({ allowedCategories: ["electronics"] }),
      transactionId,
      requestedAmount: makeMoney(100_000n),
      requestedAt: (now + 1000) as Instant,
      merchantId: "merchant_sim",
      merchantDomain: "merchant.example.com",
      merchantCategory: "fashion",
      buyerCountry: "IN",
      sku: "dress_001",
      quantity: testQuantity,
      paymentMethod: "upi",
      destination: "IN",
      operationType: "payment",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.decision.outcome).toBe("DENY");
  });

  it("denies when payment method is not in merchant allowlist", () => {
    const policy = compiledPolicy([
      { kind: "payment-path", allowedMethods: ["card"] },
    ]);

    const result = simulateWalletAuthority({
      compiledPolicy: policy,
      walletAuthority: makeWalletAuthority(),
      transactionId,
      requestedAmount: makeMoney(100_000n),
      requestedAt: (now + 1000) as Instant,
      merchantId: "merchant_sim",
      merchantDomain: "merchant.example.com",
      merchantCategory: "electronics",
      buyerCountry: "IN",
      sku: "premium_widget",
      quantity: testQuantity,
      paymentMethod: "upi",
      destination: "IN",
      operationType: "payment",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.decision.outcome).toBe("DENY");
  });

  it("denies when amount exceeds buyer per-transaction limit", () => {
    const policy = compiledPolicy([{ kind: "inr-only" }]);

    const result = simulateWalletAuthority({
      compiledPolicy: policy,
      walletAuthority: makeWalletAuthority({
        perTransactionLimit: { maxAmount: makeMoney(50_000n) },
      }),
      transactionId,
      requestedAmount: makeMoney(100_000n),
      requestedAt: (now + 1000) as Instant,
      merchantId: "merchant_sim",
      merchantDomain: "merchant.example.com",
      merchantCategory: "electronics",
      buyerCountry: "IN",
      sku: "premium_widget",
      quantity: testQuantity,
      paymentMethod: "upi",
      destination: "IN",
      operationType: "payment",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.decision.outcome).toBe("DENY");
  });

  it("denies when buyer requires India geography but buyer is not in India", () => {
    const policy = compiledPolicy([{ kind: "inr-only" }]);

    const result = simulateWalletAuthority({
      compiledPolicy: policy,
      walletAuthority: makeWalletAuthority({ indiaGeographyRequired: true }),
      transactionId,
      requestedAmount: makeMoney(100_000n),
      requestedAt: (now + 1000) as Instant,
      merchantId: "merchant_sim",
      merchantDomain: "merchant.example.com",
      merchantCategory: "electronics",
      buyerCountry: "US",
      sku: "premium_widget",
      quantity: testQuantity,
      paymentMethod: "upi",
      destination: "IN",
      operationType: "payment",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.decision.outcome).toBe("DENY");
  });
});

// ---------------------------------------------------------------------------
// REVIEW_REQUIRED cases
// ---------------------------------------------------------------------------

describe("simulateWalletAuthority - REVIEW_REQUIRED", () => {
  it("requires review when amount exceeds buyer approval threshold", () => {
    const policy = compiledPolicy([
      { kind: "product-allowlist", products: ["premium_widget"] },
      { kind: "category-allowlist", categories: ["electronics"] },
      { kind: "inr-only" },
    ]);

    const result = simulateWalletAuthority({
      compiledPolicy: policy,
      walletAuthority: makeWalletAuthority({
        approvalThreshold: { thresholdAmount: makeMoney(100_000n), requiresApproval: true },
      }),
      transactionId,
      requestedAmount: makeMoney(200_000n),
      requestedAt: (now + 1000) as Instant,
      merchantId: "merchant_sim",
      merchantDomain: "merchant.example.com",
      merchantCategory: "electronics",
      buyerCountry: "IN",
      sku: "premium_widget",
      quantity: testQuantity,
      paymentMethod: "upi",
      destination: "IN",
      operationType: "payment",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.decision.outcome).toBe("REVIEW_REQUIRED");
  });
});

// ---------------------------------------------------------------------------
// Rule results tracking
// ---------------------------------------------------------------------------

describe("simulateWalletAuthority - rule results", () => {
  it("returns bilateral rule results in the response", () => {
    const policy = compiledPolicy([{ kind: "inr-only" }]);

    const result = simulateWalletAuthority({
      compiledPolicy: policy,
      walletAuthority: makeWalletAuthority(),
      transactionId,
      requestedAmount: makeMoney(100_000n),
      requestedAt: (now + 1000) as Instant,
      merchantId: "merchant_sim",
      merchantDomain: "merchant.example.com",
      merchantCategory: "electronics",
      buyerCountry: "IN",
      sku: "premium_widget",
      quantity: testQuantity,
      paymentMethod: "upi",
      destination: "IN",
      operationType: "payment",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.ruleResults.length).toBeGreaterThan(0);
    const ruleIds = result.value.ruleResults.map((r) => r.ruleId);
    expect(ruleIds).toContain("merchant_policy");
    expect(ruleIds).toContain("buyer_allowlist");
  });
});
