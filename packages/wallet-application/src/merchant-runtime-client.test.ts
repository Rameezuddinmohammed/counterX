/**
 * Tests for MerchantRuntimeClient (InMemoryMerchantRuntimeClient).
 *
 * Validates:
 * - Manifest verification succeeds with valid response
 * - Stale manifest detection (expired/superseded)
 * - Operations blocked when manifest verification fails
 * - Malformed responses produce safe MerchantClientError
 * - Timeout produces indeterminate (not failure)
 * - Environment mismatch rejected
 * - India metadata (merchantCountry) checked
 */

import { describe, expect, it, beforeEach } from "vitest";
import type { ManifestVerificationResult } from "./merchant-client-types.js";
import { InMemoryMerchantRuntimeClient } from "./merchant-runtime-client.js";

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

const TEST_MERCHANT_ID = "merchant-001";

function createValidManifest(
  overrides?: Partial<ManifestVerificationResult>,
): ManifestVerificationResult {
  return {
    valid: true,
    merchantId: TEST_MERCHANT_ID,
    environment: "sandbox",
    verifiedDomains: ["example.com"],
    merchantCountry: "IN",
    capabilities: ["search", "quote", "transaction"],
    healthStatus: "healthy",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("InMemoryMerchantRuntimeClient", () => {
  let client: InMemoryMerchantRuntimeClient;

  beforeEach(() => {
    client = new InMemoryMerchantRuntimeClient("sandbox");
  });

  describe("verifyManifest", () => {
    it("succeeds with valid manifest", async () => {
      const manifest = createValidManifest();
      client.setManifest(TEST_MERCHANT_ID, manifest);

      const result = await client.verifyManifest(TEST_MERCHANT_ID);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.merchantId).toBe(TEST_MERCHANT_ID);
        expect(result.value.valid).toBe(true);
        expect(result.value.healthStatus).toBe("healthy");
      }
    });

    it("rejects unknown merchant", async () => {
      const result = await client.verifyManifest("unknown-merchant");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("manifest_verification");
      }
    });

    it("detects stale manifest (expired)", async () => {
      const manifest = createValidManifest({
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      });
      client.setManifest(TEST_MERCHANT_ID, manifest);

      const result = await client.verifyManifest(TEST_MERCHANT_ID);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("stale_manifest");
        expect(result.error.retryable).toBe(true);
      }
    });

    it("rejects environment mismatch", async () => {
      const manifest = createValidManifest({ environment: "production" });
      client.setManifest(TEST_MERCHANT_ID, manifest);

      const result = await client.verifyManifest(TEST_MERCHANT_ID);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("manifest_verification");
        expect(result.error.message).toContain("environment mismatch");
      }
    });

    it("rejects non-India merchant country", async () => {
      const manifest = createValidManifest({ merchantCountry: "US" });
      client.setManifest(TEST_MERCHANT_ID, manifest);

      const result = await client.verifyManifest(TEST_MERCHANT_ID);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("manifest_verification");
        expect(result.error.message).toContain("country must be IN");
      }
    });
  });

  describe("operations require manifest verification", () => {
    it("blocks search when manifest not verified", async () => {
      const result = await client.search(TEST_MERCHANT_ID, "shoes");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("manifest_verification");
      }
    });

    it("blocks getProduct when manifest not verified", async () => {
      const result = await client.getProduct(TEST_MERCHANT_ID, "variant-1");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("manifest_verification");
      }
    });

    it("blocks getQuote when manifest not verified", async () => {
      const result = await client.getQuote(TEST_MERCHANT_ID, "variant-1", 1, "INR");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("manifest_verification");
      }
    });

    it("blocks createTransaction when manifest not verified", async () => {
      const result = await client.createTransaction(TEST_MERCHANT_ID, "quote-1", "upi");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("manifest_verification");
      }
    });

    it("blocks getTransactionStatus when manifest not verified", async () => {
      const result = await client.getTransactionStatus(TEST_MERCHANT_ID, "txn-1");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("manifest_verification");
      }
    });

    it("blocks getReceipt when manifest not verified", async () => {
      const result = await client.getReceipt(TEST_MERCHANT_ID, "txn-1");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("manifest_verification");
      }
    });

    it("blocks requestRefund when manifest not verified", async () => {
      const result = await client.requestRefund(TEST_MERCHANT_ID, "txn-1", "not as described");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("manifest_verification");
      }
    });
  });

  describe("simulated failures", () => {
    it("timeout produces indeterminate error", async () => {
      client.setManifest(TEST_MERCHANT_ID, createValidManifest());
      client.simulateFailure("timeout");

      const result = await client.search(TEST_MERCHANT_ID, "shoes");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("timeout");
        expect(result.error.retryable).toBe(true);
        expect(result.error.message).toContain("indeterminate");
      }
    });

    it("network error is retryable", async () => {
      client.setManifest(TEST_MERCHANT_ID, createValidManifest());
      client.simulateFailure("network_error");

      const result = await client.search(TEST_MERCHANT_ID, "shoes");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("network");
        expect(result.error.retryable).toBe(true);
      }
    });

    it("malformed response produces safe error", async () => {
      client.setManifest(TEST_MERCHANT_ID, createValidManifest());
      client.simulateFailure("malformed_response");

      const result = await client.search(TEST_MERCHANT_ID, "shoes");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("malformed_response");
        expect(result.error.retryable).toBe(false);
        // Error message should NOT contain raw response body
        expect(result.error.message).not.toContain("{");
        expect(result.error.message).not.toContain("stack");
      }
    });

    it("stale manifest is retryable", async () => {
      client.setManifest(TEST_MERCHANT_ID, createValidManifest());
      client.simulateFailure("stale_manifest");

      const result = await client.search(TEST_MERCHANT_ID, "shoes");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("stale_manifest");
        expect(result.error.retryable).toBe(true);
      }
    });

    it("indeterminate preserves state without collapsing to failure", async () => {
      client.setManifest(TEST_MERCHANT_ID, createValidManifest());
      client.simulateFailure("indeterminate");

      const result = await client.search(TEST_MERCHANT_ID, "shoes");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("indeterminate");
        expect(result.error.retryable).toBe(true);
        expect(result.error.message).toContain("query before retry");
      }
    });

    it("server error is retryable", async () => {
      client.setManifest(TEST_MERCHANT_ID, createValidManifest());
      client.simulateFailure("server_error");

      const result = await client.search(TEST_MERCHANT_ID, "shoes");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("server_error");
        expect(result.error.retryable).toBe(true);
      }
    });

    it("unauthorized is not retryable", async () => {
      client.setManifest(TEST_MERCHANT_ID, createValidManifest());
      client.simulateFailure("unauthorized");

      const result = await client.search(TEST_MERCHANT_ID, "shoes");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("unauthorized");
        expect(result.error.retryable).toBe(false);
      }
    });

    it("manifest verification failure blocks operations", async () => {
      client.setManifest(TEST_MERCHANT_ID, createValidManifest());
      client.simulateFailure("manifest_verification_failed");

      const result = await client.search(TEST_MERCHANT_ID, "shoes");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("manifest_verification");
      }
    });
  });

  describe("successful operations with valid manifest", () => {
    it("search returns configured response", async () => {
      client.setManifest(TEST_MERCHANT_ID, createValidManifest());
      client.setSearchResponse(TEST_MERCHANT_ID, {
        merchantId: TEST_MERCHANT_ID,
        results: [
          {
            variantId: "v-1",
            title: "Test Product",
            price: { amount: "1000", currency: "INR" },
            available: true,
          },
        ],
        nextCursor: null,
        totalCount: 1,
      });

      const result = await client.search(TEST_MERCHANT_ID, "test");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.results).toHaveLength(1);
        expect(result.value.results[0]?.title).toBe("Test Product");
      }
    });

    it("getProduct returns configured response", async () => {
      client.setManifest(TEST_MERCHANT_ID, createValidManifest());
      client.setProductResponse(`${TEST_MERCHANT_ID}:variant-1`, {
        variantId: "variant-1",
        merchantId: TEST_MERCHANT_ID,
        title: "Test Item",
        description: "A test item",
        price: { amount: "500", currency: "INR" },
        available: true,
        version: "v1",
        freshness: "2025-01-01T00:00:00Z",
      });

      const result = await client.getProduct(TEST_MERCHANT_ID, "variant-1");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.variantId).toBe("variant-1");
      }
    });

    it("getQuote returns configured response", async () => {
      client.setManifest(TEST_MERCHANT_ID, createValidManifest());
      client.setQuoteResponse(TEST_MERCHANT_ID, {
        quoteId: "quote-1",
        merchantId: TEST_MERCHANT_ID,
        variantId: "variant-1",
        quantity: 2,
        unitPrice: { amount: "500", currency: "INR" },
        totalPrice: { amount: "1000", currency: "INR" },
        expiresAt: "2025-12-31T23:59:59Z",
        quoteDigest: "sha256:test-digest",
        version: "v1",
      });

      const result = await client.getQuote(TEST_MERCHANT_ID, "variant-1", 2, "INR");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.quoteId).toBe("quote-1");
        expect(result.value.totalPrice.amount).toBe("1000");
      }
    });

    it("requestRefund returns the pending relay response, not an immediate refund", async () => {
      client.setManifest(TEST_MERCHANT_ID, createValidManifest());
      client.setRefundResponse(`${TEST_MERCHANT_ID}:txn-1`, {
        refundRequestId: "refund-request-1",
        transactionId: "txn-1",
        status: "pending",
        requestedAt: "2025-06-01T00:00:00Z",
        amount: { amount: "1000", currency: "INR" },
        version: "v1",
      });

      const result = await client.requestRefund(TEST_MERCHANT_ID, "txn-1", "not as described");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe("pending");
        expect(result.value.refundRequestId).toBe("refund-request-1");
      }
    });
  });

  describe("error safety", () => {
    it("errors never leak internal details", async () => {
      client.simulateFailure("server_error");

      const result = await client.verifyManifest(TEST_MERCHANT_ID);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        // No stack trace
        expect(result.error.message).not.toContain("at ");
        expect(result.error.message).not.toContain("Error:");
        // No raw response body
        expect(result.error.message).not.toContain("<!DOCTYPE");
        expect(result.error.message).not.toContain("Internal Server Error");
      }
    });

    it("all error kinds have appropriate retryable flags", async () => {
      const nonRetryable: Array<
        "malformed_response" | "unauthorized" | "manifest_verification_failed"
      > = ["malformed_response", "unauthorized", "manifest_verification_failed"];
      const retryable: Array<
        "timeout" | "network_error" | "stale_manifest" | "indeterminate" | "server_error"
      > = ["timeout", "network_error", "stale_manifest", "indeterminate", "server_error"];

      for (const failure of nonRetryable) {
        client.simulateFailure(failure);
        const result = await client.verifyManifest(TEST_MERCHANT_ID);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.retryable).toBe(false);
        }
      }

      for (const failure of retryable) {
        client.simulateFailure(failure);
        const result = await client.verifyManifest(TEST_MERCHANT_ID);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.retryable).toBe(true);
        }
      }
    });
  });

  describe("listMerchants", () => {
    it("with nothing configured, returns an empty directory rather than erroring", async () => {
      const result = await client.listMerchants();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ merchants: [], total: 0 });
      }
    });

    it("lists everything configured when no query is given", async () => {
      client.setDirectoryResponse({
        merchants: [
          { merchantId: "m1", displayName: "Alpha Store", goodsTypes: [], capabilities: [] },
          { merchantId: "m2", displayName: "Beta Traders", goodsTypes: [], capabilities: [] },
        ],
        total: 2,
      });

      const result = await client.listMerchants();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.total).toBe(2);
        expect(result.value.merchants.map((m) => m.merchantId)).toEqual(["m1", "m2"]);
      }
    });

    it("filters by query, case-insensitively, against displayName", async () => {
      client.setDirectoryResponse({
        merchants: [
          { merchantId: "m1", displayName: "Alpha Store", goodsTypes: [], capabilities: [] },
          { merchantId: "m2", displayName: "Beta Traders", goodsTypes: [], capabilities: [] },
        ],
        total: 2,
      });

      const result = await client.listMerchants("ALPHA");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.merchants.map((m) => m.merchantId)).toEqual(["m1"]);
        expect(result.value.total).toBe(1);
      }
    });

    it("respects limit", async () => {
      client.setDirectoryResponse({
        merchants: [
          { merchantId: "m1", displayName: "Alpha Store", goodsTypes: [], capabilities: [] },
          { merchantId: "m2", displayName: "Beta Traders", goodsTypes: [], capabilities: [] },
        ],
        total: 2,
      });

      const result = await client.listMerchants(undefined, 1);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.merchants).toHaveLength(1);
      }
    });

    it("respects a simulated failure like every other method", async () => {
      client.simulateFailure("network_error");
      const result = await client.listMerchants();
      expect(result.ok).toBe(false);
    });
  });
});
