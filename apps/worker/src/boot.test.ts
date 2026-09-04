import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_SPEND_LIMIT_CONFIG,
  type PolicyConfigEntry,
  type PostgresPaymentConnectionReadStore,
} from "@counter/data";
import type { EnvironmentBag } from "./connector-env.js";
import { createCounterId, type CounterId, type MerchantId } from "@counter/domain";
import type * as RazorpayAdapterModule from "@counter/razorpay-adapter";
import type { MerchantShopifyConnectionReadStore } from "./merchant-shopify-connection-store.js";
import type { AuthorityEnvelope } from "./transaction-lifecycle.js";

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

function otherMerchantId(): MerchantId {
  const r = createCounterId("merchant", new Uint8Array(16).fill(9));
  if (!r.ok) throw new Error("bad merchant id");
  return r.value;
}

/** A request with no variantId reaches real per-merchant credential
 * resolution and then throws at resolveVariant BEFORE any real network
 * call — the cheapest way to observe "which merchant's credentials did
 * this request actually resolve" without hitting Shopify/Razorpay. */
function requestForMerchant(merchantId: string | undefined, idempotencyKey: string) {
  return {
    transactionId: txnId(3),
    amountMinor: 1000,
    currency: "INR",
    idempotencyKey,
    authority: (merchantId !== undefined ? { authorizedMerchantId: merchantId } : undefined) as
      | AuthorityEnvelope
      | undefined,
  };
}

