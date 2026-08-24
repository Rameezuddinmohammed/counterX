/**
 * Catalog sync service: paginated backfill, incremental webhook sync,
 * and reconciliation polling.
 *
 * Uses the ShopifyGraphQLPort interface for all API reads. Tracks cost
 * consumed. Produces normalized Product/Variant/PriceSnapshot/InventorySnapshot.
 */

import type { Instant } from "@counter/domain";
import type { Money } from "@counter/domain";
import type {
  Product,
  PriceSnapshot,
  InventorySnapshot,
} from "@counter/commerce-graph";
import type { ShopifyGraphQLPort } from "./graphql-client.js";
import type { CursorStore, DurableCursor } from "./sync-cursor.js";
import {
  PRODUCTS_LIST_QUERY,
  PRODUCTS_LIST_ESTIMATED_COST,
  mapShopifyProduct,
  mapVariantToPriceSnapshot,
  mapVariantToInventorySnapshot,
  SHOPIFY_MAPPING_VERSION,
} from "./catalog-queries.js";
import type {
  ShopifyProductsListResponse,
  ShopifyProductNode,
} from "./catalog-queries.js";

// ─── Webhook Event ────────────────────────────────────────────────────────────

export interface WebhookEvent {
  readonly topic: string;
  readonly shopDomain: string;
  readonly webhookId: string;
  readonly payload: WebhookProductPayload;
  readonly receivedAt: Instant;
}

export interface WebhookProductPayload {
  readonly id: number;
  readonly title: string;
  readonly body_html: string;
  readonly status: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly variants: readonly WebhookVariantPayload[];
}

export interface WebhookVariantPayload {
  readonly id: number;
  readonly title: string;
  readonly sku: string | null;
  readonly price: string;
  readonly inventory_quantity: number;
}

// ─── Backfill Options ─────────────────────────────────────────────────────────

export interface BackfillOptions {
  readonly pageSize: number;
  readonly costBudget: number;
  readonly storeCurrency: Money["currency"];
}

// ─── Sync Result ──────────────────────────────────────────────────────────────

export interface SyncResult {
  readonly products: readonly Product[];
  readonly prices: readonly PriceSnapshot[];
  readonly inventory: readonly InventorySnapshot[];
  readonly costConsumed: number;
  readonly pagesProcessed: number;
  readonly hasMore: boolean;
}

// ─── Catalog Sync Service ─────────────────────────────────────────────────────

export class CatalogSyncService {
  private readonly client: ShopifyGraphQLPort;
  private readonly cursorStore: CursorStore;
  private readonly productState = new Map<string, Product>();

  constructor(client: ShopifyGraphQLPort, cursorStore: CursorStore) {
    this.client = client;
    this.cursorStore = cursorStore;
  }

