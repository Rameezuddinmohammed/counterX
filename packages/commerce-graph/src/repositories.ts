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
  ResolutionStrategy,
  Variant,
} from "./types.js";

// ─── Product Repository ───────────────────────────────────────────────────────

export interface ProductRepository {
  save(product: Product): Promise<Result<Product>>;
  getById(id: string): Promise<Result<Product | null>>;
  getByExternalId(platform: string, externalId: string): Promise<Result<Product | null>>;
  listByMerchant(merchantId: string): Promise<Result<readonly Product[]>>;
  listByStatus(merchantId: string, status: ProductStatus): Promise<Result<readonly Product[]>>;
  tombstone(id: string, tombstonedAt: number): Promise<Result<Product | null>>;
}

// ─── Variant Repository ───────────────────────────────────────────────────────

export interface VariantRepository {
  save(variant: Variant): Promise<Result<Variant>>;
  getById(id: string): Promise<Result<Variant | null>>;
  getByProductId(productId: string): Promise<Result<readonly Variant[]>>;
  getBySkuAndMerchant(sku: string, merchantId: string): Promise<Result<Variant | null>>;
}

// ─── Price Repository ─────────────────────────────────────────────────────────

export interface PriceRepository {
  save(snapshot: PriceSnapshot): Promise<Result<PriceSnapshot>>;
  getLatest(variantId: string): Promise<Result<PriceSnapshot | null>>;
  getHistory(variantId: string): Promise<Result<readonly PriceSnapshot[]>>;
  getByVariantAndSource(variantId: string, platform: string): Promise<Result<PriceSnapshot | null>>;
}

// ─── Inventory Repository ─────────────────────────────────────────────────────

export interface InventoryRepository {
  save(snapshot: InventorySnapshot): Promise<Result<InventorySnapshot>>;
  getLatest(variantId: string): Promise<Result<InventorySnapshot | null>>;
  getHistory(variantId: string): Promise<Result<readonly InventorySnapshot[]>>;
  getByVariantAndSource(
    variantId: string,
    platform: string,
  ): Promise<Result<InventorySnapshot | null>>;
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
  resolve(
    id: string,
    resolution: ResolutionStrategy,
    resolvedAt: number,
  ): Result<ConflictRecord | null>;
}
