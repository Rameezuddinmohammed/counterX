/**
 * Durable storage for the real Shopify catalog-sync engine's normalized
 * output, backing @counter/commerce-graph's ProductRepository/
 * VariantRepository/PriceRepository/InventoryRepository.
 *
 * Product rows never store variants inline (commerce-graph's Product.variants
 * is a read-time convenience field) - getById/listByMerchant/listByStatus
 * each do a second, batched query against catalog_variants and assemble the
 * full Product, matching the interface's contract of returning a
 * fully-hydrated Product.
 *
 * SECURITY: rows carry product/price/inventory data only - no payment
 * credentials, PAN, CVV, UPI PIN, or private keys.
 */

import type { Environment, Instant, Result } from "@counter/domain";
import { createMoney, ok } from "@counter/domain";
import type {
  InventoryRepository,
  InventorySnapshot,
  PriceRepository,
  PriceSnapshot,
  Product,
  ProductRepository,
  ProductStatus,
  SourceReference,
  Variant,
  VariantRepository,
} from "@counter/commerce-graph";
import type { TransactionalDatabase } from "./database.js";

// ─── Row shapes ────────────────────────────────────────────────────────────

interface ProductRow {
  id: string;
  merchant_id: string;
  title: string;
  description: string;
  source_reference: SourceReference;
  source_references: SourceReference[];
  status: string;
  tombstoned_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface VariantRow {
  id: string;
  product_id: string;
  merchant_id: string;
  sku: string;
  title: string;
  active: boolean;
}

interface PriceRow {
  variant_id: string;
  amount_minor: string;
  currency: string;
  observed_at: Date;
  source: SourceReference;
}

interface InventoryRow {
  variant_id: string;
  available_quantity: number;
  observed_at: Date;
  source: SourceReference;
}

function toInstant(value: Date): Instant {
  return value.getTime() as Instant;
}

function rowToVariant(row: VariantRow): Variant {
  return Object.freeze({
    id: row.id,
    productId: row.product_id,
    merchantId: row.merchant_id,
    sku: row.sku,
    title: row.title,
    active: row.active,
  });
}

function rowToPriceSnapshot(row: PriceRow): PriceSnapshot {
  const amountResult = createMoney(BigInt(row.amount_minor), row.currency);
  if (!amountResult.ok) {
    throw new Error("Persisted price snapshot contains an invalid money amount");
  }
  return Object.freeze({
    variantId: row.variant_id,
    amount: amountResult.value,
    observedAt: toInstant(row.observed_at),
    source: row.source,
  });
}

function rowToInventorySnapshot(row: InventoryRow): InventorySnapshot {
  return Object.freeze({
    variantId: row.variant_id,
    availableQuantity: row.available_quantity,
    observedAt: toInstant(row.observed_at),
    source: row.source,
  });
}

// ─── Product Repository ────────────────────────────────────────────────────

const PRODUCT_COLUMNS = `id, merchant_id, title, description, source_reference,
       source_references, status, tombstoned_at, created_at, updated_at`;
const VARIANT_COLUMNS = `id, product_id, merchant_id, sku, title, active`;

export class PostgresProductRepository implements ProductRepository {
  constructor(
    private readonly database: TransactionalDatabase,
    private readonly environment: Environment,
  ) {}

  private async hydrate(rows: readonly ProductRow[]): Promise<Product[]> {
    if (rows.length === 0) {
      return [];
    }
    const productIds = rows.map((row) => row.id);
    const variantResult = await this.database.query<VariantRow>(
      `SELECT ${VARIANT_COLUMNS}
         FROM merchant.catalog_variants
        WHERE environment = $1 AND product_id = ANY($2::text[])`,
      [this.environment, productIds],
    );
    const variantsByProduct = new Map<string, Variant[]>();
    for (const variantRow of variantResult.rows) {
      const variant = rowToVariant(variantRow);
      const existing = variantsByProduct.get(variant.productId);
      if (existing !== undefined) {
        existing.push(variant);
      } else {
        variantsByProduct.set(variant.productId, [variant]);
      }
    }
    return rows.map((row) =>
      Object.freeze({
        id: row.id,
        merchantId: row.merchant_id,
        title: row.title,
        description: row.description,
        variants: Object.freeze(variantsByProduct.get(row.id) ?? []),
        sourceReference: row.source_reference,
        sourceReferences: row.source_references,
        status: row.status as ProductStatus,
        tombstonedAt: row.tombstoned_at === null ? undefined : toInstant(row.tombstoned_at),
        createdAt: toInstant(row.created_at),
        updatedAt: toInstant(row.updated_at),
      }),
    );
  }