describe("selectPaymentAuthorizationPort — multi-tenant per-merchant routing", () => {
  function multiTenantEnv(): EnvironmentBag {
    return {
      COUNTER_ENV: "test",
      SHOPIFY_STORE_DOMAIN: "pilot-fallback.myshopify.com",
      SHOPIFY_ACCESS_TOKEN: "shpat_pilot_fallback",
      RAZORPAY_KEY_ID: "rzp_test_platform_shared",
      RAZORPAY_KEY_SECRET: "secret_platform_shared",
      RAZORPAY_WEBHOOK_SECRET: "whsecret_fake",
    };
  }

  function trackedStores(
    shopifyByMerchant: Record<string, { shopDomain: string; accessToken: string } | undefined>,
    razorpayByMerchant: Record<string, { keyId: string; keySecret: string } | undefined>,
  ) {
    const shopifyCalls: string[] = [];
    const razorpayCalls: string[] = [];
    const merchantShopifyConnectionStore: MerchantShopifyConnectionReadStore = {
      async findActiveByMerchantId(merchantId) {
        shopifyCalls.push(merchantId);
        return shopifyByMerchant[merchantId];
      },
    };
    const paymentConnectionStore = {
      async findByMerchantId(merchantId: string) {
        razorpayCalls.push(merchantId);
        const found = razorpayByMerchant[merchantId];
        return found === undefined
          ? undefined
          : { ...found, verifiedAt: "2026-01-01T00:00:00.000Z" };
      },
    } as unknown as PostgresPaymentConnectionReadStore;
    return { merchantShopifyConnectionStore, paymentConnectionStore, shopifyCalls, razorpayCalls };
  }

  it("resolves each merchant's OWN Shopify/Razorpay credentials independently, and caches per merchant", async () => {
    const pilot = pilotMerchantId();
    const other = otherMerchantId();
    const { merchantShopifyConnectionStore, paymentConnectionStore, shopifyCalls, razorpayCalls } =
      trackedStores(
        {
          [other]: { shopDomain: "other-merchant.myshopify.com", accessToken: "shpat_other" },
        },
        {
          [pilot]: { keyId: "rzp_pilot_own", keySecret: "secret_pilot_own" },
          [other]: { keyId: "rzp_other_own", keySecret: "secret_other_own" },
        },
      );

    const selection = await selectPaymentAuthorizationPort(multiTenantEnv(), undefined, {
      paymentConnectionStore,
      merchantShopifyConnectionStore,
    });
    expect(selection.mode).toBe("real");

    // Building the pilot config eagerly (selectPaymentAuthorizationPort's own
    // behavior, unrelated to any request) already resolves pilot once for
    // BOTH stores — resolveShopifyCredentialsForMerchant always queries the
    // store first (even for the pilot) before falling back to env.
    expect(razorpayCalls).toEqual([pilot]);
    expect(shopifyCalls).toEqual([pilot]);

    await expect(
      selection.port.authorizeAndCapture(requestForMerchant(other, "txn-other-1")),
    ).rejects.toThrow(/requested capability is unavailable/);
    expect(razorpayCalls).toEqual([pilot, other]);
    expect(shopifyCalls).toEqual([pilot, other]);

    // A second request for the SAME other merchant must hit the cache, not
    // re-query either store.
    await expect(
      selection.port.authorizeAndCapture(requestForMerchant(other, "txn-other-2")),
    ).rejects.toThrow(/requested capability is unavailable/);
    expect(razorpayCalls).toEqual([pilot, other]);
    expect(shopifyCalls).toEqual([pilot, other]);

    // A request with no authorizedMerchantId falls back to the pilot's
    // ALREADY-cached config — no new store calls at all.
    await expect(
      selection.port.authorizeAndCapture(requestForMerchant(undefined, "txn-pilot-fallback")),
    ).rejects.toThrow(/requested capability is unavailable/);
    expect(razorpayCalls).toEqual([pilot, other]);
    expect(shopifyCalls).toEqual([pilot, other]);
  });

  it("the pilot merchant falls back to env Shopify credentials when it has no connection row (verified against the real prod DB state)", async () => {
    const pilot = pilotMerchantId();
    const { merchantShopifyConnectionStore, paymentConnectionStore } = trackedStores(
      {},
      { [pilot]: { keyId: "rzp_pilot_own", keySecret: "secret_pilot_own" } },
    );

    const selection = await selectPaymentAuthorizationPort(multiTenantEnv(), undefined, {
      paymentConnectionStore,
      merchantShopifyConnectionStore,
    });
    // Reaching resolveVariant's error (not a "has not connected" error) proves
    // the pilot's config was built successfully via the env fallback.
    await expect(
      selection.port.authorizeAndCapture(requestForMerchant(pilot, "txn-pilot-explicit")),
    ).rejects.toThrow(/requested capability is unavailable/);
  });

  it("a NON-pilot merchant with no Shopify connection fails loud, never silently borrows another merchant's store", async () => {
    const other = otherMerchantId();
    const { merchantShopifyConnectionStore, paymentConnectionStore } = trackedStores(
      {},
      {
        [pilotMerchantId()]: { keyId: "rzp_pilot_own", keySecret: "secret_pilot_own" },
        [other]: { keyId: "rzp_other_own", keySecret: "secret_other_own" },
      },
    );

    const selection = await selectPaymentAuthorizationPort(multiTenantEnv(), undefined, {
      paymentConnectionStore,
      merchantShopifyConnectionStore,
    });
    await expect(
      selection.port.authorizeAndCapture(requestForMerchant(other, "txn-other-no-shopify")),
    ).rejects.toThrow(/has not connected a Shopify store/);
  });

  it("a NON-pilot merchant with no Razorpay connection fails loud too", async () => {
    const other = otherMerchantId();
    const { merchantShopifyConnectionStore, paymentConnectionStore } = trackedStores(
      { [other]: { shopDomain: "other-merchant.myshopify.com", accessToken: "shpat_other" } },
      { [pilotMerchantId()]: { keyId: "rzp_pilot_own", keySecret: "secret_pilot_own" } },
    );

    const selection = await selectPaymentAuthorizationPort(multiTenantEnv(), undefined, {
      paymentConnectionStore,
      merchantShopifyConnectionStore,
    });
    await expect(
      selection.port.authorizeAndCapture(requestForMerchant(other, "txn-other-no-razorpay")),
    ).rejects.toThrow(/has not connected a Razorpay payment gateway/);
  });

  it("rejects a request whose authorizedMerchantId is not a valid merchant CounterId", async () => {
    const { merchantShopifyConnectionStore, paymentConnectionStore } = trackedStores(
      {},
      { [pilotMerchantId()]: { keyId: "rzp_pilot_own", keySecret: "secret_pilot_own" } },
    );
    const selection = await selectPaymentAuthorizationPort(multiTenantEnv(), undefined, {
      paymentConnectionStore,
      merchantShopifyConnectionStore,
    });
    await expect(
      selection.port.authorizeAndCapture(requestForMerchant("not-a-real-id", "txn-bad-id")),
    ).rejects.toThrow(/not a valid merchant CounterId/);
  });

  it("without merchantShopifyConnectionStore wired at all, behaves exactly as before: only the pilot merchant can ever succeed", async () => {
    const other = otherMerchantId();
    const paymentConnectionStore = {
      async findByMerchantId(merchantId: string) {
        return {
          keyId: `rzp_${merchantId}`,
          keySecret: "s",
          verifiedAt: "2026-01-01T00:00:00.000Z",
        };
      },
    } as unknown as PostgresPaymentConnectionReadStore;

    const selection = await selectPaymentAuthorizationPort(multiTenantEnv(), undefined, {
      paymentConnectionStore,
    });
    // Pilot still works (env Shopify fallback + its own Razorpay creds).
    await expect(
      selection.port.authorizeAndCapture(requestForMerchant(pilotMerchantId(), "txn-legacy-pilot")),
    ).rejects.toThrow(/requested capability is unavailable/);
    // A different merchant, with no way to resolve its OWN Shopify store
    // (no store wired), fails loud rather than silently using the pilot's.
    await expect(
      selection.port.authorizeAndCapture(requestForMerchant(other, "txn-legacy-other")),
    ).rejects.toThrow(/has not connected a Shopify store/);
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
