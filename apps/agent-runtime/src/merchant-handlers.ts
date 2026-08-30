/**
 * Handler port interfaces for merchant runtime routes.
 *
 * Pure interfaces that define the business logic contract for each
 * route operation. Implementations are injected at server creation.
 * A MockHandlerFactory is provided for testing.
 */

import type { Result } from "@counter/domain";
import type { CtpEnvelope, PurchaseIntentPayload } from "@counter/trust-protocol";

// ---------------------------------------------------------------------------
// Handler Context (passed to all handlers)
// ---------------------------------------------------------------------------

export interface HandlerContext {
  readonly merchantId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string | undefined;
  readonly version: string | undefined;
}

// ---------------------------------------------------------------------------
// Handler Result Types
// ---------------------------------------------------------------------------

export interface ReviewRequiredResult {
  readonly kind: "review_required";
  readonly reviewId: string;
  readonly reason: string;
  readonly blockingRuleIds: readonly string[];
}

export interface StaleResult {
  readonly kind: "stale";
  readonly currentVersion: string;
  readonly requestedVersion: string;
}

export interface IndeterminateResult {
  readonly kind: "indeterminate";
  readonly correlationId: string;
}

export interface NotFoundResult {
  readonly kind: "not_found";
}

export interface UnauthorizedResult {
  readonly kind: "unauthorized";
  readonly reason: string;
}

export type HandlerError =
  | ReviewRequiredResult
  | StaleResult
  | IndeterminateResult
  | NotFoundResult
  | UnauthorizedResult;

// ---------------------------------------------------------------------------
// Capability Handler
// ---------------------------------------------------------------------------

export interface CapabilityResult {
  readonly merchantId: string;
  readonly manifestDigest: string;
  readonly capabilities: readonly string[];
  readonly connectorStatus: "connected" | "disconnected" | "degraded";
  readonly signature: string;
}

export interface CapabilityHandler {
  handle(ctx: HandlerContext): Promise<Result<CapabilityResult, HandlerError>>;
}

// ---------------------------------------------------------------------------
// Search Handler
// ---------------------------------------------------------------------------

export interface SearchInput {
  readonly query: string;
  readonly filters: Record<string, unknown> | undefined;
  readonly pagination:
    | {
        readonly limit: number;
        readonly cursor?: string | undefined;
      }
    | undefined;
}

export interface SearchResultItem {
  readonly variantId: string;
  readonly title: string;
  readonly price: { readonly amount: string; readonly currency: string };
  readonly available: boolean;
}

export interface SearchResult {
  readonly merchantId: string;
  readonly results: readonly SearchResultItem[];
  readonly nextCursor: string | null;
  readonly totalCount: number;
}

export interface SearchHandler {
  handle(ctx: HandlerContext, input: SearchInput): Promise<Result<SearchResult, HandlerError>>;
}

// ---------------------------------------------------------------------------
// Product Handler
// ---------------------------------------------------------------------------

export interface ProductResult {
  readonly variantId: string;
  readonly merchantId: string;
  readonly title: string;
  readonly description: string;
  readonly price: { readonly amount: string; readonly currency: string };
  readonly available: boolean;
  readonly version: string;
  readonly freshness: string;
}

export interface ProductHandler {
  handle(ctx: HandlerContext, variantId: string): Promise<Result<ProductResult, HandlerError>>;
}

// ---------------------------------------------------------------------------
// Quote Handler
// ---------------------------------------------------------------------------

export interface QuoteInput {
  readonly variantId: string;
  readonly quantity: number;
  readonly currency: string;
}

export interface QuoteResult {
  readonly quoteId: string;
  readonly merchantId: string;
  readonly variantId: string;
  readonly quantity: number;
  readonly unitPrice: { readonly amount: string; readonly currency: string };
  readonly totalPrice: { readonly amount: string; readonly currency: string };
  readonly expiresAt: string;
  /** Binds a CTP-signed purchase intent to this exact quote (see TransactionCreateInput.ctpEnvelope). */
  readonly quoteDigest: string;
  readonly version: string;
}

export interface QuoteHandler {
  handle(ctx: HandlerContext, input: QuoteInput): Promise<Result<QuoteResult, HandlerError>>;
}

// ---------------------------------------------------------------------------
// Transaction Create Handler
// ---------------------------------------------------------------------------

