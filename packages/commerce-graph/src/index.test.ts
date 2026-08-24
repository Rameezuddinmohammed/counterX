import { describe, expect, it } from "vitest";
import {
  PACKAGE_NAME,
} from "./index.js";
import type {
  Product,
  Variant,
  PriceSnapshot,
  InventorySnapshot,
  MerchantQuote,
  SourceReference,
  FreshnessPolicy,
  MappingVersion,
} from "./index.js";

describe("@counter/commerce-graph", () => {
  it("exposes its package identity", () => {
    expect(PACKAGE_NAME).toBe("@counter/commerce-graph");
  });

  it("Product type is structurally correct", () => {
    const product: Product = {
      id: "prod-1",
      merchantId: "merchant-1",
      title: "Test Product",
      description: "A test product",
      variants: [],
      sourceReference: {
        platform: "shopify",
        externalId: "ext-1",
        fetchedAt: "2024-01-01T00:00:00Z",
        mappingVersion: { version: "1.0.0", schemaHash: "abc123" },
      },
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };
    expect(product.id).toBe("prod-1");
  });

  it("Variant type is structurally correct", () => {
    const variant: Variant = {
      id: "var-1",
      productId: "prod-1",
      sku: "SKU-001",
      title: "Default",
      active: true,
    };
    expect(variant.sku).toBe("SKU-001");
  });

  it("PriceSnapshot type is structurally correct", () => {
    const snapshot: PriceSnapshot = {
      variantId: "var-1",
      currencyCode: "USD",
      amount: "19.99",
      observedAt: "2024-01-01T00:00:00Z",
      source: {
        platform: "shopify",
        externalId: "ext-1",
        fetchedAt: "2024-01-01T00:00:00Z",
        mappingVersion: { version: "1.0.0", schemaHash: "abc123" },
      },
    };
    expect(snapshot.currencyCode).toBe("USD");
  });

  it("InventorySnapshot type is structurally correct", () => {
    const snapshot: InventorySnapshot = {
      variantId: "var-1",
      availableQuantity: 42,
      observedAt: "2024-01-01T00:00:00Z",
      source: {
        platform: "shopify",
        externalId: "ext-1",
        fetchedAt: "2024-01-01T00:00:00Z",
        mappingVersion: { version: "1.0.0", schemaHash: "abc123" },
      },
    };
    expect(snapshot.availableQuantity).toBe(42);
  });

  it("MerchantQuote type is structurally correct", () => {
    const quote: MerchantQuote = {
      id: "quote-1",
      merchantId: "merchant-1",
      variantId: "var-1",
      price: {
        variantId: "var-1",
        currencyCode: "USD",
        amount: "19.99",
        observedAt: "2024-01-01T00:00:00Z",
        source: {
          platform: "shopify",
          externalId: "ext-1",
          fetchedAt: "2024-01-01T00:00:00Z",
          mappingVersion: { version: "1.0.0", schemaHash: "abc123" },
        },
      },
      inventory: {
        variantId: "var-1",
        availableQuantity: 10,
        observedAt: "2024-01-01T00:00:00Z",
        source: {
          platform: "shopify",
          externalId: "ext-1",
          fetchedAt: "2024-01-01T00:00:00Z",
          mappingVersion: { version: "1.0.0", schemaHash: "abc123" },
        },
      },
      validUntil: "2024-01-02T00:00:00Z",
      freshnessPolicy: { maxAgeMs: 60000, staleWhileRevalidate: true },
    };
    expect(quote.id).toBe("quote-1");
  });

  it("SourceReference type is structurally correct", () => {
    const ref: SourceReference = {
      platform: "shopify",
      externalId: "ext-1",
      fetchedAt: "2024-01-01T00:00:00Z",
      mappingVersion: { version: "1.0.0", schemaHash: "abc123" },
    };
    expect(ref.platform).toBe("shopify");
  });

  it("FreshnessPolicy type is structurally correct", () => {
    const policy: FreshnessPolicy = {
      maxAgeMs: 30000,
      staleWhileRevalidate: false,
    };
    expect(policy.maxAgeMs).toBe(30000);
  });

  it("MappingVersion type is structurally correct", () => {
    const version: MappingVersion = {
      version: "2.0.0",
      schemaHash: "def456",
    };
    expect(version.version).toBe("2.0.0");
  });
});
