import { describe, expect, it } from "vitest";
import type { IsoCurrencyCode, MerchantId, Money, WalletId, Instant } from "@counter/domain";
import { ScenarioDriver } from "./scenario-driver.js";
import type {
  CheckoutPort,
  CheckoutResult,
  DiscoveryPort,
  DiscoveryResult,
  QuotePort,
  QuoteResult,
  SearchPort,
  SearchResult,
} from "./scenario-driver.js";

// ---------------------------------------------------------------------------
// Mock Ports
// ---------------------------------------------------------------------------

const TEST_MERCHANT_ID = "ctr_merchant_dGVzdC1tZXJjaGFudC0w" as MerchantId;
const TEST_WALLET_ID = "ctr_wallet_dGVzdC13YWxsZXQtMDAx" as WalletId;
const TEST_CURRENCY = "INR" as IsoCurrencyCode;

function createMockDiscoveryPort(result?: DiscoveryResult): DiscoveryPort {
  return {
    discover: async (merchantId) =>
      result ?? {
        merchantId,
        name: "Test Merchant",
        categories: ["electronics"],
        region: "IN",
        allowlisted: true,
      },
  };
}

function createMockSearchPort(results?: readonly SearchResult[]): SearchPort {
  return {
    search: async () =>
      results ?? [
        {
          productId: "prod-001",
          variantId: "var-001",
          title: "Test Product",
          priceMinor: 100_000n,
          currency: TEST_CURRENCY,
          available: true,
        },
      ],
  };
}

function createMockQuotePort(result?: QuoteResult): QuotePort {
  return {
    getQuote: async () =>
      result ?? {
        quoteId: "quote-001",
        quoteDigest: "sha256:abc123",
        totalMinor: 100_000n,
        currency: TEST_CURRENCY,
        expiresAt: (Date.now() + 15 * 60 * 1000) as Instant,
        items: [{ variantId: "var-001", quantity: 1, unitPriceMinor: 100_000n, lineTotalMinor: 100_000n }],
      },
  };
}

function createMockCheckoutPort(result?: CheckoutResult): CheckoutPort {
  return {
    executeCheckout: async () =>
      result ?? {
        outcome: "success",
        phase: "receipt",
        details: "Checkout completed successfully",
        paymentReference: "pay-ref-001",
        orderReference: "order-ref-001",
        receiptId: "receipt-001",
      },
  };
}