  /**
   * Paginated backfill that respects cost budget.
   * Stops when budget is exhausted and saves cursor for resumption.
   */
  async backfillProducts(merchantId: string, options: BackfillOptions): Promise<SyncResult> {
    const { pageSize, costBudget, storeCurrency } = options;

    // Load existing cursor for resume
    const existingCursor = this.cursorStore.getCursor(merchantId, "products");
    let cursor: string | null = existingCursor?.cursor ?? null;
    let costConsumed = existingCursor?.totalCost ?? 0;
    let pagesFetched = existingCursor?.pagesFetched ?? 0;

    const allProducts: Product[] = [];
    const allPrices: PriceSnapshot[] = [];
    const allInventory: InventorySnapshot[] = [];
    let hasMore = true;
    let failed = false;

    // Mark sync in progress
    this.cursorStore.saveCursor({
      merchantId,
      resource: "products",
      cursor,
      lastSyncedAt: Date.now() as Instant,
      syncState: "in_progress",
      pagesFetched,
      totalCost: costConsumed,
    });

    while (hasMore) {
      // Check cost budget before fetching
      if (costConsumed + PRODUCTS_LIST_ESTIMATED_COST > costBudget) {
        // Save cursor for resume
        this.cursorStore.saveCursor({
          merchantId,
          resource: "products",
          cursor,
          lastSyncedAt: Date.now() as Instant,
          syncState: "in_progress",
          pagesFetched,
          totalCost: costConsumed,
        });
        return Object.freeze({
          products: Object.freeze(allProducts),
          prices: Object.freeze(allPrices),
          inventory: Object.freeze(allInventory),
          costConsumed,
          pagesProcessed: pagesFetched - (existingCursor?.pagesFetched ?? 0),
          hasMore: true,
        });
      }

      const variables: Record<string, unknown> = { first: pageSize };
      if (cursor !== null) {
        variables["after"] = cursor;
      }

      const response = await this.client.query<ShopifyProductsListResponse>(
        PRODUCTS_LIST_QUERY,
        variables,
      );

      // Track cost
      costConsumed += PRODUCTS_LIST_ESTIMATED_COST;
      pagesFetched++;

      if (response.errors && response.errors.length > 0 && !response.data) {
        // Save cursor at last successful position with failed state
        failed = true;
        this.cursorStore.saveCursor({
          merchantId,
          resource: "products",
          cursor,
          lastSyncedAt: Date.now() as Instant,
          syncState: "failed",
          pagesFetched,
          totalCost: costConsumed,
        });
        hasMore = false;
        break;
      }

      if (response.data) {
        const fetchedAt = Date.now() as Instant;
        const edges = response.data.products.edges;

        for (const edge of edges) {
          const product = mapShopifyProduct(edge.node, merchantId, fetchedAt);
          allProducts.push(product);
          this.productState.set(product.id, product);

          // Extract prices and inventory from variants
          for (const variantEdge of edge.node.variants.edges) {
            allPrices.push(mapVariantToPriceSnapshot(variantEdge.node, fetchedAt, storeCurrency));
            allInventory.push(mapVariantToInventorySnapshot(variantEdge.node, fetchedAt));
          }
        }

        hasMore = response.data.products.pageInfo.hasNextPage;
        cursor = response.data.products.pageInfo.endCursor;
      } else {
        hasMore = false;
      }
    }

    // Mark sync completed (skip if already marked as failed)
    if (!failed) {
      const finalState: DurableCursor["syncState"] = hasMore ? "in_progress" : "completed";
      this.cursorStore.saveCursor({
        merchantId,
        resource: "products",
        cursor,
        lastSyncedAt: Date.now() as Instant,
        syncState: finalState,
        pagesFetched,
        totalCost: costConsumed,
      });
    }

    return Object.freeze({
      products: Object.freeze(allProducts),
      prices: Object.freeze(allPrices),
      inventory: Object.freeze(allInventory),
      costConsumed,
      pagesProcessed: pagesFetched - (existingCursor?.pagesFetched ?? 0),
      hasMore,
    });
  }

