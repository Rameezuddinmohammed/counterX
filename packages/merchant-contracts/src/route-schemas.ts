/**
 * Typed route request/response schemas for the merchant runtime API.
 *
 * Defines the canonical contract shapes for each endpoint including
 * standard error responses that never leak resource existence to
 * unauthorized callers.
 */

// ---------------------------------------------------------------------------
// Common Header Types
// ---------------------------------------------------------------------------

export interface AuthorizationHeader {
  readonly authorization: `Bearer ${string}`;
}

export interface CorrelationHeader {
  readonly "x-correlation-id"?: string;
}

export interface IdempotencyHeader {
  readonly "idempotency-key": string;
}

export interface VersionHeader {
  readonly "if-match": string;
}

// ---------------------------------------------------------------------------
// Common Error Response Shapes
// ---------------------------------------------------------------------------

/**
 * 401 Unauthorized - same shape whether or not the resource exists.
 * This prevents existence leakage for unauthorized callers.
 */
export interface UnauthorizedError {
  readonly error: {
    readonly code: "UNAUTHENTICATED";
    readonly message: "Authentication is required";
  };
}

/** 400 Validation Error - structured details about what failed. */
export interface ValidationError {
  readonly error: {
    readonly code: "INVALID_FORMAT";
    readonly message: string;
    readonly details?: {
      readonly field?: string;
      readonly constraint?: string;
    };
  };
}

/** 409 Conflict/Stale - provides version info for retry. */
export interface StaleError {
  readonly error: {
    readonly code: "STALE";
    readonly message: "The request is based on stale state";
    readonly details: {
      readonly currentVersion: string;
      readonly requestedVersion: string;
    };
  };
}

/** 202 Review Required - blocking rule IDs and reason. */
export interface ReviewRequiredResponse {
  readonly status: "review_required";
  readonly reviewId: string;
  readonly reason: string;
  readonly blockingRuleIds: readonly string[];
  readonly correlationId: string;
}

/** 502 Indeterminate - outcome is not yet authoritative. */
export interface IndeterminateError {
  readonly error: {
    readonly code: "INDETERMINATE";
    readonly message: "The operation outcome is not yet authoritative";
    readonly details: {
      readonly correlationId: string;
      readonly retry: "query_before_retry";
    };
  };
}

// ---------------------------------------------------------------------------
// Route: Capability (GET /runtime/v1/merchants/:merchantId/capabilities)
// ---------------------------------------------------------------------------

export interface CapabilityRequest {
  readonly params: {
    readonly merchantId: string;
  };
  readonly headers: AuthorizationHeader & CorrelationHeader;
}

export interface CapabilityResponse {
  readonly merchantId: string;
  readonly manifestDigest: string;
  readonly capabilities: readonly string[];
  readonly connectorStatus: "connected" | "disconnected" | "degraded";
  readonly signature: string;
}

// ---------------------------------------------------------------------------
// Route: Search (POST /runtime/v1/merchants/:merchantId/search)
// ---------------------------------------------------------------------------

export interface SearchRequest {
  readonly params: {
    readonly merchantId: string;
  };
  readonly headers: AuthorizationHeader & CorrelationHeader;
  readonly body: {
    readonly query: string;
    readonly filters?: Record<string, unknown>;
    readonly pagination?: {
      readonly limit: number;
      readonly cursor?: string;
    };
  };
}

export interface SearchResultItem {
  readonly variantId: string;
  readonly title: string;
  readonly price: {
    readonly amount: string;
    readonly currency: string;
  };
  readonly available: boolean;
}

export interface SearchResponse {
  readonly merchantId: string;
  readonly results: readonly SearchResultItem[];
  readonly nextCursor: string | null;
  readonly totalCount: number;
}

// ---------------------------------------------------------------------------
// Route: Product (GET /runtime/v1/merchants/:merchantId/products/:variantId)
// ---------------------------------------------------------------------------

export interface ProductRequest {
  readonly params: {
    readonly merchantId: string;
    readonly variantId: string;
  };
  readonly headers: AuthorizationHeader & CorrelationHeader & Partial<VersionHeader>;
}

export interface ProductResponse {
  readonly variantId: string;
  readonly merchantId: string;
  readonly title: string;
  readonly description: string;
  readonly price: {
    readonly amount: string;
    readonly currency: string;
  };
  readonly available: boolean;
  readonly version: string;
  readonly freshness: string;
}

// ---------------------------------------------------------------------------
// Route: Quote (POST /runtime/v1/merchants/:merchantId/quotes)
// ---------------------------------------------------------------------------

