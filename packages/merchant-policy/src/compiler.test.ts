import { describe, expect, it } from "vitest";

import type { DecimalQuantity, Instant, IsoCurrencyCode } from "@counter/domain";

import { compileMerchantPolicy } from "./compiler.js";
import type { MerchantPolicyRuleConfig, MerchantPolicyRuleSet } from "./policy-config.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const INR = "INR" as IsoCurrencyCode;
const now = Date.now() as Instant;
const later = (now + 86_400_000) as Instant;
const testQuantity: DecimalQuantity = { value: "50", unit: "item" as DecimalQuantity["unit"] };

function makeRuleSet(rules: MerchantPolicyRuleConfig[]): MerchantPolicyRuleSet {
  return {
    version: 1,
    merchantId: "merchant_001",
    rules,
    effectiveFrom: now,
    effectiveUntil: later,
  };
}

// ---------------------------------------------------------------------------
// Valid compilation
// ---------------------------------------------------------------------------

describe("compileMerchantPolicy - valid configs", () => {
  it("compiles inr-only rule to allowed currencies", () => {
    const result = compileMerchantPolicy(makeRuleSet([{ kind: "inr-only" }]), now);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.constraints.allowedCurrencies).toContain("INR");
  });

  it("compiles product-allowlist rule", () => {
    const result = compileMerchantPolicy(
      makeRuleSet([{ kind: "product-allowlist", products: ["sku_a", "sku_b"] }]),
      now,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.constraints.allowedProducts).toEqual(["sku_a", "sku_b"]);
  });

  it("compiles category-allowlist rule", () => {
    const result = compileMerchantPolicy(
      makeRuleSet([{ kind: "category-allowlist", categories: ["electronics", "food"] }]),
      now,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.constraints.allowedCategories).toEqual(["electronics", "food"]);
  });

  it("compiles quantity-limit rule", () => {
    const result = compileMerchantPolicy(
      makeRuleSet([{ kind: "quantity-limit", maxQuantity: testQuantity }]),
      now,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.constraints.maxQuantity).toEqual(testQuantity);
  });

  it("compiles india-destination rule", () => {
    const result = compileMerchantPolicy(
      makeRuleSet([{ kind: "india-destination", allowedDestinations: ["IN", "IN-MH"] }]),
      now,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.constraints.allowedDestinations).toEqual(["IN", "IN-MH"]);
  });

  it("compiles operating-window rule", () => {
    const windowStart = (now + 1000) as Instant;
    const windowEnd = (now + 50_000_000) as Instant;
    const result = compileMerchantPolicy(
      makeRuleSet([{ kind: "operating-window", allowedFrom: windowStart, allowedUntil: windowEnd }]),
      now,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.constraints.timeWindow.allowedFrom).toBe(windowStart);
    expect(result.value.constraints.timeWindow.allowedUntil).toBe(windowEnd);
  });

  it("compiles payment-path rule", () => {
    const result = compileMerchantPolicy(
      makeRuleSet([{ kind: "payment-path", allowedMethods: ["upi", "card"] }]),
      now,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.constraints.allowedPaymentPaths).toEqual(["upi", "card"]);
  });

  it("compiles review-threshold rule", () => {
    const result = compileMerchantPolicy(
      makeRuleSet([{
        kind: "review-threshold",
        thresholdAmount: { amountMinor: 500_000n, currency: INR },
      }]),
      now,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.reviewThresholdAmount).toEqual({ amountMinor: 500_000n, currency: INR });
  });

  it("compiles cancellation-policy rule", () => {
    const result = compileMerchantPolicy(
      makeRuleSet([{ kind: "cancellation-policy", allowedWithinMs: 7200_000, refundPercentage: 80 }]),
      now,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.cancellationWindowMs).toBe(7200_000);
    expect(result.value.cancellationRefundPercentage).toBe(80);
  });

  it("compiles refund-policy rule", () => {
    const result = compileMerchantPolicy(
      makeRuleSet([{ kind: "refund-policy", maxRefundWindowMs: 604_800_000, partialRefundAllowed: true }]),
      now,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.refundWindowMs).toBe(604_800_000);
    expect(result.value.partialRefundAllowed).toBe(true);
  });

  it("compiles freshness-requirement rule", () => {
    const result = compileMerchantPolicy(
      makeRuleSet([{ kind: "freshness-requirement", maxAgeMs: 120_000 }]),
      now,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.freshnessMaxAgeMs).toBe(120_000);
  });

  it("compiles count-limit rule", () => {
    const result = compileMerchantPolicy(
      makeRuleSet([{ kind: "count-limit", maxCount: 10, windowDurationMs: 3600_000 }]),
      now,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.countLimit).toEqual({ maxCount: 10, windowDurationMs: 3600_000 });
  });

  it("compiles multiple non-conflicting rules", () => {
    const result = compileMerchantPolicy(
      makeRuleSet([
        { kind: "inr-only" },
        { kind: "product-allowlist", products: ["premium_widget"] },
        { kind: "payment-path", allowedMethods: ["upi"] },
        { kind: "quantity-limit", maxQuantity: testQuantity },
      ]),
      now,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.constraints.allowedCurrencies).toContain("INR");
    expect(result.value.constraints.allowedProducts).toContain("premium_widget");
    expect(result.value.constraints.allowedPaymentPaths).toContain("upi");
    expect(result.value.constraints.maxQuantity).toEqual(testQuantity);
  });

  it("sets source field correctly", () => {
    const ruleSet = makeRuleSet([{ kind: "inr-only" }]);
    const result = compileMerchantPolicy(ruleSet, now);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.constraints.source).toBe("merchant:merchant_001:v1");
  });

  it("uses effectiveFrom/Until as default time window", () => {
    const result = compileMerchantPolicy(makeRuleSet([{ kind: "inr-only" }]), now);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.constraints.timeWindow.allowedFrom).toBe(now);
    expect(result.value.constraints.timeWindow.allowedUntil).toBe(later);
  });

  it("sets compiledAt to the provided now timestamp", () => {
    const result = compileMerchantPolicy(makeRuleSet([{ kind: "inr-only" }]), now);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.compiledAt).toBe(now);
  });
});

