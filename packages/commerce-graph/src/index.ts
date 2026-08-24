/**
 * packages/commerce-graph
 *
 * Normalized commerce model: products, variants, prices, inventory, quotes
 * with provenance. This package defines the canonical commerce types that
 * merchant connectors map platform-specific data into.
 */

import type { Instant } from "@counter/domain";
import type { IsoCurrencyCode, Money } from "@counter/domain";
import type { Sha256Digest } from "@counter/domain";

export const PACKAGE_NAME = "@counter/commerce-graph";

// ─── Product Status ───────────────────────────────────────────────────────────

export const PRODUCT_STATUSES = ["active", "released", "tombstoned", "unpublished"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

// ─── Source Priority ──────────────────────────────────────────────────────────

export interface SourcePriority {
  readonly source: string;
  readonly priority: number;
}

// ─── Source Reference ─────────────────────────────────────────────────────────

/** A reference to the source system that provided a piece of data. */
export interface SourceReference {
  readonly platform: string;
  readonly externalId: string;
  readonly fetchedAt: Instant;
  readonly mappingVersion: MappingVersion;
}

// ─── Mapping Version (lightweight) ───────────────────────────────────────────

/** Tracks the version of the mapping used to normalize external data. */
export interface MappingVersion {
  readonly version: string;
  readonly schemaHash: string;
}

// ─── Freshness Policy ─────────────────────────────────────────────────────────

/** How fresh data must be before requiring a re-fetch. */
export interface FreshnessPolicy {
  readonly resourceName: string;
  readonly maxAgeMs: number;
  readonly warningThresholdMs: number;
}

// ─── Product ──────────────────────────────────────────────────────────────────

/** A normalized product in the commerce graph. */
export interface Product {
  readonly id: string;
  readonly merchantId: string;
  readonly title: string;
  readonly description: string;
  readonly variants: readonly Variant[];
  readonly sourceReference: SourceReference;
  readonly sourceReferences: readonly SourceReference[];
  readonly status: ProductStatus;
  readonly tombstonedAt: Instant | undefined;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

// ─── Variant ──────────────────────────────────────────────────────────────────

/** A product variant with pricing and inventory associations. */
export interface Variant {
  readonly id: string;
  readonly productId: string;
  readonly merchantId: string;
  readonly sku: string;
  readonly title: string;
  readonly active: boolean;
}

// ─── Price Snapshot ───────────────────────────────────────────────────────────

/** A point-in-time price observation for a variant using integer minor units. */
export interface PriceSnapshot {
  readonly variantId: string;
  readonly amount: Money;
  readonly observedAt: Instant;
  readonly source: SourceReference;
}

// ─── Inventory Snapshot ───────────────────────────────────────────────────────

/** A point-in-time inventory observation for a variant. */
export interface InventorySnapshot {
  readonly variantId: string;
  readonly availableQuantity: number;
  readonly observedAt: Instant;
  readonly source: SourceReference;
}

// ─── Merchant Quote ───────────────────────────────────────────────────────────

/** A quote representing price and availability at a specific time. */
export interface MerchantQuote {
  readonly id: string;
  readonly merchantId: string;
  readonly variantId: string;
  readonly price: PriceSnapshot;
  readonly inventory: InventorySnapshot;
  readonly validUntil: Instant;
  readonly freshnessPolicy: FreshnessPolicy;
}

// ─── Mapping Transform ────────────────────────────────────────────────────────

export interface MappingTransform {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly schemaHash: Sha256Digest;
  readonly inputSchema: string;
  readonly outputSchema: string;
  readonly createdAt: Instant;
}

// ─── Mapping Version Record ───────────────────────────────────────────────────

export const MAPPING_VERSION_STATUSES = ["draft", "published", "rolledBack"] as const;
export type MappingVersionStatus = (typeof MAPPING_VERSION_STATUSES)[number];

export interface MappingVersionRecord {
  readonly id: string;
  readonly merchantId: string;
  readonly version: string;
  readonly schemaHash: Sha256Digest;
  readonly transforms: readonly MappingTransform[];
  readonly status: MappingVersionStatus;
  readonly publishedAt: Instant | null;
  readonly rolledBackAt: Instant | null;
  readonly createdAt: Instant;
}

// ─── Conflict Record ──────────────────────────────────────────────────────────

export const CONFLICT_TYPES = ["value_mismatch", "stale_override", "concurrent_update"] as const;
export type ConflictType = (typeof CONFLICT_TYPES)[number];

export const RESOLUTION_STRATEGIES = ["source_priority", "newer_wins", "manual"] as const;
export type ResolutionStrategy = (typeof RESOLUTION_STRATEGIES)[number];

export interface ConflictRecord {
  readonly id: string;
  readonly entityId: string;
  readonly entityType: string;
  readonly sources: readonly SourceReference[];
  readonly conflictType: ConflictType;
  readonly resolvedAt: Instant | null;
  readonly resolution: ResolutionStrategy | null;
  readonly createdAt: Instant;
}

// ─── Raw Normalized Preview ───────────────────────────────────────────────────

export interface RawNormalizedPreview {
  readonly rawData: unknown;
  readonly normalizedData: unknown;
  readonly transformId: string;
  readonly transformVersion: string;
  readonly differences: readonly string[];
}

// ─── Re-exports ───────────────────────────────────────────────────────────────

export type { Instant, IsoCurrencyCode, Money, Sha256Digest };

export { evaluateFreshness } from "./freshness.js";
export type { FreshnessAssessment, FreshnessMode } from "./freshness.js";

export type {
  ProductRepository,
  VariantRepository,
  PriceRepository,
  InventoryRepository,
  MappingVersionRepository,
  ConflictRepository,
} from "./repositories.js";

export {
  InMemoryProductRepository,
  InMemoryVariantRepository,
  InMemoryPriceRepository,
  InMemoryInventoryRepository,
  InMemoryMappingVersionRepository,
  InMemoryConflictRepository,
} from "./in-memory-repositories.js";

export { TransformRegistry, applyTransform, previewTransform } from "./transforms.js";

export {
  resolveConflict,
  detectStaleOverride,
} from "./source-priority.js";
