/**
 * Pilot quote configuration for the India-only fixed GST/shipping model.
 */

import type { FreshnessPolicy } from "@counter/commerce-graph";

// ─── Pilot Quote Config ───────────────────────────────────────────────────────

export interface PilotQuoteConfig {
  /** GST rate in basis points (e.g. 1800 = 18%). */
  readonly taxRateBps: number;
  /** Flat shipping fee in paise (e.g. 5000n = 50 INR). */
  readonly shippingFlatPaise: bigint;
  /** Only INR is supported in the pilot. */
  readonly currency: "INR";
  /** Only India is supported in the pilot. */
  readonly country: "IN";
  /** Validity window for generated quotes in milliseconds. */
  readonly quoteValidityMs: number;
  /** Freshness policy for price/inventory data. */
  readonly freshnessPolicy: FreshnessPolicy;
}

// ─── Default Config ───────────────────────────────────────────────────────────

export const DEFAULT_PILOT_QUOTE_CONFIG: PilotQuoteConfig = Object.freeze({
  taxRateBps: 1800,
  shippingFlatPaise: 5000n,
  currency: "INR" as const,
  country: "IN" as const,
  quoteValidityMs: 900_000, // 15 minutes
  freshnessPolicy: Object.freeze({
    resourceName: "price_and_inventory",
    maxAgeMs: 300_000, // 5 minutes
    warningThresholdMs: 180_000, // 3 minutes
  }),
});
