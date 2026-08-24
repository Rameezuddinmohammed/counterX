/**
 * packages/commerce-graph
 *
 * Normalized commerce model: products, variants, prices, inventory, quotes
 * with provenance. This package defines the canonical commerce types that
 * merchant connectors map platform-specific data into.
 */

export const PACKAGE_NAME = "@counter/commerce-graph";

/** A normalized product in the commerce graph. */
export interface Product {
  readonly id: string;
  readonly merchantId: string;
  readonly title: string;
  readonly description: string;
  readonly variants: readonly Variant[];
  readonly sourceReference: SourceReference;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A product variant with pricing and inventory associations. */
export interface Variant {
  readonly id: string;
  readonly productId: string;
  readonly sku: string;
  readonly title: string;
  readonly active: boolean;
}

/** A point-in-time price observation for a variant. */
export interface PriceSnapshot {
  readonly variantId: string;
  readonly currencyCode: string;
  readonly amount: string;
  readonly observedAt: string;
  readonly source: SourceReference;
}

/** A point-in-time inventory observation for a variant. */
export interface InventorySnapshot {
  readonly variantId: string;
  readonly availableQuantity: number;
  readonly observedAt: string;
  readonly source: SourceReference;
}

/** A quote representing price and availability at a specific time. */
export interface MerchantQuote {
  readonly id: string;
  readonly merchantId: string;
  readonly variantId: string;
  readonly price: PriceSnapshot;
  readonly inventory: InventorySnapshot;
  readonly validUntil: string;
  readonly freshnessPolicy: FreshnessPolicy;
}

/** A reference to the source system that provided a piece of data. */
export interface SourceReference {
  readonly platform: string;
  readonly externalId: string;
  readonly fetchedAt: string;
  readonly mappingVersion: MappingVersion;
}

/** How fresh data must be before requiring a re-fetch. */
export interface FreshnessPolicy {
  readonly maxAgeMs: number;
  readonly staleWhileRevalidate: boolean;
}

/** Tracks the version of the mapping used to normalize external data. */
export interface MappingVersion {
  readonly version: string;
  readonly schemaHash: string;
}
