/**
 * In-memory Map-based implementations of all repository ports.
 *
 * Uses proper observation ordering: newer observedAt wins for same source.
 * Products with 'tombstoned' status are retained but excluded from active queries.
 * Returned entities are frozen for immutability.
 */

import type { Instant, Result } from "@counter/domain";
import { ok } from "@counter/domain";
import type {
  ConflictRecord,
  InventorySnapshot,
  MappingVersionRecord,
  PriceSnapshot,
  Product,
  ProductStatus,
  ResolutionStrategy,
  Variant,
} from "./index.js";
import type {
  ConflictRepository,
  InventoryRepository,
  MappingVersionRepository,
  PriceRepository,
  ProductRepository,
  VariantRepository,
} from "./repositories.js";

// ─── Product Repository ───────────────────────────────────────────────────────

export class InMemoryProductRepository implements ProductRepository {
  readonly #products = new Map<string, Product>();

  public save(product: Product): Result<Product> {
    const frozen = Object.freeze({ ...product });
    this.#products.set(product.id, frozen);
    return ok(frozen);
  }

  public getById(id: string): Result<Product | null> {
    const product = this.#products.get(id);
    return ok(product ?? null);
  }

  public getByExternalId(platform: string, externalId: string): Result<Product | null> {
    for (const product of this.#products.values()) {
      for (const ref of product.sourceReferences) {
        if (ref.platform === platform && ref.externalId === externalId) {
          return ok(product);
        }
      }
    }
    return ok(null);
  }

  public listByMerchant(merchantId: string): Result<readonly Product[]> {
    const results: Product[] = [];
    for (const product of this.#products.values()) {
      if (product.merchantId === merchantId && product.status !== "tombstoned") {
        results.push(product);
      }
    }
    return ok(Object.freeze(results));
  }

  public listByStatus(merchantId: string, status: ProductStatus): Result<readonly Product[]> {
    const results: Product[] = [];
    for (const product of this.#products.values()) {
      if (product.merchantId === merchantId && product.status === status) {
        results.push(product);
      }
    }
    return ok(Object.freeze(results));
  }

  public tombstone(id: string, tombstonedAt: number): Result<Product | null> {
    const existing = this.#products.get(id);
    if (existing === undefined) {
      return ok(null);
    }
    const updated: Product = Object.freeze({
      ...existing,
      status: "tombstoned" as const,
      tombstonedAt: tombstonedAt as Instant,
      updatedAt: tombstonedAt as Instant,
    });
    this.#products.set(id, updated);
    return ok(updated);
  }
}

// ─── Variant Repository ───────────────────────────────────────────────────────

export class InMemoryVariantRepository implements VariantRepository {
  readonly #variants = new Map<string, Variant>();

  public save(variant: Variant): Result<Variant> {
    const frozen = Object.freeze({ ...variant });
    this.#variants.set(variant.id, frozen);
    return ok(frozen);
  }

  public getById(id: string): Result<Variant | null> {
    const variant = this.#variants.get(id);
    return ok(variant ?? null);
  }

  public getByProductId(productId: string): Result<readonly Variant[]> {
    const results: Variant[] = [];
    for (const variant of this.#variants.values()) {
      if (variant.productId === productId) {
        results.push(variant);
      }
    }
    return ok(Object.freeze(results));
  }

  public getBySkuAndMerchant(sku: string, merchantId: string): Result<Variant | null> {
    for (const variant of this.#variants.values()) {
      if (variant.sku === sku && variant.merchantId === merchantId) {
        return ok(variant);
      }
    }
    return ok(null);
  }
}

// ─── Price Repository ─────────────────────────────────────────────────────────

export class InMemoryPriceRepository implements PriceRepository {
  readonly #snapshots: PriceSnapshot[] = [];

  public save(snapshot: PriceSnapshot): Result<PriceSnapshot> {
    // Out-of-order handling: check if existing observation for same variant+source is newer
    const existingIdx = this.#snapshots.findIndex(
      (s) => s.variantId === snapshot.variantId && s.source.platform === snapshot.source.platform,
    );
    if (existingIdx !== -1) {
      const existing = this.#snapshots[existingIdx]!;
      if ((snapshot.observedAt as number) <= (existing.observedAt as number)) {
        // Out-of-order: existing is newer, keep history but don't replace latest
        const frozen = Object.freeze({ ...snapshot });
        this.#snapshots.push(frozen);
        return ok(frozen);
      }
    }
    const frozen = Object.freeze({ ...snapshot });
    this.#snapshots.push(frozen);
    return ok(frozen);
  }

  public getLatest(variantId: string): Result<PriceSnapshot | null> {
    let latest: PriceSnapshot | null = null;
    for (const snapshot of this.#snapshots) {
      if (snapshot.variantId === variantId) {
        if (latest === null || (snapshot.observedAt as number) > (latest.observedAt as number)) {
          latest = snapshot;
        }
      }
    }
    return ok(latest);
  }

  public getHistory(variantId: string): Result<readonly PriceSnapshot[]> {
    const results = this.#snapshots
      .filter((s) => s.variantId === variantId)
      .sort((a, b) => (b.observedAt as number) - (a.observedAt as number));
    return ok(Object.freeze(results));
  }

  public getByVariantAndSource(variantId: string, platform: string): Result<PriceSnapshot | null> {
    let latest: PriceSnapshot | null = null;
    for (const snapshot of this.#snapshots) {
      if (snapshot.variantId === variantId && snapshot.source.platform === platform) {
        if (latest === null || (snapshot.observedAt as number) > (latest.observedAt as number)) {
          latest = snapshot;
        }
      }
    }
    return ok(latest);
  }
}

