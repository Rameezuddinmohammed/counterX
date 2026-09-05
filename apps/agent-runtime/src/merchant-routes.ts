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
  getActorContext,
  registerRoutePermission,
} from "@counter/http-api-kit";
import { sha256Digest, type Instant } from "@counter/domain";
import type {
  MerchantHandlers,
  HandlerContext,
  HandlerError,
  TransactionCreateInput,
} from "./merchant-handlers.js";
import type { RuntimeIdempotencyStore } from "./idempotency-store.js";

// ---------------------------------------------------------------------------
// Route Permission Registration
// ---------------------------------------------------------------------------

const MERCHANT_PERMISSION = "identity.scope.read" as const;
const ROUTE_PREFIX = "/runtime/v1/merchants/:merchantId";
const DIRECTORY_ROUTE = "/runtime/v1/merchants";

const ROUTES_TO_REGISTER = [
  `GET:${DIRECTORY_ROUTE}`,
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
  const actorContext = getActorContext(request);
  const callerWalletId =
    actorContext !== undefined && actorContext.scope.kind === "wallet"
      ? actorContext.scope.walletId
      : undefined;

  return Object.freeze({
    merchantId: params["merchantId"] ?? "",
    correlationId,
    idempotencyKey,
    version,
    callerWalletId,
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
    case "not_found":
      // Deliberately identical to a genuinely absent resource — never
      // distinguishes "exists but not yours" from "does not exist".
      void reply.status(404).send({
        error: { code: "NOT_FOUND", message: "The requested resource was not found" },
      });
      break;
    case "unauthorized":
      // A CTP-signed envelope was present but failed verification (bad
      // signature, unknown/revoked key, or didn't match this request).
      // Never echoes the reason's internal detail beyond a stable message.
      reply.log.warn(
        { reason: (error as { reason?: string }).reason },
        "transaction authorization denied",
      );
      void reply.status(401).send({
        error: { code: "UNAUTHORIZED", message: "The signed authorization could not be verified" },
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
// Tenant isolation: verify the authenticated principal owns the merchantId
// ---------------------------------------------------------------------------

function verifyTenantAccess(request: FastifyRequest, merchantId: string): boolean {
  const actorContext = getActorContext(request);
  if (actorContext === undefined) {
    // No actor context means auth did not complete - should not reach here
    return false;
  }
  const scope = actorContext.scope;
  // Platform scope has access to all merchants
  if (scope.kind === "platform") {
    return true;
  }
  // Merchant scope must match the requested merchantId
  if (scope.kind === "merchant") {
    return scope.merchantId === merchantId;
  }
  // Wallet scope: any authenticated buyer wallet may call a merchant's
  // catalog/checkout routes — these routes exist specifically for buyer
  // agents to browse and purchase from merchants they don't own. This is
  // NOT a merchant-data leak: catalog/search/quote/transaction-create never
  // return another buyer's data, and the transaction-specific routes
  // (status/cancel/refund/receipt) separately verify the caller's
  // callerWalletId owns the transaction (see TransactionReadModel.get and
  // its callers) before returning anything — a wallet cannot read or act on
  // another wallet's transaction just by knowing its id. Real spend
  // authority for consequential actions is still enforced independently by
  // the CTP-signed envelope + mandate check in the handlers themselves.
  return scope.kind === "wallet";
}

function sendForbiddenError(reply: FastifyReply): void {
  void reply.status(403).send({
    error: {
      code: "UNAUTHORIZED",
      message: "Access denied for the requested merchant",
    },
  });
}

// ---------------------------------------------------------------------------
// Deterministic serialization for idempotency fingerprints
// ---------------------------------------------------------------------------

/**
 * Serialize a value to a canonical string with object keys sorted recursively,
 * so that two logically equal request bodies always produce the same digest
 * regardless of key ordering. Arrays preserve order (order is significant).
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(",")}}`;
}

// ---------------------------------------------------------------------------
// Plugin: Merchant Routes
// ---------------------------------------------------------------------------

export interface MerchantRoutesOptions {
  readonly handlers: MerchantHandlers;
  /**
   * Optional durable idempotency store. When present, mutating routes carrying
   * an Idempotency-Key are deduplicated through acquire/complete/replay before
   * the handler runs. When absent (local/test with no injection) routes keep
   * their prior handler-level behavior unchanged.
   */
  readonly idempotencyStore?: RuntimeIdempotencyStore | undefined;
}

export async function merchantRoutesPlugin(
  fastify: FastifyInstance,
  options: MerchantRoutesOptions,
): Promise<void> {
  const { handlers, idempotencyStore } = options;

  // Durable idempotency wrapper for mutating routes. When a store is present
  // AND the request carries an Idempotency-Key, we acquire the key (persisting
  // a pending record), run the handler, then complete with the response so a
  // replay returns the identical snapshot. Without a store or a key, `execute`
  // runs directly and behavior is unchanged.
  async function runWithIdempotency(
    ctx: HandlerContext,
    request: FastifyRequest,
    reply: FastifyReply,
    execute: () => Promise<{ readonly handled: boolean; readonly snapshot?: unknown }>,
  ): Promise<void> {
    const key = ctx.idempotencyKey;
    if (idempotencyStore === undefined || key === undefined || key === "") {
      await execute();
      return;
    }

    const now = Date.now() as Instant;
    const method = request.method;
    const path = request.routeOptions?.url ?? request.url;

    // The persisted natural key is namespaced with the merchant + method + path
    // so a client-chosen Idempotency-Key value is scoped PER TENANT and PER
    // OPERATION. The @counter/data store hardcodes a single logical partition
    // (environment='local', scope 'platform', operation 'default'; a documented
    // foundation Task 10 constraint), so `key` is the only variable dimension
    // it persists. Prefixing it here prevents two tenants (or two routes) that
    // happen to choose the same opaque key value from colliding on one row and
    // spuriously denying each other. The raw client key is still carried in the
    // fingerprint below so tamper detection compares like-for-like.
    const storageKey = `${ctx.merchantId}::${method}::${path}::${key}`;

    // The digest is a request FINGERPRINT, not just a key hash. It folds the
    // merchant, the HTTP method + route path, the Idempotency-Key, AND a stable
    // serialization of the request body. The store treats a differing digest
    // for the same (storage) key as `digest_conflict`, so reusing a key with a
    // changed payload is correctly rejected (409) rather than replaying the
    // stale response.
    const fingerprint = stableStringify({
      merchantId: ctx.merchantId,
      method,
      path,
      key,
      body: request.body ?? null,
    });
    const digest = sha256Digest(new TextEncoder().encode(fingerprint));

    const acquireResult = await idempotencyStore.acquire(storageKey, digest, now);
    if (!acquireResult.ok) {
      void reply.status(500).send({
        error: { code: "INTERNAL", message: "Idempotency store failure" },
      });
      return;
    }

    const outcome = acquireResult.value;
    if (outcome.outcome === "replay") {
      void reply.send(outcome.responseSnapshot);
      return;
    }
    if (outcome.outcome === "in_flight") {
      void reply.status(409).send({
        error: { code: "CONFLICT", message: "A request with this Idempotency-Key is in flight" },
      });
      return;
    }
    if (outcome.outcome === "digest_conflict") {
      void reply.status(409).send({
        error: {
          code: "CONFLICT",
          message: "Idempotency-Key was already used with a different request",
        },
      });
      return;
    }

    // outcome === "acquired": run the handler and persist the outcome.
    let result: { readonly handled: boolean; readonly snapshot?: unknown };
    try {
      result = await execute();
    } catch (error) {
      await idempotencyStore.fail(storageKey);
      throw error;
    }

    if (result.handled && result.snapshot !== undefined) {
      await idempotencyStore.complete(storageKey, result.snapshot, now);
    } else {
      // The handler returned an error / non-persistable outcome; release the
      // key so a corrected retry can proceed.
      await idempotencyStore.fail(storageKey);
    }
  }

  // Register permissions for all routes
  for (const routeKey of ROUTES_TO_REGISTER) {
    registerRoutePermission(routeKey, { permission: MERCHANT_PERMISSION });
  }

  // --- Capability Route ---
  fastify.get(
    `${ROUTE_PREFIX}/capabilities`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = buildContext(request);
      if (!verifyTenantAccess(request, ctx.merchantId)) {
        sendForbiddenError(reply);
        return;
      }
      const result = await handlers.capability.handle(ctx);
      if (!result.ok) {
        sendHandlerError(reply, result.error, ctx.correlationId);
        return;
      }
      void reply.send(result.value);
    },
  );

  // --- Search Route ---
  fastify.post(`${ROUTE_PREFIX}/search`, async (request: FastifyRequest, reply: FastifyReply) => {
    const ctx = buildContext(request);
    if (!verifyTenantAccess(request, ctx.merchantId)) {
      sendForbiddenError(reply);
      return;
    }
    const body = request.body as Record<string, unknown> | undefined;
    if (body === null || body === undefined || typeof body !== "object") {
      sendValidationError(reply, "Request body is required", "query");
      return;
    }
    const typedBody = body as {
      query?: string;
      filters?: Record<string, unknown>;
      pagination?: { limit: number; cursor?: string };
    };
    // query is deliberately OPTIONAL here (unlike other required-field
    // routes' use of validateBody): an omitted/empty query means "list the
    // catalog", not "malformed request" — Shopify's product search applies
    // no filter for an empty query string, per searchCatalog -> the
    // underlying PRODUCTS_LIST_QUERY's own `query` filter semantics.
    const result = await handlers.search.handle(ctx, {
      query: typedBody.query ?? "",
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
  fastify.get(
    `${ROUTE_PREFIX}/products/:variantId`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = buildContext(request);
      if (!verifyTenantAccess(request, ctx.merchantId)) {
        sendForbiddenError(reply);
        return;
      }
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
    },
  );

  // --- Quote Route ---
  fastify.post(`${ROUTE_PREFIX}/quotes`, async (request: FastifyRequest, reply: FastifyReply) => {
    const ctx = buildContext(request);
    if (!verifyTenantAccess(request, ctx.merchantId)) {
      sendForbiddenError(reply);
      return;
    }
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
    await runWithIdempotency(ctx, request, reply, async () => {
      const result = await handlers.quote.handle(ctx, {
        variantId: typedBody.variantId,
        quantity: typedBody.quantity,
        currency: typedBody.currency,
      });
      if (!result.ok) {
        sendHandlerError(reply, result.error, ctx.correlationId);
        return { handled: false };
      }
      void reply.send(result.value);
      return { handled: true, snapshot: result.value };
    });
  });

  // --- Transaction Create Route ---
  fastify.post(
    `${ROUTE_PREFIX}/transactions`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = buildContext(request);
      if (!verifyTenantAccess(request, ctx.merchantId)) {
        sendForbiddenError(reply);
        return;
      }
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
      const typedBody = body as {
        quoteId: string;
        paymentMethod: string;
        billingAddress?: {
          line1: string;
          city: string;
          region?: string;
          postalCode: string;
          country: string;
        };
        ctpEnvelope?: unknown;
      };
      await runWithIdempotency(ctx, request, reply, async () => {
        const result = await handlers.transactionCreate.handle(ctx, {
          quoteId: typedBody.quoteId,
          paymentMethod: typedBody.paymentMethod,
          billingAddress: typedBody.billingAddress,
          ctpEnvelope: typedBody.ctpEnvelope as TransactionCreateInput["ctpEnvelope"],
        });
        if (!result.ok) {
          sendHandlerError(reply, result.error, ctx.correlationId);
          return { handled: false };
        }
        void reply.send(result.value);
        return { handled: true, snapshot: result.value };
      });
    },
  );

  // --- Transaction Status Route ---
  fastify.get(
    `${ROUTE_PREFIX}/transactions/:transactionId`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = buildContext(request);
      if (!verifyTenantAccess(request, ctx.merchantId)) {
        sendForbiddenError(reply);
        return;
      }
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
    },
  );

  // --- Payment Action Result Route ---
  fastify.post(
    `${ROUTE_PREFIX}/transactions/:transactionId/payment-result`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = buildContext(request);
      if (!verifyTenantAccess(request, ctx.merchantId)) {
        sendForbiddenError(reply);
        return;
      }
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
      const typedBody = body as {
        providerReference: string;
        outcome: "success" | "failure" | "pending";
        providerMetadata?: Record<string, unknown>;
      };
      const validOutcomes = ["success", "failure", "pending"];
      if (!validOutcomes.includes(typedBody.outcome)) {
        sendValidationError(reply, "outcome must be 'success', 'failure', or 'pending'", "outcome");
        return;
      }
      await runWithIdempotency(ctx, request, reply, async () => {
        const result = await handlers.paymentActionResult.handle(ctx, transactionId, {
          providerReference: typedBody.providerReference,
          outcome: typedBody.outcome,
          providerMetadata: typedBody.providerMetadata,
        });
        if (!result.ok) {
          sendHandlerError(reply, result.error, ctx.correlationId);
          return { handled: false };
        }
        void reply.send(result.value);
        return { handled: true, snapshot: result.value };
      });
    },
  );

  // --- Cancel Route ---
  fastify.post(
    `${ROUTE_PREFIX}/transactions/:transactionId/cancel`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = buildContext(request);
      if (!verifyTenantAccess(request, ctx.merchantId)) {
        sendForbiddenError(reply);
        return;
      }
      const params = request.params as Record<string, string>;
      const transactionId = params["transactionId"] ?? "";
      const body = request.body as Record<string, unknown> | undefined;
      const validationError = validateBody(body, ["reason"]);
      if (validationError !== undefined) {
        sendValidationError(reply, validationError, "reason");
        return;
      }
      const typedBody = body as { reason: string };
      await runWithIdempotency(ctx, request, reply, async () => {
        const result = await handlers.cancel.handle(ctx, transactionId, {
          reason: typedBody.reason,
        });
        if (!result.ok) {
          sendHandlerError(reply, result.error, ctx.correlationId);
          return { handled: false };
        }
        void reply.send(result.value);
        return { handled: true, snapshot: result.value };
      });
    },
  );

  // --- Refund Route ---
  fastify.post(
    `${ROUTE_PREFIX}/transactions/:transactionId/refund`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = buildContext(request);
      if (!verifyTenantAccess(request, ctx.merchantId)) {
        sendForbiddenError(reply);
        return;
      }
      const params = request.params as Record<string, string>;
      const transactionId = params["transactionId"] ?? "";
      const body = request.body as Record<string, unknown> | undefined;
      const validationError = validateBody(body, ["reason"]);
      if (validationError !== undefined) {
        sendValidationError(reply, validationError, "reason");
        return;
      }
      const typedBody = body as { reason: string };
      await runWithIdempotency(ctx, request, reply, async () => {
        const result = await handlers.refund.handle(ctx, transactionId, {
          reason: typedBody.reason,
        });
        if (!result.ok) {
          sendHandlerError(reply, result.error, ctx.correlationId);
          return { handled: false };
        }
        void reply.send(result.value);
        return { handled: true, snapshot: result.value };
      });
    },
  );

  // --- Receipt Route ---
  fastify.get(
    `${ROUTE_PREFIX}/transactions/:transactionId/receipt`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = buildContext(request);
      if (!verifyTenantAccess(request, ctx.merchantId)) {
        sendForbiddenError(reply);
        return;
      }
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
    },
  );

  // --- Directory Route (merchant discovery — NOT scoped to one merchantId) ---
  // Any authenticated actor (wallet/merchant/platform) may list/search the
  // merchant directory: it exists specifically for a buyer agent to find a
  // merchantId before it can call any of the per-merchant routes above, so
  // no tenant check applies here — the same reasoning already covers
  // search/quotes/transaction-create for wallet-scoped callers, see
  // verifyTenantAccess's comment.
  fastify.get(DIRECTORY_ROUTE, async (request: FastifyRequest, reply: FastifyReply) => {
    const correlationId = getCorrelationId(request);
    const queryParams = request.query as Record<string, string | undefined>;
    const rawLimit = queryParams["limit"];
    const parsedLimit = rawLimit !== undefined ? Number.parseInt(rawLimit, 10) : undefined;
    const result = await handlers.directory.handle(
      { correlationId, idempotencyKey: undefined, version: undefined, callerWalletId: undefined },
      {
        query: queryParams["q"],
        limit: parsedLimit !== undefined && Number.isFinite(parsedLimit) ? parsedLimit : undefined,
      },
    );
    if (!result.ok) {
      sendHandlerError(reply, result.error, correlationId);
      return;
    }
    void reply.send(result.value);
  });
}