export interface TransactionCreateInput {
  readonly quoteId: string;
  readonly paymentMethod: string;
  readonly billingAddress:
    | {
        readonly line1: string;
        readonly city: string;
        readonly region?: string | undefined;
        readonly postalCode: string;
        readonly country: string;
      }
    | undefined;
  /**
   * Optional CTP-signed purchase-intent envelope from a real buyer agent
   * (see PurchaseIntentBuilder.sign() in @counter/wallet-application). When
   * present, the handler verifies it against the buyer's registered key
   * before proceeding, and the resulting transaction's spend-limit check
   * runs against the buyer's own wallet rather than the merchant's. Absent
   * for existing merchant-only/test flows, which are unaffected.
   */
  readonly ctpEnvelope: CtpEnvelope<PurchaseIntentPayload> | undefined;
}

export interface TransactionCreateResult {
  readonly transactionId: string;
  readonly merchantId: string;
  readonly status: "pending" | "confirmed" | "review_required";
  readonly quoteId: string;
  readonly amount: { readonly amount: string; readonly currency: string };
  readonly createdAt: string;
  readonly version: string;
}

export interface TransactionCreateHandler {
  handle(
    ctx: HandlerContext,
    input: TransactionCreateInput,
  ): Promise<Result<TransactionCreateResult, HandlerError>>;
}

// ---------------------------------------------------------------------------
// Transaction Status Handler
// ---------------------------------------------------------------------------

export interface TransactionStatusResult {
  readonly transactionId: string;
  readonly merchantId: string;
  readonly status: "pending" | "confirmed" | "completed" | "cancelled" | "refunded";
  readonly amount: { readonly amount: string; readonly currency: string };
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: string;
}

export interface TransactionStatusHandler {
  handle(
    ctx: HandlerContext,
    transactionId: string,
  ): Promise<Result<TransactionStatusResult, HandlerError>>;
}

// ---------------------------------------------------------------------------
// Payment Action Result Handler
// ---------------------------------------------------------------------------

export interface PaymentActionInput {
  readonly providerReference: string;
  readonly outcome: "success" | "failure" | "pending";
  readonly providerMetadata: Record<string, unknown> | undefined;
}

export interface PaymentActionResult {
  readonly transactionId: string;
  readonly status: "confirmed" | "failed" | "pending";
  readonly providerReference: string;
  readonly processedAt: string;
}

export interface PaymentActionResultHandler {
  handle(
    ctx: HandlerContext,
    transactionId: string,
    input: PaymentActionInput,
  ): Promise<Result<PaymentActionResult, HandlerError>>;
}

// ---------------------------------------------------------------------------
// Cancel Handler
// ---------------------------------------------------------------------------

export interface CancelInput {
  readonly reason: string;
}

export interface CancelResult {
  readonly transactionId: string;
  readonly status: "cancelled";
  readonly cancelledAt: string;
  readonly version: string;
}

export interface CancelHandler {
  handle(
    ctx: HandlerContext,
    transactionId: string,
    input: CancelInput,
  ): Promise<Result<CancelResult, HandlerError>>;
}

// ---------------------------------------------------------------------------
// Refund Handler
// ---------------------------------------------------------------------------

export interface RefundInput {
  readonly reason: string;
}

/**
 * Refund is a RELAY, not an immediate execution: this handler records the
 * request (see runtime.refund_requests, migration 0014) and returns
 * "pending" — it never calls Razorpay itself. The merchant decides
 * (manually, or via their own configured auto-approve threshold) whether
 * the refund actually happens, via apps/control-plane-api/src/
 * refund-request-routes.ts's approve/deny routes, which perform the actual
 * provider call. See real-handlers.ts's createRefundHandler for why: a
 * merchant on their own separate payment gateway (not yet built) gives
 * CounterX no ability to reverse a charge it never processed, so relay is
 * the only workflow that works for every merchant.
 */
export interface RefundResult {
  readonly refundRequestId: string;
  readonly transactionId: string;
  readonly status: "pending";
  readonly requestedAt: string;
  readonly amount: { readonly amount: string; readonly currency: string };
  readonly version: string;
}

export interface RefundHandler {
  handle(
    ctx: HandlerContext,
    transactionId: string,
    input: RefundInput,
  ): Promise<Result<RefundResult, HandlerError>>;
}

// ---------------------------------------------------------------------------
// Receipt Handler
// ---------------------------------------------------------------------------

export interface ReceiptItem {
  readonly variantId: string;
  readonly title: string;
  readonly quantity: number;
  readonly unitPrice: string;
  readonly total: string;
}

