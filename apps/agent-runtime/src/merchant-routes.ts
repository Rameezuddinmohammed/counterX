/**
 * Merchant runtime routes plugin for Fastify.
 *
 * Registers all merchant-facing runtime routes with CTP authority
 * verification, correlation tracking, idempotency enforcement, and
 * safe error responses that never leak unauthorized existence.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  getCorrelationId,
  getIdempotencyKey,
  registerRoutePermission,
} from "@counter/http-api-kit";
import type { MerchantHandlers, HandlerContext, HandlerError } from "./merchant-handlers.js";

// ---------------------------------------------------------------------------
// Route Permission Registration
// ---------------------------------------------------------------------------

const MERCHANT_PERMISSION = "identity.scope.read" as const;
const ROUTE_PREFIX = "/runtime/v1/merchants/:merchantId";

const ROUTES_TO_REGISTER = [
  `GET:${ROUTE_PREFIX}/capabilities`,
  `POST:${ROUTE_PREFIX}/search`,
  `GET:${ROUTE_PREFIX}/products/:variantId`,
  `POST:${ROUTE_PREFIX}/quotes`,
  `POST:${ROUTE_PREFIX}/transactions`,
  `GET:${ROUTE_PREFIX}/transactions/:transactionId`,
  `POST:${ROUTE_PREFIX}/transactions/:transactionId/payment-result`,
  `POST:${ROUTE_PREFIX}/transactions/:transactionId/cancel`,
  `POST:${ROUTE_PREFIX}/transactions/:transactionId/refund`,
  `GET:${ROUTE_PREFIX}/transactions/:transactionId/receipt`,
] as const;

// ---------------------------------------------------------------------------
// Helper: Build HandlerContext from request
// ---------------------------------------------------------------------------

function buildContext(request: FastifyRequest): HandlerContext {
  const params = request.params as Record<string, string>;
  const correlationId = getCorrelationId(request);
  const idempotencyKey = getIdempotencyKey(request);
  const versionHeader = request.headers["if-match"];
  const version = typeof versionHeader === "string" ? versionHeader : undefined;

  return Object.freeze({
    merchantId: params["merchantId"] ?? "",
    correlationId,
    idempotencyKey,
    version,
  });
}

// ---------------------------------------------------------------------------
// Helper: Map handler errors to HTTP responses
// ---------------------------------------------------------------------------

function sendHandlerError(reply: FastifyReply, error: HandlerError, correlationId: string): void {
  switch (error.kind) {
    case "review_required":
      void reply.status(202).send({
        status: "review_required",
        reviewId: error.reviewId,
        reason: error.reason,
        blockingRuleIds: error.blockingRuleIds,
        correlationId,
      });
      break;
    case "stale":
      void reply.status(409).send({
        error: {
          code: "STALE",
          message: "The request is based on stale state",
          details: {
            currentVersion: error.currentVersion,
            requestedVersion: error.requestedVersion,
          },
        },
      });
      break;
    case "indeterminate":
      void reply.status(502).send({
        error: {
          code: "INDETERMINATE",
          message: "The operation outcome is not yet authoritative",
          details: {
            correlationId: error.correlationId,
            retry: "query_before_retry",
          },
        },
      });
      break;
  }
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function validateBody(body: unknown, requiredFields: readonly string[]): string | undefined {
  if (body === null || body === undefined || typeof body !== "object") {
    return "Request body is required";
  }
  const obj = body as Record<string, unknown>;
  for (const field of requiredFields) {
    if (obj[field] === undefined || obj[field] === null || obj[field] === "") {
      return `Field '${field}' is required`;
    }
  }
  return undefined;
}

function sendValidationError(reply: FastifyReply, message: string, field?: string): void {
  void reply.status(400).send({
    error: {
      code: "INVALID_FORMAT",
      message,
      ...(field !== undefined ? { details: { field } } : {}),
    },
  });
}

// ---------------------------------------------------------------------------
// Plugin: Merchant Routes
// ---------------------------------------------------------------------------

export interface MerchantRoutesOptions {
  readonly handlers: MerchantHandlers;
}

export async function merchantRoutesPlugin(
  fastify: FastifyInstance,
  options: MerchantRoutesOptions,
): Promise<void> {
  const { handlers } = options;

  // Register permissions for all routes
  for (const routeKey of ROUTES_TO_REGISTER) {
    registerRoutePermission(routeKey, { permission: MERCHANT_PERMISSION });
  }

  // --- Capability Route ---
  fastify.get(`${ROUTE_PREFIX}/capabilities`, async (request: FastifyRequest, reply: FastifyReply) => {
    const ctx = buildContext(request);
    const result = await handlers.capability.handle(ctx);
    if (!result.ok) {
      sendHandlerError(reply, result.error, ctx.correlationId);
      return;
    }
    void reply.send(result.value);
  });

  // --- Search Route ---
  fastify.post(`${ROUTE_PREFIX}/search`, async (request: FastifyRequest, reply: FastifyReply) => {
    const ctx = buildContext(request);
    const body = request.body as Record<string, unknown> | undefined;
    const validationError = validateBody(body, ["query"]);
    if (validationError !== undefined) {
      sendValidationError(reply, validationError, "query");
      return;
    }
    const typedBody = body as { query: string; filters?: Record<string, unknown>; pagination?: { limit: number; cursor?: string } };
    const result = await handlers.search.handle(ctx, {
      query: typedBody.query,
      filters: typedBody.filters,
      pagination: typedBody.pagination,
    });
    if (!result.ok) {
      sendHandlerError(reply, result.error, ctx.correlationId);
      return;
    }
    void reply.send(result.value);
  });

  // --- Product Route ---
  fastify.get(`${ROUTE_PREFIX}/products/:variantId`, async (request: FastifyRequest, reply: FastifyReply) => {
    const ctx = buildContext(request);
    const params = request.params as Record<string, string>;
    const variantId = params["variantId"] ?? "";
    if (variantId === "") {
      sendValidationError(reply, "variantId is required", "variantId");
      return;
    }
    const result = await handlers.product.handle(ctx, variantId);
    if (!result.ok) {
      sendHandlerError(reply, result.error, ctx.correlationId);
      return;
    }
    void reply.send(result.value);
  });

  // --- Quote Route ---
  fastify.post(`${ROUTE_PREFIX}/quotes`, async (request: FastifyRequest, reply: FastifyReply) => {
    const ctx = buildContext(request);
    const body = request.body as Record<string, unknown> | undefined;
    const validationError = validateBody(body, ["variantId", "quantity", "currency"]);
    if (validationError !== undefined) {
      const field = ["variantId", "quantity", "currency"].find((f) => {
        const obj = (body ?? {}) as Record<string, unknown>;
        return obj[f] === undefined || obj[f] === null || obj[f] === "";
      });
      sendValidationError(reply, validationError, field);
      return;
    }
    const typedBody = body as { variantId: string; quantity: number; currency: string };
    if (typeof typedBody.quantity !== "number" || typedBody.quantity <= 0) {
      sendValidationError(reply, "quantity must be a positive number", "quantity");
      return;
    }
    const result = await handlers.quote.handle(ctx, {
      variantId: typedBody.variantId,
      quantity: typedBody.quantity,
      currency: typedBody.currency,
    });
    if (!result.ok) {
      sendHandlerError(reply, result.error, ctx.correlationId);
      return;
    }
    void reply.send(result.value);
  });

  // --- Transaction Create Route ---
  fastify.post(`${ROUTE_PREFIX}/transactions`, async (request: FastifyRequest, reply: FastifyReply) => {
    const ctx = buildContext(request);
    const body = request.body as Record<string, unknown> | undefined;
    const validationError = validateBody(body, ["quoteId", "paymentMethod"]);
    if (validationError !== undefined) {
      const field = ["quoteId", "paymentMethod"].find((f) => {
        const obj = (body ?? {}) as Record<string, unknown>;
        return obj[f] === undefined || obj[f] === null || obj[f] === "";
      });
      sendValidationError(reply, validationError, field);
      return;
    }
    const typedBody = body as { quoteId: string; paymentMethod: string; billingAddress?: { line1: string; city: string; region?: string; postalCode: string; country: string } };
    const result = await handlers.transactionCreate.handle(ctx, {
      quoteId: typedBody.quoteId,
      paymentMethod: typedBody.paymentMethod,
      billingAddress: typedBody.billingAddress,
    });
    if (!result.ok) {
      sendHandlerError(reply, result.error, ctx.correlationId);
      return;
    }
    void reply.send(result.value);
  });

  // --- Transaction Status Route ---
  fastify.get(`${ROUTE_PREFIX}/transactions/:transactionId`, async (request: FastifyRequest, reply: FastifyReply) => {
    const ctx = buildContext(request);
    const params = request.params as Record<string, string>;
    const transactionId = params["transactionId"] ?? "";
    if (transactionId === "") {
      sendValidationError(reply, "transactionId is required", "transactionId");
      return;
    }
    const result = await handlers.transactionStatus.handle(ctx, transactionId);
    if (!result.ok) {
      sendHandlerError(reply, result.error, ctx.correlationId);
      return;
    }
    void reply.send(result.value);
  });

  // --- Payment Action Result Route ---
  fastify.post(`${ROUTE_PREFIX}/transactions/:transactionId/payment-result`, async (request: FastifyRequest, reply: FastifyReply) => {
    const ctx = buildContext(request);
    const params = request.params as Record<string, string>;
    const transactionId = params["transactionId"] ?? "";
    const body = request.body as Record<string, unknown> | undefined;
    const validationError = validateBody(body, ["providerReference", "outcome"]);
    if (validationError !== undefined) {
      const field = ["providerReference", "outcome"].find((f) => {
        const obj = (body ?? {}) as Record<string, unknown>;
        return obj[f] === undefined || obj[f] === null || obj[f] === "";
      });
      sendValidationError(reply, validationError, field);
      return;
    }
    const typedBody = body as { providerReference: string; outcome: "success" | "failure" | "pending"; providerMetadata?: Record<string, unknown> };
    const validOutcomes = ["success", "failure", "pending"];
    if (!validOutcomes.includes(typedBody.outcome)) {
      sendValidationError(reply, "outcome must be 'success', 'failure', or 'pending'", "outcome");
      return;
    }
    const result = await handlers.paymentActionResult.handle(ctx, transactionId, {
      providerReference: typedBody.providerReference,
      outcome: typedBody.outcome,
      providerMetadata: typedBody.providerMetadata,
    });
    if (!result.ok) {
      sendHandlerError(reply, result.error, ctx.correlationId);
      return;
    }
    void reply.send(result.value);
  });

  // --- Cancel Route ---
  fastify.post(`${ROUTE_PREFIX}/transactions/:transactionId/cancel`, async (request: FastifyRequest, reply: FastifyReply) => {
    const ctx = buildContext(request);
    const params = request.params as Record<string, string>;
    const transactionId = params["transactionId"] ?? "";
    const body = request.body as Record<string, unknown> | undefined;
    const validationError = validateBody(body, ["reason"]);
    if (validationError !== undefined) {
      sendValidationError(reply, validationError, "reason");
      return;
    }
    const typedBody = body as { reason: string };
    const result = await handlers.cancel.handle(ctx, transactionId, {
      reason: typedBody.reason,
    });
    if (!result.ok) {
      sendHandlerError(reply, result.error, ctx.correlationId);
      return;
    }
    void reply.send(result.value);
  });

  // --- Refund Route ---
  fastify.post(`${ROUTE_PREFIX}/transactions/:transactionId/refund`, async (request: FastifyRequest, reply: FastifyReply) => {
    const ctx = buildContext(request);
    const params = request.params as Record<string, string>;
    const transactionId = params["transactionId"] ?? "";
    const body = request.body as Record<string, unknown> | undefined;
    const validationError = validateBody(body, ["reason"]);
    if (validationError !== undefined) {
      sendValidationError(reply, validationError, "reason");
      return;
    }
    const typedBody = body as { reason: string };
    const result = await handlers.refund.handle(ctx, transactionId, {
      reason: typedBody.reason,
    });
    if (!result.ok) {
      sendHandlerError(reply, result.error, ctx.correlationId);
      return;
    }
    void reply.send(result.value);
  });

  // --- Receipt Route ---
  fastify.get(`${ROUTE_PREFIX}/transactions/:transactionId/receipt`, async (request: FastifyRequest, reply: FastifyReply) => {
    const ctx = buildContext(request);
    const params = request.params as Record<string, string>;
    const transactionId = params["transactionId"] ?? "";
    if (transactionId === "") {
      sendValidationError(reply, "transactionId is required", "transactionId");
      return;
    }
    const result = await handlers.receipt.handle(ctx, transactionId);
    if (!result.ok) {
      sendHandlerError(reply, result.error, ctx.correlationId);
      return;
    }
    void reply.send(result.value);
  });
}
