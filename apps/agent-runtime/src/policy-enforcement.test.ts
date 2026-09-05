import { describe, expect, it } from "vitest";
import type { Instant } from "@counter/domain";
import { compileMerchantPolicy } from "@counter/merchant-policy";
import type { MerchantPolicyRuleConfig, MerchantPolicyRuleSet } from "@counter/merchant-policy";
import { checkCompiledPolicy, type CheckoutPolicyInput } from "./policy-enforcement.js";

const now = Date.now() as Instant;
const later = (now + 86_400_000) as Instant;
const earlier = (now - 86_400_000) as Instant;

function compile(
  rules: MerchantPolicyRuleConfig[],
  effectiveFrom = earlier,
  effectiveUntil = later,
) {
  const ruleSet: MerchantPolicyRuleSet = {
    version: 1,
    merchantId: "ctr_merchant_AAAAAAAAAAAAAAAAAAAAAA",
    rules,
    effectiveFrom,
    effectiveUntil,
  };
  const result = compileMerchantPolicy(ruleSet, now);
  if (!result.ok) throw new Error(`test fixture failed to compile: ${result.error.message}`);
  return result.value;
}

function baseInput(overrides: Partial<CheckoutPolicyInput> = {}): CheckoutPolicyInput {
  return {
    variantId: "gid://shopify/ProductVariant/1",
    quantity: 1,
    currency: "INR",
    totalAmountMinor: 10_000n,
    destinationCountry: "IN",
    paymentMethod: "upi",
    quoteCreatedAtMs: now - 1_000,
    nowMs: now,
    ...overrides,
  };
}

