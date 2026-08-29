/**
 * Builds a CTP-digest-signed quote from a live Shopify catalog read.
 *
 * Reuses the pilot tax/shipping model (DEFAULT_PILOT_QUOTE_CONFIG) and the
 * CTP canonical-JSON digest (computeCtpDigest) from @counter/shopify-connector
 * for content and tamper-evidence parity with QuoteService's output — but
 * builds the ImmutableQuote directly from a live-fetched CatalogVariant
 * instead of going through QuoteService's ProductIndex/PriceSnapshotPort,
 * since that pipeline requires a durably-synced catalog this app does not
 * (yet) maintain. See shopify-catalog.ts for the scope rationale.
 */

import type { Instant } from "@counter/domain";
import { createCounterId } from "@counter/domain";
import type { FreshnessAssessment } from "@counter/commerce-graph";
import type { ImmutableQuote } from "@counter/shopify-connector";
import { DEFAULT_PILOT_QUOTE_CONFIG, computeCtpDigest } from "@counter/shopify-connector";
import type { CatalogVariant } from "./shopify-catalog.js";

export interface BuildQuoteInput {
  readonly merchantId: string;
  readonly variant: CatalogVariant;
  readonly quantity: number;
  readonly nowMs: number;
}

export function buildQuote(input: BuildQuoteInput): ImmutableQuote {
  const config = DEFAULT_PILOT_QUOTE_CONFIG;
  const now = input.nowMs as Instant;

  const unitPricePaise = input.variant.priceMinor;
  const subtotalPaise = unitPricePaise * BigInt(input.quantity);
  const taxAmountPaise = (subtotalPaise * BigInt(config.taxRateBps)) / 10000n;
  const shippingAmountPaise = config.shippingFlatPaise;
  const totalPaise = subtotalPaise + taxAmountPaise + shippingAmountPaise;

  const idResult = createCounterId("quote", crypto.getRandomValues(new Uint8Array(16)));
  if (!idResult.ok) {
    throw new Error("Failed to derive quote id");
  }

  const freshnessAssessment: FreshnessAssessment = Object.freeze({
    status: "fresh" as const,
    lastObservedAt: now,
    ageMs: 0,
    budgetMs: config.freshnessPolicy.maxAgeMs,
    withinBudget: true,
  });

  const quoteContent: ImmutableQuote = {
    id: idResult.value,
    merchantId: input.merchantId,
    items: Object.freeze([
      Object.freeze({
        variantId: input.variant.variantId,
        quantity: input.quantity,
        unitPricePaise,
      }),
    ]),
    subtotalPaise,
    taxAmountPaise,
    taxRateBps: config.taxRateBps,
    shippingAmountPaise,
    totalPaise,
    currency: "INR",
    country: "IN",
    createdAt: now,
    validUntil: (input.nowMs + config.quoteValidityMs) as Instant,
    freshnessAssessment,
    ctpDigest: "" as unknown as ImmutableQuote["ctpDigest"],
    metadata: Object.freeze({
      taxSource: "merchant_pilot_config" as const,
      shippingSource: "merchant_pilot_config" as const,
      taxRateBps: config.taxRateBps,
      shippingFlatPaise: config.shippingFlatPaise,
      calculationMethod: "fixed_pilot_v1" as const,
    }),
  };

  const ctpDigest = computeCtpDigest(quoteContent);
  return Object.freeze({ ...quoteContent, ctpDigest });
}