  /**
   * Process a single product webhook event (create/update/delete).
   * Returns the processed product or undefined for tombstones.
   */
  syncIncrementalFromWebhook(event: WebhookEvent): Product {
    const fetchedAt = event.receivedAt;
    const merchantId = event.shopDomain;
    const gid = `gid://shopify/Product/${String(event.payload.id)}`;

    // Check if we have a newer version already
    const existing = this.productState.get(gid);
    const incomingUpdatedAt = Date.parse(event.payload.updated_at) as Instant;
    if (existing && existing.updatedAt > incomingUpdatedAt) {
      // Stale event - return existing product unchanged
      return existing;
    }

    if (event.topic === "products/delete") {
      const tombstone: Product = Object.freeze({
        id: gid,
        merchantId,
        title: event.payload.title,
        description: event.payload.body_html,
        variants: Object.freeze([]),
        sourceReference: Object.freeze({
          platform: "shopify",
          externalId: gid,
          fetchedAt,
          mappingVersion: SHOPIFY_MAPPING_VERSION,
        }),
        sourceReferences: Object.freeze([
          Object.freeze({
            platform: "shopify",
            externalId: gid,
            fetchedAt,
            mappingVersion: SHOPIFY_MAPPING_VERSION,
          }),
        ]),
        status: "tombstoned" as const,
        tombstonedAt: fetchedAt,
        createdAt: Date.parse(event.payload.created_at) as Instant,
        updatedAt: incomingUpdatedAt,
      });
      this.productState.set(gid, tombstone);
      return tombstone;
    }

    // Map to a Shopify product node structure for reuse of mapping
    const shopifyNode: ShopifyProductNode = {
      id: gid,
      title: event.payload.title,
      descriptionHtml: event.payload.body_html,
      status: event.payload.status,
      createdAt: event.payload.created_at,
      updatedAt: event.payload.updated_at,
      variants: {
        edges: event.payload.variants.map((v) => ({
          node: {
            id: `gid://shopify/ProductVariant/${String(v.id)}`,
            title: v.title,
            sku: v.sku,
            price: v.price,
            compareAtPrice: null,
            inventoryQuantity: v.inventory_quantity,
          },
        })),
      },
    };

    const product = mapShopifyProduct(shopifyNode, merchantId, fetchedAt);
    this.productState.set(product.id, product);
    return product;
  }

  /**
   * Fallback reconciliation poll: fetches products updated since last sync.
   * Paginates through all pages using a server-side query filter where
   * supported, with client-side filtering as a safety net.
   */
  async reconciliationPoll(merchantId: string, since: Instant, storeCurrency: Money["currency"]): Promise<SyncResult> {
    const allProducts: Product[] = [];
    const allPrices: PriceSnapshot[] = [];
    const allInventory: InventorySnapshot[] = [];
    let costConsumed = 0;
    let pagesFetched = 0;
    let hasNextPage = true;
    let cursor: string | null = null;

    // Paginate through all products, filtering by updatedAt >= since.
    // We pass a query parameter for server-side filtering when supported,
    // and apply client-side filtering as a safety net.
    const sinceIso = new Date(since as number).toISOString();
    const queryFilter = `updated_at:>='${sinceIso}'`;

    while (hasNextPage) {
      const variables: Record<string, unknown> = { first: 50, query: queryFilter };
      if (cursor !== null) {
        variables["after"] = cursor;
      }

      const response = await this.client.query<ShopifyProductsListResponse>(
        PRODUCTS_LIST_QUERY,
        variables,
      );

      costConsumed += PRODUCTS_LIST_ESTIMATED_COST;
      pagesFetched++;

      if (response.data) {
        const fetchedAt = Date.now() as Instant;
        for (const edge of response.data.products.edges) {
          const updatedAt = Date.parse(edge.node.updatedAt) as Instant;
          if (updatedAt >= since) {
            const product = mapShopifyProduct(edge.node, merchantId, fetchedAt);
            allProducts.push(product);
            this.productState.set(product.id, product);

            for (const variantEdge of edge.node.variants.edges) {
              allPrices.push(mapVariantToPriceSnapshot(variantEdge.node, fetchedAt, storeCurrency));
              allInventory.push(mapVariantToInventorySnapshot(variantEdge.node, fetchedAt));
            }
          }
        }

        hasNextPage = response.data.products.pageInfo.hasNextPage;
        cursor = response.data.products.pageInfo.endCursor;
      } else {
        hasNextPage = false;
      }
    }

    return Object.freeze({
      products: Object.freeze(allProducts),
      prices: Object.freeze(allPrices),
      inventory: Object.freeze(allInventory),
      costConsumed,
      pagesProcessed: pagesFetched,
      hasMore: false,
    });
  }

  /** Get current product state (for testing). */
  getProductState(): ReadonlyMap<string, Product> {
    return this.productState;
  }
}
