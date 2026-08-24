/**
 * ResourceReadPort implementations for the reference connector.
 *
 * Provides cursor-based pagination, get by ExternalReference, and
 * search by name for both products and variants.
 */

import type { ExternalReference, Instant } from "@counter/domain";
import type {
  ListParams,
  PagedResult,
  ResourceObservation,
  ResourceReadPort,
  SearchParams,
} from "@counter/connector-sdk";
import type { FreshnessStatus } from "@counter/connector-sdk";

import type { Product, ProductVariant } from "./catalog.js";
import {
  CATALOG_PRODUCTS,
  ALL_VARIANTS,
  CONNECTOR_SOURCE,
  findProductsByName,
  findVariantsByName,
  getProduct,
  getVariant,
} from "./catalog.js";
import type { FaultControls } from "./fault-controls.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFreshnessStatus(faultControls: FaultControls | undefined): FreshnessStatus {
  if (faultControls?.shouldReturnStaleResponse()) {
    return "stale";
  }
  return "fresh";
}

function makeProductObservation(
  product: Product,
  freshnessStatus: FreshnessStatus,
): ResourceObservation<Product> {
  return {
    data: product,
    sourceReference: { source: CONNECTOR_SOURCE, value: product.productId } as ExternalReference,
    sourceVersion: "v1",
    observedAt: Date.now() as Instant,
    freshnessStatus,
  };
}

function makeVariantObservation(
  variant: ProductVariant,
  freshnessStatus: FreshnessStatus,
): ResourceObservation<ProductVariant> {
  return {
    data: variant,
    sourceReference: { source: CONNECTOR_SOURCE, value: variant.variantId } as ExternalReference,
    sourceVersion: "v1",
    observedAt: Date.now() as Instant,
    freshnessStatus,
  };
}

function parseCursor(cursor: string | null): number {
  if (cursor === null) return 0;
  const parsed = parseInt(cursor, 10);
  if (Number.isNaN(parsed) || parsed < 0) return -1;
  return parsed;
}

// ─── Product Resource Port ────────────────────────────────────────────────────

export function createProductResourcePort(
  faultControls?: FaultControls,
): ResourceReadPort<Product> {
  return {
    async list(params: ListParams): Promise<PagedResult<Product>> {
      const offset = parseCursor(params.cursor);
      if (offset < 0) {
        return { items: [], nextCursor: null, hasMore: false, totalCount: 0 };
      }

      const items = CATALOG_PRODUCTS.slice(offset, offset + params.pageSize);
      const freshnessStatus = makeFreshnessStatus(faultControls);
      const observations = items.map((p) => makeProductObservation(p, freshnessStatus));
      const hasMore = offset + params.pageSize < CATALOG_PRODUCTS.length;

      return {
        items: observations,
        nextCursor: hasMore ? String(offset + params.pageSize) : null,
        hasMore,
        totalCount: CATALOG_PRODUCTS.length,
      };
    },

    async get(id: ExternalReference): Promise<ResourceObservation<Product> | null> {
      if (id.source !== CONNECTOR_SOURCE) return null;
      const product = getProduct(id.value);
      if (!product) return null;
      const freshnessStatus = makeFreshnessStatus(faultControls);
      return makeProductObservation(product, freshnessStatus);
    },

    async search(query: SearchParams): Promise<PagedResult<Product>> {
      const matched = findProductsByName(query.query);
      const items = matched.slice(query.offset, query.offset + query.limit);
      const freshnessStatus = makeFreshnessStatus(faultControls);
      const observations = items.map((p) => makeProductObservation(p, freshnessStatus));
      const hasMore = query.offset + query.limit < matched.length;

      return {
        items: observations,
        nextCursor: hasMore ? String(query.offset + query.limit) : null,
        hasMore,
        totalCount: matched.length,
      };
    },
  };
}

// ─── Variant Resource Port ────────────────────────────────────────────────────

export function createVariantResourcePort(
  faultControls?: FaultControls,
): ResourceReadPort<ProductVariant> {
  return {
    async list(params: ListParams): Promise<PagedResult<ProductVariant>> {
      const offset = parseCursor(params.cursor);
      if (offset < 0) {
        return { items: [], nextCursor: null, hasMore: false, totalCount: 0 };
      }

      const items = ALL_VARIANTS.slice(offset, offset + params.pageSize);
      const freshnessStatus = makeFreshnessStatus(faultControls);
      const observations = items.map((v) => makeVariantObservation(v, freshnessStatus));
      const hasMore = offset + params.pageSize < ALL_VARIANTS.length;

      return {
        items: observations,
        nextCursor: hasMore ? String(offset + params.pageSize) : null,
        hasMore,
        totalCount: ALL_VARIANTS.length,
      };
    },

    async get(id: ExternalReference): Promise<ResourceObservation<ProductVariant> | null> {
      if (id.source !== CONNECTOR_SOURCE) return null;
      const variant = getVariant(id.value);
      if (!variant) return null;
      const freshnessStatus = makeFreshnessStatus(faultControls);
      return makeVariantObservation(variant, freshnessStatus);
    },

    async search(query: SearchParams): Promise<PagedResult<ProductVariant>> {
      const matched = findVariantsByName(query.query);
      const items = matched.slice(query.offset, query.offset + query.limit);
      const freshnessStatus = makeFreshnessStatus(faultControls);
      const observations = items.map((v) => makeVariantObservation(v, freshnessStatus));
      const hasMore = query.offset + query.limit < matched.length;

      return {
        items: observations,
        nextCursor: hasMore ? String(query.offset + query.limit) : null,
        hasMore,
        totalCount: matched.length,
      };
    },
  };
}
