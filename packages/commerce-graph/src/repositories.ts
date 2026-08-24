/**
 * Repository port interfaces for the commerce graph.
 *
 * All methods return Result<T> for error handling (no exceptions).
 * Repositories operate over frozen, immutable entities.
 */

import type { Result } from "@counter/domain";
import type {
  ConflictRecord,
  InventorySnapshot,
  MappingVersionRecord,
  PriceSnapshot,
  Product,
  ProductStatus,
  Variant,
} from "./index.js";

// ─── Product Repository ───────────────────────────────────────────────────────

export interface ProductRepository {
  save(product: Product): Result<Product>;
  getById(id: string): Result<Product | null>;
  getByExternalId(platform: string, externalId: string): Result<Product | null>;
  listByMerchant(merchantId: string): Result<readonly Product[]>;
  listByStatus(merchantId: string, status: ProductStatus): Result<readonly Product[]>;
  tombstone(id: string, tombstonedAt: number): Result<Product | null>;
}

// ─── Variant Repository ───────────────────────────────────────────────────────

export interface VariantRepository {
  save(variant: Variant): Result<Variant>;
  getById(id: string): Result<Variant | null>;
  getByProductId(productId: string): Result<readonly Variant[]>;
  getBySkuAndMerchant(sku: string, merchantId: string): Result<Variant | null>;
}

// ─── Price Repository ─────────────────────────────────────────────────────────

export interface PriceRepository {
  save(snapshot: PriceSnapshot): Result<PriceSnapshot>;
  getLatest(variantId: string): Result<PriceSnapshot | null>;
  getHistory(variantId: string): Result<readonly PriceSnapshot[]>;
  getByVariantAndSource(variantId: string, platform: string): Result<PriceSnapshot | null>;
}

// ─── Inventory Repository ─────────────────────────────────────────────────────

export interface InventoryRepository {
  save(snapshot: InventorySnapshot): Result<InventorySnapshot>;
  getLatest(variantId: string): Result<InventorySnapshot | null>;
  getHistory(variantId: string): Result<readonly InventorySnapshot[]>;
  getByVariantAndSource(variantId: string, platform: string): Result<InventorySnapshot | null>;
}

// ─── Mapping Version Repository ───────────────────────────────────────────────

export interface MappingVersionRepository {
  save(record: MappingVersionRecord): Result<MappingVersionRecord>;
  getById(id: string): Result<MappingVersionRecord | null>;
  getPublished(merchantId: string): Result<MappingVersionRecord | null>;
  publish(id: string, publishedAt: number): Result<MappingVersionRecord | null>;
  rollback(id: string, rolledBackAt: number): Result<MappingVersionRecord | null>;
  listByMerchant(merchantId: string): Result<readonly MappingVersionRecord[]>;
}

// ─── Conflict Repository ──────────────────────────────────────────────────────

export interface ConflictRepository {
  save(record: ConflictRecord): Result<ConflictRecord>;
  getById(id: string): Result<ConflictRecord | null>;
  getUnresolved(entityId: string): Result<readonly ConflictRecord[]>;
  resolve(id: string, resolution: string, resolvedAt: number): Result<ConflictRecord | null>;
}