export interface QuoteRequest {
  readonly params: {
    readonly merchantId: string;
  };
  readonly headers: AuthorizationHeader & CorrelationHeader & IdempotencyHeader;
  readonly body: {
    readonly variantId: string;
    readonly quantity: number;
    readonly currency: string;
  };
}

export interface QuoteResponse {
  readonly quoteId: string;
  readonly merchantId: string;
  readonly variantId: string;
  readonly quantity: number;
  readonly unitPrice: {
    readonly amount: string;
    readonly currency: string;
  };
  readonly totalPrice: {
    readonly amount: string;
    readonly currency: string;
  };
  readonly expiresAt: string;
  /** Binds a CTP-signed purchase intent to this exact quote. */
  readonly quoteDigest: string;
  readonly version: string;
}

// ---------------------------------------------------------------------------
// Route: Transaction Create (POST /runtime/v1/merchants/:merchantId/transactions)
// ---------------------------------------------------------------------------

export interface TransactionCreateRequest {
  readonly params: {
    readonly merchantId: string;
  };
  readonly headers: AuthorizationHeader & CorrelationHeader & IdempotencyHeader;
  readonly body: {
    readonly quoteId: string;
    readonly paymentMethod: string;
    readonly billingAddress?: {
      readonly line1: string;
      readonly city: string;
      readonly region?: string;
      readonly postalCode: string;
      readonly country: string;
    };
  };
}

export interface TransactionCreateResponse {
  readonly transactionId: string;
  readonly merchantId: string;
  readonly status: "pending" | "confirmed" | "review_required";
  readonly quoteId: string;
  readonly amount: {
    readonly amount: string;
    readonly currency: string;
  };
  readonly createdAt: string;
  readonly version: string;
}

// ---------------------------------------------------------------------------
// Route: Transaction Status (GET /runtime/v1/merchants/:merchantId/transactions/:transactionId)
// ---------------------------------------------------------------------------

export interface TransactionStatusRequest {
  readonly params: {
    readonly merchantId: string;
    readonly transactionId: string;
  };
  readonly headers: AuthorizationHeader & CorrelationHeader & Partial<VersionHeader>;
}

export interface TransactionStatusResponse {
  readonly transactionId: string;
  readonly merchantId: string;
  readonly status: "pending" | "confirmed" | "completed" | "cancelled" | "refunded";
  readonly amount: {
    readonly amount: string;
    readonly currency: string;
  };
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: string;
}

// ---------------------------------------------------------------------------
// Route: Payment Action Result (POST /runtime/v1/merchants/:merchantId/transactions/:transactionId/payment-result)
// ---------------------------------------------------------------------------

export interface PaymentActionResultRequest {
  readonly params: {
    readonly merchantId: string;
    readonly transactionId: string;
  };
  readonly headers: AuthorizationHeader & CorrelationHeader & IdempotencyHeader;
  readonly body: {
    readonly providerReference: string;
    readonly outcome: "success" | "failure" | "pending";
    readonly providerMetadata?: Record<string, unknown>;
  };
}

export interface PaymentActionResultResponse {
  readonly transactionId: string;
  readonly status: "confirmed" | "failed" | "pending";
  readonly providerReference: string;
  readonly processedAt: string;
}

// ---------------------------------------------------------------------------
// Route: Cancel (POST /runtime/v1/merchants/:merchantId/transactions/:transactionId/cancel)
// ---------------------------------------------------------------------------

export interface CancelRequest {
  readonly params: {
    readonly merchantId: string;
    readonly transactionId: string;
  };
  readonly headers: AuthorizationHeader & CorrelationHeader & IdempotencyHeader & VersionHeader;
  readonly body: {
    readonly reason: string;
  };
}

export interface CancelResponse {
  readonly transactionId: string;
  readonly status: "cancelled";
  readonly cancelledAt: string;
  readonly version: string;
}

// ---------------------------------------------------------------------------
// Route: Refund (POST /runtime/v1/merchants/:merchantId/transactions/:transactionId/refund)
// ---------------------------------------------------------------------------

export interface RefundRequest {
  readonly params: {
    readonly merchantId: string;
    readonly transactionId: string;
  };
  readonly headers: AuthorizationHeader & CorrelationHeader & IdempotencyHeader & VersionHeader;
  readonly body: {
    readonly reason: string;
  };
}

export interface RefundResponse {
  readonly refundId: string;
  readonly transactionId: string;
  readonly status: "refunded";
  readonly refundedAt: string;
  readonly amount: {
    readonly amount: string;
    readonly currency: string;
  };
  readonly version: string;
}

