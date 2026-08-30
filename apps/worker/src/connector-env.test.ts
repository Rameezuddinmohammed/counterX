import { describe, expect, it } from "vitest";

import {
  DEFAULT_RAZORPAY_BASE_URL,
  DEFAULT_SHOPIFY_API_VERSION,
  isProdLike,
  requireCounterTestPaymentSigner,
  requireRazorpayCredentials,
  requireShopifyCredentials,
  resolveCounterTestPaymentSigner,
  resolveRazorpayCredentials,
  resolveShopifyCredentials,
  type EnvironmentBag,
} from "./connector-env.js";
import { TEST_KID_A } from "@counter/trust-protocol";

// A sentinel secret used only inside these tests. It is NOT a real credential.
const FAKE_SHOPIFY_TOKEN = "shpat_synthetic_test_token";
const FAKE_RAZORPAY_SECRET = "rzp_synthetic_test_secret";
const FAKE_RAZORPAY_WEBHOOK_SECRET = "rzp_synthetic_webhook_secret";

const localEnv = (extra: EnvironmentBag = {}): EnvironmentBag => ({
  COUNTER_ENV: "local",
  NODE_ENV: "development",
  ...extra,
});

const prodEnv = (extra: EnvironmentBag = {}): EnvironmentBag => ({
  COUNTER_ENV: "production",
  NODE_ENV: "production",
  ...extra,
});

describe("isProdLike", () => {
  it("treats local/test/development as NOT prod-like", () => {
    expect(isProdLike({ COUNTER_ENV: "local" })).toBe(false);
    expect(isProdLike({ COUNTER_ENV: "test" })).toBe(false);
    expect(isProdLike({ NODE_ENV: "development" })).toBe(false);
  });

  it("treats production/sandbox/pilot as prod-like", () => {
    expect(isProdLike({ COUNTER_ENV: "production" })).toBe(true);
    expect(isProdLike({ COUNTER_ENV: "sandbox" })).toBe(true);
    expect(isProdLike({ COUNTER_ENV: "pilot" })).toBe(true);
  });

  it("treats an absent or unknown environment as prod-like (fail-fast)", () => {
    expect(isProdLike({})).toBe(true);
    expect(isProdLike({ COUNTER_ENV: "staging-typo" })).toBe(true);
  });

  it("prefers COUNTER_ENV over NODE_ENV", () => {
    expect(isProdLike({ COUNTER_ENV: "local", NODE_ENV: "production" })).toBe(false);
    expect(isProdLike({ COUNTER_ENV: "production", NODE_ENV: "development" })).toBe(true);
  });
});

