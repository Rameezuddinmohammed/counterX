import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { APP_NAME } from "./index.js";
import { buildServer } from "./server.js";

describe("@counter/reference-services", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("exposes its app identity", () => {
    expect(APP_NAME).toBe("@counter/reference-services");
  });

  // ─── Health ─────────────────────────────────────────────────────────────────

  describe("GET /health", () => {
    it("returns 200 with valid health structure", async () => {
      const response = await app.inject({ method: "GET", url: "/health" });
      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.status).toBe("healthy");
      expect(body.lastCheckedAt).toBeTypeOf("number");
      expect(body.details).toBeInstanceOf(Array);
      expect(body.details.length).toBeGreaterThan(0);
    });
  });

  // ─── Products ───────────────────────────────────────────────────────────────

  describe("GET /products", () => {
    it("returns product list with pagination", async () => {
      const response = await app.inject({ method: "GET", url: "/products" });
      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.items).toBeInstanceOf(Array);
      expect(body.items.length).toBeGreaterThan(0);
      expect(body.totalCount).toBeTypeOf("number");
      expect(body).toHaveProperty("hasMore");
      expect(body).toHaveProperty("nextCursor");
    });
  });

  describe("GET /products/:id", () => {
    it("returns a specific product", async () => {
      // First get the product list to find a valid ID
      const listResponse = await app.inject({ method: "GET", url: "/products" });
      const list = listResponse.json();
      const firstItem = list.items[0];
      const productId = firstItem.sourceReference.value;

      const response = await app.inject({ method: "GET", url: `/products/${productId}` });
      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.data).toBeDefined();
      expect(body.sourceReference.value).toBe(productId);
    });

    it("returns 404 for unknown product", async () => {
      const response = await app.inject({ method: "GET", url: "/products/unknown-id" });
      expect(response.statusCode).toBe(404);
    });
  });

  describe("GET /products/search", () => {
    it("finds matching products by query", async () => {
      const response = await app.inject({ method: "GET", url: "/products/search?q=shirt" });
      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.items).toBeInstanceOf(Array);
      expect(body).toHaveProperty("totalCount");
    });
  });

  // ─── Variants ───────────────────────────────────────────────────────────────

  describe("GET /variants", () => {
    it("returns variant list", async () => {
      const response = await app.inject({ method: "GET", url: "/variants" });
      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.items).toBeInstanceOf(Array);
      expect(body.items.length).toBeGreaterThan(0);
    });
  });

  describe("GET /variants/:id", () => {
    it("returns a specific variant", async () => {
      const listResponse = await app.inject({ method: "GET", url: "/variants" });
      const list = listResponse.json();
      const firstItem = list.items[0];
      const variantId = firstItem.sourceReference.value;

      const response = await app.inject({ method: "GET", url: `/variants/${variantId}` });
      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.data).toBeDefined();
      expect(body.sourceReference.value).toBe(variantId);
    });
  });

  // ─── Quotes ─────────────────────────────────────────────────────────────────

  describe("POST /quotes", () => {
    it("creates a quote successfully", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/quotes",
        payload: {
          items: [{ variantId: "var-001", quantity: 2 }],
          idempotencyKey: "idem-quote-1",
          correlationId: "corr-quote-1",
        },
      });
      expect(response.statusCode).toBe(201);

      const body = response.json();
      expect(body.status).toBe("succeeded");
      expect(body.result.quoteId).toBeDefined();
      expect(body.result.variantId).toBe("var-001");
      expect(body.result.quantity).toBe(2);
    });
  });

  // ─── Draft Orders ──────────────────────────────────────────────────────────

  describe("POST /draft-orders", () => {
    it("creates a draft order", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/draft-orders",
        payload: {
          quoteId: "quote-0001",
          idempotencyKey: "idem-draft-1",
          correlationId: "corr-draft-1",
        },
      });
      expect(response.statusCode).toBe(201);

      const body = response.json();
      expect(body.status).toBe("succeeded");
      expect(body.result.orderId).toBeDefined();
      expect(body.result.status).toBe("draft");
    });
  });

  // ─── Events ─────────────────────────────────────────────────────────────────

  describe("GET /events", () => {
    it("returns events array", async () => {
      const response = await app.inject({ method: "GET", url: "/events" });
      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.events).toBeInstanceOf(Array);
    });

    it("returns events since a given sequence", async () => {
      const response = await app.inject({ method: "GET", url: "/events?since=0" });
      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.events).toBeInstanceOf(Array);
      // Events were created by the quote and draft-order tests above
      expect(body.events.length).toBeGreaterThan(0);
    });
  });

  // ─── Fault Controls ────────────────────────────────────────────────────────

  describe("POST /fault-controls", () => {
    it("updates fault controls", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/fault-controls",
        payload: {
          delayMs: 100,
          conflictErrorRate: 0.5,
          seed: 99,
        },
      });
      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.status).toBe("updated");
      expect(body.config.delayMs).toBe(100);
      expect(body.config.conflictErrorRate).toBe(0.5);
      expect(body.config.seed).toBe(99);
    });
  });

  // ─── Manifest ──────────────────────────────────────────────────────────────

  describe("GET /manifest", () => {
    it("returns the connector manifest", async () => {
      const response = await app.inject({ method: "GET", url: "/manifest" });
      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.connectorId).toBeDefined();
      expect(body.platform).toBeDefined();
      expect(body.version).toBeDefined();
      expect(body.resources).toBeInstanceOf(Array);
      expect(body.actions).toBeInstanceOf(Array);
    });
  });
});