export interface ReceiptResult {
  readonly receiptId: string;
  readonly transactionId: string;
  readonly merchantId: string;
  readonly issuedAt: string;
  readonly items: readonly ReceiptItem[];
  readonly total: { readonly amount: string; readonly currency: string };
  readonly signature: string;
}

export interface ReceiptHandler {
  handle(ctx: HandlerContext, transactionId: string): Promise<Result<ReceiptResult, HandlerError>>;
}

// ---------------------------------------------------------------------------
// Handler Registry (all ports for the merchant runtime)
// ---------------------------------------------------------------------------

export interface MerchantHandlers {
  readonly capability: CapabilityHandler;
  readonly search: SearchHandler;
  readonly product: ProductHandler;
  readonly quote: QuoteHandler;
  readonly transactionCreate: TransactionCreateHandler;
  readonly transactionStatus: TransactionStatusHandler;
  readonly paymentActionResult: PaymentActionResultHandler;
  readonly cancel: CancelHandler;
  readonly refund: RefundHandler;
  readonly receipt: ReceiptHandler;
}

// ---------------------------------------------------------------------------
// Mock Handler Factory for Testing
// ---------------------------------------------------------------------------

export type MockBehavior = "success" | "review_required" | "stale" | "indeterminate";

export interface MockHandlerOptions {
  readonly behavior?: MockBehavior | undefined;
  readonly idempotencyCache?: Map<string, unknown> | undefined;
}

function makeReviewRequired(): ReviewRequiredResult {
  return Object.freeze({
    kind: "review_required" as const,
    reviewId: "rev_test_001",
    reason: "Transaction requires manual review",
    blockingRuleIds: Object.freeze(["rule_amount_limit", "rule_new_customer"]),
  });
}

function makeStale(): StaleResult {
  return Object.freeze({
    kind: "stale" as const,
    currentVersion: "v2",
    requestedVersion: "v1",
  });
}

function makeIndeterminate(correlationId: string): IndeterminateResult {
  return Object.freeze({
    kind: "indeterminate" as const,
    correlationId,
  });
}

function errResult<E>(error: E): { readonly ok: false; readonly error: E } {
  return Object.freeze({ ok: false as const, error });
}

function okResult<V>(value: V): { readonly ok: true; readonly value: V } {
  return Object.freeze({ ok: true as const, value });
}

