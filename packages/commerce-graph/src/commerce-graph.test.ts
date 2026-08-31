/**
 * Comprehensive test suite for the commerce graph.
 *
 * Covers: provenance completeness, integer money, variant identity,
 * stale data detection, out-of-order observations, tombstone behavior,
 * source priority resolution, mapping version lifecycle, transform
 * determinism, preview mode, and conflict detection/resolution.
 */

import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import type { Instant, Money, Sha256Digest } from "@counter/domain";
import { createMoney } from "@counter/domain";
import type {
  ConflictRecord,
  FreshnessPolicy,
  InventorySnapshot,
  MappingVersionRecord,
  PriceSnapshot,
  Product,
  RawNormalizedPreview,
  SourceReference,
  Variant,
} from "./index.js";
import {
  InMemoryProductRepository,
  InMemoryVariantRepository,
  InMemoryPriceRepository,
  InMemoryInventoryRepository,
  InMemoryMappingVersionRepository,
  InMemoryConflictRepository,
  evaluateFreshness,
  TransformRegistry,
  applyTransform,
  previewTransform,
  resolveConflict,
  detectStaleOverride,
} from "./index.js";
import { enforceFreshnessPolicy } from "./freshness.js";
import type { SourcedObservation } from "./source-priority.js";
import { shopifyProductTransform, createDefaultRegistry } from "./transforms.js";

// ─── Test Helpers ─────────────────────────────────────────────────────────────

function makeSourceRef(platform = "shopify", externalId = "ext-1"): SourceReference {
  return Object.freeze({
    platform,
    externalId,
    fetchedAt: 1704067200000 as Instant,
    mappingVersion: { version: "1.0.0", schemaHash: "abc123" },
  });
}

function makeProduct(overrides: Partial<Product> = {}): Product {
  return Object.freeze({
    id: "prod-1",
    merchantId: "merchant-1",
    title: "Test Product",
    description: "A test product",
    variants: [],
    sourceReference: makeSourceRef(),
    sourceReferences: [makeSourceRef()],
    status: "active" as const,
    tombstonedAt: undefined,
    createdAt: 1704067200000 as Instant,
    updatedAt: 1704067200000 as Instant,
    ...overrides,
  });
}

function makeVariant(overrides: Partial<Variant> = {}): Variant {
  return Object.freeze({
    id: "var-1",
    productId: "prod-1",
    merchantId: "merchant-1",
    sku: "SKU-001",
    title: "Default",
    active: true,
    ...overrides,
  });
}

function makeMoney(amountMinor: bigint, currency: string): Money {
  const result = createMoney(amountMinor, currency);
  if (!result.ok) throw new Error("Failed to create money");
  return result.value;
}

function makePriceSnapshot(overrides: Partial<PriceSnapshot> = {}): PriceSnapshot {
  return Object.freeze({
    variantId: "var-1",
    amount: makeMoney(1999n, "USD"),
    observedAt: 1704067200000 as Instant,
    source: makeSourceRef(),
    ...overrides,
  });
}

function makeInventorySnapshot(overrides: Partial<InventorySnapshot> = {}): InventorySnapshot {
  return Object.freeze({
    variantId: "var-1",
    availableQuantity: 42,
    observedAt: 1704067200000 as Instant,
    source: makeSourceRef(),
    ...overrides,
  });
}

