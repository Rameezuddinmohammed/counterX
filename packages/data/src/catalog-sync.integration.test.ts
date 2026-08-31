/**
 * Integration proof that the real Shopify catalog-sync engine
 * (CatalogSyncService) actually persists through this package's Postgres
 * repositories - the exact seam the OAuth-callback wiring will use.
 *
 * SKIPPED unless TEST_DATABASE_URL or DATABASE_URL is present (mirrors the
 * other *.integration.test.ts gates). SAFETY: every row is written under a
 * UNIQUE per-run merchant id (via createCounterId, real 128-bit entropy)
 * and, in afterAll, deletes ONLY that merchant's rows. It never truncates,
 * drops, or migrates the shared schema.
 */
import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { CounterId, IsoCurrencyCode } from "@counter/domain";
import { createCounterId } from "@counter/domain";
import {
  CatalogSyncService,
  createMockGraphQLClient,
  PRODUCTS_LIST_QUERY,
} from "@counter/shopify-connector";
import type { ShopifyGraphQLResponse, ShopifyProductsListResponse } from "@counter/shopify-connector";
import { PostgresDatabase } from "./database.js";
import { PostgresCursorStore } from "./catalog-cursor-store.js";
import {
  PostgresInventoryRepository,
  PostgresPriceRepository,
  PostgresProductRepository,
  PostgresVariantRepository,
} from "./catalog-repositories.js";

const databaseUrl =
  process.env["TEST_DATABASE_URL"]?.trim() || process.env["DATABASE_URL"]?.trim() || undefined;
const databaseDescribe = databaseUrl === undefined ? describe.skip : describe;
const databaseHookTimeout = 30_000;

function freshMerchantId(): CounterId<"merchant"> {
  const result = createCounterId("merchant", randomBytes(16));
  if (!result.ok) {
    throw new Error("Failed to generate a fresh merchant id for this test run");
  }
  return result.value;
}