  async save(product: Product): Promise<Result<Product>> {
    await this.database.query(
      `INSERT INTO merchant.catalog_products (
         environment, id, merchant_id, title, description, source_reference,
         source_references, status, tombstoned_at, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (environment, id) DO UPDATE SET
         merchant_id = EXCLUDED.merchant_id,
         title = EXCLUDED.title,
         description = EXCLUDED.description,
         source_reference = EXCLUDED.source_reference,
         source_references = EXCLUDED.source_references,
         status = EXCLUDED.status,
         tombstoned_at = EXCLUDED.tombstoned_at,
         updated_at = EXCLUDED.updated_at`,
      [
        this.environment,
        product.id,
        product.merchantId,
        product.title,
        product.description,
        JSON.stringify(product.sourceReference),
        JSON.stringify(product.sourceReferences),
        product.status,
        product.tombstonedAt === undefined ? null : new Date(product.tombstonedAt).toISOString(),
        new Date(product.createdAt).toISOString(),
        new Date(product.updatedAt).toISOString(),
      ],
    );
    return ok(Object.freeze({ ...product }));
  }

  async getById(id: string): Promise<Result<Product | null>> {
    const result = await this.database.query<ProductRow>(
      `SELECT ${PRODUCT_COLUMNS}
         FROM merchant.catalog_products
        WHERE environment = $1 AND id = $2`,
      [this.environment, id],
    );
    const [product] = await this.hydrate(result.rows);
    return ok(product ?? null);
  }

  async getByExternalId(platform: string, externalId: string): Promise<Result<Product | null>> {
    const result = await this.database.query<ProductRow>(
      `SELECT ${PRODUCT_COLUMNS}
         FROM merchant.catalog_products
        WHERE environment = $1
          AND source_references @> $2::jsonb`,
      [this.environment, JSON.stringify([{ platform, externalId }])],
    );
    const [product] = await this.hydrate(result.rows);
    return ok(product ?? null);
  }

  async listByMerchant(merchantId: string): Promise<Result<readonly Product[]>> {
    const result = await this.database.query<ProductRow>(
      `SELECT ${PRODUCT_COLUMNS}
         FROM merchant.catalog_products
        WHERE environment = $1 AND merchant_id = $2 AND status != 'tombstoned'
        ORDER BY updated_at DESC`,
      [this.environment, merchantId],
    );
    return ok(Object.freeze(await this.hydrate(result.rows)));
  }

  async listByStatus(
    merchantId: string,
    status: ProductStatus,
  ): Promise<Result<readonly Product[]>> {
    const result = await this.database.query<ProductRow>(
      `SELECT ${PRODUCT_COLUMNS}
         FROM merchant.catalog_products
        WHERE environment = $1 AND merchant_id = $2 AND status = $3
        ORDER BY updated_at DESC`,
      [this.environment, merchantId, status],
    );
    return ok(Object.freeze(await this.hydrate(result.rows)));
  }

  async tombstone(id: string, tombstonedAt: number): Promise<Result<Product | null>> {
    const result = await this.database.query<ProductRow>(
      `UPDATE merchant.catalog_products
          SET status = 'tombstoned', tombstoned_at = $3, updated_at = $3
        WHERE environment = $1 AND id = $2
        RETURNING ${PRODUCT_COLUMNS}`,
      [this.environment, id, new Date(tombstonedAt).toISOString()],
    );
    const [product] = await this.hydrate(result.rows);
    return ok(product ?? null);
  }
}

// ─── Variant Repository ────────────────────────────────────────────────────

export class PostgresVariantRepository implements VariantRepository {
  constructor(
    private readonly database: TransactionalDatabase,
    private readonly environment: Environment,
  ) {}

  async save(variant: Variant): Promise<Result<Variant>> {
    await this.database.query(
      `INSERT INTO merchant.catalog_variants (
         environment, id, product_id, merchant_id, sku, title, active
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (environment, id) DO UPDATE SET
         product_id = EXCLUDED.product_id,
         merchant_id = EXCLUDED.merchant_id,
         sku = EXCLUDED.sku,
         title = EXCLUDED.title,
         active = EXCLUDED.active`,
      [
        this.environment,
        variant.id,
        variant.productId,
        variant.merchantId,
        variant.sku,
        variant.title,
        variant.active,
      ],
    );
    return ok(Object.freeze({ ...variant }));
  }

  async getById(id: string): Promise<Result<Variant | null>> {
    const result = await this.database.query<VariantRow>(
      `SELECT ${VARIANT_COLUMNS}
         FROM merchant.catalog_variants
        WHERE environment = $1 AND id = $2`,
      [this.environment, id],
    );
    const row = result.rows[0];
    return ok(row === undefined ? null : rowToVariant(row));
  }

  async getByProductId(productId: string): Promise<Result<readonly Variant[]>> {
    const result = await this.database.query<VariantRow>(
      `SELECT ${VARIANT_COLUMNS}
         FROM merchant.catalog_variants
        WHERE environment = $1 AND product_id = $2`,
      [this.environment, productId],
    );
    return ok(Object.freeze(result.rows.map(rowToVariant)));
  }

