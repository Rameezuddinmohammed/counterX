/**
 * Quote verification: digest recomputation, expiry detection, and
 * material change detection.
 */

import type { Instant, Sha256Digest } from "@counter/domain";
import { sha256Digest, sha256DigestsEqual } from "@counter/domain";
import type { ImmutableQuote, MaterialChangeResult, PriceChange, InventoryChange } from "./quote-types.js";

// ─── Canonical JSON for CTP Digest ───────────────────────────────────────────

/**
 * Produces a deterministic canonical JSON representation for CTP digest
 * computation. Keys are sorted, bigints serialized as strings.
 */
export function computeCanonicalJson(quote: ImmutableQuote): string {
  const sortedItems = [...quote.items]
    .sort((a, b) => a.variantId.localeCompare(b.variantId))
    .map((item) => ({
      quantity: item.quantity,
      unitPricePaise: item.unitPricePaise.toString(10),
      variantId: item.variantId,
    }));

  const canonical: Record<string, unknown> = {
    country: quote.country,
    createdAt: quote.createdAt,
    currency: quote.currency,
    items: sortedItems,
    merchantId: quote.merchantId,
    shippingAmountPaise: quote.shippingAmountPaise.toString(10),
    subtotalPaise: quote.subtotalPaise.toString(10),
    taxAmountPaise: quote.taxAmountPaise.toString(10),
    taxRateBps: quote.taxRateBps,
    totalPaise: quote.totalPaise.toString(10),
    validUntil: quote.validUntil,
  };

  return JSON.stringify(canonical);
}

/**
 * Computes the CTP digest (SHA-256) of a quote's canonical content.
 *
 * The digest is intentionally content-based, not instance-based. The quote `id`
 * is excluded from the canonical representation so that the digest reflects only
 * the commercial content of the quote. Uniqueness across distinct quote instances
 * is guaranteed by the inclusion of `createdAt` and `validUntil` timestamps,
 * which vary per invocation (millisecond granularity from the ClockPort).
 */
export function computeCtpDigest(quote: ImmutableQuote): Sha256Digest {
  const json = computeCanonicalJson(quote);
  const bytes = new TextEncoder().encode(json);
  return sha256Digest(bytes);
}

// ─── Verification Functions ───────────────────────────────────────────────────

/**
 * Recomputes the CTP digest and verifies it matches the quote's stored digest.
 * Uses timing-safe comparison.
 */
export function verifyQuoteDigest(quote: ImmutableQuote): boolean {
  const recomputed = computeCtpDigest(quote);
  return sha256DigestsEqual(recomputed, quote.ctpDigest);
}

/**
 * Returns true if the quote has expired relative to the given instant.
 */
export function isQuoteExpired(quote: ImmutableQuote, now: Instant): boolean {
  return (now as number) > (quote.validUntil as number);
}

/**
 * Detects material changes between the original quote and current prices/inventory.
 * A material change means the quote may no longer be valid.
 */
export function detectMaterialChange(
  original: ImmutableQuote,
  currentPrices: Map<string, bigint>,
  currentInventory: Map<string, number>,
): MaterialChangeResult {
  const priceChanges: PriceChange[] = [];
  const inventoryChanges: InventoryChange[] = [];

  for (const item of original.items) {
    const currentPrice = currentPrices.get(item.variantId);
    if (currentPrice !== undefined && currentPrice !== item.unitPricePaise) {
      priceChanges.push(
        Object.freeze({
          variantId: item.variantId,
          previousPaise: item.unitPricePaise,
          currentPaise: currentPrice,
        }),
      );
    }

    const currentQty = currentInventory.get(item.variantId);
    if (currentQty !== undefined && currentQty < item.quantity) {
      inventoryChanges.push(
        Object.freeze({
          variantId: item.variantId,
          previousQuantity: item.quantity,
          currentQuantity: currentQty,
          requestedQuantity: item.quantity,
        }),
      );
    }
  }

  return Object.freeze({
    changed: priceChanges.length > 0 || inventoryChanges.length > 0,
    priceChanges: Object.freeze(priceChanges),
    inventoryChanges: Object.freeze(inventoryChanges),
  });
}