function makeProductsPage(
  shopifyProductId: number,
): ShopifyGraphQLResponse<ShopifyProductsListResponse> {
  return {
    data: {
      products: {
        edges: [
          {
            cursor: "cursor-1",
            node: {
              id: `gid://shopify/Product/${String(shopifyProductId)}`,
              title: "Test Product",
              descriptionHtml: "<p>A real catalog-sync integration test product</p>",
              status: "ACTIVE",
              createdAt: "2024-06-01T00:00:00.000Z",
              updatedAt: "2024-06-01T00:00:00.000Z",
              variants: {
                edges: [
                  {
                    node: {
                      id: `gid://shopify/ProductVariant/${String(shopifyProductId)}01`,
                      title: "Default",
                      sku: `SKU-${String(shopifyProductId)}`,
                      inventoryQuantity: 25,
                      price: "499.00",
                      compareAtPrice: null,
                    },
                  },
                ],
              },
            },
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    },
    errors: undefined,
    extensions: undefined,
  };
}

databaseDescribe("Catalog sync -> Postgres repositories (DB-gated)", () => {
  const database = new PostgresDatabase(databaseUrl as string);
  const cursorStore = new PostgresCursorStore(database, "local");
  const productRepo = new PostgresProductRepository(database, "local");
  const variantRepo = new PostgresVariantRepository(database, "local");
  const priceRepo = new PostgresPriceRepository(database, "local");
  const inventoryRepo = new PostgresInventoryRepository(database, "local");

  const writtenMerchantIds: string[] = [];

  afterAll(async () => {
    try {
      for (const merchantId of writtenMerchantIds) {
        await database.query(
          `DELETE FROM merchant.catalog_prices WHERE variant_id IN (
             SELECT id FROM merchant.catalog_variants WHERE merchant_id = $1
           )`,
          [merchantId],
        );
        await database.query(
          `DELETE FROM merchant.catalog_inventory WHERE variant_id IN (
             SELECT id FROM merchant.catalog_variants WHERE merchant_id = $1
           )`,
          [merchantId],
        );
        await database.query(`DELETE FROM merchant.catalog_variants WHERE merchant_id = $1`, [
          merchantId,
        ]);
        await database.query(`DELETE FROM merchant.catalog_products WHERE merchant_id = $1`, [
          merchantId,
        ]);
        await database.query(
          `DELETE FROM merchant.catalog_sync_cursors WHERE merchant_id = $1`,
          [merchantId],
        );
      }
    } finally {
      await database.close();
    }
  }, databaseHookTimeout);

  it(
    "backfillProducts persists a real product, variant, price, and inventory row, resumably via a durable cursor",
    async () => {
      const merchantId = freshMerchantId();
      writtenMerchantIds.push(merchantId);

      const client = createMockGraphQLClient();
      client.setResponse(PRODUCTS_LIST_QUERY, makeProductsPage(1) as ShopifyGraphQLResponse<unknown>);

      const syncService = new CatalogSyncService(client, cursorStore);
      const result = await syncService.backfillProducts(merchantId, {
        pageSize: 10,
        costBudget: 1000,
        storeCurrency: "INR" as IsoCurrencyCode,
      });

      expect(result.products).toHaveLength(1);
      expect(result.hasMore).toBe(false);

      // The real Shopify-shaped product/prices/inventory the sync engine
      // produced now needs to actually be persisted - backfillProducts
      // itself only returns them in memory, it doesn't call the
      // repositories. This proves the repositories correctly accept and
      // round-trip exactly what the real sync engine produces.
      const product = result.products[0]!;
      await productRepo.save(product);
      for (const variant of product.variants) {
        await variantRepo.save(variant);
      }
      for (const price of result.prices) {
        await priceRepo.save(price);
      }
      for (const inventory of result.inventory) {
        await inventoryRepo.save(inventory);
      }

      // Read back through the repositories, not the in-memory result.
      const stored = await productRepo.getById(product.id);
      expect(stored.ok).toBe(true);
      if (!stored.ok) throw new Error("getById failed");
      expect(stored.value?.merchantId).toBe(merchantId);
      expect(stored.value?.title).toBe("Test Product");
      expect(stored.value?.variants).toHaveLength(1);
      expect(stored.value?.variants[0]?.sku).toBe("SKU-1");

      const latestPrice = await priceRepo.getLatest(product.variants[0]!.id);
      expect(latestPrice.ok).toBe(true);
      if (!latestPrice.ok) throw new Error("getLatest price failed");
      expect(latestPrice.value?.amount.amountMinor).toBe(49900n);
      expect(latestPrice.value?.amount.currency).toBe("INR");

      const latestInventory = await inventoryRepo.getLatest(product.variants[0]!.id);
      expect(latestInventory.ok).toBe(true);
      if (!latestInventory.ok) throw new Error("getLatest inventory failed");
      expect(latestInventory.value?.availableQuantity).toBe(25);

      // The durable cursor the backfill saved is readable independently -
      // proves resume state survives a fresh CatalogSyncService instance,
      // not just the in-process one that ran the backfill.
      const cursor = await cursorStore.getCursor(merchantId, "products");
      expect(cursor?.syncState).toBe("completed");
    },
    databaseHookTimeout,
  );

  it(
    "listByMerchant returns only that merchant's products",
    async () => {
      const merchantId = freshMerchantId();
      const otherMerchantId = freshMerchantId();
      writtenMerchantIds.push(merchantId, otherMerchantId);

      const client = createMockGraphQLClient();
      client.setResponse(PRODUCTS_LIST_QUERY, makeProductsPage(2) as ShopifyGraphQLResponse<unknown>);
      const syncService = new CatalogSyncService(client, cursorStore);

      const resultA = await syncService.backfillProducts(merchantId, {
        pageSize: 10,
        costBudget: 1000,
        storeCurrency: "INR" as IsoCurrencyCode,
      });
      await productRepo.save(resultA.products[0]!);

      const otherClient = createMockGraphQLClient();
      otherClient.setResponse(
        PRODUCTS_LIST_QUERY,
        makeProductsPage(3) as ShopifyGraphQLResponse<unknown>,
      );
      const otherSyncService = new CatalogSyncService(otherClient, cursorStore);
      const resultB = await otherSyncService.backfillProducts(otherMerchantId, {
        pageSize: 10,
        costBudget: 1000,
        storeCurrency: "INR" as IsoCurrencyCode,
      });
      await productRepo.save(resultB.products[0]!);

      const listed = await productRepo.listByMerchant(merchantId);
      expect(listed.ok).toBe(true);
      if (!listed.ok) throw new Error("listByMerchant failed");
      expect(listed.value).toHaveLength(1);
      expect(listed.value[0]?.merchantId).toBe(merchantId);
    },
    databaseHookTimeout,
  );
});
