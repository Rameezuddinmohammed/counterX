import { describe, expect, it } from "vitest";
import { ProductIndex } from "./product-index.js";
import type { Product, SourceReference, MappingVersion, Variant } from "@counter/commerce-graph";
import type { Instant } from "@counter/domain";

const NOW = Date.now() as Instant;

function makeMappingVersion(): MappingVersion {
  return { version: "1.0.0", schemaHash: "abc123" };
}

function makeSourceRef(platform = "shopify"): SourceReference {
  return {
    platform,
    externalId: "ext-123",
    fetchedAt: NOW,
    mappingVersion: makeMappingVersion(),
  };
}

function makeVariant(overrides: Partial<Variant> = {}): Variant {
  return {
    id: "variant-1",
    productId: "product-1",
    merchantId: "merchant-1",
    sku: "SKU-001",
    title: "Default Variant",
    active: true,
    ...overrides,
  };
}

function makeProduct(overrides: Partial<Product> = {}): Product {
  const base: Product = {
    id: "product-1",
    merchantId: "merchant-1",
    title: "Test Product",
    description: "A test product description",
    variants: [makeVariant()],
    sourceReference: makeSourceRef(),
    sourceReferences: [makeSourceRef()],
    status: "released",
    tombstonedAt: undefined,
    createdAt: NOW,
    updatedAt: NOW,
  };
  return { ...base, ...overrides };
}

describe("ProductIndex", () => {
  describe("indexProducts", () => {
    it("only indexes released products", () => {
      const index = new ProductIndex();
      const released = makeProduct({ id: "p1", status: "released" });
      const active = makeProduct({ id: "p2", status: "active" });
      const tombstoned = makeProduct({ id: "p3", status: "tombstoned" });
      const unpublished = makeProduct({ id: "p4", status: "unpublished" });

      index.indexProducts([released, active, tombstoned, unpublished]);

      expect(index.getProduct("p1")).not.toBeNull();
      expect(index.getProduct("p2")).toBeNull();
      expect(index.getProduct("p3")).toBeNull();
      expect(index.getProduct("p4")).toBeNull();
    });

    it("removes previously indexed product when status changes from released", () => {
      const index = new ProductIndex();
      const product = makeProduct({ id: "p1", status: "released" });
      index.indexProducts([product]);
      expect(index.getProduct("p1")).not.toBeNull();

      const updatedProduct = makeProduct({ id: "p1", status: "active" });
      index.indexProducts([updatedProduct]);
      expect(index.getProduct("p1")).toBeNull();
    });

    it("re-indexing updates existing products", () => {
      const index = new ProductIndex();
      const product = makeProduct({
        id: "p1",
        title: "Original Title",
        status: "released",
      });
      index.indexProducts([product]);
      expect(index.getProduct("p1")?.title).toBe("Original Title");

      const updated = makeProduct({
        id: "p1",
        title: "Updated Title",
        status: "released",
      });
      index.indexProducts([updated]);
      expect(index.getProduct("p1")?.title).toBe("Updated Title");
    });
  });

  describe("search", () => {
    it("returns matching products by title", () => {
      const index = new ProductIndex();
      const p1 = makeProduct({ id: "p1", title: "Widget Pro", status: "released" });
      const p2 = makeProduct({ id: "p2", title: "Gadget Lite", status: "released" });
      index.indexProducts([p1, p2]);

      const results = index.search("widget");
      expect(results).toHaveLength(1);
      expect(results[0]?.title).toBe("Widget Pro");
    });

    it("returns matching products by description", () => {
      const index = new ProductIndex();
      const product = makeProduct({
        id: "p1",
        description: "Premium quality headphones",
        status: "released",
      });
      index.indexProducts([product]);

      const results = index.search("headphones");
      expect(results).toHaveLength(1);
    });

    it("returns matching products by SKU", () => {
      const index = new ProductIndex();
      const product = makeProduct({
        id: "p1",
        variants: [makeVariant({ sku: "PHONE-CASE-BLK" })],
        status: "released",
      });
      index.indexProducts([product]);

      const results = index.search("PHONE-CASE");
      expect(results).toHaveLength(1);
    });

    it("excludes non-released products from search", () => {
      const index = new ProductIndex();
      const released = makeProduct({ id: "p1", title: "Available Widget", status: "released" });
      const active = makeProduct({ id: "p2", title: "Hidden Widget", status: "active" });
      index.indexProducts([released, active]);

      const results = index.search("widget");
      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe("p1");
    });

    it("respects the limit parameter", () => {
      const index = new ProductIndex();
      const products = Array.from({ length: 10 }, (_, i) =>
        makeProduct({
          id: `p${i}`,
          title: `Widget ${i}`,
          status: "released",
          variants: [makeVariant({ id: `v${i}`, productId: `p${i}` })],
        }),
      );
      index.indexProducts(products);

      const results = index.search("widget", 3);
      expect(results).toHaveLength(3);
    });
  });

  describe("getProduct", () => {
    it("returns safe projection without internal IDs", () => {
      const index = new ProductIndex();
      const product = makeProduct({
        id: "p1",
        merchantId: "secret-merchant-id",
        status: "released",
      });
      index.indexProducts([product]);

      const projection = index.getProduct("p1");
      expect(projection).not.toBeNull();
      expect(projection!.id).toBe("p1");
      expect(projection!.status).toBe("released");
      expect(projection!.source).toBe("shopify");
      // Verify no merchantId or raw source references leaked
      expect("merchantId" in projection!).toBe(false);
      expect("sourceReference" in projection!).toBe(false);
      expect("sourceReferences" in projection!).toBe(false);
    });

    it("returns null for non-existent product", () => {
      const index = new ProductIndex();
      expect(index.getProduct("nonexistent")).toBeNull();
    });
  });

  describe("getVariant", () => {
    it("returns variant projection", () => {
      const index = new ProductIndex();
      const product = makeProduct({
        id: "p1",
        status: "released",
        variants: [makeVariant({ id: "v1", productId: "p1", sku: "SKU-V1", active: true })],
      });
      index.indexProducts([product]);

      const variant = index.getVariant("v1");
      expect(variant).not.toBeNull();
      expect(variant!.id).toBe("v1");
      expect(variant!.productId).toBe("p1");
      expect(variant!.sku).toBe("SKU-V1");
      expect(variant!.active).toBe(true);
      // Verify no merchantId leaked
      expect("merchantId" in variant!).toBe(false);
    });

    it("returns null for variant of non-released product", () => {
      const index = new ProductIndex();
      const product = makeProduct({
        id: "p1",
        status: "active",
        variants: [makeVariant({ id: "v1", productId: "p1" })],
      });
      index.indexProducts([product]);

      expect(index.getVariant("v1")).toBeNull();
    });

    it("returns null for non-existent variant", () => {
      const index = new ProductIndex();
      expect(index.getVariant("nonexistent")).toBeNull();
    });
  });
});
