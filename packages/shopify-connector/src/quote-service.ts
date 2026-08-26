/**
 * Quote service implementing the pilot tax/shipping model.
 *
 * Generates immutable quotes with CTP digest (SHA-256 of canonical JSON).
 * Enforces: released-only products, freshness policy, inventory availability,
 * INR-only, India-only.
 */

import type { Instant } from "@counter/domain";
import type { Result, Sha256Digest } from "@counter/domain";
import { ok, err, createCanonicalError } from "@counter/domain";
import type { IdGenerator } from "@counter/domain";
import type { PriceSnapshot, InventorySnapshot, FreshnessAssessment } from "@counter/commerce-graph";
import { evaluateFreshness } from "@counter/commerce-graph";
import type { PilotQuoteConfig } from "./quote-config.js";
import type { ImmutableQuote, QuoteLineItem } from "./quote-types.js";
import type { ProductProjection } from "./product-index.js";
import type { ProductIndex } from "./product-index.js";
import { computeCtpDigest } from "./quote-verification.js";

// ─── Create Quote Request ─────────────────────────────────────────────────────

export interface CreateQuoteRequestItem {
  readonly variantId: string;
  readonly quantity: number;
}

export interface CreateQuoteRequest {
  readonly merchantId: string;
  readonly items: readonly CreateQuoteRequestItem[];
  readonly config: PilotQuoteConfig;
}

// ─── Quote Refusal Error ──────────────────────────────────────────────────────

export interface QuoteRefusal {
  readonly reason: string;
  readonly variantId?: string | undefined;
  readonly detail?: string | undefined;
}

// ─── Data Ports ───────────────────────────────────────────────────────────────

/**
 * Port for retrieving price snapshots for variants.
 */
export interface PriceSnapshotPort {
  getLatestPrice(variantId: string): PriceSnapshot | null;
}

/**
 * Port for retrieving inventory snapshots for variants.
 */
export interface InventorySnapshotPort {
  getLatestInventory(variantId: string): InventorySnapshot | null;
}

// ─── Clock Port ───────────────────────────────────────────────────────────────

export interface ClockPort {
  now(): Instant;
}

// ─── Quote Service ────────────────────────────────────────────────────────────

export class QuoteService {
  readonly #productIndex: ProductIndex;
  readonly #pricePort: PriceSnapshotPort;
  readonly #inventoryPort: InventorySnapshotPort;
  readonly #idGenerator: IdGenerator;
  readonly #clock: ClockPort;

  public constructor(deps: {
    productIndex: ProductIndex;
    pricePort: PriceSnapshotPort;
    inventoryPort: InventorySnapshotPort;
    idGenerator: IdGenerator;
    clock: ClockPort;
  }) {
    this.#productIndex = deps.productIndex;
    this.#pricePort = deps.pricePort;
    this.#inventoryPort = deps.inventoryPort;
    this.#idGenerator = deps.idGenerator;
    this.#clock = deps.clock;
  }

