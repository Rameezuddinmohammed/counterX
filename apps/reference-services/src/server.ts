/**
 * Fastify server factory for the reference-services app.
 *
 * Wraps the reference connector and exposes REST endpoints for
 * resources, actions, health, events, manifest, and fault controls.
 */

import Fastify from "fastify";
import type { FastifyInstance } from "fastify";

import {
  createFaultControls,
  createProductResourcePort,
  createVariantResourcePort,
  createHealthPort,
  createQuoteAction,
  createDraftOrderAction,
  createCompleteOrderAction,
  createCancelOrderAction,
  createRefundAction,
  InventoryStore,
  DeterministicEventStream,
  ALL_VARIANTS,
  REFERENCE_CONNECTOR_MANIFEST,
} from "@counter/reference-connector";
import type {
  FaultControlsConfig,
  QuotePayload,
  OrderPayload,
  RefundPayload,
} from "@counter/reference-connector";

// ─── BigInt-safe JSON serialization ───────────────────────────────────────────

function bigIntReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") {
    return Number(value);
  }
  return value;
}

function serializeWithBigInt(payload: unknown): string {
  return JSON.stringify(payload, bigIntReplacer);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildQuotePayload(
  items: Array<{ variantId: string; quantity: number }> | undefined,
): QuotePayload {
  const firstItem = items?.[0];
  const payload: Record<string, unknown> = {};
  if (firstItem?.variantId !== undefined) payload["variantId"] = firstItem.variantId;
  if (firstItem?.quantity !== undefined) payload["quantity"] = firstItem.quantity;
  return payload as QuotePayload;
}

function buildOrderPayload(quoteId: string | undefined): OrderPayload {
  const payload: Record<string, unknown> = {};
  if (quoteId !== undefined) payload["quoteId"] = quoteId;
  return payload as OrderPayload;
}

function buildRefundPayload(orderId: string, amountMinor: number | undefined): RefundPayload {
  const payload: Record<string, unknown> = { orderId };
  if (amountMinor !== undefined) payload["amountMinor"] = amountMinor;
  return payload as RefundPayload;
}

// ─── Server Factory ───────────────────────────────────────────────────────────

export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: false });

  // Configure BigInt-safe serialization for all replies
  app.addHook("preSerialization", async (_request, _reply, payload) => {
    // Return the pre-serialized string wrapped in a raw marker
    return JSON.parse(serializeWithBigInt(payload)) as unknown;
  });

  // Build connector internals with accessible references
  let faultControls = createFaultControls();
  let eventStream = new DeterministicEventStream(faultControls);

  const initialInventory = new Map<string, number>();
  for (const variant of ALL_VARIANTS) {
    initialInventory.set(variant.variantId, variant.inventoryQuantity);
  }
  let inventory = new InventoryStore(initialInventory);

  let products = createProductResourcePort(faultControls);
  let variants = createVariantResourcePort(faultControls);
  const health = createHealthPort();

  let quoteAction = createQuoteAction(eventStream, faultControls);
  let draftOrderAction = createDraftOrderAction(eventStream, inventory, faultControls);
  let completeOrderAction = createCompleteOrderAction(eventStream, inventory, faultControls);
  let cancelOrderAction = createCancelOrderAction(eventStream, inventory, faultControls);
  let refundAction = createRefundAction(eventStream, faultControls);

  // ─── Health ───────────────────────────────────────────────────────────────

  app.get("/health", async (_request, reply) => {
    const result = await health.checkHealth();
    return reply.send(result);
  });

  // ─── Products ─────────────────────────────────────────────────────────────

  app.get("/products", async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const cursor = query["cursor"] ?? null;
    const pageSize = parseInt(query["pageSize"] ?? "20", 10);

    const result = await products.list({
      cursor,
      pageSize: Number.isNaN(pageSize) ? 20 : pageSize,
      filters: {},
    });
    return reply.send(result);
  });

  app.get("/products/search", async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const q = query["q"] ?? "";
    const limit = parseInt(query["limit"] ?? "20", 10);
    const offset = parseInt(query["offset"] ?? "0", 10);

    const result = await products.search({
      query: q,
      limit: Number.isNaN(limit) ? 20 : limit,
      offset: Number.isNaN(offset) ? 0 : offset,
      filters: {},
    });
    return reply.send(result);
  });

  app.get("/products/:id", async (request, reply) => {
    const params = request.params as Record<string, string>;
    const id = params["id"] ?? "";

    const result = await products.get({ source: "reference-connector", value: id });
    if (result === null) {
      return reply.status(404).send({ error: "Product not found" });
    }
    return reply.send(result);
  });

  // ─── Variants ─────────────────────────────────────────────────────────────

  app.get("/variants", async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const cursor = query["cursor"] ?? null;
    const pageSize = parseInt(query["pageSize"] ?? "20", 10);

    const result = await variants.list({
      cursor,
      pageSize: Number.isNaN(pageSize) ? 20 : pageSize,
      filters: {},
    });
    return reply.send(result);
  });

  app.get("/variants/:id", async (request, reply) => {
    const params = request.params as Record<string, string>;
    const id = params["id"] ?? "";

    const result = await variants.get({ source: "reference-connector", value: id });
    if (result === null) {
      return reply.status(404).send({ error: "Variant not found" });
    }
    return reply.send(result);
  });

  // ─── Quotes ───────────────────────────────────────────────────────────────

  app.post("/quotes", async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const items = body["items"] as Array<{ variantId: string; quantity: number }> | undefined;
    const idempotencyKey = (body["idempotencyKey"] as string) ?? crypto.randomUUID();
    const correlationId = (body["correlationId"] as string) ?? crypto.randomUUID();

    const result = await quoteAction.execute({
      payload: buildQuotePayload(items),
      idempotencyKey,
      correlationId,
      preconditions: [],
      timeoutMs: 5000,
    });
    return reply.status(201).send(result);
  });

  // ─── Draft Orders ────────────────────────────────────────────────────────

  app.post("/draft-orders", async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const quoteId = body["quoteId"] as string | undefined;
    const idempotencyKey = (body["idempotencyKey"] as string) ?? crypto.randomUUID();
    const correlationId = (body["correlationId"] as string) ?? crypto.randomUUID();

    const result = await draftOrderAction.execute({
      payload: buildOrderPayload(quoteId),
      idempotencyKey,
      correlationId,
      preconditions: [],
      timeoutMs: 5000,
    });
    return reply.status(201).send(result);
  });

  // ─── Complete Order ──────────────────────────────────────────────────────

  app.post("/orders/:id/complete", async (request, reply) => {
    const params = request.params as Record<string, string>;
    const orderId = params["id"] ?? "";
    const body = request.body as Record<string, unknown>;
    const idempotencyKey = (body["idempotencyKey"] as string) ?? crypto.randomUUID();
    const correlationId = (body["correlationId"] as string) ?? crypto.randomUUID();

    const result = await completeOrderAction.execute({
      payload: buildOrderPayload(orderId),
      idempotencyKey,
      correlationId,
      preconditions: [],
      timeoutMs: 5000,
    });
    return reply.send(result);
  });

  // ─── Cancel Order ────────────────────────────────────────────────────────

  app.post("/orders/:id/cancel", async (request, reply) => {
    const params = request.params as Record<string, string>;
    const orderId = params["id"] ?? "";
    const body = request.body as Record<string, unknown>;
    const idempotencyKey = (body["idempotencyKey"] as string) ?? crypto.randomUUID();
    const correlationId = (body["correlationId"] as string) ?? crypto.randomUUID();

    const result = await cancelOrderAction.execute({
      payload: { orderId },
      idempotencyKey,
      correlationId,
      preconditions: [],
      timeoutMs: 5000,
    });
    return reply.send(result);
  });

  // ─── Refund ──────────────────────────────────────────────────────────────

  app.post("/orders/:id/refund", async (request, reply) => {
    const params = request.params as Record<string, string>;
    const orderId = params["id"] ?? "";
    const body = request.body as Record<string, unknown>;
    const idempotencyKey = (body["idempotencyKey"] as string) ?? crypto.randomUUID();
    const correlationId = (body["correlationId"] as string) ?? crypto.randomUUID();
    const amountMinor = body["amountMinor"] as number | undefined;

    const result = await refundAction.execute({
      payload: buildRefundPayload(orderId, amountMinor),
      idempotencyKey,
      correlationId,
      preconditions: [],
      timeoutMs: 5000,
    });
    return reply.send(result);
  });

  // ─── Events ──────────────────────────────────────────────────────────────

  app.get("/events", async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const since = parseInt(query["since"] ?? "0", 10);

    const events = eventStream.getEvents(Number.isNaN(since) ? 0 : since);
    return reply.send({ events });
  });

  // ─── Fault Controls ──────────────────────────────────────────────────────

  app.post("/fault-controls", async (request, reply) => {
    const body = request.body as Partial<FaultControlsConfig>;

    // Rebuild with new fault config
    faultControls = createFaultControls(body);
    eventStream = new DeterministicEventStream(faultControls);

    const newInventory = new Map<string, number>();
    for (const variant of ALL_VARIANTS) {
      newInventory.set(variant.variantId, variant.inventoryQuantity);
    }
    inventory = new InventoryStore(newInventory);

    products = createProductResourcePort(faultControls);
    variants = createVariantResourcePort(faultControls);
    quoteAction = createQuoteAction(eventStream, faultControls);
    draftOrderAction = createDraftOrderAction(eventStream, inventory, faultControls);
    completeOrderAction = createCompleteOrderAction(eventStream, inventory, faultControls);
    cancelOrderAction = createCancelOrderAction(eventStream, inventory, faultControls);
    refundAction = createRefundAction(eventStream, faultControls);

    return reply.send({ status: "updated", config: faultControls.config });
  });

  // ─── Manifest ────────────────────────────────────────────────────────────

  app.get("/manifest", async (_request, reply) => {
    return reply.send(REFERENCE_CONNECTOR_MANIFEST);
  });

  return app;
}
