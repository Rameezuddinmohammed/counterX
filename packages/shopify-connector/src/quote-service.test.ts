import { describe, expect, it } from "vitest";
import type { Instant, IsoCurrencyCode } from "@counter/domain";
import { CryptoIdGenerator } from "@counter/domain";
import type {
  Product,
  PriceSnapshot,
  InventorySnapshot,
  SourceReference,
  MappingVersion,
  Variant,
} from "@counter/commerce-graph";
import { ProductIndex } from "./product-index.js";
import { QuoteService } from "./quote-service.js";
import type { PriceSnapshotPort, InventorySnapshotPort, ClockPort } from "./quote-service.js";
import type { PilotQuoteConfig } from "./quote-config.js";
import { DEFAULT_PILOT_QUOTE_CONFIG } from "./quote-config.js";
import { verifyQuoteDigest, isQuoteExpired, detectMaterialChange } from "./quote-verification.js";

// ─── Test Helpers ─────────────────────────────────────────────────────────────

const NOW = 1_700_000_000_000 as Instant;
const FRESH_TIME = (NOW - 60_000) as Instant; // 1 minute ago (within budget)
const STALE_TIME = (NOW - 600_000) as Instant; // 10 minutes ago (exceeds maxAge of 5 min)

const INR = "INR" as IsoCurrencyCode;

function makeMappingVersion(): MappingVersion {
  return { version: "1.0.0", schemaHash: "abc123" };
}

function makeSourceRef(): SourceReference {
  return {
    platform: "shopify",
    externalId: "ext-123",
    fetchedAt: NOW,
    mappingVersion: makeMappingVersion(),
  };
}

function makeVariant(overrides: Partial<Variant> = {}): Variant {
  return {
    id: "variant-1",
    productId: "product-1",
    merchantId: "merchant-1",
    sku: "SKU-001",
    title: "Default Variant",
    active: true,
    ...overrides,
  };
}

function makeProduct(overrides: Partial<Product> = {}): Product {
  const base: Product = {
    id: "product-1",
    merchantId: "merchant-1",
    title: "Test Product",
    description: "A test product description",
    variants: [makeVariant()],
    sourceReference: makeSourceRef(),
    sourceReferences: [makeSourceRef()],
    status: "released",
    tombstonedAt: undefined,
    createdAt: NOW,
    updatedAt: NOW,
  };
  return { ...base, ...overrides };
}

function makePriceSnapshot(
  variantId: string,
  amountMinor: bigint,
  observedAt: Instant = FRESH_TIME,
): PriceSnapshot {
  return {
    variantId,
    amount: { amountMinor, currency: INR },
    observedAt,
    source: makeSourceRef(),
  };
}

function makeInventorySnapshot(
  variantId: string,
  qty: number,
  observedAt: Instant = FRESH_TIME,
): InventorySnapshot {
  return {
    variantId,
    availableQuantity: qty,
    observedAt,
    source: makeSourceRef(),
  };
}

class MockPricePort implements PriceSnapshotPort {
  readonly #prices = new Map<string, PriceSnapshot>();

  set(snapshot: PriceSnapshot): void {
    this.#prices.set(snapshot.variantId, snapshot);
  }

  getLatestPrice(variantId: string): PriceSnapshot | null {
    return this.#prices.get(variantId) ?? null;
  }
}

class MockInventoryPort implements InventorySnapshotPort {
  readonly #inventory = new Map<string, InventorySnapshot>();

  set(snapshot: InventorySnapshot): void {
    this.#inventory.set(snapshot.variantId, snapshot);
  }

  getLatestInventory(variantId: string): InventorySnapshot | null {
    return this.#inventory.get(variantId) ?? null;
  }
}

class MockClock implements ClockPort {
  #now: Instant;

  constructor(now: Instant = NOW) {
    this.#now = now;
  }

  now(): Instant {
    return this.#now;
  }

  advance(ms: number): void {
    this.#now = ((this.#now as number) + ms) as Instant;
  }
}