  public createQuote(request: CreateQuoteRequest): Result<ImmutableQuote> {
    const { merchantId, items, config } = request;

    // Validate currency
    if (config.currency !== "INR") {
      return err(
        createCanonicalError({
          category: "validation",
          code: "UNSUPPORTED_VALUE",
          message: "Only INR currency is supported in the pilot",
        }),
      );
    }

    // Validate country
    if (config.country !== "IN") {
      return err(
        createCanonicalError({
          category: "validation",
          code: "UNSUPPORTED_VALUE",
          message: "Only India (IN) is supported in the pilot",
        }),
      );
    }

    // Validate items are non-empty
    if (items.length === 0) {
      return err(
        createCanonicalError({
          category: "validation",
          code: "INVALID_FORMAT",
          message: "Quote must contain at least one line item",
        }),
      );
    }

    const now = this.#clock.now();
    const resolvedItems: QuoteLineItem[] = [];
    let worstFreshness: FreshnessAssessment | null = null;

    for (const item of items) {
      // Validate quantity
      if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
        return err(
          createCanonicalError({
            category: "validation",
            code: "OUT_OF_RANGE",
            message: "Quantity must be a positive integer",
          }),
        );
      }

      // Resolve variant from index
      const variant = this.#productIndex.getVariant(item.variantId);
      if (variant === null) {
        return err(
          createCanonicalError({
            category: "validation",
            code: "UNSUPPORTED_VALUE",
            message: "Variant not found in released product index",
          }),
        );
      }

      // Verify the product is still released
      const product: ProductProjection | null = this.#productIndex.getProduct(variant.productId);
      if (product === null || product.status !== "released") {
        return err(
          createCanonicalError({
            category: "validation",
            code: "UNSUPPORTED_VALUE",
            message: "Product is not released",
          }),
        );
      }

      // Get latest price and check freshness
      const priceSnapshot = this.#pricePort.getLatestPrice(item.variantId);
      if (priceSnapshot === null) {
        return err(
          createCanonicalError({
            category: "stale",
            code: "STALE",
            message: "No price data available for variant",
          }),
        );
      }

      const priceFreshness = evaluateFreshness(priceSnapshot.observedAt, now, config.freshnessPolicy);
      if (!priceFreshness.withinBudget) {
        return err(
          createCanonicalError({
            category: "stale",
            code: "STALE",
            message: "Price data is stale",
          }),
        );
      }

      // Get latest inventory and check freshness
      const inventorySnapshot = this.#inventoryPort.getLatestInventory(item.variantId);
      if (inventorySnapshot === null) {
        return err(
          createCanonicalError({
            category: "stale",
            code: "STALE",
            message: "No inventory data available for variant",
          }),
        );
      }

      const inventoryFreshness = evaluateFreshness(inventorySnapshot.observedAt, now, config.freshnessPolicy);
      if (!inventoryFreshness.withinBudget) {
        return err(
          createCanonicalError({
            category: "stale",
            code: "STALE",
            message: "Inventory data is stale",
          }),
        );
      }

      // Check inventory availability
      if (inventorySnapshot.availableQuantity < item.quantity) {
        return err(
          createCanonicalError({
            category: "validation",
            code: "OUT_OF_RANGE",
            message: "Insufficient inventory for requested quantity",
          }),
        );
      }

      // Track worst freshness assessment
      if (worstFreshness === null || compareFreshnessWorst(priceFreshness, worstFreshness) < 0) {
        worstFreshness = priceFreshness;
      }
      if (compareFreshnessWorst(inventoryFreshness, worstFreshness) < 0) {
        worstFreshness = inventoryFreshness;
      }

      resolvedItems.push(
        Object.freeze({
          variantId: item.variantId,
          quantity: item.quantity,
          unitPricePaise: priceSnapshot.amount.amountMinor,
        }),
      );
    }

    // Calculate totals per pilot tax/shipping decision
    const subtotalPaise = resolvedItems.reduce(
      (sum, item) => sum + item.unitPricePaise * BigInt(item.quantity),
      0n,
    );
    const taxAmountPaise = (subtotalPaise * BigInt(config.taxRateBps)) / 10000n;
    const shippingAmountPaise = config.shippingFlatPaise;
    const totalPaise = subtotalPaise + taxAmountPaise + shippingAmountPaise;

    // Generate quote ID and timestamps
    const quoteId = this.#idGenerator.generate("quote");
    const createdAt = now;
    const validUntil = ((now as number) + config.quoteValidityMs) as Instant;

    // Build the quote content for digest (digest field itself is not included in the hash)
    const quoteContent: ImmutableQuote = {
      id: quoteId,
      merchantId,
      items: Object.freeze(resolvedItems),
      subtotalPaise,
      taxAmountPaise,
      taxRateBps: config.taxRateBps,
      shippingAmountPaise,
      totalPaise,
      currency: "INR",
      country: "IN",
      createdAt,
      validUntil,
      freshnessAssessment: worstFreshness!,
      ctpDigest: "" as unknown as Sha256Digest,
      metadata: Object.freeze({
        taxSource: "merchant_pilot_config" as const,
        shippingSource: "merchant_pilot_config" as const,
        taxRateBps: config.taxRateBps,
        shippingFlatPaise: config.shippingFlatPaise,
        calculationMethod: "fixed_pilot_v1" as const,
      }),
    };

    // Compute CTP digest from canonical representation
    const ctpDigest = computeCtpDigest(quoteContent);

    const immutableQuote: ImmutableQuote = Object.freeze({
      id: quoteId,
      merchantId,
      items: Object.freeze(resolvedItems),
      subtotalPaise,
      taxAmountPaise,
      taxRateBps: config.taxRateBps,
      shippingAmountPaise,
      totalPaise,
      currency: "INR",
      country: "IN",
      createdAt,
      validUntil,
      freshnessAssessment: worstFreshness!,
      ctpDigest,
      metadata: Object.freeze({
        taxSource: "merchant_pilot_config" as const,
        shippingSource: "merchant_pilot_config" as const,
        taxRateBps: config.taxRateBps,
        shippingFlatPaise: config.shippingFlatPaise,
        calculationMethod: "fixed_pilot_v1" as const,
      }),
    });

    return ok(immutableQuote);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const FRESHNESS_ORDER: Record<string, number> = {
  fresh: 3,
  approaching_stale: 2,
  stale: 1,
  unknown: 0,
};

/**
 * Returns negative if `a` is worse than `b`, 0 if equal, positive if better.
 */
function compareFreshnessWorst(a: FreshnessAssessment, b: FreshnessAssessment): number {
  return (FRESHNESS_ORDER[a.status] ?? 0) - (FRESHNESS_ORDER[b.status] ?? 0);
}
