-- Durable storage for the real Shopify catalog-sync engine
-- (packages/shopify-connector's CatalogSyncService, product-index.ts's
-- ProductIndex) and its cursor/resume state - both real, tested, and
-- previously entirely unwired to any durable store (in-memory only).
--
-- Backs @counter/commerce-graph's ProductRepository/VariantRepository/
-- PriceRepository/InventoryRepository and @counter/shopify-connector's
-- CursorStore. Same "direct-SQL trust boundary, RLS enabled+forced, zero
-- policies" pattern as merchant.manual_catalog_items and every other
-- merchant.* table in this schema.

CREATE TABLE merchant.catalog_products (
  environment platform.counter_environment NOT NULL,
  id text NOT NULL,
  merchant_id text NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  source_reference jsonb NOT NULL,
  source_references jsonb NOT NULL,
  status text NOT NULL,
  tombstoned_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (environment, id),
  CONSTRAINT catalog_products_merchant_id_profile
    CHECK (identity.is_counter_id(merchant_id, 'merchant')),
  CONSTRAINT catalog_products_status
    CHECK (status IN ('active', 'released', 'tombstoned', 'unpublished')),
  CONSTRAINT catalog_products_tombstoned_state
    CHECK (
      (status = 'tombstoned' AND tombstoned_at IS NOT NULL)
      OR (status != 'tombstoned' AND tombstoned_at IS NULL)
    ),
  CONSTRAINT catalog_products_merchant_fk
    FOREIGN KEY (environment, merchant_id)
    REFERENCES merchant.scopes (environment, merchant_id)
);

CREATE INDEX catalog_products_merchant
  ON merchant.catalog_products (environment, merchant_id, status);

CREATE TABLE merchant.catalog_variants (
  environment platform.counter_environment NOT NULL,
  id text NOT NULL,
  product_id text NOT NULL,
  merchant_id text NOT NULL,
  sku text NOT NULL,
  title text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (environment, id),
  CONSTRAINT catalog_variants_merchant_id_profile
    CHECK (identity.is_counter_id(merchant_id, 'merchant')),
  CONSTRAINT catalog_variants_product_fk
    FOREIGN KEY (environment, product_id)
    REFERENCES merchant.catalog_products (environment, id)
);

CREATE INDEX catalog_variants_product
  ON merchant.catalog_variants (environment, product_id);
CREATE INDEX catalog_variants_sku_merchant
  ON merchant.catalog_variants (environment, merchant_id, sku);

-- Append-only price observations (PriceSnapshot has no merchantId field -
-- merchant scoping flows through variant_id's FK to catalog_variants).
CREATE TABLE merchant.catalog_prices (
  environment platform.counter_environment NOT NULL,
  id bigint GENERATED ALWAYS AS IDENTITY,
  variant_id text NOT NULL,
  amount_minor bigint NOT NULL,
  currency text NOT NULL,
  observed_at timestamptz NOT NULL,
  source jsonb NOT NULL,
  PRIMARY KEY (environment, id),
  CONSTRAINT catalog_prices_amount_non_negative CHECK (amount_minor >= 0),
  CONSTRAINT catalog_prices_variant_fk
    FOREIGN KEY (environment, variant_id)
    REFERENCES merchant.catalog_variants (environment, id)
);

CREATE INDEX catalog_prices_variant_latest
  ON merchant.catalog_prices (environment, variant_id, observed_at DESC);

-- Append-only inventory observations, same shape as catalog_prices.
CREATE TABLE merchant.catalog_inventory (
  environment platform.counter_environment NOT NULL,
  id bigint GENERATED ALWAYS AS IDENTITY,
  variant_id text NOT NULL,
  available_quantity integer NOT NULL,
  observed_at timestamptz NOT NULL,
  source jsonb NOT NULL,
  PRIMARY KEY (environment, id),
  CONSTRAINT catalog_inventory_quantity_non_negative CHECK (available_quantity >= 0),
  CONSTRAINT catalog_inventory_variant_fk
    FOREIGN KEY (environment, variant_id)
    REFERENCES merchant.catalog_variants (environment, id)
);

CREATE INDEX catalog_inventory_variant_latest
  ON merchant.catalog_inventory (environment, variant_id, observed_at DESC);

-- Durable resume cursor for CatalogSyncService.backfillProducts, and the
-- incremental-sync watermark used alongside it.
CREATE TABLE merchant.catalog_sync_cursors (
  environment platform.counter_environment NOT NULL,
  merchant_id text NOT NULL,
  resource text NOT NULL,
  cursor text,
  last_synced_at timestamptz NOT NULL,
  sync_state text NOT NULL,
  pages_fetched integer NOT NULL DEFAULT 0,
  total_cost bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (environment, merchant_id, resource),
  CONSTRAINT catalog_sync_cursors_merchant_id_profile
    CHECK (identity.is_counter_id(merchant_id, 'merchant')),
  CONSTRAINT catalog_sync_cursors_resource
    CHECK (resource IN ('products', 'variants', 'inventory')),
  CONSTRAINT catalog_sync_cursors_state
    CHECK (sync_state IN ('idle', 'in_progress', 'completed', 'failed')),
  CONSTRAINT catalog_sync_cursors_merchant_fk
    FOREIGN KEY (environment, merchant_id)
    REFERENCES merchant.scopes (environment, merchant_id)
);

ALTER TABLE merchant.catalog_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant.catalog_products FORCE ROW LEVEL SECURITY;
ALTER TABLE merchant.catalog_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant.catalog_variants FORCE ROW LEVEL SECURITY;
ALTER TABLE merchant.catalog_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant.catalog_prices FORCE ROW LEVEL SECURITY;
ALTER TABLE merchant.catalog_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant.catalog_inventory FORCE ROW LEVEL SECURITY;
ALTER TABLE merchant.catalog_sync_cursors ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant.catalog_sync_cursors FORCE ROW LEVEL SECURITY;
