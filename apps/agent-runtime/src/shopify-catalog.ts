/**
 * Live Shopify catalog reads for the agent-runtime merchant API.
 *
 * Scope note: packages/shopify-connector also ships a durable catalog-sync
 * pipeline (CatalogSyncService + ProductIndex + a sync-cursor store) meant for
 * a continuously-synced local index. That pipeline is not wired into any app
 * in this repo yet — standing it up (webhook subscriptions, cursor
 * durability, reconciliation polling) is a materially larger, separate piece
 * of infrastructure. This module instead queries Shopify's Admin API live,
 * per request, using the same GraphQL query strings and response types the
 * sync pipeline uses, so search/product/price data is genuinely real (not a
 * hardcoded mock) without requiring that pipeline to exist first.
 *
 * SECURITY: reads only public catalog data (title, description, price,
 * inventory count). Never touches payment credentials or secrets.
 */

import type {
  ShopifyGraphQLError,
  ShopifyGraphQLPort,
  ShopifyProductNode,
  ShopifyProductsListResponse,
  ShopifyVariantNode,
} from "@counter/shopify-connector";
import { PRODUCTS_LIST_QUERY } from "@counter/shopify-connector";

function formatGraphQLErrors(errors: readonly ShopifyGraphQLError[] | undefined): string {
  return errors === undefined || errors.length === 0
    ? "unknown error"
    : errors.map((error) => error.message).join("; ");
}

export interface CatalogVariant {
  readonly variantId: string;
  readonly title: string;
  readonly productTitle: string;
  readonly productDescription: string;
  readonly priceMinor: bigint;
  readonly currency: string;
  readonly available: boolean;
}

const CURRENCY = "INR";
const SEARCH_PAGE_SIZE = 25;

/** Shopify's decimal price string (e.g. "1499.00") to minor units (paise). */
function decimalToMinor(price: string): bigint {
  const [whole, fraction = ""] = price.split(".");
  const paddedFraction = (fraction + "00").slice(0, 2);
  return BigInt(`${whole}${paddedFraction}`);
}

function toVariants(product: ShopifyProductNode): readonly CatalogVariant[] {
  const active = product.status === "ACTIVE";
  return product.variants.edges.map(({ node }: { node: ShopifyVariantNode }) =>
    Object.freeze({
      variantId: node.id,
      title: node.title,
      productTitle: product.title,
      productDescription: product.descriptionHtml,
      priceMinor: decimalToMinor(node.price),
      currency: CURRENCY,
      available: active && node.inventoryQuantity > 0,
    }),
  );
}

/**
 * Searches the live catalog using Shopify's native product search syntax
 * (the same free-text `query` filter Shopify's admin search box accepts).
 */
export async function searchCatalog(
  client: ShopifyGraphQLPort,
  query: string,
  limit: number,
): Promise<readonly CatalogVariant[]> {
  const response = await client.query<ShopifyProductsListResponse>(PRODUCTS_LIST_QUERY, {
    first: Math.min(Math.max(limit, 1), SEARCH_PAGE_SIZE),
    after: null,
    query,
  });
  if (response.data === null) {
    throw new Error(`Shopify product search failed: ${formatGraphQLErrors(response.errors)}`);
  }
  return response.data.products.edges.flatMap((edge: { node: ShopifyProductNode }) =>
    toVariants(edge.node),
  );
}

const VARIANT_QUERY = `query VariantById($id: ID!) {
  node(id: $id) {
    ... on ProductVariant {
      id
      title
      sku
      inventoryQuantity
      price
      compareAtPrice
      product {
        title
        descriptionHtml
        status
      }
    }
  }
}`;

interface VariantNodeResponse {
  readonly node: {
    readonly id: string;
    readonly title: string;
    readonly sku: string | null;
    readonly inventoryQuantity: number;
    readonly price: string;
    readonly compareAtPrice: string | null;
    readonly product: {
      readonly title: string;
      readonly descriptionHtml: string;
      readonly status: string;
    };
  } | null;
}

/** Fetches a single variant (and its parent product's title/description) by GID. */
export async function getCatalogVariant(
  client: ShopifyGraphQLPort,
  variantId: string,
): Promise<CatalogVariant | undefined> {
  const response = await client.query<VariantNodeResponse>(VARIANT_QUERY, { id: variantId });
  if (response.data === null) {
    throw new Error(`Shopify variant lookup failed: ${formatGraphQLErrors(response.errors)}`);
  }
  const node = response.data.node;
  if (node === null) {
    return undefined;
  }
  return Object.freeze({
    variantId: node.id,
    title: node.title,
    productTitle: node.product.title,
    productDescription: node.product.descriptionHtml,
    priceMinor: decimalToMinor(node.price),
    currency: CURRENCY,
    available: node.product.status === "ACTIVE" && node.inventoryQuantity > 0,
  });
}