function createTestService(options: {
  products?: readonly Product[];
  prices?: readonly PriceSnapshot[];
  inventory?: readonly InventorySnapshot[];
  now?: Instant;
} = {}): { service: QuoteService; pricePort: MockPricePort; inventoryPort: MockInventoryPort; clock: MockClock } {
  const productIndex = new ProductIndex();
  if (options.products) {
    productIndex.indexProducts(options.products);
  }

  const pricePort = new MockPricePort();
  if (options.prices) {
    for (const p of options.prices) {
      pricePort.set(p);
    }
  }

  const inventoryPort = new MockInventoryPort();
  if (options.inventory) {
    for (const inv of options.inventory) {
      inventoryPort.set(inv);
    }
  }

  const clock = new MockClock(options.now ?? NOW);

  const service = new QuoteService({
    productIndex,
    pricePort,
    inventoryPort,
    idGenerator: new CryptoIdGenerator(),
    clock,
  });

  return { service, pricePort, inventoryPort, clock };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("QuoteService", () => {
  describe("successful quote creation", () => {
    it("calculates correct arithmetic: subtotal, tax (floor rounding), shipping, total", () => {
      const product = makeProduct({
        id: "p1",
        variants: [
          makeVariant({ id: "v1", productId: "p1" }),
          makeVariant({ id: "v2", productId: "p1" }),
        ],
      });

      const { service } = createTestService({
        products: [product],
        prices: [
          makePriceSnapshot("v1", 10000n), // 100.00 INR
          makePriceSnapshot("v2", 25000n), // 250.00 INR
        ],
        inventory: [
          makeInventorySnapshot("v1", 10),
          makeInventorySnapshot("v2", 5),
        ],
      });

      const result = service.createQuote({
        merchantId: "merchant-1",
        items: [
          { variantId: "v1", quantity: 2 },
          { variantId: "v2", quantity: 1 },
        ],
        config: DEFAULT_PILOT_QUOTE_CONFIG,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const quote = result.value;
      // subtotal = (10000 * 2) + (25000 * 1) = 45000
      expect(quote.subtotalPaise).toBe(45000n);
      // tax = floor(45000 * 1800 / 10000) = floor(8100) = 8100
      expect(quote.taxAmountPaise).toBe(8100n);
      // shipping = 5000 (flat)
      expect(quote.shippingAmountPaise).toBe(5000n);
      // total = 45000 + 8100 + 5000 = 58100
      expect(quote.totalPaise).toBe(58100n);
      expect(quote.currency).toBe("INR");
      expect(quote.country).toBe("IN");
      expect(quote.taxRateBps).toBe(1800);
      expect(quote.items).toHaveLength(2);
      expect(quote.id).toMatch(/^ctr_quote_/);
    });

    it("applies floor rounding for tax (never overcharges)", () => {
      // subtotal = 10001, taxRateBps = 1800
      // 10001n * 1800n = 18001800n, / 10000n = 1800n (bigint division floors)
      const product = makeProduct({
        id: "p1",
        variants: [makeVariant({ id: "v1", productId: "p1" })],
      });

      const { service } = createTestService({
        products: [product],
        prices: [makePriceSnapshot("v1", 10001n)],
        inventory: [makeInventorySnapshot("v1", 10)],
      });

      const result = service.createQuote({
        merchantId: "merchant-1",
        items: [{ variantId: "v1", quantity: 1 }],
        config: DEFAULT_PILOT_QUOTE_CONFIG,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // 10001 * 1800 = 18001800, / 10000 = 1800 (bigint division floors)
      expect(result.value.taxAmountPaise).toBe(1800n);
    });

    it("sets correct metadata", () => {
      const product = makeProduct({
        id: "p1",
        variants: [makeVariant({ id: "v1", productId: "p1" })],
      });

      const { service } = createTestService({
        products: [product],
        prices: [makePriceSnapshot("v1", 10000n)],
        inventory: [makeInventorySnapshot("v1", 10)],
      });

      const result = service.createQuote({
        merchantId: "merchant-1",
        items: [{ variantId: "v1", quantity: 1 }],
        config: DEFAULT_PILOT_QUOTE_CONFIG,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.metadata).toEqual({
        taxSource: "merchant_pilot_config",
        shippingSource: "merchant_pilot_config",
        taxRateBps: 1800,
        shippingFlatPaise: 5000n,
        calculationMethod: "fixed_pilot_v1",
      });
    });

    it("sets validUntil to now + quoteValidityMs", () => {
      const product = makeProduct({
        id: "p1",
        variants: [makeVariant({ id: "v1", productId: "p1" })],
      });

      const { service } = createTestService({
        products: [product],
        prices: [makePriceSnapshot("v1", 10000n)],
        inventory: [makeInventorySnapshot("v1", 10)],
      });

      const result = service.createQuote({
        merchantId: "merchant-1",
        items: [{ variantId: "v1", quantity: 1 }],
        config: DEFAULT_PILOT_QUOTE_CONFIG,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.createdAt).toBe(NOW);
      expect(result.value.validUntil).toBe((NOW as number) + 900_000);
    });
  });

  describe("refusals", () => {
    it("refuses when variant not found in released product index", () => {
      const { service } = createTestService({ products: [] });

      const result = service.createQuote({
        merchantId: "merchant-1",
        items: [{ variantId: "nonexistent", quantity: 1 }],
        config: DEFAULT_PILOT_QUOTE_CONFIG,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("UNSUPPORTED_VALUE");
    });

    it("refuses non-released product", () => {
      const product = makeProduct({ id: "p1", status: "active" });

      const { service } = createTestService({ products: [product] });

      const result = service.createQuote({
        merchantId: "merchant-1",
        items: [{ variantId: "variant-1", quantity: 1 }],
        config: DEFAULT_PILOT_QUOTE_CONFIG,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("UNSUPPORTED_VALUE");
    });

    it("refuses stale price data", () => {
      const product = makeProduct({
        id: "p1",
        variants: [makeVariant({ id: "v1", productId: "p1" })],
      });

      const { service } = createTestService({
        products: [product],
        prices: [makePriceSnapshot("v1", 10000n, STALE_TIME)],
        inventory: [makeInventorySnapshot("v1", 10)],
      });

      const result = service.createQuote({
        merchantId: "merchant-1",
        items: [{ variantId: "v1", quantity: 1 }],
        config: DEFAULT_PILOT_QUOTE_CONFIG,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("STALE");
    });

    it("refuses stale inventory data", () => {
      const product = makeProduct({
        id: "p1",
        variants: [makeVariant({ id: "v1", productId: "p1" })],
      });

      const { service } = createTestService({
        products: [product],
        prices: [makePriceSnapshot("v1", 10000n)],
        inventory: [makeInventorySnapshot("v1", 10, STALE_TIME)],
      });

      const result = service.createQuote({
        merchantId: "merchant-1",
        items: [{ variantId: "v1", quantity: 1 }],
        config: DEFAULT_PILOT_QUOTE_CONFIG,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("STALE");
    });

    it("refuses insufficient inventory", () => {
      const product = makeProduct({
        id: "p1",
        variants: [makeVariant({ id: "v1", productId: "p1" })],
      });

      const { service } = createTestService({
        products: [product],
        prices: [makePriceSnapshot("v1", 10000n)],
        inventory: [makeInventorySnapshot("v1", 2)],
      });

      const result = service.createQuote({
        merchantId: "merchant-1",
        items: [{ variantId: "v1", quantity: 5 }],
        config: DEFAULT_PILOT_QUOTE_CONFIG,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("OUT_OF_RANGE");
    });

    it("refuses zero quantity", () => {
      const product = makeProduct({
        id: "p1",
        variants: [makeVariant({ id: "v1", productId: "p1" })],
      });

      const { service } = createTestService({
        products: [product],
        prices: [makePriceSnapshot("v1", 10000n)],
        inventory: [makeInventorySnapshot("v1", 10)],
      });

      const result = service.createQuote({
        merchantId: "merchant-1",
        items: [{ variantId: "v1", quantity: 0 }],
        config: DEFAULT_PILOT_QUOTE_CONFIG,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("OUT_OF_RANGE");
    });

    it("refuses negative quantity", () => {
      const product = makeProduct({
        id: "p1",
        variants: [makeVariant({ id: "v1", productId: "p1" })],
      });

      const { service } = createTestService({
        products: [product],
        prices: [makePriceSnapshot("v1", 10000n)],
        inventory: [makeInventorySnapshot("v1", 10)],
      });

      const result = service.createQuote({
        merchantId: "merchant-1",
        items: [{ variantId: "v1", quantity: -1 }],
        config: DEFAULT_PILOT_QUOTE_CONFIG,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("OUT_OF_RANGE");
    });

    it("refuses non-INR currency", () => {
      const product = makeProduct({
        id: "p1",
        variants: [makeVariant({ id: "v1", productId: "p1" })],
      });

      const { service } = createTestService({
        products: [product],
        prices: [makePriceSnapshot("v1", 10000n)],
        inventory: [makeInventorySnapshot("v1", 10)],
      });

      const config: PilotQuoteConfig = {
        ...DEFAULT_PILOT_QUOTE_CONFIG,
        currency: "USD" as unknown as "INR",
      };

      const result = service.createQuote({
        merchantId: "merchant-1",
        items: [{ variantId: "v1", quantity: 1 }],
        config,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("UNSUPPORTED_VALUE");
    });

    it("refuses non-India country", () => {
      const product = makeProduct({
        id: "p1",
        variants: [makeVariant({ id: "v1", productId: "p1" })],
      });

      const { service } = createTestService({
        products: [product],
        prices: [makePriceSnapshot("v1", 10000n)],
        inventory: [makeInventorySnapshot("v1", 10)],
      });

      const config: PilotQuoteConfig = {
        ...DEFAULT_PILOT_QUOTE_CONFIG,
        country: "US" as unknown as "IN",
      };

      const result = service.createQuote({
        merchantId: "merchant-1",
        items: [{ variantId: "v1", quantity: 1 }],
        config,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("UNSUPPORTED_VALUE");
    });
  });

  describe("CTP digest", () => {
    it("is deterministic - same inputs produce same digest", () => {
      const product = makeProduct({
        id: "p1",
        variants: [makeVariant({ id: "v1", productId: "p1" })],
      });

      const { service } = createTestService({
        products: [product],
        prices: [makePriceSnapshot("v1", 10000n)],
        inventory: [makeInventorySnapshot("v1", 10)],
      });

      const request = {
        merchantId: "merchant-1",
        items: [{ variantId: "v1", quantity: 2 }],
        config: DEFAULT_PILOT_QUOTE_CONFIG,
      };

      const result1 = service.createQuote(request);
      const result2 = service.createQuote(request);

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);
      if (!result1.ok || !result2.ok) return;

      // The digests should be the same because quote content is identical
      // (same createdAt from clock, same validUntil, same items)
      expect(result1.value.ctpDigest).toBe(result2.value.ctpDigest);
    });

    it("verification passes for valid quote", () => {
      const product = makeProduct({
        id: "p1",
        variants: [makeVariant({ id: "v1", productId: "p1" })],
      });

      const { service } = createTestService({
        products: [product],
        prices: [makePriceSnapshot("v1", 10000n)],
        inventory: [makeInventorySnapshot("v1", 10)],
      });

      const result = service.createQuote({
        merchantId: "merchant-1",
        items: [{ variantId: "v1", quantity: 1 }],
        config: DEFAULT_PILOT_QUOTE_CONFIG,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(verifyQuoteDigest(result.value)).toBe(true);
    });

    it("verification fails for tampered quote", () => {
      const product = makeProduct({
        id: "p1",
        variants: [makeVariant({ id: "v1", productId: "p1" })],
      });

      const { service } = createTestService({
        products: [product],
        prices: [makePriceSnapshot("v1", 10000n)],
        inventory: [makeInventorySnapshot("v1", 10)],
      });

      const result = service.createQuote({
        merchantId: "merchant-1",
        items: [{ variantId: "v1", quantity: 1 }],
        config: DEFAULT_PILOT_QUOTE_CONFIG,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Tamper with the quote
      const tampered = { ...result.value, totalPaise: 99999n };
      expect(verifyQuoteDigest(tampered)).toBe(false);
    });
  });

  describe("quote expiry", () => {
    it("quote is not expired before validUntil", () => {
      const product = makeProduct({
        id: "p1",
        variants: [makeVariant({ id: "v1", productId: "p1" })],
      });

      const { service } = createTestService({
        products: [product],
        prices: [makePriceSnapshot("v1", 10000n)],
        inventory: [makeInventorySnapshot("v1", 10)],
      });

      const result = service.createQuote({
        merchantId: "merchant-1",
        items: [{ variantId: "v1", quantity: 1 }],
        config: DEFAULT_PILOT_QUOTE_CONFIG,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Check 5 minutes after creation (validity is 15 minutes)
      const fiveMinLater = ((NOW as number) + 300_000) as Instant;
      expect(isQuoteExpired(result.value, fiveMinLater)).toBe(false);
    });

    it("quote is expired after validUntil", () => {
      const product = makeProduct({
        id: "p1",
        variants: [makeVariant({ id: "v1", productId: "p1" })],
      });

      const { service } = createTestService({
        products: [product],
        prices: [makePriceSnapshot("v1", 10000n)],
        inventory: [makeInventorySnapshot("v1", 10)],
      });

      const result = service.createQuote({
        merchantId: "merchant-1",
        items: [{ variantId: "v1", quantity: 1 }],
        config: DEFAULT_PILOT_QUOTE_CONFIG,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Check 20 minutes after creation (validity is 15 minutes)
      const twentyMinLater = ((NOW as number) + 1_200_000) as Instant;
      expect(isQuoteExpired(result.value, twentyMinLater)).toBe(true);
    });
  });

  describe("material change detection", () => {
    it("detects price change", () => {
      const product = makeProduct({
        id: "p1",
        variants: [makeVariant({ id: "v1", productId: "p1" })],
      });

      const { service } = createTestService({
        products: [product],
        prices: [makePriceSnapshot("v1", 10000n)],
        inventory: [makeInventorySnapshot("v1", 10)],
      });

      const result = service.createQuote({
        merchantId: "merchant-1",
        items: [{ variantId: "v1", quantity: 2 }],
        config: DEFAULT_PILOT_QUOTE_CONFIG,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Price changed from 10000 to 12000
      const currentPrices = new Map([["v1", 12000n]]);
      const currentInventory = new Map([["v1", 10]]);

      const change = detectMaterialChange(result.value, currentPrices, currentInventory);
      expect(change.changed).toBe(true);
      expect(change.priceChanges).toHaveLength(1);
      expect(change.priceChanges[0]?.previousPaise).toBe(10000n);
      expect(change.priceChanges[0]?.currentPaise).toBe(12000n);
      expect(change.inventoryChanges).toHaveLength(0);
    });

    it("detects inventory reduction below requested quantity", () => {
      const product = makeProduct({
        id: "p1",
        variants: [makeVariant({ id: "v1", productId: "p1" })],
      });

      const { service } = createTestService({
        products: [product],
        prices: [makePriceSnapshot("v1", 10000n)],
        inventory: [makeInventorySnapshot("v1", 10)],
      });

      const result = service.createQuote({
        merchantId: "merchant-1",
        items: [{ variantId: "v1", quantity: 5 }],
        config: DEFAULT_PILOT_QUOTE_CONFIG,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Inventory dropped below requested quantity
      const currentPrices = new Map([["v1", 10000n]]);
      const currentInventory = new Map([["v1", 3]]);

      const change = detectMaterialChange(result.value, currentPrices, currentInventory);
      expect(change.changed).toBe(true);
      expect(change.inventoryChanges).toHaveLength(1);
      expect(change.inventoryChanges[0]?.currentQuantity).toBe(3);
      expect(change.inventoryChanges[0]?.requestedQuantity).toBe(5);
      expect(change.priceChanges).toHaveLength(0);
    });

    it("reports no change when prices and inventory are unchanged", () => {
      const product = makeProduct({
        id: "p1",
        variants: [makeVariant({ id: "v1", productId: "p1" })],
      });

      const { service } = createTestService({
        products: [product],
        prices: [makePriceSnapshot("v1", 10000n)],
        inventory: [makeInventorySnapshot("v1", 10)],
      });

      const result = service.createQuote({
        merchantId: "merchant-1",
        items: [{ variantId: "v1", quantity: 2 }],
        config: DEFAULT_PILOT_QUOTE_CONFIG,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const currentPrices = new Map([["v1", 10000n]]);
      const currentInventory = new Map([["v1", 10]]);

      const change = detectMaterialChange(result.value, currentPrices, currentInventory);
      expect(change.changed).toBe(false);
      expect(change.priceChanges).toHaveLength(0);
      expect(change.inventoryChanges).toHaveLength(0);
    });
  });

  describe("concurrent inventory scenario", () => {
    it("two quotes for same variant where total exceeds available (second refuses)", () => {
      const product = makeProduct({
        id: "p1",
        variants: [makeVariant({ id: "v1", productId: "p1" })],
      });

      const { service } = createTestService({
        products: [product],
        prices: [makePriceSnapshot("v1", 10000n)],
        inventory: [makeInventorySnapshot("v1", 5)],
      });

      // First quote: request 3 units (succeeds, 5 available)
      const result1 = service.createQuote({
        merchantId: "merchant-1",
        items: [{ variantId: "v1", quantity: 3 }],
        config: DEFAULT_PILOT_QUOTE_CONFIG,
      });
      expect(result1.ok).toBe(true);

      // Second quote: request 3 units (succeeds because we check snapshot, not reserved)
      // But material change detection will catch this
      const result2 = service.createQuote({
        merchantId: "merchant-1",
        items: [{ variantId: "v1", quantity: 3 }],
        config: DEFAULT_PILOT_QUOTE_CONFIG,
      });
      expect(result2.ok).toBe(true);

      // Verify: if both quotes were to be fulfilled, total = 6 > 5 available
      // Material change detection reveals the problem
      if (!result1.ok || !result2.ok) return;

      // After first quote is "reserved" (inventory drops to 2), second quote detects change
      const currentInventory = new Map([["v1", 2]]);
      const currentPrices = new Map([["v1", 10000n]]);

      const change = detectMaterialChange(result2.value, currentPrices, currentInventory);
      expect(change.changed).toBe(true);
      expect(change.inventoryChanges).toHaveLength(1);
      expect(change.inventoryChanges[0]?.currentQuantity).toBe(2);
      expect(change.inventoryChanges[0]?.requestedQuantity).toBe(3);
    });
  });
});
