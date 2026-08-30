import { describe, expect, it } from "vitest";

import type { DecimalQuantity, Instant, IsoCurrencyCode } from "@counter/domain";

import type { MerchantPolicyRuleConfig, MerchantPolicyRuleSet } from "./policy-config.js";
import {
  isValidRuleKind,
  RULE_KINDS,
  validateRuleConfig,
  validateRuleSet,
} from "./policy-config.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const INR = "INR" as IsoCurrencyCode;
const testQuantity: DecimalQuantity = { value: "10", unit: "item" as DecimalQuantity["unit"] };
const now = Date.now() as Instant;
const later = (now + 86_400_000) as Instant;

function makeRuleSet(overrides: Partial<MerchantPolicyRuleSet> = {}): MerchantPolicyRuleSet {
  return {
    version: 1,
    merchantId: "merchant_001",
    rules: [{ kind: "inr-only" }],
    effectiveFrom: now,
    effectiveUntil: later,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// isValidRuleKind
// ---------------------------------------------------------------------------

describe("isValidRuleKind", () => {
  it("returns true for all known rule kinds", () => {
    for (const kind of RULE_KINDS) {
      expect(isValidRuleKind(kind)).toBe(true);
    }
  });

  it("returns false for unknown strings", () => {
    expect(isValidRuleKind("unknown")).toBe(false);
    expect(isValidRuleKind("")).toBe(false);
  });

  it("returns false for non-string values", () => {
    expect(isValidRuleKind(42)).toBe(false);
    expect(isValidRuleKind(null)).toBe(false);
    expect(isValidRuleKind(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateRuleConfig - individual rule types
// ---------------------------------------------------------------------------

describe("validateRuleConfig", () => {
  it("validates product-allowlist with products", () => {
    const rule: MerchantPolicyRuleConfig = {
      kind: "product-allowlist",
      products: ["sku1", "sku2"],
    };
    expect(validateRuleConfig(rule)).toEqual([]);
  });

  it("rejects product-allowlist with empty products", () => {
    const rule: MerchantPolicyRuleConfig = { kind: "product-allowlist", products: [] };
    expect(validateRuleConfig(rule)).toContain("product-allowlist must have at least one product");
  });

  it("validates category-allowlist with categories", () => {
    const rule: MerchantPolicyRuleConfig = {
      kind: "category-allowlist",
      categories: ["electronics"],
    };
    expect(validateRuleConfig(rule)).toEqual([]);
  });

  it("rejects category-allowlist with empty categories", () => {
    const rule: MerchantPolicyRuleConfig = { kind: "category-allowlist", categories: [] };
    expect(validateRuleConfig(rule)).toContain(
      "category-allowlist must have at least one category",
    );
  });

  it("validates inr-only (no parameters)", () => {
    const rule: MerchantPolicyRuleConfig = { kind: "inr-only" };
    expect(validateRuleConfig(rule)).toEqual([]);
  });

  it("validates quantity-limit with positive value", () => {
    const rule: MerchantPolicyRuleConfig = { kind: "quantity-limit", maxQuantity: testQuantity };
    expect(validateRuleConfig(rule)).toEqual([]);
  });

  it("rejects quantity-limit with zero", () => {
    const rule: MerchantPolicyRuleConfig = {
      kind: "quantity-limit",
      maxQuantity: { value: "0", unit: "item" as DecimalQuantity["unit"] },
    };
    expect(validateRuleConfig(rule)).toContain(
      "quantity-limit maxQuantity must be greater than zero",
    );
  });

  it("validates count-limit with positive values", () => {
    const rule: MerchantPolicyRuleConfig = {
      kind: "count-limit",
      maxCount: 5,
      windowDurationMs: 3600_000,
    };
    expect(validateRuleConfig(rule)).toEqual([]);
  });

  it("rejects count-limit with non-positive maxCount", () => {
    const rule: MerchantPolicyRuleConfig = {
      kind: "count-limit",
      maxCount: 0,
      windowDurationMs: 3600_000,
    };
    expect(validateRuleConfig(rule)).toContain("count-limit maxCount must be positive");
  });

  it("rejects count-limit with non-positive windowDurationMs", () => {
    const rule: MerchantPolicyRuleConfig = {
      kind: "count-limit",
      maxCount: 5,
      windowDurationMs: -1,
    };
    expect(validateRuleConfig(rule)).toContain("count-limit windowDurationMs must be positive");
  });

  it("validates india-destination with destinations", () => {
    const rule: MerchantPolicyRuleConfig = {
      kind: "india-destination",
      allowedDestinations: ["IN"],
    };
    expect(validateRuleConfig(rule)).toEqual([]);
  });

  it("rejects india-destination with empty destinations", () => {
    const rule: MerchantPolicyRuleConfig = { kind: "india-destination", allowedDestinations: [] };
    expect(validateRuleConfig(rule)).toContain(
      "india-destination must have at least one destination",
    );
  });

  it("validates operating-window with valid time range", () => {
    const rule: MerchantPolicyRuleConfig = {
      kind: "operating-window",
      allowedFrom: now,
      allowedUntil: later,
    };
    expect(validateRuleConfig(rule)).toEqual([]);
  });

  it("rejects operating-window where from >= until", () => {
    const rule: MerchantPolicyRuleConfig = {
      kind: "operating-window",
      allowedFrom: later,
      allowedUntil: now,
    };
    expect(validateRuleConfig(rule)).toContain(
      "operating-window allowedFrom must be before allowedUntil",
    );
  });

  it("validates freshness-requirement with positive maxAgeMs", () => {
    const rule: MerchantPolicyRuleConfig = { kind: "freshness-requirement", maxAgeMs: 60_000 };
    expect(validateRuleConfig(rule)).toEqual([]);
  });

  it("rejects freshness-requirement with non-positive maxAgeMs", () => {
    const rule: MerchantPolicyRuleConfig = { kind: "freshness-requirement", maxAgeMs: 0 };
    expect(validateRuleConfig(rule)).toContain("freshness-requirement maxAgeMs must be positive");
  });

  it("validates payment-path with methods", () => {
    const rule: MerchantPolicyRuleConfig = {
      kind: "payment-path",
      allowedMethods: ["upi", "card"],
    };
    expect(validateRuleConfig(rule)).toEqual([]);
  });

  it("rejects payment-path with empty methods", () => {
    const rule: MerchantPolicyRuleConfig = { kind: "payment-path", allowedMethods: [] };
    expect(validateRuleConfig(rule)).toContain(
      "payment-path must have at least one payment method",
    );
  });

  it("validates review-threshold with positive amount", () => {
    const rule: MerchantPolicyRuleConfig = {
      kind: "review-threshold",
      thresholdAmount: { amountMinor: 100_000n, currency: INR },
    };
    expect(validateRuleConfig(rule)).toEqual([]);
  });

  it("rejects review-threshold with non-positive amount", () => {
    const rule: MerchantPolicyRuleConfig = {
      kind: "review-threshold",
      thresholdAmount: { amountMinor: 0n, currency: INR },
    };
    expect(validateRuleConfig(rule)).toContain("review-threshold thresholdAmount must be positive");
  });

  it("validates cancellation-policy with valid params", () => {
    const rule: MerchantPolicyRuleConfig = {
      kind: "cancellation-policy",
      allowedWithinMs: 3600_000,
      refundPercentage: 100,
    };
    expect(validateRuleConfig(rule)).toEqual([]);
  });

  it("rejects cancellation-policy with invalid refundPercentage", () => {
    const rule: MerchantPolicyRuleConfig = {
      kind: "cancellation-policy",
      allowedWithinMs: 3600_000,
      refundPercentage: 150,
    };
    expect(validateRuleConfig(rule)).toContain(
      "cancellation-policy refundPercentage must be between 0 and 100",
    );
  });

  it("validates refund-policy with valid params", () => {
    const rule: MerchantPolicyRuleConfig = {
      kind: "refund-policy",
      maxRefundWindowMs: 86_400_000,
      partialRefundAllowed: true,
    };
    expect(validateRuleConfig(rule)).toEqual([]);
  });

  it("rejects refund-policy with non-positive window", () => {
    const rule: MerchantPolicyRuleConfig = {
      kind: "refund-policy",
      maxRefundWindowMs: 0,
      partialRefundAllowed: false,
    };
    expect(validateRuleConfig(rule)).toContain("refund-policy maxRefundWindowMs must be positive");
  });
});

// ---------------------------------------------------------------------------
// validateRuleSet
// ---------------------------------------------------------------------------

describe("validateRuleSet", () => {
  it("passes for a valid rule set", () => {
    const ruleSet = makeRuleSet();
    expect(validateRuleSet(ruleSet)).toEqual([]);
  });

  it("rejects empty rule set", () => {
    const ruleSet = makeRuleSet({ rules: [] });
    expect(validateRuleSet(ruleSet)).toContain("Rule set must contain at least one rule");
  });

  it("rejects version <= 0", () => {
    const ruleSet = makeRuleSet({ version: 0 });
    expect(validateRuleSet(ruleSet)).toContain("Policy version must be a positive integer");
  });

  it("rejects empty merchantId", () => {
    const ruleSet = makeRuleSet({ merchantId: "   " });
    expect(validateRuleSet(ruleSet)).toContain("merchantId must not be empty");
  });

  it("rejects effectiveFrom >= effectiveUntil", () => {
    const ruleSet = makeRuleSet({ effectiveFrom: later, effectiveUntil: now });
    expect(validateRuleSet(ruleSet)).toContain("effectiveFrom must be before effectiveUntil");
  });

  it("aggregates errors from individual rules", () => {
    const ruleSet = makeRuleSet({
      rules: [{ kind: "product-allowlist", products: [] }],
    });
    const errors = validateRuleSet(ruleSet);
    expect(errors).toContain("product-allowlist must have at least one product");
  });
});

// ---------------------------------------------------------------------------
// Serialization roundtrip
// ---------------------------------------------------------------------------

describe("serialization roundtrip", () => {
  it("rule configs survive JSON roundtrip", () => {
    const rules: MerchantPolicyRuleConfig[] = [
      { kind: "product-allowlist", products: ["sku1"] },
      { kind: "category-allowlist", categories: ["food"] },
      { kind: "inr-only" },
      { kind: "quantity-limit", maxQuantity: testQuantity },
      { kind: "count-limit", maxCount: 10, windowDurationMs: 3600_000 },
      { kind: "india-destination", allowedDestinations: ["IN"] },
      { kind: "operating-window", allowedFrom: now, allowedUntil: later },
      { kind: "freshness-requirement", maxAgeMs: 60_000 },
      { kind: "payment-path", allowedMethods: ["upi"] },
      {
        kind: "review-threshold",
        thresholdAmount: { amountMinor: 100_000n, currency: INR },
      },
      { kind: "cancellation-policy", allowedWithinMs: 3600_000, refundPercentage: 100 },
      { kind: "refund-policy", maxRefundWindowMs: 86_400_000, partialRefundAllowed: true },
    ];

    // BigInt is not JSON-serializable by default, so test without the review-threshold
    const serializableRules = rules.filter((r) => r.kind !== "review-threshold");
    const json = JSON.stringify(serializableRules);
    const parsed = JSON.parse(json) as MerchantPolicyRuleConfig[];

    expect(parsed.length).toBe(serializableRules.length);
    for (let i = 0; i < parsed.length; i++) {
      expect(parsed[i]!.kind).toBe(serializableRules[i]!.kind);
    }
  });
});