describe("checkCompiledPolicy", () => {
  it("allows a request when the policy has no meaningful restriction", () => {
    const compiled = compile([{ kind: "inr-only" }]);
    const outcome = checkCompiledPolicy(compiled, baseInput());
    expect(outcome.kind).toBe("allow");
  });

  it("denies when the current time falls outside the operating window", () => {
    const compiled = compile([{ kind: "inr-only" }], (now + 1_000) as Instant, later);
    const outcome = checkCompiledPolicy(compiled, baseInput());
    expect(outcome.kind).toBe("deny");
  });

  it("denies a currency not on the inr-only allowlist", () => {
    const compiled = compile([{ kind: "inr-only" }]);
    const outcome = checkCompiledPolicy(compiled, baseInput({ currency: "USD" }));
    expect(outcome.kind).toBe("deny");
  });

  it("allows INR when inr-only is configured", () => {
    const compiled = compile([{ kind: "inr-only" }]);
    const outcome = checkCompiledPolicy(compiled, baseInput({ currency: "INR" }));
    expect(outcome.kind).toBe("allow");
  });

  it("denies a destination outside the india-destination allowlist", () => {
    const compiled = compile([{ kind: "india-destination", allowedDestinations: ["IN"] }]);
    const outcome = checkCompiledPolicy(compiled, baseInput({ destinationCountry: "US" }));
    expect(outcome.kind).toBe("deny");
  });

  it("denies when destination is unknown and a destination allowlist is configured", () => {
    const compiled = compile([{ kind: "india-destination", allowedDestinations: ["IN"] }]);
    const outcome = checkCompiledPolicy(compiled, baseInput({ destinationCountry: undefined }));
    expect(outcome.kind).toBe("deny");
  });

  it("allows a destination inside the india-destination allowlist", () => {
    const compiled = compile([{ kind: "india-destination", allowedDestinations: ["IN"] }]);
    const outcome = checkCompiledPolicy(compiled, baseInput({ destinationCountry: "IN" }));
    expect(outcome.kind).toBe("allow");
  });

  it("denies a payment method not on the payment-path allowlist", () => {
    const compiled = compile([{ kind: "payment-path", allowedMethods: ["upi"] }]);
    const outcome = checkCompiledPolicy(compiled, baseInput({ paymentMethod: "card" }));
    expect(outcome.kind).toBe("deny");
  });

  it("allows a payment method on the payment-path allowlist", () => {
    const compiled = compile([{ kind: "payment-path", allowedMethods: ["upi", "card"] }]);
    const outcome = checkCompiledPolicy(compiled, baseInput({ paymentMethod: "card" }));
    expect(outcome.kind).toBe("allow");
  });

  it("denies a variant not on the product-allowlist", () => {
    const compiled = compile([
      { kind: "product-allowlist", products: ["gid://shopify/ProductVariant/other"] },
    ]);
    const outcome = checkCompiledPolicy(
      compiled,
      baseInput({ variantId: "gid://shopify/ProductVariant/1" }),
    );
    expect(outcome.kind).toBe("deny");
  });

  it("allows a variant on the product-allowlist", () => {
    const compiled = compile([
      { kind: "product-allowlist", products: ["gid://shopify/ProductVariant/1"] },
    ]);
    const outcome = checkCompiledPolicy(
      compiled,
      baseInput({ variantId: "gid://shopify/ProductVariant/1" }),
    );
    expect(outcome.kind).toBe("allow");
  });

  it("denies a quantity above the quantity-limit", () => {
    const compiled = compile([
      { kind: "quantity-limit", maxQuantity: { value: "2", unit: "item" as never } },
    ]);
    const outcome = checkCompiledPolicy(compiled, baseInput({ quantity: 3 }));
    expect(outcome.kind).toBe("deny");
  });

  it("allows a quantity at or below the quantity-limit", () => {
    const compiled = compile([
      { kind: "quantity-limit", maxQuantity: { value: "2", unit: "item" as never } },
    ]);
    expect(checkCompiledPolicy(compiled, baseInput({ quantity: 2 })).kind).toBe("allow");
    expect(checkCompiledPolicy(compiled, baseInput({ quantity: 1 })).kind).toBe("allow");
  });

  it("denies a stale quote past the freshness-requirement", () => {
    const compiled = compile([{ kind: "freshness-requirement", maxAgeMs: 5_000 }]);
    const outcome = checkCompiledPolicy(
      compiled,
      baseInput({ quoteCreatedAtMs: now - 10_000, nowMs: now }),
    );
    expect(outcome.kind).toBe("deny");
  });

  it("allows a fresh quote within the freshness-requirement", () => {
    const compiled = compile([{ kind: "freshness-requirement", maxAgeMs: 5_000 }]);
    const outcome = checkCompiledPolicy(
      compiled,
      baseInput({ quoteCreatedAtMs: now - 1_000, nowMs: now }),
    );
    expect(outcome.kind).toBe("allow");
  });

  it("surfaces review_required (not deny) above the review-threshold", () => {
    const compiled = compile([
      {
        kind: "review-threshold",
        thresholdAmount: { amountMinor: 5_000n, currency: "INR" as never },
      },
    ]);
    const outcome = checkCompiledPolicy(compiled, baseInput({ totalAmountMinor: 10_000n }));
    expect(outcome.kind).toBe("review_required");
  });

  it("allows an amount at or below the review-threshold", () => {
    const compiled = compile([
      {
        kind: "review-threshold",
        thresholdAmount: { amountMinor: 10_000n, currency: "INR" as never },
      },
    ]);
    const outcome = checkCompiledPolicy(compiled, baseInput({ totalAmountMinor: 10_000n }));
    expect(outcome.kind).toBe("allow");
  });

  it("combines rules: an otherwise-allowed request is denied by any single failing dimension", () => {
    const compiled = compile([
      { kind: "india-destination", allowedDestinations: ["IN"] },
      { kind: "payment-path", allowedMethods: ["upi"] },
    ]);
    expect(
      checkCompiledPolicy(compiled, baseInput({ destinationCountry: "IN", paymentMethod: "upi" }))
        .kind,
    ).toBe("allow");
    expect(
      checkCompiledPolicy(compiled, baseInput({ destinationCountry: "US", paymentMethod: "upi" }))
        .kind,
    ).toBe("deny");
    expect(
      checkCompiledPolicy(compiled, baseInput({ destinationCountry: "IN", paymentMethod: "card" }))
        .kind,
    ).toBe("deny");
  });
});
