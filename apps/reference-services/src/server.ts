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
  OrderRegistry,
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

function buildCompleteOrderPayload(orderId: string | undefined): OrderPayload {
  const payload: Record<string, unknown> = {};
  if (orderId !== undefined) payload["orderId"] = orderId;
  return payload as OrderPayload;
}

function buildDraftOrderPayload(quoteId: string | undefined): OrderPayload {
  const payload: Record<string, unknown> = {};
  if (quoteId !== undefined) payload["quoteId"] = quoteId;
  return payload as OrderPayload;
}

function buildRefundPayload(orderId: string, amountMinor: number | undefined): RefundPayload {
  const payload: Record<string, unknown> = { orderId };
  if (amountMinor !== undefined) payload["amountMinor"] = amountMinor;
  return payload as RefundPayload;
}

/**
 * Returns the appropriate HTTP status code for an action outcome.
 * - succeeded: uses the provided default (201 for creation, 200 otherwise)
 * - failed: 409 Conflict (action was rejected)
 * - indeterminate: 202 Accepted (outcome unknown, caller should poll)
 */
function statusCodeForOutcome(
  outcome: { status: string },
  successCode: number,
): number {
  switch (outcome.status) {
    case "succeeded":
      return successCode;
    case "failed":
      return 409;
    case "indeterminate":
      return 202;
    default:
      return successCode;
  }
}

// ─── Server Factory ───────────────────────────────────────────────────────────

export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: false });

  // Configure BigInt-safe serialization for all replies.
  // NOTE: This performs a double serialize-parse pass (stringify with replacer, then
  // parse back to a plain object for Fastify to re-serialize). This is intentional
  // for a test fixture where correctness matters more than throughput. A production
  // connector would use a custom Fastify serializer instead.
  app.addHook("preSerialization", async (_request, _reply, payload) => {
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
  let orderRegistry = new OrderRegistry();

  let products = createProductResourcePort(faultControls);
  let variants = createVariantResourcePort(faultControls);
  const health = createHealthPort();

  let quoteAction = createQuoteAction(eventStream, faultControls);
  let draftOrderAction = createDraftOrderAction(eventStream, inventory, faultControls);
  let completeOrderAction = createCompleteOrderAction(eventStream, inventory, faultControls, orderRegistry);
  let cancelOrderAction = createCancelOrderAction(eventStream, inventory, faultControls, orderRegistry);
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
    return reply.status(statusCodeForOutcome(result, 201)).send(result);
  });

  // ─── Draft Orders ────────────────────────────────────────────────────────

  app.post("/draft-orders", async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const quoteId = body["quoteId"] as string | undefined;
    const idempotencyKey = (body["idempotencyKey"] as string) ?? crypto.randomUUID();
    const correlationId = (body["correlationId"] as string) ?? crypto.randomUUID();

    const result = await draftOrderAction.execute({
      payload: buildDraftOrderPayload(quoteId),
      idempotencyKey,
      correlationId,
      preconditions: [],
      timeoutMs: 5000,
    });
    return reply.status(statusCodeForOutcome(result, 201)).send(result);
  });

  // ─── Complete Order ──────────────────────────────────────────────────────

  app.post("/orders/:id/complete", async (request, reply) => {
    const params = request.params as Record<string, string>;
    const orderId = params["id"] ?? "";
    const body = request.body as Record<string, unknown>;
    const idempotencyKey = (body["idempotencyKey"] as string) ?? crypto.randomUUID();
    const correlationId = (body["correlationId"] as string) ?? crypto.randomUUID();

    const result = await completeOrderAction.execute({
      payload: buildCompleteOrderPayload(orderId),
      idempotencyKey,
      correlationId,
      preconditions: [],
      timeoutMs: 5000,
    });
    return reply.status(statusCodeForOutcome(result, 200)).send(result);
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
    return reply.status(statusCodeForOutcome(result, 200)).send(result);
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
    return reply.status(statusCodeForOutcome(result, 200)).send(result);
  });

  // ─── Events ──────────────────────────────────────────────────────────────

  app.get("/events", async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const since = parseInt(query["since"] ?? "0", 10);

    const events = eventStream.getEvents(Number.isNaN(since) ? 0 : since);
    return reply.send({ events });
  });

  // ─── Fault Controls ──────────────────────────────────────────────────────

  // NOTE: This endpoint performs a full world-reset, not just a fault config update.
  // It intentionally wipes all idempotency stores, inventory, event history, and
  // sequential counters. This is by design for test isolation: callers use this
  // between test scenarios to get a clean slate. The endpoint name is kept as
  // "fault-controls" for API stability.
  app.post("/fault-controls", async (request, reply) => {
    const body = request.body as Partial<FaultControlsConfig>;

    // Rebuild all connector state with new fault config
    faultControls = createFaultControls(body);
    eventStream = new DeterministicEventStream(faultControls);

    const newInventory = new Map<string, number>();
    for (const variant of ALL_VARIANTS) {
      newInventory.set(variant.variantId, variant.inventoryQuantity);
    }
    inventory = new InventoryStore(newInventory);
    orderRegistry = new OrderRegistry();

    products = createProductResourcePort(faultControls);
    variants = createVariantResourcePort(faultControls);
    quoteAction = createQuoteAction(eventStream, faultControls);
    draftOrderAction = createDraftOrderAction(eventStream, inventory, faultControls);
    completeOrderAction = createCompleteOrderAction(eventStream, inventory, faultControls, orderRegistry);
    cancelOrderAction = createCancelOrderAction(eventStream, inventory, faultControls, orderRegistry);
    refundAction = createRefundAction(eventStream, faultControls);

    return reply.send({ status: "updated", config: faultControls.config });
  });

  // ─── Manifest ────────────────────────────────────────────────────────────

  app.get("/manifest", async (_request, reply) => {
    return reply.send(REFERENCE_CONNECTOR_MANIFEST);
  });

  return app;
}