function createTestDriver(overrides?: {
  discovery?: DiscoveryPort;
  search?: SearchPort;
  quote?: QuotePort;
  checkout?: CheckoutPort;
}): ScenarioDriver {
  return new ScenarioDriver({
    discoveryPort: overrides?.discovery ?? createMockDiscoveryPort(),
    searchPort: overrides?.search ?? createMockSearchPort(),
    quotePort: overrides?.quote ?? createMockQuotePort(),
    checkoutPort: overrides?.checkout ?? createMockCheckoutPort(),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ScenarioDriver", () => {
  describe("discover", () => {
    it("returns merchant discovery result", async () => {
      const driver = createTestDriver();
      const result = await driver.discover(TEST_MERCHANT_ID);

      expect(result).toBeDefined();
      expect(result!.merchantId).toBe(TEST_MERCHANT_ID);
      expect(result!.allowlisted).toBe(true);
      expect(result!.region).toBe("IN");
    });

    it("returns undefined for unknown merchant", async () => {
      const driver = createTestDriver({
        discovery: { discover: async () => undefined },
      });
      const result = await driver.discover(TEST_MERCHANT_ID);

      expect(result).toBeUndefined();
    });
  });

  describe("search", () => {
    it("returns product search results", async () => {
      const driver = createTestDriver();
      const results = await driver.search(TEST_MERCHANT_ID, "test product");

      expect(results.length).toBe(1);
      expect(results[0]!.variantId).toBe("var-001");
      expect(results[0]!.available).toBe(true);
    });

    it("returns empty array for no results", async () => {
      const driver = createTestDriver({
        search: { search: async () => [] },
      });
      const results = await driver.search(TEST_MERCHANT_ID, "nonexistent");

      expect(results.length).toBe(0);
    });
  });

  describe("getQuote", () => {
    it("returns a binding quote with digest", async () => {
      const driver = createTestDriver();
      const quote = await driver.getQuote(TEST_MERCHANT_ID, [
        { variantId: "var-001", quantity: 1 },
      ]);

      expect(quote.quoteId).toBe("quote-001");
      expect(quote.quoteDigest).toBe("sha256:abc123");
      expect(quote.totalMinor).toBe(100_000n);
    });
  });

  describe("verifyDigest", () => {
    it("returns true when digests match", async () => {
      const driver = createTestDriver();
      const quote = await driver.getQuote(TEST_MERCHANT_ID, [
        { variantId: "var-001", quantity: 1 },
      ]);

      expect(driver.verifyDigest(quote, "sha256:abc123")).toBe(true);
    });

    it("returns false when digests do not match", async () => {
      const driver = createTestDriver();
      const quote = await driver.getQuote(TEST_MERCHANT_ID, [
        { variantId: "var-001", quantity: 1 },
      ]);

      expect(driver.verifyDigest(quote, "sha256:different")).toBe(false);
    });
  });

  describe("executeCheckout", () => {
    it("completes checkout successfully via the checkout port", async () => {
      const driver = createTestDriver();

      const amount: Money = Object.freeze({
        amountMinor: 100_000n,
        currency: TEST_CURRENCY,
      });

      const result = await driver.executeCheckout({
        context: { walletId: TEST_WALLET_ID, merchantId: TEST_MERCHANT_ID },
        amount,
        currency: TEST_CURRENCY,
        mandateRef: "mandate-001",
        intentRef: "intent-001",
        quoteDigest: "sha256:abc123",
        idempotencyKey: "idem-001",
        lineItems: [{ variantId: "var-001", quantity: 1 }],
      });

      expect(result.outcome).toBe("success");
      expect(result.paymentReference).toBe("pay-ref-001");
      expect(result.orderReference).toBe("order-ref-001");
    });

    it("returns declined when checkout port declines", async () => {
      const driver = createTestDriver({
        checkout: createMockCheckoutPort({
          outcome: "declined",
          phase: "policy_check",
          details: "Policy denied: non-allowlisted merchant",
        }),
      });

      const amount: Money = Object.freeze({
        amountMinor: 100_000n,
        currency: TEST_CURRENCY,
      });

      const result = await driver.executeCheckout({
        context: { walletId: TEST_WALLET_ID, merchantId: TEST_MERCHANT_ID },
        amount,
        currency: TEST_CURRENCY,
        mandateRef: "mandate-001",
        intentRef: "intent-001",
        quoteDigest: "sha256:abc123",
        idempotencyKey: "idem-002",
        lineItems: [{ variantId: "var-001", quantity: 1 }],
      });

      expect(result.outcome).toBe("declined");
      expect(result.phase).toBe("policy_check");
    });

    it("returns indeterminate on payment timeout simulation", async () => {
      const driver = createTestDriver({
        checkout: createMockCheckoutPort({
          outcome: "indeterminate",
          phase: "payment_execution",
          details: "Payment timeout - indeterminate state",
        }),
      });

      const amount: Money = Object.freeze({
        amountMinor: 100_000n,
        currency: TEST_CURRENCY,
      });

      const result = await driver.executeCheckout({
        context: { walletId: TEST_WALLET_ID, merchantId: TEST_MERCHANT_ID },
        amount,
        currency: TEST_CURRENCY,
        mandateRef: "mandate-001",
        intentRef: "intent-001",
        quoteDigest: "sha256:abc123",
        idempotencyKey: "idem-003",
        lineItems: [{ variantId: "var-001", quantity: 1 }],
      });

      expect(result.outcome).toBe("indeterminate");
    });
  });

  describe("full lifecycle", () => {
    it("drives discover -> search -> quote -> verify -> checkout", async () => {
      const driver = createTestDriver();

      // Step 1: Discover
      const merchant = await driver.discover(TEST_MERCHANT_ID);
      expect(merchant).toBeDefined();
      expect(merchant!.allowlisted).toBe(true);

      // Step 2: Search
      const products = await driver.search(TEST_MERCHANT_ID, "product");
      expect(products.length).toBeGreaterThan(0);

      // Step 3: Quote
      const quote = await driver.getQuote(TEST_MERCHANT_ID, [
        { variantId: products[0]!.variantId, quantity: 1 },
      ]);
      expect(quote.quoteDigest).toBeDefined();

      // Step 4: Verify Digest
      expect(driver.verifyDigest(quote, quote.quoteDigest)).toBe(true);

      // Step 5: Checkout
      const amount: Money = Object.freeze({
        amountMinor: quote.totalMinor,
        currency: quote.currency,
      });

      const result = await driver.executeCheckout({
        context: { walletId: TEST_WALLET_ID, merchantId: TEST_MERCHANT_ID },
        amount,
        currency: quote.currency,
        mandateRef: "mandate-lifecycle-001",
        intentRef: "intent-lifecycle-001",
        quoteDigest: quote.quoteDigest,
        idempotencyKey: "idem-lifecycle-001",
        lineItems: [{ variantId: products[0]!.variantId, quantity: 1 }],
      });

      expect(result.outcome).toBe("success");
    });
  });
});