function makePolicy(): FreshnessPolicy {
  return Object.freeze({
    resourceName: "product",
    maxAgeMs: 60000,
    warningThresholdMs: 30000,
  });
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe("Commerce Graph", () => {
  // (a) Provenance completeness
  describe("Provenance completeness", () => {
    it("every saved product retains source reference, observed time, and mapping version", async () => {
      const repo = new InMemoryProductRepository();
      const product = makeProduct();
      const saved = await repo.save(product);

      expect(saved.ok).toBe(true);
      if (!saved.ok) return;

      expect(saved.value.sourceReference.platform).toBe("shopify");
      expect(saved.value.sourceReference.fetchedAt).toBe(1704067200000);
      expect(saved.value.sourceReference.mappingVersion.version).toBe("1.0.0");
      expect(saved.value.sourceReference.mappingVersion.schemaHash).toBe("abc123");
    });

    it("price snapshot retains source and observation time", async () => {
      const repo = new InMemoryPriceRepository();
      const snapshot = makePriceSnapshot();
      const saved = await repo.save(snapshot);

      expect(saved.ok).toBe(true);
      if (!saved.ok) return;

      expect(saved.value.source.platform).toBe("shopify");
      expect(saved.value.observedAt).toBe(1704067200000);
      expect(saved.value.source.mappingVersion.version).toBe("1.0.0");
    });

    it("inventory snapshot retains source and observation time", async () => {
      const repo = new InMemoryInventoryRepository();
      const snapshot = makeInventorySnapshot();
      const saved = await repo.save(snapshot);

      expect(saved.ok).toBe(true);
      if (!saved.ok) return;

      expect(saved.value.source.platform).toBe("shopify");
      expect(saved.value.observedAt).toBe(1704067200000);
    });
  });

  // (b) Integer money
  describe("Integer money", () => {
    it("prices are stored as bigint minor units, not floating point", () => {
      const price = makePriceSnapshot({
        amount: makeMoney(79900n, "INR"),
      });

      expect(typeof price.amount.amountMinor).toBe("bigint");
      expect(price.amount.amountMinor).toBe(79900n);
      expect(price.amount.currency).toBe("INR");
    });

    it("property: money amount is always a bigint", () => {
      fc.assert(
        fc.property(fc.bigInt(-1000000n, 1000000n), (amount) => {
          const result = createMoney(amount, "USD");
          if (!result.ok) return true;
          return typeof result.value.amountMinor === "bigint";
        }),
      );
    });

    it("correctly represents USD cents (1999 = $19.99)", () => {
      const money = makeMoney(1999n, "USD");
      expect(money.amountMinor).toBe(1999n);
      expect(money.currency).toBe("USD");
    });
  });

  // (c) Variant identity
  describe("Variant identity", () => {
    it("variants are uniquely identified by id and sku within a merchant", async () => {
      const repo = new InMemoryVariantRepository();
      await repo.save(makeVariant({ id: "var-1", sku: "SKU-001", merchantId: "m1" }));
      await repo.save(makeVariant({ id: "var-2", sku: "SKU-002", merchantId: "m1" }));

      const found1 = await repo.getBySkuAndMerchant("SKU-001", "m1");
      const found2 = await repo.getBySkuAndMerchant("SKU-002", "m1");
      const notFound = await repo.getBySkuAndMerchant("SKU-001", "m2");

      expect(found1.ok && found1.value?.id).toBe("var-1");
      expect(found2.ok && found2.value?.id).toBe("var-2");
      expect(notFound.ok && notFound.value).toBeNull();
    });

    it("same sku in different merchants are distinct", async () => {
      const repo = new InMemoryVariantRepository();
      await repo.save(makeVariant({ id: "var-1", sku: "SKU-001", merchantId: "m1" }));
      await repo.save(makeVariant({ id: "var-2", sku: "SKU-001", merchantId: "m2" }));

      const found1 = await repo.getBySkuAndMerchant("SKU-001", "m1");
      const found2 = await repo.getBySkuAndMerchant("SKU-001", "m2");

      expect(found1.ok && found1.value?.id).toBe("var-1");
      expect(found2.ok && found2.value?.id).toBe("var-2");
    });
  });

  // (d) Stale data detection
  describe("Stale data detection", () => {
    it("entities past freshness budget are flagged as stale", () => {
      const policy = makePolicy(); // maxAge: 60000, warning: 30000
      const observedAt = 1704067200000 as Instant;
      const now = (1704067200000 + 70000) as Instant; // 70s later

      const assessment = evaluateFreshness(observedAt, now, policy);

      expect(assessment.status).toBe("stale");
      expect(assessment.withinBudget).toBe(false);
      expect(assessment.ageMs).toBe(70000);
    });

    it("fresh entities are within budget", () => {
      const policy = makePolicy();
      const observedAt = 1704067200000 as Instant;
      const now = (1704067200000 + 10000) as Instant; // 10s later

      const assessment = evaluateFreshness(observedAt, now, policy);

      expect(assessment.status).toBe("fresh");
      expect(assessment.withinBudget).toBe(true);
    });

    it("approaching stale entities are within budget but warned", () => {
      const policy = makePolicy();
      const observedAt = 1704067200000 as Instant;
      const now = (1704067200000 + 40000) as Instant; // 40s later

      const assessment = evaluateFreshness(observedAt, now, policy);

      expect(assessment.status).toBe("approaching_stale");
      expect(assessment.withinBudget).toBe(true);
    });

    it("unknown freshness when never observed", () => {
      const policy = makePolicy();
      const now = 1704067200000 as Instant;

      const assessment = evaluateFreshness(null, now, policy);

      expect(assessment.status).toBe("unknown");
      expect(assessment.withinBudget).toBe(false);
      expect(assessment.ageMs).toBeNull();
    });

    it("block mode rejects stale entities", () => {
      const policy = makePolicy();
      const entity = { observedAt: 1704067200000 as Instant };
      const now = (1704067200000 + 70000) as Instant;

      const result = enforceFreshnessPolicy(entity, now, policy, "block");

      expect(result.ok).toBe(false);
    });

    it("degrade mode allows stale entities", () => {
      const policy = makePolicy();
      const entity = { observedAt: 1704067200000 as Instant };
      const now = (1704067200000 + 70000) as Instant;

      const result = enforceFreshnessPolicy(entity, now, policy, "degrade");

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.allowed).toBe(true);
      expect(result.value.assessment.status).toBe("stale");
    });
  });

  // (e) Out-of-order observation handling
  describe("Out-of-order observation handling", () => {
    it("later timestamp wins even if received first", async () => {
      const repo = new InMemoryPriceRepository();

      // Receive newer observation first
      await repo.save(
        makePriceSnapshot({
          observedAt: 1704067300000 as Instant,
          amount: makeMoney(2500n, "USD"),
        }),
      );

      // Receive older observation second (out of order)
      await repo.save(
        makePriceSnapshot({
          observedAt: 1704067200000 as Instant,
          amount: makeMoney(1999n, "USD"),
        }),
      );

      const latest = await repo.getLatest("var-1");
      expect(latest.ok).toBe(true);
      if (!latest.ok) return;

      // Latest should be the one with the newer timestamp
      expect(latest.value?.observedAt).toBe(1704067300000);
      expect(latest.value?.amount.amountMinor).toBe(2500n);
    });

    it("detectStaleOverride identifies out-of-order observations", () => {
      const existing = 1704067300000 as Instant;
      const older = 1704067200000 as Instant;

      const result = detectStaleOverride(existing, older);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.isStale).toBe(true);
    });

    it("detectStaleOverride allows newer observations", () => {
      const existing = 1704067200000 as Instant;
      const newer = 1704067300000 as Instant;

      const result = detectStaleOverride(existing, newer);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.isStale).toBe(false);
    });
  });

  // (f) Tombstone behavior
  describe("Tombstone behavior", () => {
    it("tombstoned products are excluded from active queries", async () => {
      const repo = new InMemoryProductRepository();
      await repo.save(makeProduct({ id: "prod-1", merchantId: "m1", status: "active" }));
      await repo.save(makeProduct({ id: "prod-2", merchantId: "m1", status: "tombstoned" }));

      const active = await repo.listByMerchant("m1");

      expect(active.ok).toBe(true);
      if (!active.ok) return;
      expect(active.value.length).toBe(1);
      expect(active.value[0]?.id).toBe("prod-1");
    });

    it("tombstoned products are retained in storage", async () => {
      const repo = new InMemoryProductRepository();
      await repo.save(makeProduct({ id: "prod-1", merchantId: "m1", status: "active" }));
      await repo.tombstone("prod-1", 1704067300000);

      const byId = await repo.getById("prod-1");
      expect(byId.ok).toBe(true);
      if (!byId.ok) return;
      expect(byId.value?.status).toBe("tombstoned");
      expect(byId.value?.tombstonedAt).toBe(1704067300000);
    });

    it("tombstoned products can be queried by status", async () => {
      const repo = new InMemoryProductRepository();
      await repo.save(makeProduct({ id: "prod-1", merchantId: "m1", status: "active" }));
      await repo.tombstone("prod-1", 1704067300000);

      const tombstoned = await repo.listByStatus("m1", "tombstoned");
      expect(tombstoned.ok).toBe(true);
      if (!tombstoned.ok) return;
      expect(tombstoned.value.length).toBe(1);
      expect(tombstoned.value[0]?.id).toBe("prod-1");
    });
  });

  // (g) Source priority resolution
  describe("Source priority resolution", () => {
    it("higher priority source wins", () => {
      const obs1: SourcedObservation = {
        source: makeSourceRef("shopify", "ext-1"),
        observedAt: 1704067200000 as Instant,
        data: { price: 100 },
      };
      const obs2: SourcedObservation = {
        source: makeSourceRef("woocommerce", "ext-2"),
        observedAt: 1704067200000 as Instant,
        data: { price: 200 },
      };

      const result = resolveConflict(
        [obs1, obs2],
        [
          { source: "shopify", priority: 10 },
          { source: "woocommerce", priority: 5 },
        ],
        "entity-1",
        "product",
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.winner.source.platform).toBe("shopify");
      expect(result.value.resolution).toBe("source_priority");
    });

    it("when same priority, newer observedAt wins", () => {
      const obs1: SourcedObservation = {
        source: makeSourceRef("shopify", "ext-1"),
        observedAt: 1704067200000 as Instant,
        data: { price: 100 },
      };
      const obs2: SourcedObservation = {
        source: makeSourceRef("woocommerce", "ext-2"),
        observedAt: 1704067300000 as Instant,
        data: { price: 200 },
      };

      const result = resolveConflict(
        [obs1, obs2],
        [
          { source: "shopify", priority: 5 },
          { source: "woocommerce", priority: 5 },
        ],
        "entity-1",
        "product",
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.winner.source.platform).toBe("woocommerce");
      expect(result.value.resolution).toBe("newer_wins");
    });

    it("creates conflict record when values mismatch at same priority", () => {
      const obs1: SourcedObservation = {
        source: makeSourceRef("shopify", "ext-1"),
        observedAt: 1704067200000 as Instant,
        data: { price: 100 },
      };
      const obs2: SourcedObservation = {
        source: makeSourceRef("woocommerce", "ext-2"),
        observedAt: 1704067300000 as Instant,
        data: { price: 200 },
      };

      const result = resolveConflict(
        [obs1, obs2],
        [
          { source: "shopify", priority: 5 },
          { source: "woocommerce", priority: 5 },
        ],
        "entity-1",
        "product",
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.conflict).not.toBeNull();
      expect(result.value.conflict?.conflictType).toBe("value_mismatch");
    });
  });

  // (h) Mapping version publish/rollback lifecycle
  describe("Mapping version publish/rollback lifecycle", () => {
    it("draft mapping version can be published", () => {
      const repo = new InMemoryMappingVersionRepository();
      const record: MappingVersionRecord = Object.freeze({
        id: "mv-1",
        merchantId: "m1",
        version: "1.0.0",
        schemaHash:
          "sha256:abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890" as Sha256Digest,
        transforms: [],
        status: "draft" as const,
        publishedAt: null,
        rolledBackAt: null,
        createdAt: 1704067200000 as Instant,
      });

      repo.save(record);
      const published = repo.publish("mv-1", 1704067300000);

      expect(published.ok).toBe(true);
      if (!published.ok) return;
      expect(published.value?.status).toBe("published");
      expect(published.value?.publishedAt).toBe(1704067300000);
    });

    it("published mapping version can be rolled back", () => {
      const repo = new InMemoryMappingVersionRepository();
      const record: MappingVersionRecord = Object.freeze({
        id: "mv-1",
        merchantId: "m1",
        version: "1.0.0",
        schemaHash:
          "sha256:abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890" as Sha256Digest,
        transforms: [],
        status: "published" as const,
        publishedAt: 1704067300000 as Instant,
        rolledBackAt: null,
        createdAt: 1704067200000 as Instant,
      });

      repo.save(record);
      const rolledBack = repo.rollback("mv-1", 1704067400000);

      expect(rolledBack.ok).toBe(true);
      if (!rolledBack.ok) return;
      expect(rolledBack.value?.status).toBe("rolledBack");
      expect(rolledBack.value?.rolledBackAt).toBe(1704067400000);
    });

    it("getPublished returns the currently published version for a merchant", () => {
      const repo = new InMemoryMappingVersionRepository();
      repo.save(
        Object.freeze({
          id: "mv-1",
          merchantId: "m1",
          version: "1.0.0",
          schemaHash:
            "sha256:abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890" as Sha256Digest,
          transforms: [],
          status: "published" as const,
          publishedAt: 1704067300000 as Instant,
          rolledBackAt: null,
          createdAt: 1704067200000 as Instant,
        }),
      );

      const found = repo.getPublished("m1");
      expect(found.ok).toBe(true);
      if (!found.ok) return;
      expect(found.value?.id).toBe("mv-1");
      expect(found.value?.status).toBe("published");
    });
  });

  // (i) Transform determinism
  describe("Transform determinism", () => {
    it("same input always produces same output", () => {
      const registry = createDefaultRegistry();
      const rawData = {
        id: "123",
        title: "Test Product",
        body_html: "<p>Description</p>",
        variants: [{ id: "v1", title: "Default", sku: "SKU-1", price: "19.99" }],
      };

      const result1 = applyTransform(registry, rawData, "shopify-product", "1.0.0");
      const result2 = applyTransform(registry, rawData, "shopify-product", "1.0.0");

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);
      if (!result1.ok || !result2.ok) return;

      expect(JSON.stringify(result1.value)).toBe(JSON.stringify(result2.value));
    });

    it("property: shopify transform is deterministic for any string input", () => {
      fc.assert(
        fc.property(
          fc.record({
            id: fc.string(),
            title: fc.string(),
            body_html: fc.string(),
          }),
          (rawData) => {
            const r1 = shopifyProductTransform(rawData);
            const r2 = shopifyProductTransform(rawData);
            return JSON.stringify(r1) === JSON.stringify(r2);
          },
        ),
      );
    });

    it("unregistered transform returns error", () => {
      const registry = new TransformRegistry();
      const result = applyTransform(registry, {}, "nonexistent", "1.0.0");

      expect(result.ok).toBe(false);
    });
  });

  // (j) Preview mode
  describe("Preview mode", () => {
    it("shows raw vs normalized comparison without mutating state", () => {
      const registry = createDefaultRegistry();
      const rawData = {
        id: "456",
        title: "Preview Product",
        body_html: "Description",
        variants: [],
      };

      const result = previewTransform(registry, rawData, "shopify-product", "1.0.0");

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const preview: RawNormalizedPreview = result.value;
      expect(preview.rawData).toEqual(rawData);
      expect(preview.normalizedData).not.toBeNull();
      expect(preview.transformId).toBe("shopify-product");
      expect(preview.transformVersion).toBe("1.0.0");
      expect(Array.isArray(preview.differences)).toBe(true);
    });

    it("preview detects added/removed fields", () => {
      const registry = createDefaultRegistry();
      const rawData = {
        id: "789",
        title: "Field Test",
        body_html: "Desc",
        vendor: "TestVendor",
        handle: "test-handle",
      };

      const result = previewTransform(registry, rawData, "shopify-product", "1.0.0");

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // The normalized output has different fields than the raw input
      expect(result.value.differences.length).toBeGreaterThan(0);
    });
  });

  // (k) Conflict detection and resolution
  describe("Conflict detection and resolution", () => {
    it("conflict record can be saved and retrieved", () => {
      const repo = new InMemoryConflictRepository();
      const conflict: ConflictRecord = Object.freeze({
        id: "conflict-1",
        entityId: "prod-1",
        entityType: "product",
        sources: [makeSourceRef("shopify"), makeSourceRef("woocommerce")],
        conflictType: "value_mismatch" as const,
        resolvedAt: null,
        resolution: null,
        createdAt: 1704067200000 as Instant,
      });

      repo.save(conflict);
      const found = repo.getById("conflict-1");

      expect(found.ok).toBe(true);
      if (!found.ok) return;
      expect(found.value?.entityId).toBe("prod-1");
      expect(found.value?.conflictType).toBe("value_mismatch");
    });

    it("unresolved conflicts can be listed by entity", () => {
      const repo = new InMemoryConflictRepository();
      repo.save(
        Object.freeze({
          id: "conflict-1",
          entityId: "prod-1",
          entityType: "product",
          sources: [makeSourceRef()],
          conflictType: "value_mismatch" as const,
          resolvedAt: null,
          resolution: null,
          createdAt: 1704067200000 as Instant,
        }),
      );
      repo.save(
        Object.freeze({
          id: "conflict-2",
          entityId: "prod-1",
          entityType: "product",
          sources: [makeSourceRef()],
          conflictType: "concurrent_update" as const,
          resolvedAt: 1704067300000 as Instant,
          resolution: "manual" as const,
          createdAt: 1704067200000 as Instant,
        }),
      );

      const unresolved = repo.getUnresolved("prod-1");
      expect(unresolved.ok).toBe(true);
      if (!unresolved.ok) return;
      expect(unresolved.value.length).toBe(1);
      expect(unresolved.value[0]?.id).toBe("conflict-1");
    });

    it("conflicts can be resolved", () => {
      const repo = new InMemoryConflictRepository();
      repo.save(
        Object.freeze({
          id: "conflict-1",
          entityId: "prod-1",
          entityType: "product",
          sources: [makeSourceRef()],
          conflictType: "value_mismatch" as const,
          resolvedAt: null,
          resolution: null,
          createdAt: 1704067200000 as Instant,
        }),
      );

      const resolved = repo.resolve("conflict-1", "manual", 1704067300000);
      expect(resolved.ok).toBe(true);
      if (!resolved.ok) return;
      expect(resolved.value?.resolution).toBe("manual");
      expect(resolved.value?.resolvedAt).toBe(1704067300000);
    });
  });
});