// ---------------------------------------------------------------------------
// Route: Receipt (GET /runtime/v1/merchants/:merchantId/transactions/:transactionId/receipt)
// ---------------------------------------------------------------------------

export interface ReceiptRequest {
  readonly params: {
    readonly merchantId: string;
    readonly transactionId: string;
  };
  readonly headers: AuthorizationHeader & CorrelationHeader;
}

export interface ReceiptResponse {
  readonly receiptId: string;
  readonly transactionId: string;
  readonly merchantId: string;
  readonly issuedAt: string;
  readonly items: readonly ReceiptItem[];
  readonly total: {
    readonly amount: string;
    readonly currency: string;
  };
  readonly signature: string;
}

export interface ReceiptItem {
  readonly variantId: string;
  readonly title: string;
  readonly quantity: number;
  readonly unitPrice: string;
  readonly total: string;
}

// ---------------------------------------------------------------------------
// Route Contract Aggregate
// ---------------------------------------------------------------------------

export interface RouteContract {
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly description: string;
  readonly requiresAuth: true;
  readonly requiresIdempotency: boolean;
  readonly requiresVersion: boolean;
  readonly errorResponses: readonly number[];
}

export const MERCHANT_ROUTES: readonly RouteContract[] = Object.freeze([
  Object.freeze({
    method: "GET" as const,
    path: "/runtime/v1/merchants/:merchantId/capabilities",
    description: "Signed capability discovery with manifest digest",
    requiresAuth: true as const,
    requiresIdempotency: false,
    requiresVersion: false,
    errorResponses: [401, 400],
  }),
  Object.freeze({
    method: "POST" as const,
    path: "/runtime/v1/merchants/:merchantId/search",
    description: "Product search with query, filters, and pagination",
    requiresAuth: true as const,
    requiresIdempotency: false,
    requiresVersion: false,
    errorResponses: [401, 400],
  }),
  Object.freeze({
    method: "GET" as const,
    path: "/runtime/v1/merchants/:merchantId/products/:variantId",
    description: "Product details by variant with freshness",
    requiresAuth: true as const,
    requiresIdempotency: false,
    requiresVersion: true,
    errorResponses: [401, 400, 409],
  }),
  Object.freeze({
    method: "POST" as const,
    path: "/runtime/v1/merchants/:merchantId/quotes",
    description: "Create immutable price quote",
    requiresAuth: true as const,
    requiresIdempotency: true,
    requiresVersion: false,
    errorResponses: [401, 400, 502],
  }),
  Object.freeze({
    method: "POST" as const,
    path: "/runtime/v1/merchants/:merchantId/transactions",
    description: "Create transaction with bilateral policy evaluation",
    requiresAuth: true as const,
    requiresIdempotency: true,
    requiresVersion: false,
    errorResponses: [401, 400, 202, 502],
  }),
  Object.freeze({
    method: "GET" as const,
    path: "/runtime/v1/merchants/:merchantId/transactions/:transactionId",
    description: "Transaction status with optimistic version",
    requiresAuth: true as const,
    requiresIdempotency: false,
    requiresVersion: true,
    errorResponses: [401, 400, 409],
  }),
  Object.freeze({
    method: "POST" as const,
    path: "/runtime/v1/merchants/:merchantId/transactions/:transactionId/payment-result",
    description: "Payment provider action result callback",
    requiresAuth: true as const,
    requiresIdempotency: true,
    requiresVersion: false,
    errorResponses: [401, 400, 502],
  }),
  Object.freeze({
    method: "POST" as const,
    path: "/runtime/v1/merchants/:merchantId/transactions/:transactionId/cancel",
    description: "Cancel transaction with preconditions",
    requiresAuth: true as const,
    requiresIdempotency: true,
    requiresVersion: true,
    errorResponses: [401, 400, 409, 502],
  }),
  Object.freeze({
    method: "POST" as const,
    path: "/runtime/v1/merchants/:merchantId/transactions/:transactionId/refund",
    description: "Full refund with preconditions",
    requiresAuth: true as const,
    requiresIdempotency: true,
    requiresVersion: true,
    errorResponses: [401, 400, 409, 502],
  }),
  Object.freeze({
    method: "GET" as const,
    path: "/runtime/v1/merchants/:merchantId/transactions/:transactionId/receipt",
    description: "Signed receipt for completed transaction",
    requiresAuth: true as const,
    requiresIdempotency: false,
    requiresVersion: false,
    errorResponses: [401, 400],
  }),
]);
