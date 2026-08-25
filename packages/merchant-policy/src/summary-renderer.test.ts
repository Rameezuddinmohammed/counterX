import { describe, expect, it } from "vitest";

import type { DecimalQuantity, Instant, IsoCurrencyCode } from "@counter/domain";

import { compileMerchantPolicy } from "./compiler.js";
import type { MerchantPolicyRuleSet } from "./policy-config.js";
import { renderPolicySummary } from "./summary-renderer.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const INR = "INR" as IsoCurrencyCode;
const now = 1700000000000 as Instant; // fixed timestamp for deterministic output
const later = (now + 86_400_000) as Instant;
const testQuantity: DecimalQuantity = { value: "50", unit: "item" as DecimalQuantity["unit"] };

function compiledPolicy(rules: MerchantPolicyRuleSet["rules"]) {
  const ruleSet: MerchantPolicyRuleSet = {
    version: 1,
    merchantId: "merchant_render",
    rules,
    effectiveFrom: now,
    effectiveUntil: later,
  };
  const result = compileMerchantPolicy(ruleSet, now);
  if (!result.ok) throw new Error("Failed to compile test policy");
  return result.value;
}

// ---------------------------------------------------------------------------
// Deterministic output
// ---------------------------------------------------------------------------

describe("renderPolicySummary", () => {
  it("produces deterministic output for the same input", () => {
    const policy = compiledPolicy([
      { kind: "inr-only" },
      { kind: "product-allowlist", products: ["widget_b", "widget_a"] },
      { kind: "category-allowlist", categories: ["food", "electronics"] },
      { kind: "payment-path", allowedMethods: ["card", "upi"] },
      { kind: "india-destination", allowedDestinations: ["IN-MH", "IN-KA"] },
      { kind: "quantity-limit", maxQuantity: testQuantity },
    ]);

    const summary1 = renderPolicySummary(policy);
    const summary2 = renderPolicySummary(policy);

    expect(summary1).toEqual(summary2);
  });

  it("sorts output lines alphabetically", () => {
    const policy = compiledPolicy([
      { kind: "inr-only" },
      { kind: "product-allowlist", products: ["widget_b", "widget_a"] },
    ]);

    const summary = renderPolicySummary(policy);

    // Verify sorted order
    const sortedCopy = [...summary].sort();
    expect(summary).toEqual(sortedCopy);
  });

  it("sorts items within each line alphabetically", () => {
    const policy = compiledPolicy([
      { kind: "product-allowlist", products: ["zebra", "apple"] },
    ]);

    const summary = renderPolicySummary(policy);
    const productsLine = summary.find((l) => l.startsWith("Allowed products:"));
    expect(productsLine).toBe("Allowed products: apple, zebra");
  });

  it("includes all constraint dimensions", () => {
    const policy = compiledPolicy([
      { kind: "inr-only" },
      { kind: "product-allowlist", products: ["sku1"] },
      { kind: "category-allowlist", categories: ["electronics"] },
      { kind: "payment-path", allowedMethods: ["upi"] },
      { kind: "india-destination", allowedDestinations: ["IN"] },
      { kind: "quantity-limit", maxQuantity: testQuantity },
      { kind: "freshness-requirement", maxAgeMs: 60_000 },
      { kind: "cancellation-policy", allowedWithinMs: 3600_000, refundPercentage: 100 },
      { kind: "refund-policy", maxRefundWindowMs: 86_400_000, partialRefundAllowed: true },
      {
        kind: "review-threshold",
        thresholdAmount: { amountMinor: 500_000n, currency: INR },
      },
    ]);

    const summary = renderPolicySummary(policy);

    expect(summary.some((l) => l.startsWith("Allowed categories:"))).toBe(true);
    expect(summary.some((l) => l.startsWith("Allowed currencies:"))).toBe(true);
    expect(summary.some((l) => l.startsWith("Allowed destinations:"))).toBe(true);
    expect(summary.some((l) => l.startsWith("Allowed payment methods:"))).toBe(true);
    expect(summary.some((l) => l.startsWith("Allowed products:"))).toBe(true);
    expect(summary.some((l) => l.startsWith("Cancellation allowed"))).toBe(true);
    expect(summary.some((l) => l.startsWith("Freshness requirement:"))).toBe(true);
    expect(summary.some((l) => l.startsWith("Max amount:"))).toBe(true);
    expect(summary.some((l) => l.startsWith("Max quantity:"))).toBe(true);
    expect(summary.some((l) => l.startsWith("Min amount:"))).toBe(true);
    expect(summary.some((l) => l.startsWith("Operating window:"))).toBe(true);
    expect(summary.some((l) => l.startsWith("Partial refund:"))).toBe(true);
    expect(summary.some((l) => l.startsWith("Refund window:"))).toBe(true);
    expect(summary.some((l) => l.startsWith("Review required above:"))).toBe(true);
    expect(summary.some((l) => l.startsWith("Source:"))).toBe(true);
    expect(summary.some((l) => l.startsWith("Version:"))).toBe(true);
  });

  it("renders a minimal policy correctly", () => {
    const policy = compiledPolicy([{ kind: "inr-only" }]);
    const summary = renderPolicySummary(policy);

    expect(summary.length).toBeGreaterThan(0);
    expect(summary.some((l) => l.includes("INR"))).toBe(true);
    expect(summary.some((l) => l.startsWith("Version: 1"))).toBe(true);
    expect(summary.some((l) => l.startsWith("Source: merchant:merchant_render:v1"))).toBe(true);
  });
});
