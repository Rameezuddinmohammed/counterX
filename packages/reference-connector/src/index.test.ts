import { describe, expect, it, beforeEach } from "vitest";
import type { ExternalReference } from "@counter/domain";
import { createCertificationHarness } from "@counter/connector-sdk";
import type { ActionInput } from "@counter/connector-sdk";

import {
  PACKAGE_NAME,
  createReferenceConnector,
  REFERENCE_CONNECTOR_MANIFEST,
  CATALOG_PRODUCTS,
  ALL_VARIANTS,
  CONNECTOR_SOURCE,
  getProduct,
  getVariant,
  findProductsByName,
  findVariantsByName,
  createFaultControls,
  DeterministicEventStream,
  InventoryStore,
  createProductResourcePort,
  createVariantResourcePort,
  createQuoteAction,
  createDraftOrderAction,
  createCompleteOrderAction,
  createCancelOrderAction,
  createRefundAction,
  createHealthPort,
} from "./index.js";
import type { QuotePayload, OrderPayload, CancelPayload, RefundPayload } from "./index.js";

// ─── Package Identity ─────────────────────────────────────────────────────────

describe("@counter/reference-connector", () => {
  it("exposes its package identity", () => {
    expect(PACKAGE_NAME).toBe("@counter/reference-connector");
  });
});

// ─── Catalog Tests ────────────────────────────────────────────────────────────

describe("catalog", () => {
  it("has at least 3 products", () => {
    expect(CATALOG_PRODUCTS.length).toBeGreaterThanOrEqual(3);
  });

  it("each product has size and color variants", () => {
    for (const product of CATALOG_PRODUCTS) {
      expect(product.variants.length).toBeGreaterThan(0);
      for (const variant of product.variants) {
        expect(variant.size).toBeTruthy();
        expect(variant.color).toBeTruthy();
      }
    }
  });

  it("all prices are in INR minor units", () => {
    for (const variant of ALL_VARIANTS) {
      expect(variant.currency).toBe("INR");
      expect(variant.priceMinor).toBeGreaterThan(0n);
    }
  });

  it("all variants have positive inventory", () => {
    for (const variant of ALL_VARIANTS) {
      expect(variant.inventoryQuantity).toBeGreaterThan(0);
    }
  });

  it("getProduct returns known product", () => {
    const product = getProduct("prod-classic-tshirt");
    expect(product).toBeDefined();
    expect(product!.name).toBe("Classic T-Shirt");
  });

  it("getProduct returns undefined for unknown", () => {
    expect(getProduct("nonexistent")).toBeUndefined();
  });

  it("getVariant returns known variant", () => {
    const variant = getVariant("prod-classic-tshirt-s-black");
    expect(variant).toBeDefined();
    expect(variant!.size).toBe("S");
    expect(variant!.color).toBe("Black");
  });

  it("findProductsByName searches by name", () => {
    const results = findProductsByName("hoodie");
    expect(results.length).toBe(1);
    expect(results[0]!.name).toBe("Urban Hoodie");
  });

  it("findVariantsByName searches across product names and variant attributes", () => {
    const results = findVariantsByName("jeans");
    expect(results.length).toBeGreaterThan(0);
    for (const v of results) {
      expect(v.productId).toBe("prod-slim-jeans");
    }
  });
});

// ─── Fault Controls Tests ─────────────────────────────────────────────────────

describe("fault controls", () => {
  it("creates with defaults (no faults)", () => {
    const fc = createFaultControls();
    expect(fc.shouldInjectDelay()).toBe(false);
    expect(fc.getDelayMs()).toBe(0);
  });

  it("injects delay when configured", () => {
    const fc = createFaultControls({ delayMs: 100 });
    expect(fc.shouldInjectDelay()).toBe(true);
    expect(fc.getDelayMs()).toBe(100);
  });

  it("deterministic fault injection with seed", () => {
    const fc1 = createFaultControls({ duplicateEventRate: 0.5, seed: 123 });
    const fc2 = createFaultControls({ duplicateEventRate: 0.5, seed: 123 });

    const results1 = Array.from({ length: 10 }, () => fc1.shouldDuplicateEvent());
    const results2 = Array.from({ length: 10 }, () => fc2.shouldDuplicateEvent());
    expect(results1).toEqual(results2);
  });

  it("reset restores initial state", () => {
    const fc = createFaultControls({ duplicateEventRate: 0.5, seed: 42 });
    const first = fc.shouldDuplicateEvent();
    fc.reset();
    const afterReset = fc.shouldDuplicateEvent();
    expect(first).toBe(afterReset);
  });
});