// ---------------------------------------------------------------------------
// Rejection of ambiguous/conflicting rules
// ---------------------------------------------------------------------------

describe("compileMerchantPolicy - ambiguity rejection", () => {
  it("rejects duplicate product-allowlist rules", () => {
    const result = compileMerchantPolicy(
      makeRuleSet([
        { kind: "product-allowlist", products: ["sku_a"] },
        { kind: "product-allowlist", products: ["sku_b"] },
      ]),
      now,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("POLICY_DENIED");
    expect(result.error.category).toBe("policy_denial");
  });

  it("rejects duplicate operating-window rules", () => {
    const result = compileMerchantPolicy(
      makeRuleSet([
        { kind: "operating-window", allowedFrom: now, allowedUntil: later },
        { kind: "operating-window", allowedFrom: now, allowedUntil: (later + 1000) as Instant },
      ]),
      now,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("POLICY_DENIED");
  });

  it("rejects duplicate payment-path rules", () => {
    const result = compileMerchantPolicy(
      makeRuleSet([
        { kind: "payment-path", allowedMethods: ["upi"] },
        { kind: "payment-path", allowedMethods: ["card"] },
      ]),
      now,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("POLICY_DENIED");
  });
});

// ---------------------------------------------------------------------------
// Rejection of invalid rule sets
// ---------------------------------------------------------------------------

describe("compileMerchantPolicy - invalid rule sets", () => {
  it("rejects empty rule set", () => {
    const result = compileMerchantPolicy(
      { version: 1, merchantId: "m1", rules: [], effectiveFrom: now, effectiveUntil: later },
      now,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_FORMAT");
  });

  it("rejects invalid version", () => {
    const result = compileMerchantPolicy(
      { version: 0, merchantId: "m1", rules: [{ kind: "inr-only" }], effectiveFrom: now, effectiveUntil: later },
      now,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_FORMAT");
  });

  it("rejects empty merchantId", () => {
    const result = compileMerchantPolicy(
      { version: 1, merchantId: "", rules: [{ kind: "inr-only" }], effectiveFrom: now, effectiveUntil: later },
      now,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_FORMAT");
  });

  it("rejects rule set with invalid individual rule", () => {
    const result = compileMerchantPolicy(
      makeRuleSet([{ kind: "product-allowlist", products: [] }]),
      now,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_FORMAT");
  });
});