describe("resolveShopifyCredentials", () => {
  it("returns null when required vars are absent", () => {
    expect(resolveShopifyCredentials(localEnv())).toBeNull();
    expect(
      resolveShopifyCredentials(localEnv({ SHOPIFY_STORE_DOMAIN: "shop.myshopify.com" })),
    ).toBeNull();
  });

  it("treats empty/whitespace values as absent", () => {
    expect(
      resolveShopifyCredentials(
        localEnv({ SHOPIFY_STORE_DOMAIN: "   ", SHOPIFY_ACCESS_TOKEN: FAKE_SHOPIFY_TOKEN }),
      ),
    ).toBeNull();
  });

  it("returns parsed config when all required vars are present", () => {
    const result = resolveShopifyCredentials(
      localEnv({
        SHOPIFY_STORE_DOMAIN: "shop.myshopify.com",
        SHOPIFY_ACCESS_TOKEN: FAKE_SHOPIFY_TOKEN,
        SHOPIFY_API_VERSION: "2025-01",
      }),
    );
    expect(result).toEqual({
      shopDomain: "shop.myshopify.com",
      accessToken: FAKE_SHOPIFY_TOKEN,
      apiVersion: "2025-01",
    });
  });

  it("applies the default API version when unset", () => {
    const result = resolveShopifyCredentials(
      localEnv({
        SHOPIFY_STORE_DOMAIN: "shop.myshopify.com",
        SHOPIFY_ACCESS_TOKEN: FAKE_SHOPIFY_TOKEN,
      }),
    );
    expect(result?.apiVersion).toBe(DEFAULT_SHOPIFY_API_VERSION);
  });

  it("falls back to SHOPIFY_SHOP_DOMAIN when SHOPIFY_STORE_DOMAIN is absent", () => {
    const result = resolveShopifyCredentials(
      localEnv({
        SHOPIFY_SHOP_DOMAIN: "legacy.myshopify.com",
        SHOPIFY_ACCESS_TOKEN: FAKE_SHOPIFY_TOKEN,
      }),
    );
    expect(result?.shopDomain).toBe("legacy.myshopify.com");
  });

  it("does not expose the secret via Object toString", () => {
    const result = resolveShopifyCredentials(
      localEnv({
        SHOPIFY_STORE_DOMAIN: "shop.myshopify.com",
        SHOPIFY_ACCESS_TOKEN: FAKE_SHOPIFY_TOKEN,
      }),
    );
    // Default Object.prototype.toString must not embed the secret value.
    expect(Object.prototype.toString.call(result)).toBe("[object Object]");
    // The secret is only reachable through the explicit typed property.
    expect(result?.accessToken).toBe(FAKE_SHOPIFY_TOKEN);
  });
});

describe("resolveRazorpayCredentials", () => {
  it("returns null when required vars are absent", () => {
    expect(resolveRazorpayCredentials(localEnv())).toBeNull();
    expect(
      resolveRazorpayCredentials(
        localEnv({ RAZORPAY_KEY_ID: "rzp_key", RAZORPAY_KEY_SECRET: FAKE_RAZORPAY_SECRET }),
      ),
    ).toBeNull();
  });

  it("returns parsed config when all required vars are present", () => {
    const result = resolveRazorpayCredentials(
      localEnv({
        RAZORPAY_KEY_ID: "rzp_key",
        RAZORPAY_KEY_SECRET: FAKE_RAZORPAY_SECRET,
        RAZORPAY_WEBHOOK_SECRET: FAKE_RAZORPAY_WEBHOOK_SECRET,
        RAZORPAY_BASE_URL: "https://api.razorpay.com/v2",
      }),
    );
    expect(result).toEqual({
      keyId: "rzp_key",
      keySecret: FAKE_RAZORPAY_SECRET,
      webhookSecret: FAKE_RAZORPAY_WEBHOOK_SECRET,
      baseUrl: "https://api.razorpay.com/v2",
    });
  });

  it("applies the default base URL when unset", () => {
    const result = resolveRazorpayCredentials(
      localEnv({
        RAZORPAY_KEY_ID: "rzp_key",
        RAZORPAY_KEY_SECRET: FAKE_RAZORPAY_SECRET,
        RAZORPAY_WEBHOOK_SECRET: FAKE_RAZORPAY_WEBHOOK_SECRET,
      }),
    );
    expect(result?.baseUrl).toBe(DEFAULT_RAZORPAY_BASE_URL);
  });
});

describe("requireShopifyCredentials", () => {
  it("returns null (mock fallback) when creds absent in local/test", () => {
    expect(requireShopifyCredentials(localEnv())).toBeNull();
  });

  it("returns the real config when creds are present regardless of environment", () => {
    const result = requireShopifyCredentials(
      prodEnv({
        SHOPIFY_STORE_DOMAIN: "shop.myshopify.com",
        SHOPIFY_ACCESS_TOKEN: FAKE_SHOPIFY_TOKEN,
      }),
    );
    expect(result?.shopDomain).toBe("shop.myshopify.com");
  });

  it("throws naming the missing vars when creds absent in prod-like env", () => {
    expect(() => requireShopifyCredentials(prodEnv())).toThrow(/SHOPIFY_STORE_DOMAIN/);
    expect(() => requireShopifyCredentials(prodEnv())).toThrow(/SHOPIFY_ACCESS_TOKEN/);
  });

  it("does not include the secret value in the fail-loud error", () => {
    let message = "";
    try {
      requireShopifyCredentials(prodEnv({ SHOPIFY_STORE_DOMAIN: "shop.myshopify.com" }));
    } catch (error) {
      message = (error as Error).message;
    }
    // Access token is missing, so the error names it but never a value.
    expect(message).toContain("SHOPIFY_ACCESS_TOKEN");
    expect(message).not.toContain(FAKE_SHOPIFY_TOKEN);
  });
});

