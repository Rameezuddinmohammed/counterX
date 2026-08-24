/**
 * Tests for CatalogSyncService: backfill, webhook processing,
 * reconciliation polling, cursor management, and error handling.
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { Instant, IsoCurrencyCode } from "@counter/domain";
import { createMockGraphQLClient } from "./mock-graphql-client.js";
import type { MockShopifyClient } from "./mock-graphql-client.js";
import { InMemoryCursorStore } from "./sync-cursor.js";
import { CatalogSyncService } from "./catalog-sync.js";
import type { WebhookEvent } from "./catalog-sync.js";
import type { ShopifyProductsListResponse } from "./catalog-queries.js";
import { PRODUCTS_LIST_QUERY } from "./catalog-queries.js";
import type { ShopifyGraphQLResponse } from "./graphql-client.js";

// ─── Test Helpers ─────────────────────────────────────────────────────────────

const INR = "INR" as IsoCurrencyCode;

function makeProductNode(id: number, title: string, updatedAt: string) {
  return {
    id: `gid://shopify/Product/${String(id)}`,
    title,
    descriptionHtml: `<p>${title} description</p>`,
    status: "ACTIVE",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt,
    variants: {
      edges: [
        {
          node: {
            id: `gid://shopify/ProductVariant/${String(id * 10)}`,
            title: "Default",
            sku: `SKU-${String(id)}`,
            inventoryQuantity: 100,
            price: "19.99",
            compareAtPrice: null,
          },
        },
      ],
    },
  };
}

function makePageResponse(
  products: ReturnType<typeof makeProductNode>[],
  hasNextPage: boolean,
  endCursor: string | null,
): ShopifyGraphQLResponse<ShopifyProductsListResponse> {
  return {
    data: {
      products: {
        edges: products.map((p, i) => ({
          cursor: `cursor_${String(i)}`,
          node: p,
        })),
        pageInfo: {
          hasNextPage,
          endCursor,
        },
      },
    },
    errors: undefined,
    extensions: {
      cost: {
        throttleStatus: {
          currentlyAvailable: 900,
          restoreRate: 50,
          maximumAvailable: 1000,
        },
      },
    },
  };
}

function makeWebhookEvent(
  id: number,
  topic: string,
  updatedAt: string,
  webhookId?: string,
): WebhookEvent {
  return Object.freeze({
    topic,
    shopDomain: "test-store.myshopify.com",
    webhookId: webhookId ?? `webhook-${String(id)}`,
    payload: Object.freeze({
      id,
      title: `Product ${String(id)}`,
      body_html: `<p>Product ${String(id)} description</p>`,
      status: "active",
      created_at: "2024-01-01T00:00:00.000Z",
      updated_at: updatedAt,
      variants: Object.freeze([
        Object.freeze({
          id: id * 10,
          title: "Default",
          sku: `SKU-${String(id)}`,
          price: "29.99",
          inventory_quantity: 50,
        }),
      ]),
    }),
    receivedAt: Date.now() as Instant,
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("CatalogSyncService", () => {
  let client: MockShopifyClient;
  let cursorStore: InMemoryCursorStore;
  let service: CatalogSyncService;

  beforeEach(() => {
    client = createMockGraphQLClient();
    cursorStore = new InMemoryCursorStore();
    service = new CatalogSyncService(client, cursorStore);
  });

  describe("backfillProducts", () => {
    it("fetches all pages of a multi-page catalog", async () => {
      // Page 1
      const page1 = makePageResponse(
        [makeProductNode(1, "Product 1", "2024-06-01T00:00:00.000Z")],
        true,
        "cursor_page1",
      );
      // Page 2
      const page2 = makePageResponse(
        [makeProductNode(2, "Product 2", "2024-06-02T00:00:00.000Z")],
        true,
        "cursor_page2",
      );
      // Page 3 (final)
      const page3 = makePageResponse(
        [makeProductNode(3, "Product 3", "2024-06-03T00:00:00.000Z")],
        false,
        null,
      );

      // Mock client responds based on call order
      let callCount = 0;
      const pages = [page1, page2, page3];
      client.setResponse(PRODUCTS_LIST_QUERY, page1);

      // Override the query behavior with sequential responses
      const originalQuery = client.query.bind(client);
      client.query = async <T>(operation: string, variables: Record<string, unknown>) => {
        const result = pages[callCount]!;
        callCount++;
        // Still record the call
        await originalQuery<T>(operation, variables);
        return result as ShopifyGraphQLResponse<T>;
      };

      const result = await service.backfillProducts("merchant-1", {
        pageSize: 1,
        costBudget: 100,
        storeCurrency: INR,
      });

      expect(result.products).toHaveLength(3);
      expect(result.products[0]!.title).toBe("Product 1");
      expect(result.products[1]!.title).toBe("Product 2");
      expect(result.products[2]!.title).toBe("Product 3");
      expect(result.hasMore).toBe(false);
      expect(result.pagesProcessed).toBe(3);
    });

    it("stops when cost budget is exhausted and saves cursor", async () => {
      const page1 = makePageResponse(
        [makeProductNode(1, "Product 1", "2024-06-01T00:00:00.000Z")],
        true,
        "cursor_page1",
      );

      client.setResponse(PRODUCTS_LIST_QUERY, page1);

      // Budget of 15 allows 1 page (cost 10), but second page would exceed
      const result = await service.backfillProducts("merchant-1", {
        pageSize: 1,
        costBudget: 15,
        storeCurrency: INR,
      });

      expect(result.products).toHaveLength(1);
      expect(result.hasMore).toBe(true);
      expect(result.costConsumed).toBe(10);

      // Verify cursor was saved
      const cursor = cursorStore.getCursor("merchant-1", "products");
      expect(cursor).toBeDefined();
      expect(cursor!.cursor).toBe("cursor_page1");
      expect(cursor!.syncState).toBe("in_progress");
      expect(cursor!.pagesFetched).toBe(1);
    });

    it("resumes from cursor and continues where left off", async () => {
      // Pre-set a cursor as if page 1 was already fetched
      cursorStore.saveCursor({
        merchantId: "merchant-1",
        resource: "products",
        cursor: "cursor_page1",
        lastSyncedAt: Date.now() as Instant,
        syncState: "in_progress",
        pagesFetched: 1,
        totalCost: 10,
      });

      const page2 = makePageResponse(
        [makeProductNode(2, "Product 2", "2024-06-02T00:00:00.000Z")],
        false,
        null,
      );

      client.setResponse(PRODUCTS_LIST_QUERY, page2);

      const result = await service.backfillProducts("merchant-1", {
        pageSize: 1,
        costBudget: 100,
        storeCurrency: INR,
      });

      expect(result.products).toHaveLength(1);
      expect(result.products[0]!.title).toBe("Product 2");
      expect(result.hasMore).toBe(false);
      // Total cost includes the pre-existing 10
      expect(result.costConsumed).toBe(20);
      expect(result.pagesProcessed).toBe(1);

      // Verify cursor after variable was "cursor_page1"
      const history = client.callHistory;
      expect(history[0]!.variables["after"]).toBe("cursor_page1");
    });

    it("handles rate limiting gracefully (errors in response)", async () => {
      const errorResponse: ShopifyGraphQLResponse<ShopifyProductsListResponse> = {
        data: null,
        errors: [{ message: "Throttled" }],
        extensions: {
          cost: {
            throttleStatus: {
              currentlyAvailable: 0,
              restoreRate: 50,
              maximumAvailable: 1000,
            },
          },
        },
      };

      client.setResponse(PRODUCTS_LIST_QUERY, errorResponse);

      const result = await service.backfillProducts("merchant-1", {
        pageSize: 10,
        costBudget: 100,
        storeCurrency: INR,
      });

      expect(result.products).toHaveLength(0);
      // Cursor should be saved with failed state
      const cursor = cursorStore.getCursor("merchant-1", "products");
      expect(cursor).toBeDefined();
      expect(cursor!.syncState).toBe("failed");
    });

    it("partial failure on one page does not lose previous pages", async () => {
      const page1 = makePageResponse(
        [makeProductNode(1, "Product 1", "2024-06-01T00:00:00.000Z")],
        true,
        "cursor_page1",
      );
      const errorResponse: ShopifyGraphQLResponse<ShopifyProductsListResponse> = {
        data: null,
        errors: [{ message: "Internal error" }],
        extensions: undefined,
      };

      let callCount = 0;
      const responses = [page1, errorResponse];
      const originalQuery = client.query.bind(client);
      client.query = async <T>(operation: string, variables: Record<string, unknown>) => {
        const result = responses[callCount]!;
        callCount++;
        await originalQuery<T>(operation, variables);
        return result as ShopifyGraphQLResponse<T>;
      };

      const result = await service.backfillProducts("merchant-1", {
        pageSize: 1,
        costBudget: 100,
        storeCurrency: INR,
      });

      // First page products should be retained
      expect(result.products).toHaveLength(1);
      expect(result.products[0]!.title).toBe("Product 1");
    });

    it("produces PriceSnapshot and InventorySnapshot for each variant", async () => {
      const page = makePageResponse(
        [makeProductNode(1, "Product 1", "2024-06-01T00:00:00.000Z")],
        false,
        null,
      );

      client.setResponse(PRODUCTS_LIST_QUERY, page);

      const result = await service.backfillProducts("merchant-1", {
        pageSize: 10,
        costBudget: 100,
        storeCurrency: INR,
      });

      expect(result.prices).toHaveLength(1);
      expect(result.prices[0]!.amount.amountMinor).toBe(1999n);
      expect(result.prices[0]!.amount.currency).toBe("INR");
      expect(result.inventory).toHaveLength(1);
      expect(result.inventory[0]!.availableQuantity).toBe(100);
    });
  });

  describe("syncIncrementalFromWebhook", () => {
    it("processes product update webhook", () => {
      const event = makeWebhookEvent(1, "products/update", "2024-06-15T00:00:00.000Z");
      const product = service.syncIncrementalFromWebhook(event);

      expect(product.title).toBe("Product 1");
      expect(product.status).toBe("active");
      expect(product.sourceReference.platform).toBe("shopify");
      expect(product.id).toBe("gid://shopify/Product/1");
    });

    it("product deletion webhook creates tombstone", () => {
      const event = makeWebhookEvent(1, "products/delete", "2024-06-15T00:00:00.000Z");
      const product = service.syncIncrementalFromWebhook(event);

      expect(product.status).toBe("tombstoned");
      expect(product.tombstonedAt).toBeDefined();
      expect(product.variants).toHaveLength(0);
    });

    it("newer version updates existing product", () => {
      // First event at time T1
      const event1 = makeWebhookEvent(1, "products/update", "2024-06-10T00:00:00.000Z");
      service.syncIncrementalFromWebhook(event1);

      // Second event at time T2 > T1
      const event2 = makeWebhookEvent(1, "products/update", "2024-06-15T00:00:00.000Z");
      const product = service.syncIncrementalFromWebhook(event2);

      expect(product.updatedAt).toBe(Date.parse("2024-06-15T00:00:00.000Z"));
    });

    it("stale webhook (older updatedAt) is ignored", () => {
      // First event at time T2 (newer)
      const event1 = makeWebhookEvent(1, "products/update", "2024-06-15T00:00:00.000Z");
      service.syncIncrementalFromWebhook(event1);

      // Second event at time T1 (older) - should be ignored
      const event2 = makeWebhookEvent(1, "products/update", "2024-06-10T00:00:00.000Z");
      const product = service.syncIncrementalFromWebhook(event2);

      // Should return the existing (newer) product unchanged
      expect(product.updatedAt).toBe(Date.parse("2024-06-15T00:00:00.000Z"));
    });
  });

  describe("reconciliationPoll", () => {
    it("fetches products updated since last sync", async () => {
      const recentProduct = makeProductNode(1, "Recent Product", "2024-06-15T00:00:00.000Z");
      const oldProduct = makeProductNode(2, "Old Product", "2024-01-01T00:00:00.000Z");

      const response = makePageResponse([recentProduct, oldProduct], false, null);
      client.setResponse(PRODUCTS_LIST_QUERY, response);

      const since = Date.parse("2024-06-01T00:00:00.000Z") as Instant;
      const result = await service.reconciliationPoll("merchant-1", since, INR);

      // Only the recent product should pass the filter
      expect(result.products).toHaveLength(1);
      expect(result.products[0]!.title).toBe("Recent Product");
      expect(result.costConsumed).toBeGreaterThan(0);
    });
  });

  describe("convergence", () => {
    it("backfill + webhooks + poll all produce consistent final state", async () => {
      // Backfill fetches product 1
      const page = makePageResponse(
        [makeProductNode(1, "Product 1", "2024-06-01T00:00:00.000Z")],
        false,
        null,
      );
      client.setResponse(PRODUCTS_LIST_QUERY, page);

      await service.backfillProducts("merchant-1", {
        pageSize: 10,
        costBudget: 100,
        storeCurrency: INR,
      });

      // Webhook updates product 1 with newer data
      const event = makeWebhookEvent(1, "products/update", "2024-06-15T00:00:00.000Z");
      const updatedProduct = service.syncIncrementalFromWebhook(event);

      // Final state should reflect the webhook update
      const state = service.getProductState();
      const product = state.get("gid://shopify/Product/1");
      expect(product).toBeDefined();
      expect(product!.updatedAt).toBe(updatedProduct.updatedAt);
    });
  });
});
