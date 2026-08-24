/**
 * Immutable quote types for the pilot tax/shipping calculation.
 *
 * All monetary amounts are in paise (integer bigint, INR only).
 */

import type { Instant, Sha256Digest } from "@counter/domain";
import type { FreshnessAssessment } from "@counter/commerce-graph";

// ─── Quote Refusal Reasons ────────────────────────────────────────────────────

export const QUOTE_REFUSAL_REASONS = [
  "product_not_found",
  "product_not_released",
  "variant_not_found",
  "stale_data",
  "insufficient_inventory",
  "invalid_quantity",
  "unsupported_currency",
  "unsupported_country",
  "quote_expired",
  "ambiguous_total",
] as const;

export type QuoteRefusalReason = (typeof QUOTE_REFUSAL_REASONS)[number];

// ─── Quote Line Item ──────────────────────────────────────────────────────────

export interface QuoteLineItem {
  readonly variantId: string;
  readonly quantity: number;
  readonly unitPricePaise: bigint;
}

// ─── Immutable Quote ──────────────────────────────────────────────────────────

export interface ImmutableQuote {
  readonly id: string;
  readonly merchantId: string;
  readonly items: readonly QuoteLineItem[];
  readonly subtotalPaise: bigint;
  readonly taxAmountPaise: bigint;
  readonly taxRateBps: number;
  readonly shippingAmountPaise: bigint;
  readonly totalPaise: bigint;
  readonly currency: "INR";
  readonly country: "IN";
  readonly createdAt: Instant;
  readonly validUntil: Instant;
  readonly freshnessAssessment: FreshnessAssessment;
  readonly ctpDigest: Sha256Digest;
  readonly metadata: QuoteMetadata;
}

export interface QuoteMetadata {
  readonly taxSource: "merchant_pilot_config";
  readonly shippingSource: "merchant_pilot_config";
  readonly taxRateBps: number;
  readonly shippingFlatPaise: bigint;
  readonly calculationMethod: "fixed_pilot_v1";
}

// ─── Material Change Detection ────────────────────────────────────────────────

export interface PriceChange {
  readonly variantId: string;
  readonly previousPaise: bigint;
  readonly currentPaise: bigint;
}

export interface InventoryChange {
  readonly variantId: string;
  readonly previousQuantity: number;
  readonly currentQuantity: number;
  readonly requestedQuantity: number;
}

export interface MaterialChangeResult {
  readonly changed: boolean;
  readonly priceChanges: readonly PriceChange[];
  readonly inventoryChanges: readonly InventoryChange[];
}