describe("requireRazorpayCredentials", () => {
  it("returns null (mock fallback) when creds absent in local/test", () => {
    expect(requireRazorpayCredentials(localEnv())).toBeNull();
  });

  it("throws naming the missing vars when creds absent in prod-like env", () => {
    expect(() => requireRazorpayCredentials(prodEnv())).toThrow(/RAZORPAY_KEY_ID/);
    expect(() => requireRazorpayCredentials(prodEnv())).toThrow(/RAZORPAY_KEY_SECRET/);
    expect(() => requireRazorpayCredentials(prodEnv())).toThrow(/RAZORPAY_WEBHOOK_SECRET/);
  });

  it("does not include the secret value in the fail-loud error", () => {
    let message = "";
    try {
      requireRazorpayCredentials(prodEnv({ RAZORPAY_KEY_ID: "rzp_key" }));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("RAZORPAY_KEY_SECRET");
    expect(message).not.toContain(FAKE_RAZORPAY_SECRET);
  });
});

// A synthetic 32-byte Ed25519 seed used only inside these tests. NOT a real key.
const FAKE_SIGNER_SEED = "QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI";

describe("resolveCounterTestPaymentSigner", () => {
  it("returns null when either variable is absent", () => {
    expect(resolveCounterTestPaymentSigner({})).toBeNull();
    expect(
      resolveCounterTestPaymentSigner({ COUNTER_TEST_PAYMENT_SIGNER_KID: "k1" }),
    ).toBeNull();
  });

  it("returns null when the seed does not decode to 32 bytes", () => {
    expect(
      resolveCounterTestPaymentSigner({
        COUNTER_TEST_PAYMENT_SIGNER_KID: "k1",
        COUNTER_TEST_PAYMENT_SIGNER_SEED: Buffer.from("too-short").toString("base64url"),
      }),
    ).toBeNull();
  });

  it("resolves a valid kid/seed pair", () => {
    const resolved = resolveCounterTestPaymentSigner({
      COUNTER_TEST_PAYMENT_SIGNER_KID: "k1",
      COUNTER_TEST_PAYMENT_SIGNER_SEED: FAKE_SIGNER_SEED,
    });
    expect(resolved?.kid).toBe("k1");
    expect(resolved?.seed.length).toBe(32);
  });
});

describe("requireCounterTestPaymentSigner", () => {
  it("uses the real configured secret when present, in any environment", () => {
    const resolved = requireCounterTestPaymentSigner(
      prodEnv({
        COUNTER_TEST_PAYMENT_SIGNER_KID: "k1",
        COUNTER_TEST_PAYMENT_SIGNER_SEED: FAKE_SIGNER_SEED,
      }),
    );
    expect(resolved.kid).toBe("k1");
    expect(resolved.isFixture).toBe(false);
  });

  it("falls back to the named public fixture in a mock-eligible environment", () => {
    const resolved = requireCounterTestPaymentSigner(localEnv());
    expect(resolved.kid).toBe(TEST_KID_A);
    expect(resolved.isFixture).toBe(true);
  });

  it("throws (fail loud) in a production-like environment without a real signer, never using the public fixture", () => {
    expect(() => requireCounterTestPaymentSigner(prodEnv())).toThrow(
      /COUNTER_TEST_PAYMENT_SIGNER_KID/,
    );
  });
});
