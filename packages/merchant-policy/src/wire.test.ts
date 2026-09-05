import { describe, expect, it } from "vitest";

import type { Instant, IsoCurrencyCode } from "@counter/domain";

import type { MerchantPolicyRuleSet } from "./policy-config.js";
import {
  parseRuleConfig,
  parseRuleSetBody,
  ruleSetFromStored,
  serializeRuleConfig,
  serializeRuleSet,
  type StoredRuleSet,
} from "./wire.js";

const INR = "INR" as IsoCurrencyCode;
const now = Date.now() as Instant;
const later = (now + 86_400_000) as Instant;

describe("parseRuleConfig / serializeRuleConfig round-trip", () => {
  it("round-trips every rule kind", () => {
    const cases: readonly unknown[] = [
      { kind: "product-allowlist", products: ["sku_a"] },
      { kind: "category-allowlist", categories: ["electronics"] },
      { kind: "inr-only" },
      { kind: "quantity-limit", maxQuantity: { value: "5", unit: "item" } },
      { kind: "count-limit", maxCount: 3, windowDurationMs: 60_000 },
      { kind: "india-destination", allowedDestinations: ["IN"] },
      {
        kind: "operating-window",
        allowedFrom: new Date(now).toISOString(),
        allowedUntil: new Date(later).toISOString(),
      },
      { kind: "freshness-requirement", maxAgeMs: 30_000 },
      { kind: "payment-path", allowedMethods: ["upi", "card"] },
      { kind: "review-threshold", thresholdAmount: { amountMinor: "500000", currency: "INR" } },
      { kind: "cancellation-policy", allowedWithinMs: 3_600_000, refundPercentage: 80 },
      { kind: "refund-policy", maxRefundWindowMs: 604_800_000, partialRefundAllowed: true },
    ];

    for (const wire of cases) {
      const parsed = parseRuleConfig(wire);
      expect(typeof parsed).not.toBe("string");
      if (typeof parsed === "string") continue;
      const reserialized = serializeRuleConfig(parsed);
      expect(reserialized).toEqual(wire);
    }
  });

  it("round-trips a Money field as a real bigint, not a JSON-mangled number", () => {
    const parsed = parseRuleConfig({
      kind: "review-threshold",
      thresholdAmount: { amountMinor: "9999999999999", currency: "INR" },
    });
    expect(typeof parsed).not.toBe("string");
    if (typeof parsed === "string") return;
    if (parsed.kind !== "review-threshold") throw new Error("expected review-threshold");
    expect(parsed.thresholdAmount.amountMinor).toBe(9999999999999n);
  });

  it("rejects an unknown rule kind", () => {
    const parsed = parseRuleConfig({ kind: "not-a-real-kind" });
    expect(parsed).toContain("Unknown rule kind");
  });

  it("rejects a malformed rule (wrong field type)", () => {
    const parsed = parseRuleConfig({ kind: "quantity-limit", maxQuantity: "not-an-object" });
    expect(typeof parsed).toBe("string");
  });

  it("rejects a non-object rule", () => {
    expect(parseRuleConfig(null)).toContain("object");
    expect(parseRuleConfig("nope")).toContain("object");
  });
});

describe("parseRuleSetBody", () => {
  it("parses a valid body, defaulting a null effectiveUntil to the far-future sentinel", () => {
    const parsed = parseRuleSetBody({
      rules: [{ kind: "inr-only" }],
      effectiveFrom: new Date(now).toISOString(),
      effectiveUntil: null,
    });
    expect(Array.isArray(parsed)).toBe(false);
    if (Array.isArray(parsed)) return;
    expect(parsed.rules).toHaveLength(1);
    expect(parsed.effectiveUntil).toBeGreaterThan(parsed.effectiveFrom);
  });

  it("returns errors for a missing rules array", () => {
    const parsed = parseRuleSetBody({ effectiveFrom: new Date(now).toISOString() });
    expect(Array.isArray(parsed)).toBe(true);
  });

  it("returns errors for a missing effectiveFrom", () => {
    const parsed = parseRuleSetBody({ rules: [{ kind: "inr-only" }] });
    expect(Array.isArray(parsed)).toBe(true);
    if (!Array.isArray(parsed)) return;
    expect(parsed.join(" ")).toContain("effectiveFrom");
  });

  it("collects an error per invalid rule, not just the first", () => {
    const parsed = parseRuleSetBody({
      rules: [{ kind: "not-real" }, { kind: "quantity-limit", maxQuantity: "bad" }],
      effectiveFrom: new Date(now).toISOString(),
    });
    expect(Array.isArray(parsed)).toBe(true);
    if (!Array.isArray(parsed)) return;
    expect(parsed).toHaveLength(2);
  });
});

describe("serializeRuleSet / ruleSetFromStored round-trip", () => {
  it("round-trips a full rule set, including a bigint-carrying rule", () => {
    const ruleSet: MerchantPolicyRuleSet = {
      version: 3,
      merchantId: "ctr_merchant_AAAAAAAAAAAAAAAAAAAAAA",
      rules: [
        { kind: "inr-only" },
        {
          kind: "review-threshold",
          thresholdAmount: { amountMinor: 250000n, currency: INR },
        },
      ],
      effectiveFrom: now,
      effectiveUntil: later,
    };
    const stored = serializeRuleSet(ruleSet);
    // A stored row must survive an actual JSON.stringify/parse cycle (what
    // Postgres's JSON column does) without losing the bigint.
    const roundTripped = JSON.parse(JSON.stringify(stored)) as StoredRuleSet;
    const rebuilt = ruleSetFromStored(roundTripped);
    expect(rebuilt.version).toBe(3);
    expect(rebuilt.rules).toHaveLength(2);
    const reviewRule = rebuilt.rules.find((r) => r.kind === "review-threshold");
    if (reviewRule?.kind !== "review-threshold") throw new Error("expected review-threshold");
    expect(reviewRule.thresholdAmount.amountMinor).toBe(250000n);
  });

  it("throws on a corrupt stored rule", () => {
    const corrupt: StoredRuleSet = {
      merchantId: "m1",
      version: 1,
      rules: [{ kind: "not-a-real-kind" } as never],
      effectiveFrom: new Date(now).toISOString(),
      effectiveUntil: new Date(later).toISOString(),
    };
    expect(() => ruleSetFromStored(corrupt)).toThrow(/Corrupt stored policy/);
  });
});
