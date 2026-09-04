import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_SPEND_LIMIT_CONFIG,
  type PolicyConfigEntry,
  type PostgresPaymentConnectionReadStore,
} from "@counter/data";
import type { EnvironmentBag } from "./connector-env.js";
import { createCounterId, type CounterId } from "@counter/domain";
import type * as RazorpayAdapterModule from "@counter/razorpay-adapter";

const recurringMandateProviderCalls: Array<{ keyId: string; keySecret: string }> = [];

vi.mock("@counter/razorpay-adapter", async () => {
  const actual = await vi.importActual<typeof RazorpayAdapterModule>("@counter/razorpay-adapter");
  return {
    ...actual,
    createRealRazorpayRecurringMandateProvider: (
      config: Parameters<typeof actual.createRealRazorpayRecurringMandateProvider>[0],
    ) => {
      recurringMandateProviderCalls.push({ keyId: config.keyId, keySecret: config.keySecret });
      return actual.createRealRazorpayRecurringMandateProvider(config);
    },
  };
});

const {
  selectPaymentAuthorizationPort,
  createDeterministicPaymentAuthorizationPort,
  resolveSpendLimitConfig,
  pilotMerchantId,
} = await import("./boot.js");

function txnId(fill: number): CounterId<"transaction"> {
  const r = createCounterId("transaction", new Uint8Array(16).fill(fill));
  if (!r.ok) throw new Error("bad txn id");
  return r.value;
}

describe("selectPaymentAuthorizationPort", () => {
  it("falls back to the deterministic port in local/test without credentials", async () => {
    const env: EnvironmentBag = { COUNTER_ENV: "test" };
    const selection = await selectPaymentAuthorizationPort(env);
    expect(selection.mode).toBe("deterministic");
  });

  it("throws (fail loud) in a prod-like environment without credentials", async () => {
    const env: EnvironmentBag = { COUNTER_ENV: "production" };
    await expect(selectPaymentAuthorizationPort(env)).rejects.toThrow(/production-like/);
  });

  it("selects the real port when both credential sets are present", async () => {
    const env: EnvironmentBag = {
      COUNTER_ENV: "test",
      SHOPIFY_STORE_DOMAIN: "counter-commerce-agent.myshopify.com",
      SHOPIFY_ACCESS_TOKEN: "shpat_fake",
      RAZORPAY_KEY_ID: "rzp_test_fake",
      RAZORPAY_KEY_SECRET: "secret_fake",
      RAZORPAY_WEBHOOK_SECRET: "whsecret_fake",
    };
    const selection = await selectPaymentAuthorizationPort(env);
    expect(selection.mode).toBe("real");
  });

  it("uses deterministic when only Shopify credentials are present (local/test)", async () => {
    const env: EnvironmentBag = {
      COUNTER_ENV: "local",
      SHOPIFY_STORE_DOMAIN: "counter-commerce-agent.myshopify.com",
      SHOPIFY_ACCESS_TOKEN: "shpat_fake",
    };
    const selection = await selectPaymentAuthorizationPort(env);
    expect(selection.mode).toBe("deterministic");
  });

  it("uses the merchant's OWN verified Razorpay credentials when a paymentConnectionStore is wired in", async () => {
    const env: EnvironmentBag = {
      COUNTER_ENV: "test",
      SHOPIFY_STORE_DOMAIN: "counter-commerce-agent.myshopify.com",
      SHOPIFY_ACCESS_TOKEN: "shpat_fake",
      RAZORPAY_KEY_ID: "rzp_test_platform_shared",
      RAZORPAY_KEY_SECRET: "secret_platform_shared",
      RAZORPAY_WEBHOOK_SECRET: "whsecret_fake",
    };
    const merchantId = pilotMerchantId();
    const store = {
      findByMerchantId: async (id: string) => {
        expect(id).toBe(merchantId);
        return {
          keyId: "rzp_test_merchant_own",
          keySecret: "secret_merchant_own",
          verifiedAt: "2026-01-01T00:00:00.000Z",
        };
      },
    } as unknown as PostgresPaymentConnectionReadStore;

    const selection = await selectPaymentAuthorizationPort(env, undefined, {
      paymentConnectionStore: store,
    });
    expect(selection.mode).toBe("real");
  });

  it("routes recurring-mandate charges through the SAME merchant-resolved credentials as the one-shot order path, not the raw platform env pair", async () => {
    recurringMandateProviderCalls.length = 0;
    const env: EnvironmentBag = {
      COUNTER_ENV: "test",
      SHOPIFY_STORE_DOMAIN: "counter-commerce-agent.myshopify.com",
      SHOPIFY_ACCESS_TOKEN: "shpat_fake",
      RAZORPAY_KEY_ID: "rzp_test_platform_shared",
      RAZORPAY_KEY_SECRET: "secret_platform_shared",
      RAZORPAY_WEBHOOK_SECRET: "whsecret_fake",
    };
    const store = {
      findByMerchantId: async () => ({
        keyId: "rzp_test_merchant_own",
        keySecret: "secret_merchant_own",
        verifiedAt: "2026-01-01T00:00:00.000Z",
      }),
    } as unknown as PostgresPaymentConnectionReadStore;

    const selection = await selectPaymentAuthorizationPort(env, undefined, {
      paymentConnectionStore: store,
    });
    expect(selection.mode).toBe("real");

    expect(recurringMandateProviderCalls).toEqual([
      { keyId: "rzp_test_merchant_own", keySecret: "secret_merchant_own" },
    ]);
  });

  it("fails loud (never falls back to the shared credential) when the merchant has no connected gateway", async () => {
    const env: EnvironmentBag = {
      COUNTER_ENV: "test",
      SHOPIFY_STORE_DOMAIN: "counter-commerce-agent.myshopify.com",
      SHOPIFY_ACCESS_TOKEN: "shpat_fake",
      RAZORPAY_KEY_ID: "rzp_test_platform_shared",
      RAZORPAY_KEY_SECRET: "secret_platform_shared",
      RAZORPAY_WEBHOOK_SECRET: "whsecret_fake",
    };
    const store = {
      findByMerchantId: async () => undefined,
    } as unknown as PostgresPaymentConnectionReadStore;

    await expect(
      selectPaymentAuthorizationPort(env, undefined, { paymentConnectionStore: store }),
    ).rejects.toThrow(/has not connected a Razorpay payment gateway/);
  });
});