export function createMockHandlers(options: MockHandlerOptions = {}): MerchantHandlers {
  const behavior = options.behavior ?? "success";
  const idempotencyCache = options.idempotencyCache ?? new Map<string, unknown>();

  function checkIdempotency(ctx: HandlerContext): unknown {
    if (ctx.idempotencyKey !== undefined) {
      const cached = idempotencyCache.get(ctx.idempotencyKey);
      if (cached !== undefined) return cached;
    }
    return undefined;
  }

  function cacheResult(ctx: HandlerContext, result: unknown): void {
    if (ctx.idempotencyKey !== undefined) {
      idempotencyCache.set(ctx.idempotencyKey, result);
    }
  }

  return {
    capability: {
      async handle(ctx) {
        if (behavior === "indeterminate") return errResult(makeIndeterminate(ctx.correlationId));
        return okResult({
          merchantId: ctx.merchantId,
          manifestDigest: "sha256:abc123def456",
          capabilities: ["search", "quote", "transaction", "refund"] as readonly string[],
          connectorStatus: "connected" as const,
          signature: "sig_test_001",
        });
      },
    },
    search: {
      async handle(ctx, _input) {
        if (behavior === "indeterminate") return errResult(makeIndeterminate(ctx.correlationId));
        return okResult({
          merchantId: ctx.merchantId,
          results: [
            {
              variantId: "var_001",
              title: "Test Product",
              price: { amount: "10.00", currency: "USD" },
              available: true,
            },
          ] as readonly SearchResultItem[],
          nextCursor: null,
          totalCount: 1,
        });
      },
    },
    product: {
      async handle(ctx, variantId) {
        if (behavior === "stale") return errResult(makeStale());
        if (behavior === "indeterminate") return errResult(makeIndeterminate(ctx.correlationId));
        return okResult({
          variantId,
          merchantId: ctx.merchantId,
          title: "Test Product",
          description: "A test product",
          price: { amount: "10.00", currency: "USD" },
          available: true,
          version: "v1",
          freshness: new Date().toISOString(),
        });
      },
    },
    quote: {
      async handle(ctx, input) {
        const cached = checkIdempotency(ctx);
        if (cached !== undefined) return cached as Result<QuoteResult, HandlerError>;
        if (behavior === "indeterminate") return errResult(makeIndeterminate(ctx.correlationId));
        const result = okResult({
          quoteId: "quote_test_001",
          merchantId: ctx.merchantId,
          variantId: input.variantId,
          quantity: input.quantity,
          unitPrice: { amount: "10.00", currency: input.currency },
          totalPrice: { amount: String(10 * input.quantity) + ".00", currency: input.currency },
          expiresAt: new Date(Date.now() + 900_000).toISOString(),
          quoteDigest: "sha256:mock-quote-digest",
          version: "v1",
        });
        cacheResult(ctx, result);
        return result;
      },
    },
    transactionCreate: {
      async handle(ctx, input) {
        const cached = checkIdempotency(ctx);
        if (cached !== undefined) return cached as Result<TransactionCreateResult, HandlerError>;
        if (behavior === "review_required") return errResult(makeReviewRequired());
        if (behavior === "indeterminate") return errResult(makeIndeterminate(ctx.correlationId));
        const result = okResult({
          transactionId: "txn_test_001",
          merchantId: ctx.merchantId,
          status: "pending" as const,
          quoteId: input.quoteId,
          amount: { amount: "100.00", currency: "USD" },
          createdAt: new Date().toISOString(),
          version: "v1",
        });
        cacheResult(ctx, result);
        return result;
      },
    },
    transactionStatus: {
      async handle(ctx, transactionId) {
        if (behavior === "stale") return errResult(makeStale());
        if (behavior === "indeterminate") return errResult(makeIndeterminate(ctx.correlationId));
        return okResult({
          transactionId,
          merchantId: ctx.merchantId,
          status: "pending" as const,
          amount: { amount: "100.00", currency: "USD" },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          version: "v1",
        });
      },
    },
    paymentActionResult: {
      async handle(ctx, transactionId, input) {
        const cached = checkIdempotency(ctx);
        if (cached !== undefined) return cached as Result<PaymentActionResult, HandlerError>;
        if (behavior === "indeterminate") return errResult(makeIndeterminate(ctx.correlationId));
        const status: "confirmed" | "failed" | "pending" =
          input.outcome === "success"
            ? "confirmed"
            : input.outcome === "failure"
              ? "failed"
              : "pending";
        const result = okResult({
          transactionId,
          status,
          providerReference: input.providerReference,
          processedAt: new Date().toISOString(),
        });
        cacheResult(ctx, result);
        return result;
      },
    },
    cancel: {
      async handle(ctx, transactionId, _input) {
        const cached = checkIdempotency(ctx);
        if (cached !== undefined) return cached as Result<CancelResult, HandlerError>;
        if (behavior === "stale") return errResult(makeStale());
        if (behavior === "indeterminate") return errResult(makeIndeterminate(ctx.correlationId));
        const result = okResult({
          transactionId,
          status: "cancelled" as const,
          cancelledAt: new Date().toISOString(),
          version: "v2",
        });
        cacheResult(ctx, result);
        return result;
      },
    },
    refund: {
      async handle(ctx, transactionId, _input) {
        const cached = checkIdempotency(ctx);
        if (cached !== undefined) return cached as Result<RefundResult, HandlerError>;
        if (behavior === "stale") return errResult(makeStale());
        if (behavior === "indeterminate") return errResult(makeIndeterminate(ctx.correlationId));
        const result = okResult({
          refundRequestId: "refreq_test_001",
          transactionId,
          status: "pending" as const,
          requestedAt: new Date().toISOString(),
          amount: { amount: "100.00", currency: "USD" },
          version: "v3",
        });
        cacheResult(ctx, result);
        return result;
      },
    },
    receipt: {
      async handle(ctx, transactionId) {
        if (behavior === "indeterminate") return errResult(makeIndeterminate(ctx.correlationId));
        return okResult({
          receiptId: "rcp_test_001",
          transactionId,
          merchantId: ctx.merchantId,
          issuedAt: new Date().toISOString(),
          items: [
            {
              variantId: "var_001",
              title: "Test Product",
              quantity: 1,
              unitPrice: "10.00",
              total: "10.00",
            },
          ] as readonly ReceiptItem[],
          total: { amount: "10.00", currency: "USD" },
          signature: "sig_receipt_test_001",
        });
      },
    },
  };
}
