import { describe, expect, it } from "vitest";
import { createMoney } from "@counter/domain";
import type { Instant, Sha256Digest } from "@counter/domain";
import { PACKAGE_NAME } from "./index.js";
import type {
  Product,
  Variant,
  PriceSnapshot,
  InventorySnapshot,
  MerchantQuote,
  SourceReference,
  FreshnessPolicy,
  MappingVersion,
  SourcePriority,
  MappingVersionRecord,
  ConflictRecord,
  RawNormalizedPreview,
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
        fetchedAt: 1704067200000 as Instant,
        mappingVersion: { version: "1.0.0", schemaHash: "abc123" },
      },
      sourceReferences: [
        {
          platform: "shopify",
          externalId: "ext-1",
          fetchedAt: 1704067200000 as Instant,
          mappingVersion: { version: "1.0.0", schemaHash: "abc123" },
        },
      ],
      status: "active",
      tombstonedAt: undefined,
      createdAt: 1704067200000 as Instant,
      updatedAt: 1704067200000 as Instant,
    };
    expect(product.id).toBe("prod-1");
  });

  it("Variant type is structurally correct", () => {
    const variant: Variant = {
      id: "var-1",
      productId: "prod-1",
      merchantId: "merchant-1",
      sku: "SKU-001",
      title: "Default",
      active: true,
    };
    expect(variant.sku).toBe("SKU-001");
  });

  it("PriceSnapshot type is structurally correct", () => {
    const moneyResult = createMoney(1999n, "USD");
    if (!moneyResult.ok) throw new Error("Failed to create money");

    const snapshot: PriceSnapshot = {
      variantId: "var-1",
      amount: moneyResult.value,
      observedAt: 1704067200000 as Instant,
      source: {
        platform: "shopify",
        externalId: "ext-1",
        fetchedAt: 1704067200000 as Instant,
        mappingVersion: { version: "1.0.0", schemaHash: "abc123" },
      },
    };
    expect(snapshot.amount.currency).toBe("USD");
    expect(snapshot.amount.amountMinor).toBe(1999n);
  });

  it("InventorySnapshot type is structurally correct", () => {
    const snapshot: InventorySnapshot = {
      variantId: "var-1",
      availableQuantity: 42,
      observedAt: 1704067200000 as Instant,
      source: {
        platform: "shopify",
        externalId: "ext-1",
        fetchedAt: 1704067200000 as Instant,
        mappingVersion: { version: "1.0.0", schemaHash: "abc123" },
      },
    };
    expect(snapshot.availableQuantity).toBe(42);
  });

  it("MerchantQuote type is structurally correct", () => {
    const moneyResult = createMoney(1999n, "USD");
    if (!moneyResult.ok) throw new Error("Failed to create money");

    const quote: MerchantQuote = {
      id: "quote-1",
      merchantId: "merchant-1",
      variantId: "var-1",
      price: {
        variantId: "var-1",
        amount: moneyResult.value,
        observedAt: 1704067200000 as Instant,
        source: {
          platform: "shopify",
          externalId: "ext-1",
          fetchedAt: 1704067200000 as Instant,
          mappingVersion: { version: "1.0.0", schemaHash: "abc123" },
        },
      },
      inventory: {
        variantId: "var-1",
        availableQuantity: 10,
        observedAt: 1704067200000 as Instant,
        source: {
          platform: "shopify",
          externalId: "ext-1",
          fetchedAt: 1704067200000 as Instant,
          mappingVersion: { version: "1.0.0", schemaHash: "abc123" },
        },
      },
      validUntil: 1704153600000 as Instant,
      freshnessPolicy: { resourceName: "quote", maxAgeMs: 60000, warningThresholdMs: 30000 },
    };
    expect(quote.id).toBe("quote-1");
  });

  it("SourceReference type is structurally correct", () => {
    const ref: SourceReference = {
      platform: "shopify",
      externalId: "ext-1",
      fetchedAt: 1704067200000 as Instant,
      mappingVersion: { version: "1.0.0", schemaHash: "abc123" },
    };
    expect(ref.platform).toBe("shopify");
  });

  it("FreshnessPolicy type is structurally correct", () => {
    const policy: FreshnessPolicy = {
      resourceName: "product",
      maxAgeMs: 30000,
      warningThresholdMs: 15000,
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

  it("SourcePriority type is structurally correct", () => {
    const priority: SourcePriority = {
      source: "shopify",
      priority: 10,
    };
    expect(priority.source).toBe("shopify");
    expect(priority.priority).toBe(10);
  });

  it("MappingVersionRecord type is structurally correct", () => {
    const record: MappingVersionRecord = {
      id: "mv-1",
      merchantId: "m1",
      version: "1.0.0",
      schemaHash:
        "sha256:abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890" as Sha256Digest,
      transforms: [],
      status: "draft",
      publishedAt: null,
      rolledBackAt: null,
      createdAt: 1704067200000 as Instant,
    };
    expect(record.id).toBe("mv-1");
  });

  it("ConflictRecord type is structurally correct", () => {
    const record: ConflictRecord = {
      id: "conflict-1",
      entityId: "prod-1",
      entityType: "product",
      sources: [],
      conflictType: "value_mismatch",
      resolvedAt: null,
      resolution: null,
      createdAt: 1704067200000 as Instant,
    };
    expect(record.id).toBe("conflict-1");
  });

  it("RawNormalizedPreview type is structurally correct", () => {
    const preview: RawNormalizedPreview = {
      rawData: { title: "raw" },
      normalizedData: { title: "normalized" },
      transformId: "shopify-product",
      transformVersion: "1.0.0",
      differences: ["title: changed"],
    };
    expect(preview.transformId).toBe("shopify-product");
  });
});