describe("resolveSpendLimitConfig", () => {
  it("falls back to the platform default when no policy entry exists", () => {
    expect(resolveSpendLimitConfig(undefined)).toEqual(DEFAULT_SPEND_LIMIT_CONFIG);
  });

  it("falls back to the default when the config has no spendLimits field", () => {
    const entry: PolicyConfigEntry = { config: { policyVersion: "v1", rules: [] }, version: 1 };
    expect(resolveSpendLimitConfig(entry)).toEqual(DEFAULT_SPEND_LIMIT_CONFIG);
  });

  it("falls back to the default when spendLimits is malformed (fails closed, not open)", () => {
    const entry: PolicyConfigEntry = {
      config: { spendLimits: { maxTransactionAmountMinor: "not-a-number" } },
      version: 1,
    };
    expect(resolveSpendLimitConfig(entry)).toEqual(DEFAULT_SPEND_LIMIT_CONFIG);
  });

  it("parses a valid per-merchant override", () => {
    const entry: PolicyConfigEntry = {
      config: {
        policyVersion: "v1",
        rules: [],
        effectiveFrom: "2026-01-01T00:00:00.000Z",
        spendLimits: {
          maxTransactionAmountMinor: "250000",
          maxRolling24hTotalMinor: "500000",
          maxAttemptsPerWindow: 3,
          windowMs: 3_600_000,
          currency: "INR",
        },
      },
      version: 2,
    };
    expect(resolveSpendLimitConfig(entry)).toEqual({
      maxTransactionAmountMinor: 250_000n,
      maxRolling24hTotalMinor: 500_000n,
      maxAttemptsPerWindow: 3,
      windowMs: 3_600_000,
      currency: "INR",
    });
  });
});

describe("deterministic PaymentAuthorizationPort", () => {
  it("captures the intended amount and is stable across replays", async () => {
    const port = createDeterministicPaymentAuthorizationPort();
    const request = {
      transactionId: txnId(2),
      amountMinor: 4999,
      currency: "INR",
      idempotencyKey: "order-det",
    };
    const first = await port.authorizeAndCapture(request);
    const second = await port.authorizeAndCapture(request);
    expect(first.status).toBe("captured");
    expect(first.capturedMinor).toBe(4999);
    expect(second.providerReference).toBe(first.providerReference);
  });
});
