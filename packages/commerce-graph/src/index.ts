/**
 * packages/commerce-graph
 *
 * Normalized commerce model: products, variants, prices, inventory, quotes
 * with provenance. This package defines the canonical commerce types that
 * merchant connectors map platform-specific data into.
 */

import type { Instant, IsoCurrencyCode, Money, Sha256Digest } from "@counter/domain";

export const PACKAGE_NAME = "@counter/commerce-graph";

// ─── Core Types (re-exported from types.ts) ───────────────────────────────────

export {
  PRODUCT_STATUSES,
  MAPPING_VERSION_STATUSES,
  CONFLICT_TYPES,
  RESOLUTION_STRATEGIES,
} from "./types.js";

export type {
  ProductStatus,
  SourcePriority,
  SourceReference,
  MappingVersion,
  FreshnessPolicy,
  Product,
  Variant,
  PriceSnapshot,
  InventorySnapshot,
  MerchantQuote,
  MappingTransform,
  MappingVersionStatus,
  MappingVersionRecord,
  ConflictType,
  ResolutionStrategy,
  ConflictRecord,
  RawNormalizedPreview,
} from "./types.js";

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
export type { TransformContext } from "./transforms.js";

export {
  resolveConflict,
  detectStaleOverride,
} from "./source-priority.js";