// ─── Inventory Repository ─────────────────────────────────────────────────────

export class InMemoryInventoryRepository implements InventoryRepository {
  readonly #snapshots: InventorySnapshot[] = [];

  public save(snapshot: InventorySnapshot): Result<InventorySnapshot> {
    // Out-of-order handling: check if existing observation for same variant+source is newer
    const existingIdx = this.#snapshots.findIndex(
      (s) => s.variantId === snapshot.variantId && s.source.platform === snapshot.source.platform,
    );
    if (existingIdx !== -1) {
      const existing = this.#snapshots[existingIdx]!;
      if ((snapshot.observedAt as number) <= (existing.observedAt as number)) {
        // Out-of-order: existing is newer, keep history but don't replace latest
        const frozen = Object.freeze({ ...snapshot });
        this.#snapshots.push(frozen);
        return ok(frozen);
      }
    }
    const frozen = Object.freeze({ ...snapshot });
    this.#snapshots.push(frozen);
    return ok(frozen);
  }

  public getLatest(variantId: string): Result<InventorySnapshot | null> {
    let latest: InventorySnapshot | null = null;
    for (const snapshot of this.#snapshots) {
      if (snapshot.variantId === variantId) {
        if (latest === null || (snapshot.observedAt as number) > (latest.observedAt as number)) {
          latest = snapshot;
        }
      }
    }
    return ok(latest);
  }

  public getHistory(variantId: string): Result<readonly InventorySnapshot[]> {
    const results = this.#snapshots
      .filter((s) => s.variantId === variantId)
      .sort((a, b) => (b.observedAt as number) - (a.observedAt as number));
    return ok(Object.freeze(results));
  }

  public getByVariantAndSource(
    variantId: string,
    platform: string,
  ): Result<InventorySnapshot | null> {
    let latest: InventorySnapshot | null = null;
    for (const snapshot of this.#snapshots) {
      if (snapshot.variantId === variantId && snapshot.source.platform === platform) {
        if (latest === null || (snapshot.observedAt as number) > (latest.observedAt as number)) {
          latest = snapshot;
        }
      }
    }
    return ok(latest);
  }
}

// ─── Mapping Version Repository ───────────────────────────────────────────────

export class InMemoryMappingVersionRepository implements MappingVersionRepository {
  readonly #records = new Map<string, MappingVersionRecord>();

  public save(record: MappingVersionRecord): Result<MappingVersionRecord> {
    const frozen = Object.freeze({ ...record });
    this.#records.set(record.id, frozen);
    return ok(frozen);
  }

  public getById(id: string): Result<MappingVersionRecord | null> {
    const record = this.#records.get(id);
    return ok(record ?? null);
  }

  public getPublished(merchantId: string): Result<MappingVersionRecord | null> {
    for (const record of this.#records.values()) {
      if (record.merchantId === merchantId && record.status === "published") {
        return ok(record);
      }
    }
    return ok(null);
  }

  public publish(id: string, publishedAt: number): Result<MappingVersionRecord | null> {
    const existing = this.#records.get(id);
    if (existing === undefined) {
      return ok(null);
    }

    // Revoke any previously published version for the same merchant
    for (const [recordId, record] of this.#records) {
      if (record.merchantId === existing.merchantId && record.status === "published" && recordId !== id) {
        const revoked: MappingVersionRecord = Object.freeze({
          ...record,
          status: "rolledBack" as const,
          rolledBackAt: publishedAt as Instant,
        });
        this.#records.set(recordId, revoked);
      }
    }

    const updated: MappingVersionRecord = Object.freeze({
      ...existing,
      status: "published" as const,
      publishedAt: publishedAt as Instant,
    });
    this.#records.set(id, updated);
    return ok(updated);
  }

  public rollback(id: string, rolledBackAt: number): Result<MappingVersionRecord | null> {
    const existing = this.#records.get(id);
    if (existing === undefined) {
      return ok(null);
    }
    const updated: MappingVersionRecord = Object.freeze({
      ...existing,
      status: "rolledBack" as const,
      rolledBackAt: rolledBackAt as Instant,
    });
    this.#records.set(id, updated);
    return ok(updated);
  }

  public listByMerchant(merchantId: string): Result<readonly MappingVersionRecord[]> {
    const results: MappingVersionRecord[] = [];
    for (const record of this.#records.values()) {
      if (record.merchantId === merchantId) {
        results.push(record);
      }
    }
    return ok(Object.freeze(results));
  }
}

// ─── Conflict Repository ──────────────────────────────────────────────────────

export class InMemoryConflictRepository implements ConflictRepository {
  readonly #records = new Map<string, ConflictRecord>();

  public save(record: ConflictRecord): Result<ConflictRecord> {
    const frozen = Object.freeze({ ...record });
    this.#records.set(record.id, frozen);
    return ok(frozen);
  }

  public getById(id: string): Result<ConflictRecord | null> {
    const record = this.#records.get(id);
    return ok(record ?? null);
  }

  public getUnresolved(entityId: string): Result<readonly ConflictRecord[]> {
    const results: ConflictRecord[] = [];
    for (const record of this.#records.values()) {
      if (record.entityId === entityId && record.resolvedAt === null) {
        results.push(record);
      }
    }
    return ok(Object.freeze(results));
  }

  public resolve(
    id: string,
    resolution: ResolutionStrategy,
    resolvedAt: number,
  ): Result<ConflictRecord | null> {
    const existing = this.#records.get(id);
    if (existing === undefined) {
      return ok(null);
    }
    const updated: ConflictRecord = Object.freeze({
      ...existing,
      resolution,
      resolvedAt: resolvedAt as Instant,
    });
    this.#records.set(id, updated);
    return ok(updated);
  }
}
