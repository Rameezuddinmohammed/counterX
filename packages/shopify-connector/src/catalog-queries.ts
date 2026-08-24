/**
 * GraphQL query strings, response types, and mapping functions for
 * Shopify product/variant/price/inventory catalog reads.
 */

import type { Instant } from "@counter/domain";
import type { Money } from "@counter/domain";
import type {
  Product,
  Variant,
  PriceSnapshot,
  InventorySnapshot,
  SourceReference,
  MappingVersion,
  ProductStatus,
} from "@counter/commerce-graph";

// ─── Mapping Version Constant ─────────────────────────────────────────────────

export const SHOPIFY_MAPPING_VERSION: MappingVersion = Object.freeze({
  version: "1.0.0",
  schemaHash: "shopify-admin-2025-07",
});

// ─── Cost Estimation ──────────────────────────────────────────────────────────

export const PRODUCTS_LIST_ESTIMATED_COST = 10;
export const SINGLE_PRODUCT_ESTIMATED_COST = 3;
export const PRODUCT_COUNT_ESTIMATED_COST = 2;

// ─── GraphQL Query Strings ────────────────────────────────────────────────────

export const PRODUCTS_LIST_QUERY = `query ProductsList($first: Int!, $after: String) {
  products(first: $first, after: $after) {
    edges {
      cursor
      node {
        id
        title
        descriptionHtml
        status
        createdAt
        updatedAt
        variants(first: 100) {
          edges {
            node {
              id
              title
              sku
              inventoryQuantity
              price
              compareAtPrice
            }
          }
        }
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}`;

export const SINGLE_PRODUCT_QUERY = `query SingleProduct($id: ID!) {
  product(id: $id) {
    id
    title
    descriptionHtml
    status
    createdAt
    updatedAt
    variants(first: 100) {
      edges {
        node {
          id
          title
          sku
          inventoryQuantity
          price
          compareAtPrice
        }
      }
    }
  }
}`;

export const PRODUCT_COUNT_QUERY = `query ProductCount {
  productsCount {
    count
  }
}`;

// ─── Shopify Response Types ───────────────────────────────────────────────────

export interface ShopifyMoneyV2 {
  readonly amount: string;
  readonly currencyCode: string;
}

export interface ShopifyVariantNode {
  readonly id: string;
  readonly title: string;
  readonly sku: string | null;
  readonly inventoryQuantity: number;
  readonly price: string;
  readonly compareAtPrice: string | null;
}

export interface ShopifyProductNode {
  readonly id: string;
  readonly title: string;
  readonly descriptionHtml: string;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly variants: {
    readonly edges: readonly { readonly node: ShopifyVariantNode }[];
  };
}

export interface ShopifyProductsListResponse {
  readonly products: {
    readonly edges: readonly { readonly cursor: string; readonly node: ShopifyProductNode }[];
    readonly pageInfo: {
      readonly hasNextPage: boolean;
      readonly endCursor: string | null;
    };
  };
}

export interface ShopifySingleProductResponse {
  readonly product: ShopifyProductNode | null;
}

export interface ShopifyProductCountResponse {
  readonly productsCount: {
    readonly count: number;
  };
}

export interface ShopifyInventoryLevel {
  readonly variantId: string;
  readonly available: number;
  readonly locationId: string;
}

// ─── Mapping Functions ────────────────────────────────────────────────────────

function mapShopifyStatus(shopifyStatus: string): ProductStatus {
  switch (shopifyStatus.toUpperCase()) {
    case "ACTIVE":
      return "active";
    case "DRAFT":
      return "unpublished";
    case "ARCHIVED":
      return "tombstoned";
    default:
      return "active";
  }
}

function createSourceReference(externalId: string, fetchedAt: Instant): SourceReference {
  return Object.freeze({
    platform: "shopify",
    externalId,
    fetchedAt,
    mappingVersion: SHOPIFY_MAPPING_VERSION,
  });
}

function parseShopifyGid(gid: string): string {
  return gid;
}

function parseShopifyInstant(isoString: string): Instant {
  return Date.parse(isoString) as Instant;
}

function parseShopifyPrice(priceString: string): Money {
  // Shopify returns prices as decimal strings like "19.99"
  // Convert to minor units (cents) as bigint
  const parts = priceString.split(".");
  const whole = parts[0] ?? "0";
  const fractional = (parts[1] ?? "00").padEnd(2, "0").slice(0, 2);
  const amountMinor = BigInt(whole) * 100n + BigInt(fractional);
  return Object.freeze({ amountMinor, currency: "USD" as Money["currency"] });
}

export function mapShopifyVariant(
  variantNode: ShopifyVariantNode,
  productId: string,
  merchantId: string,
): Variant {
  return Object.freeze({
    id: parseShopifyGid(variantNode.id),
    productId,
    merchantId,
    sku: variantNode.sku ?? "",
    title: variantNode.title,
    active: true,
  });
}

export function mapShopifyProduct(
  node: ShopifyProductNode,
  merchantId: string,
  fetchedAt: Instant,
): Product {
  const productId = parseShopifyGid(node.id);
  const sourceReference = createSourceReference(node.id, fetchedAt);
  const status = mapShopifyStatus(node.status);

  const variants: Variant[] = node.variants.edges.map((edge) =>
    mapShopifyVariant(edge.node, productId, merchantId),
  );

  return Object.freeze({
    id: productId,
    merchantId,
    title: node.title,
    description: node.descriptionHtml,
    variants: Object.freeze(variants),
    sourceReference,
    sourceReferences: Object.freeze([sourceReference]),
    status,
    tombstonedAt: status === "tombstoned" ? fetchedAt : undefined,
    createdAt: parseShopifyInstant(node.createdAt),
    updatedAt: parseShopifyInstant(node.updatedAt),
  });
}

export function mapVariantToPriceSnapshot(
  variantNode: ShopifyVariantNode,
  fetchedAt: Instant,
): PriceSnapshot {
  return Object.freeze({
    variantId: parseShopifyGid(variantNode.id),
    amount: parseShopifyPrice(variantNode.price),
    observedAt: fetchedAt,
    source: createSourceReference(variantNode.id, fetchedAt),
  });
}

export function mapVariantToInventorySnapshot(
  variantNode: ShopifyVariantNode,
  fetchedAt: Instant,
): InventorySnapshot {
  return Object.freeze({
    variantId: parseShopifyGid(variantNode.id),
    availableQuantity: variantNode.inventoryQuantity,
    observedAt: fetchedAt,
    source: createSourceReference(variantNode.id, fetchedAt),
  });
}
