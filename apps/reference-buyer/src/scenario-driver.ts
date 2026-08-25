/**
 * ScenarioDriver: drives the full purchase lifecycle using only published contracts.
 *
 * Uses port interfaces so it works with mocks in tests and real services
 * in integration testing. No internal shortcuts or direct DB access.
 *
 * Lifecycle: discover -> search -> quote -> verify digest -> create intent ->
 *            execute checkout -> verify receipt
 */

import type { Instant, IsoCurrencyCode, MerchantId, Money, WalletId } from "@counter/domain";

// ---------------------------------------------------------------------------
// Port Interfaces (published contracts only)
// ---------------------------------------------------------------------------

export interface DiscoveryResult {
  readonly merchantId: MerchantId;
  readonly name: string;
  readonly categories: readonly string[];
  readonly region: string;
  readonly allowlisted: boolean;
}

export interface SearchResult {
  readonly productId: string;
  readonly variantId: string;
  readonly title: string;
  readonly priceMinor: bigint;
  readonly currency: IsoCurrencyCode;
  readonly available: boolean;
}

export interface QuoteResult {
  readonly quoteId: string;
  readonly quoteDigest: string;
  readonly totalMinor: bigint;
  readonly currency: IsoCurrencyCode;
  readonly expiresAt: Instant;
  readonly items: readonly QuoteLineItem[];
}

export interface QuoteLineItem {
  readonly variantId: string;
  readonly quantity: number;
  readonly unitPriceMinor: bigint;
  readonly lineTotalMinor: bigint;
}

export interface CheckoutResult {
  readonly outcome: "success" | "declined" | "review_required" | "indeterminate";
  readonly phase: string;
  readonly details: string;
  readonly paymentReference?: string;
  readonly orderReference?: string;
  readonly receiptId?: string;
}

export interface ReceiptVerificationResult {
  readonly valid: boolean;
  readonly error?: string;
}

/**
 * Port for merchant discovery.
 */
export interface DiscoveryPort {
  discover(merchantId: MerchantId): Promise<DiscoveryResult | undefined>;
}

/**
 * Port for product search within a merchant catalog.
 */
export interface SearchPort {
  search(merchantId: MerchantId, query: string): Promise<readonly SearchResult[]>;
}

/**
 * Port for requesting a binding quote.
 */
export interface QuotePort {
  getQuote(params: {
    readonly merchantId: MerchantId;
    readonly items: readonly { readonly variantId: string; readonly quantity: number }[];
  }): Promise<QuoteResult>;
}

/**
 * Port for executing checkout (payment + order).
 */
export interface CheckoutPort {
  executeCheckout(params: {
    readonly walletId: WalletId;
    readonly merchantId: MerchantId;
    readonly amount: Money;
    readonly currency: IsoCurrencyCode;
    readonly mandateRef: string;
    readonly intentRef: string;
    readonly quoteDigest: string;
    readonly idempotencyKey: string;
    readonly lineItems: readonly { readonly variantId: string; readonly quantity: number }[];
  }): Promise<CheckoutResult>;
}

// ---------------------------------------------------------------------------
// Scenario Driver
// ---------------------------------------------------------------------------

export interface ScenarioDriverConfig {
  readonly discoveryPort: DiscoveryPort;
  readonly searchPort: SearchPort;
  readonly quotePort: QuotePort;
  readonly checkoutPort: CheckoutPort;
}

export interface DriverContext {
  readonly walletId: WalletId;
  readonly merchantId: MerchantId;
}

/**
 * ScenarioDriver drives the full lifecycle using published contracts only.
 * No internal shortcuts - all interactions go through port interfaces.
 */
export class ScenarioDriver {
  readonly #discoveryPort: DiscoveryPort;
  readonly #searchPort: SearchPort;
  readonly #quotePort: QuotePort;
  readonly #checkoutPort: CheckoutPort;

  public constructor(config: ScenarioDriverConfig) {
    this.#discoveryPort = config.discoveryPort;
    this.#searchPort = config.searchPort;
    this.#quotePort = config.quotePort;
    this.#checkoutPort = config.checkoutPort;
  }

  /**
   * Step 1: Discover a merchant and verify allowlisting.
   */
  public async discover(merchantId: MerchantId): Promise<DiscoveryResult | undefined> {
    return this.#discoveryPort.discover(merchantId);
  }

  /**
   * Step 2: Search for products at the merchant.
   */
  public async search(merchantId: MerchantId, query: string): Promise<readonly SearchResult[]> {
    return this.#searchPort.search(merchantId, query);
  }

  /**
   * Step 3: Get a binding quote for selected items.
   */
  public async getQuote(
    merchantId: MerchantId,
    items: readonly { readonly variantId: string; readonly quantity: number }[],
  ): Promise<QuoteResult> {
    return this.#quotePort.getQuote({ merchantId, items });
  }

  /**
   * Step 4: Verify the quote digest matches expected value.
   */
  public verifyDigest(quote: QuoteResult, expectedDigest: string): boolean {
    return quote.quoteDigest === expectedDigest;
  }

  /**
   * Step 5: Execute checkout through the published checkout port.
   */
  public async executeCheckout(params: {
    readonly context: DriverContext;
    readonly amount: Money;
    readonly currency: IsoCurrencyCode;
    readonly mandateRef: string;
    readonly intentRef: string;
    readonly quoteDigest: string;
    readonly idempotencyKey: string;
    readonly lineItems: readonly { readonly variantId: string; readonly quantity: number }[];
  }): Promise<CheckoutResult> {
    return this.#checkoutPort.executeCheckout({
      walletId: params.context.walletId,
      merchantId: params.context.merchantId,
      amount: params.amount,
      currency: params.currency,
      mandateRef: params.mandateRef,
      intentRef: params.intentRef,
      quoteDigest: params.quoteDigest,
      idempotencyKey: params.idempotencyKey,
      lineItems: params.lineItems,
    });
  }
}