  async getBySkuAndMerchant(sku: string, merchantId: string): Promise<Result<Variant | null>> {
    const result = await this.database.query<VariantRow>(
      `SELECT ${VARIANT_COLUMNS}
         FROM merchant.catalog_variants
        WHERE environment = $1 AND sku = $2 AND merchant_id = $3`,
      [this.environment, sku, merchantId],
    );
    const row = result.rows[0];
    return ok(row === undefined ? null : rowToVariant(row));
  }
}

// ─── Price Repository ───────────────────────────────────────────────────────

export class PostgresPriceRepository implements PriceRepository {
  constructor(
    private readonly database: TransactionalDatabase,
    private readonly environment: Environment,
  ) {}

  async save(snapshot: PriceSnapshot): Promise<Result<PriceSnapshot>> {
    await this.database.query(
      `INSERT INTO merchant.catalog_prices (
         environment, variant_id, amount_minor, currency, observed_at, source
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        this.environment,
        snapshot.variantId,
        snapshot.amount.amountMinor.toString(),
        snapshot.amount.currency,
        new Date(snapshot.observedAt).toISOString(),
        JSON.stringify(snapshot.source),
      ],
    );
    return ok(Object.freeze({ ...snapshot }));
  }

  async getLatest(variantId: string): Promise<Result<PriceSnapshot | null>> {
    const result = await this.database.query<PriceRow>(
      `SELECT variant_id, amount_minor, currency, observed_at, source
         FROM merchant.catalog_prices
        WHERE environment = $1 AND variant_id = $2
        ORDER BY observed_at DESC
        LIMIT 1`,
      [this.environment, variantId],
    );
    const row = result.rows[0];
    return ok(row === undefined ? null : rowToPriceSnapshot(row));
  }

  async getHistory(variantId: string): Promise<Result<readonly PriceSnapshot[]>> {
    const result = await this.database.query<PriceRow>(
      `SELECT variant_id, amount_minor, currency, observed_at, source
         FROM merchant.catalog_prices
        WHERE environment = $1 AND variant_id = $2
        ORDER BY observed_at DESC`,
      [this.environment, variantId],
    );
    return ok(Object.freeze(result.rows.map(rowToPriceSnapshot)));
  }

  async getByVariantAndSource(
    variantId: string,
    platform: string,
  ): Promise<Result<PriceSnapshot | null>> {
    const result = await this.database.query<PriceRow>(
      `SELECT variant_id, amount_minor, currency, observed_at, source
         FROM merchant.catalog_prices
        WHERE environment = $1 AND variant_id = $2 AND source ->> 'platform' = $3
        ORDER BY observed_at DESC
        LIMIT 1`,
      [this.environment, variantId, platform],
    );
    const row = result.rows[0];
    return ok(row === undefined ? null : rowToPriceSnapshot(row));
  }
}

// ─── Inventory Repository ───────────────────────────────────────────────────

export class PostgresInventoryRepository implements InventoryRepository {
  constructor(
    private readonly database: TransactionalDatabase,
    private readonly environment: Environment,
  ) {}

  async save(snapshot: InventorySnapshot): Promise<Result<InventorySnapshot>> {
    await this.database.query(
      `INSERT INTO merchant.catalog_inventory (
         environment, variant_id, available_quantity, observed_at, source
       ) VALUES ($1, $2, $3, $4, $5)`,
      [
        this.environment,
        snapshot.variantId,
        snapshot.availableQuantity,
        new Date(snapshot.observedAt).toISOString(),
        JSON.stringify(snapshot.source),
      ],
    );
    return ok(Object.freeze({ ...snapshot }));
  }

  async getLatest(variantId: string): Promise<Result<InventorySnapshot | null>> {
    const result = await this.database.query<InventoryRow>(
      `SELECT variant_id, available_quantity, observed_at, source
         FROM merchant.catalog_inventory
        WHERE environment = $1 AND variant_id = $2
        ORDER BY observed_at DESC
        LIMIT 1`,
      [this.environment, variantId],
    );
    const row = result.rows[0];
    return ok(row === undefined ? null : rowToInventorySnapshot(row));
  }

  async getHistory(variantId: string): Promise<Result<readonly InventorySnapshot[]>> {
    const result = await this.database.query<InventoryRow>(
      `SELECT variant_id, available_quantity, observed_at, source
         FROM merchant.catalog_inventory
        WHERE environment = $1 AND variant_id = $2
        ORDER BY observed_at DESC`,
      [this.environment, variantId],
    );
    return ok(Object.freeze(result.rows.map(rowToInventorySnapshot)));
  }

  async getByVariantAndSource(
    variantId: string,
    platform: string,
  ): Promise<Result<InventorySnapshot | null>> {
    const result = await this.database.query<InventoryRow>(
      `SELECT variant_id, available_quantity, observed_at, source
         FROM merchant.catalog_inventory
        WHERE environment = $1 AND variant_id = $2 AND source ->> 'platform' = $3
        ORDER BY observed_at DESC
        LIMIT 1`,
      [this.environment, variantId, platform],
    );
    const row = result.rows[0];
    return ok(row === undefined ? null : rowToInventorySnapshot(row));
  }
}