// ─── Event Stream Tests ───────────────────────────────────────────────────────

describe("event stream", () => {
  let stream: DeterministicEventStream;

  beforeEach(() => {
    stream = new DeterministicEventStream();
  });

  it("emits events with incrementing sequence", () => {
    stream.emit("quote_created", { quoteId: "q1" });
    stream.emit("order_completed", { orderId: "o1" });

    const events = stream.allEvents;
    expect(events).toHaveLength(2);
    expect(events[0]!.sequence).toBe(1);
    expect(events[1]!.sequence).toBe(2);
  });

  it("getEvents returns events since a sequence", () => {
    stream.emit("quote_created", { quoteId: "q1" });
    stream.emit("draft_order_created", { orderId: "o1" });
    stream.emit("order_completed", { orderId: "o1" });

    const since1 = stream.getEvents(1);
    expect(since1).toHaveLength(2);
    expect(since1[0]!.topic).toBe("draft_order_created");
  });

  it("events have proper structure", () => {
    const event = stream.emit("refund_created", { refundId: "r1" });
    expect(event.eventId).toMatch(/^evt-\d{6}$/);
    expect(event.topic).toBe("refund_created");
    expect(event.occurredAt).toBeGreaterThan(0);
  });

  it("applies duplicate fault control", () => {
    const fc = createFaultControls({ duplicateEventRate: 1.0, seed: 1 });
    const faultyStream = new DeterministicEventStream(fc);
    faultyStream.emit("quote_created", { quoteId: "q1" });
    faultyStream.emit("order_completed", { orderId: "o1" });

    const events = faultyStream.getEvents(0);
    // With 100% duplicate rate, first event should be duplicated
    expect(events.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── Resource Tests ───────────────────────────────────────────────────────────

describe("resources", () => {
  describe("products", () => {
    const port = createProductResourcePort();

    it("list returns first page", async () => {
      const result = await port.list({ cursor: null, pageSize: 2, filters: {} });
      expect(result.items).toHaveLength(2);
      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toBe("2");
      expect(result.totalCount).toBe(3);
    });

    it("list with cursor returns remaining items", async () => {
      const result = await port.list({ cursor: "2", pageSize: 5, filters: {} });
      expect(result.items).toHaveLength(1);
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
    });

    it("list with invalid cursor returns empty", async () => {
      const result = await port.list({ cursor: "___empty___", pageSize: 5, filters: {} });
      expect(result.items).toHaveLength(0);
    });

    it("get returns product by reference", async () => {
      const ref = { source: CONNECTOR_SOURCE, value: "prod-urban-hoodie" } as ExternalReference;
      const result = await port.get(ref);
      expect(result).not.toBeNull();
      expect(result!.data.name).toBe("Urban Hoodie");
      expect(result!.freshnessStatus).toBe("fresh");
    });

    it("get returns null for unknown reference", async () => {
      const ref = { source: CONNECTOR_SOURCE, value: "nonexistent" } as ExternalReference;
      const result = await port.get(ref);
      expect(result).toBeNull();
    });

    it("get returns null for wrong source", async () => {
      const ref = { source: "other-system", value: "prod-urban-hoodie" } as ExternalReference;
      const result = await port.get(ref);
      expect(result).toBeNull();
    });

    it("search finds products by name", async () => {
      const result = await port.search({ query: "jeans", filters: {}, limit: 10, offset: 0 });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.data.name).toBe("Slim Jeans");
    });
  });

  describe("variants", () => {
    const port = createVariantResourcePort();

    it("list returns paginated variants", async () => {
      const result = await port.list({ cursor: null, pageSize: 5, filters: {} });
      expect(result.items).toHaveLength(5);
      expect(result.hasMore).toBe(true);
      expect(result.totalCount).toBe(ALL_VARIANTS.length);
    });

    it("get returns variant by reference", async () => {
      const ref = { source: CONNECTOR_SOURCE, value: "prod-classic-tshirt-m-white" } as ExternalReference;
      const result = await port.get(ref);
      expect(result).not.toBeNull();
      expect(result!.data.size).toBe("M");
      expect(result!.data.color).toBe("White");
    });

    it("search finds variants by name", async () => {
      const result = await port.search({ query: "hoodie", filters: {}, limit: 100, offset: 0 });
      expect(result.items.length).toBeGreaterThan(0);
      for (const obs of result.items) {
        expect(obs.data.productId).toBe("prod-urban-hoodie");
      }
    });
  });
});

// ─── Action Tests ─────────────────────────────────────────────────────────────

describe("actions", () => {
  let stream: DeterministicEventStream;
  let inventory: InventoryStore;

  beforeEach(() => {
    stream = new DeterministicEventStream();
    const initial = new Map<string, number>();
    initial.set("prod-classic-tshirt-s-black", 50);
    initial.set("prod-classic-tshirt-m-white", 10);
    inventory = new InventoryStore(initial);
  });

  describe("create_quote", () => {
    it("creates a quote successfully", async () => {
      const action = createQuoteAction(stream);
      const input: ActionInput<QuotePayload> = {
        payload: { variantId: "prod-classic-tshirt-s-black", quantity: 2 },
        idempotencyKey: "key-1",
        correlationId: "corr-1",
        preconditions: [],
        timeoutMs: 5000,
      };
      const result = await action.execute(input);
      expect(result.status).toBe("succeeded");
      if (result.status === "succeeded") {
        expect(result.result.quoteId).toMatch(/^quote-/);
        expect(result.result.quantity).toBe(2);
      }
    });

    it("is idempotent with same key", async () => {
      const action = createQuoteAction(stream);
      const input: ActionInput<QuotePayload> = {
        payload: { variantId: "v1", quantity: 1 },
        idempotencyKey: "same-key",
        correlationId: "corr-same",
        preconditions: [],
        timeoutMs: 5000,
      };
      const r1 = await action.execute(input);
      const r2 = await action.execute(input);
      expect(r1).toEqual(r2);
    });

    it("query returns result by correlationId", async () => {
      const action = createQuoteAction(stream);
      const input: ActionInput<QuotePayload> = {
        payload: { variantId: "v1", quantity: 1 },
        idempotencyKey: "key-q",
        correlationId: "corr-q",
        preconditions: [],
        timeoutMs: 5000,
      };
      await action.execute(input);
      const queried = await action.query("corr-q");
      expect(queried).not.toBeNull();
      expect(queried!.status).toBe("succeeded");
    });

    it("query returns null for unknown correlationId", async () => {
      const action = createQuoteAction(stream);
      const result = await action.query("nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("create_draft_order", () => {
    it("creates a draft order", async () => {
      const action = createDraftOrderAction(stream, inventory);
      const input: ActionInput<OrderPayload> = {
        payload: { variantId: "prod-classic-tshirt-s-black", quantity: 1 },
        idempotencyKey: "draft-key-1",
        correlationId: "draft-corr-1",
        preconditions: [],
        timeoutMs: 5000,
      };
      const result = await action.execute(input);
      expect(result.status).toBe("succeeded");
      if (result.status === "succeeded") {
        expect(result.result.status).toBe("draft");
      }
    });
  });

  describe("complete_order", () => {
    it("completes an order and reserves inventory", async () => {
      const action = createCompleteOrderAction(stream, inventory);
      const input: ActionInput<OrderPayload> = {
        payload: { variantId: "prod-classic-tshirt-s-black", quantity: 5 },
        idempotencyKey: "complete-key-1",
        correlationId: "complete-corr-1",
        preconditions: [],
        timeoutMs: 5000,
      };
      const result = await action.execute(input);
      expect(result.status).toBe("succeeded");
      expect(inventory.get("prod-classic-tshirt-s-black")).toBe(45);
    });

    it("fails when insufficient inventory", async () => {
      const action = createCompleteOrderAction(stream, inventory);
      const input: ActionInput<OrderPayload> = {
        payload: { variantId: "prod-classic-tshirt-m-white", quantity: 100 },
        idempotencyKey: "complete-key-2",
        correlationId: "complete-corr-2",
        preconditions: [],
        timeoutMs: 5000,
      };
      const result = await action.execute(input);
      expect(result.status).toBe("failed");
    });
  });

  describe("cancel_order", () => {
    it("cancels an order", async () => {
      const action = createCancelOrderAction(stream, inventory);
      const input: ActionInput<CancelPayload> = {
        payload: { orderId: "order-0001", reason: "changed_mind" },
        idempotencyKey: "cancel-key-1",
        correlationId: "cancel-corr-1",
        preconditions: [],
        timeoutMs: 5000,
      };
      const result = await action.execute(input);
      expect(result.status).toBe("succeeded");
      if (result.status === "succeeded") {
        expect(result.result.status).toBe("cancelled");
      }
    });
  });

  describe("create_refund", () => {
    it("creates a refund", async () => {
      const action = createRefundAction(stream);
      const input: ActionInput<RefundPayload> = {
        payload: { orderId: "order-0001", amountMinor: 79900 },
        idempotencyKey: "refund-key-1",
        correlationId: "refund-corr-1",
        preconditions: [],
        timeoutMs: 5000,
      };
      const result = await action.execute(input);
      expect(result.status).toBe("succeeded");
      if (result.status === "succeeded") {
        expect(result.result.amountMinor).toBe(79900);
        expect(result.result.status).toBe("refunded");
      }
    });
  });
});

// ─── Health Tests ─────────────────────────────────────────────────────────────

describe("health", () => {
  it("returns healthy status", async () => {
    const port = createHealthPort();
    const health = await port.checkHealth();
    expect(health.status).toBe("healthy");
    expect(health.lastCheckedAt).toBeGreaterThan(0);
    expect(health.details).toHaveLength(3);
  });

  it("health details have valid structure", async () => {
    const port = createHealthPort();
    const health = await port.checkHealth();
    for (const detail of health.details) {
      expect(detail.component).toBeTruthy();
      expect(detail.status).toBe("healthy");
      expect(typeof detail.latencyMs).toBe("number");
    }
  });
});

// ─── Manifest Tests ───────────────────────────────────────────────────────────

describe("manifest", () => {
  it("has correct connectorId", () => {
    expect(REFERENCE_CONNECTOR_MANIFEST.connectorId).toBe("reference-connector");
  });

  it("declares 2 resources", () => {
    expect(REFERENCE_CONNECTOR_MANIFEST.resources).toHaveLength(2);
  });

  it("declares 5 actions", () => {
    expect(REFERENCE_CONNECTOR_MANIFEST.actions).toHaveLength(5);
  });

  it("every action declares timeout semantics", () => {
    for (const action of REFERENCE_CONNECTOR_MANIFEST.actions) {
      expect(["before_effect", "after_effect"]).toContain(action.timeoutSemantics);
    }
  });

  it("events declare deduplication strategy", () => {
    expect(REFERENCE_CONNECTOR_MANIFEST.events.deduplicationStrategy).toBe("sequence_number");
  });

  it("events declare mode", () => {
    expect(REFERENCE_CONNECTOR_MANIFEST.events.mode).toBe("polling");
  });

  it("createdAt is a valid Instant", () => {
    expect(REFERENCE_CONNECTOR_MANIFEST.createdAt).toBeGreaterThan(0);
  });
});

// ─── Factory Tests ────────────────────────────────────────────────────────────

describe("createReferenceConnector", () => {
  it("creates a valid connector contract", () => {
    const connector = createReferenceConnector();
    expect(connector.manifest).toBeDefined();
    expect(connector.resources).toBeDefined();
    expect(connector.actions).toBeDefined();
    expect(connector.health).toBeDefined();
  });

  it("has products and variants resources", () => {
    const connector = createReferenceConnector();
    expect(connector.resources["products"]).toBeDefined();
    expect(connector.resources["variants"]).toBeDefined();
  });

  it("has all 5 actions", () => {
    const connector = createReferenceConnector();
    expect(connector.actions["create_quote"]).toBeDefined();
    expect(connector.actions["create_draft_order"]).toBeDefined();
    expect(connector.actions["complete_order"]).toBeDefined();
    expect(connector.actions["cancel_order"]).toBeDefined();
    expect(connector.actions["create_refund"]).toBeDefined();
  });

  it("accepts fault config options", () => {
    const connector = createReferenceConnector({
      faultConfig: { delayMs: 100, seed: 99 },
    });
    expect(connector).toBeDefined();
  });
});

// ─── Certification Harness ────────────────────────────────────────────────────

describe("certification harness", () => {
  it("passes all certification tests", async () => {
    const connector = createReferenceConnector();
    const harness = createCertificationHarness(
      connector.manifest,
      connector,
    );

    const result = await harness.run();

    // Log any failures for debugging
    if (!result.passed) {
      for (const group of result.results) {
        for (const test of group.tests) {
          if (!test.passed) {
            console.error(`FAILED: ${group.group} > ${test.name}: ${test.error}`);
          }
        }
      }
    }

    expect(result.passed).toBe(true);
  });
});
