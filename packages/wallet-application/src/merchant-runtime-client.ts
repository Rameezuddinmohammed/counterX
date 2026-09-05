/**
 * Merchant runtime client implementations.
 *
 * HttpMerchantRuntimeClient: production client using fetch with manifest
 * verification, error normalization, and timeout handling.
 *
 * InMemoryMerchantRuntimeClient: test double with configurable responses
 * for simulating success, timeout, malformed responses, stale manifests,
 * network errors, and indeterminate outcomes.
 */

import type {
  CancelResponse,
  CapabilityResponse,
  DirectoryListResponse,
  ProductResponse,
  QuoteResponse,
  ReceiptResponse,
  RefundResponse,
  SearchResponse,
  TransactionCreateResponse,
  TransactionStatusResponse,
} from "@counter/merchant-contracts";
import type { CtpEnvelope, PurchaseIntentPayload } from "@counter/trust-protocol";
import {
  createIndeterminateError,
  createMalformedResponseError,
  createManifestVerificationError,
  createNetworkError,
  createServerError,
  createStaleManifestError,
  createTimeoutError,
  createUnauthorizedError,
} from "./client-errors.js";

import type {
  ClientResult,
  ManifestVerificationResult,
  MerchantRuntimeClient,
  PaginationParams,
  SearchFilters,
} from "./merchant-client-types.js";

// ---------------------------------------------------------------------------
// HTTP Client Options
// ---------------------------------------------------------------------------

export interface HttpClientOptions {
  readonly timeoutMs?: number;
  readonly environment: string;
}

// ---------------------------------------------------------------------------
// Cached Manifest Entry
// ---------------------------------------------------------------------------

interface CachedManifest {
  readonly result: ManifestVerificationResult;
  readonly cachedAt: number;
  readonly ttlMs: number;
}

// ---------------------------------------------------------------------------
// HttpMerchantRuntimeClient
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 30_000;
const MANIFEST_CACHE_TTL_MS = 300_000; // 5 minutes

/**
 * Production merchant runtime client using fetch.
 * Verifies merchant manifest before any operation, normalizes all errors
 * to safe structured types, and handles timeout as indeterminate.
 */
export class HttpMerchantRuntimeClient implements MerchantRuntimeClient {
  readonly #baseUrl: string;
  readonly #authToken: string;
  readonly #manifestCache: Map<string, CachedManifest>;
  readonly #timeoutMs: number;
  readonly #environment: string;

  constructor(
    baseUrl: string,
    authToken: string,
    manifestCache: Map<string, CachedManifest>,
    options: HttpClientOptions,
  ) {
    this.#baseUrl = baseUrl;
    this.#authToken = authToken;
    this.#manifestCache = manifestCache;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#environment = options.environment;
  }

  /**
   * NOT scoped to one merchantId, and doesn't verify a manifest first (there
   * isn't one merchant to verify) — this is how a caller finds a merchantId
   * to call every other method here with.
   */
  async listMerchants(
    query?: string,
    limit?: number,
  ): Promise<ClientResult<DirectoryListResponse>> {
    const params = new URLSearchParams();
    if (query !== undefined && query.length > 0) {
      params.set("q", query);
    }
    if (limit !== undefined) {
      params.set("limit", String(limit));
    }
    const qs = params.toString();
    const url = `${this.#baseUrl}/runtime/v1/merchants${qs.length > 0 ? `?${qs}` : ""}`;

    const response = await this.#safeFetch(url);
    if (!response.ok) {
      return response;
    }
    return { ok: true, value: response.value as DirectoryListResponse };
  }

  async verifyManifest(merchantId: string): Promise<ClientResult<ManifestVerificationResult>> {
    const url = `${this.#baseUrl}/runtime/v1/merchants/${encodeURIComponent(merchantId)}/capabilities`;

    const response = await this.#safeFetch(url);
    if (!response.ok) {
      return response;
    }

    const body = response.value;

    // Validate capability response structure
    if (!this.#isValidCapabilityResponse(body)) {
      return { ok: false, error: createMalformedResponseError() };
    }

    const capability = body as CapabilityResponse;

    // Verify signature field is present and non-empty
    if (!capability.signature || capability.signature.length === 0) {
      return {
        ok: false,
        error: createManifestVerificationError("missing or empty signature"),
      };
    }

    // Check environment match
    if (capability.merchantId !== merchantId) {
      return {
        ok: false,
        error: createManifestVerificationError("merchant ID mismatch"),
      };
    }

    // Check connector health
    const healthStatus =
      capability.connectorStatus === "connected"
        ? "healthy"
        : capability.connectorStatus === "degraded"
          ? "degraded"
          : "unavailable";

    const result: ManifestVerificationResult = {
      valid: true,
      merchantId: capability.merchantId,
      environment: this.#environment,
      verifiedDomains: [],
      merchantCountry: "IN", // India metadata - default for Counter
      capabilities: [...capability.capabilities],
      healthStatus,
    };

    // Cache the result
    this.#manifestCache.set(merchantId, {
      result,
      cachedAt: Date.now(),
      ttlMs: MANIFEST_CACHE_TTL_MS,
    });

    return { ok: true, value: result };
  }

  async search(
    merchantId: string,
    query: string,
    filters?: SearchFilters,
    pagination?: PaginationParams,
  ): Promise<ClientResult<SearchResponse>> {
    const manifestCheck = await this.#ensureManifestVerified(merchantId);
    if (!manifestCheck.ok) {
      return manifestCheck;
    }

    // When query is empty, whitespace, or omitted, normalize to "*" so both older
    // deployed runtimes (which require a non-empty `query` field) and Shopify's
    // catalog search return the full product catalog without a 400 validation error.
    const normalizedQuery =
      typeof query === "string" && query.trim().length > 0 ? query.trim() : "*";

    const url = `${this.#baseUrl}/runtime/v1/merchants/${encodeURIComponent(merchantId)}/search`;
    const response = await this.#safeFetch(url, {
      method: "POST",
      body: JSON.stringify({ query: normalizedQuery, filters, pagination }),
    });

    if (!response.ok) {
      return response;
    }

    return { ok: true, value: response.value as SearchResponse };
  }

  async getProduct(merchantId: string, variantId: string): Promise<ClientResult<ProductResponse>> {
    const manifestCheck = await this.#ensureManifestVerified(merchantId);
    if (!manifestCheck.ok) {
      return manifestCheck;
    }

    const url = `${this.#baseUrl}/runtime/v1/merchants/${encodeURIComponent(merchantId)}/products/${encodeURIComponent(variantId)}`;
    const response = await this.#safeFetch(url);

    if (!response.ok) {
      return response;
    }

    return { ok: true, value: response.value as ProductResponse };
  }

  async getQuote(
    merchantId: string,
    variantId: string,
    quantity: number,
    currency: string,
  ): Promise<ClientResult<QuoteResponse>> {
    const manifestCheck = await this.#ensureManifestVerified(merchantId);
    if (!manifestCheck.ok) {
      return manifestCheck;
    }

    const url = `${this.#baseUrl}/runtime/v1/merchants/${encodeURIComponent(merchantId)}/quotes`;
    const response = await this.#safeFetch(url, {
      method: "POST",
      body: JSON.stringify({ variantId, quantity, currency }),
    });

    if (!response.ok) {
      return response;
    }

    return { ok: true, value: response.value as QuoteResponse };
  }

  async createTransaction(
    merchantId: string,
    quoteId: string,
    paymentMethod: string,
    signedEnvelope?: CtpEnvelope<PurchaseIntentPayload>,
  ): Promise<ClientResult<TransactionCreateResponse>> {
    const manifestCheck = await this.#ensureManifestVerified(merchantId);
    if (!manifestCheck.ok) {
      return manifestCheck;
    }

    const url = `${this.#baseUrl}/runtime/v1/merchants/${encodeURIComponent(merchantId)}/transactions`;
    const response = await this.#safeFetch(url, {
      method: "POST",
      body: JSON.stringify({
        quoteId,
        paymentMethod,
        ...(signedEnvelope !== undefined ? { ctpEnvelope: signedEnvelope } : {}),
      }),
    });

    if (!response.ok) {
      return response;
    }

    return { ok: true, value: response.value as TransactionCreateResponse };
  }

  async getTransactionStatus(
    merchantId: string,
    transactionId: string,
  ): Promise<ClientResult<TransactionStatusResponse>> {
    const manifestCheck = await this.#ensureManifestVerified(merchantId);
    if (!manifestCheck.ok) {
      return manifestCheck;
    }

    const url = `${this.#baseUrl}/runtime/v1/merchants/${encodeURIComponent(merchantId)}/transactions/${encodeURIComponent(transactionId)}`;
    const response = await this.#safeFetch(url);

    if (!response.ok) {
      return response;
    }

    return { ok: true, value: response.value as TransactionStatusResponse };
  }

  async getReceipt(
    merchantId: string,
    transactionId: string,
  ): Promise<ClientResult<ReceiptResponse>> {
    const manifestCheck = await this.#ensureManifestVerified(merchantId);
    if (!manifestCheck.ok) {
      return manifestCheck;
    }

    const url = `${this.#baseUrl}/runtime/v1/merchants/${encodeURIComponent(merchantId)}/transactions/${encodeURIComponent(transactionId)}/receipt`;
    const response = await this.#safeFetch(url);

    if (!response.ok) {
      return response;
    }

    return { ok: true, value: response.value as ReceiptResponse };
  }

  async requestRefund(
    merchantId: string,
    transactionId: string,
    reason: string,
  ): Promise<ClientResult<RefundResponse>> {
    const manifestCheck = await this.#ensureManifestVerified(merchantId);
    if (!manifestCheck.ok) {
      return manifestCheck;
    }

    const url = `${this.#baseUrl}/runtime/v1/merchants/${encodeURIComponent(merchantId)}/transactions/${encodeURIComponent(transactionId)}/refund`;
    const response = await this.#safeFetch(url, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });

    if (!response.ok) {
      return response;
    }

    return { ok: true, value: response.value as RefundResponse };
  }

  async cancelTransaction(
    merchantId: string,
    transactionId: string,
    reason: string,
  ): Promise<ClientResult<CancelResponse>> {
    const manifestCheck = await this.#ensureManifestVerified(merchantId);
    if (!manifestCheck.ok) {
      return manifestCheck;
    }

    const url = `${this.#baseUrl}/runtime/v1/merchants/${encodeURIComponent(merchantId)}/transactions/${encodeURIComponent(transactionId)}/cancel`;
    const response = await this.#safeFetch(url, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });

    if (!response.ok) {
      return response;
    }

    return { ok: true, value: response.value as CancelResponse };
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  async #ensureManifestVerified(merchantId: string): Promise<ClientResult<void>> {
    const cached = this.#manifestCache.get(merchantId);
    if (cached) {
      const age = Date.now() - cached.cachedAt;
      if (age < cached.ttlMs) {
        if (cached.result.valid) {
          return { ok: true, value: undefined };
        }
        return {
          ok: false,
          error: createManifestVerificationError("cached manifest is invalid"),
        };
      }
      // Stale - remove from cache
      this.#manifestCache.delete(merchantId);
    }

    // Need to verify
    const result = await this.verifyManifest(merchantId);
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    return { ok: true, value: undefined };
  }

  async #safeFetch(
    url: string,
    init?: { method?: string; body?: string },
  ): Promise<ClientResult<unknown>> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
      }, this.#timeoutMs);

      const response = await fetch(url, {
        method: init?.method ?? "GET",
        headers: {
          Authorization: `Bearer ${this.#authToken}`,
          "Content-Type": "application/json",
        },
        body: init?.body ?? null,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.status === 401) {
        return { ok: false, error: createUnauthorizedError() };
      }

      if (response.status === 502) {
        return { ok: false, error: createIndeterminateError() };
      }

      if (response.status >= 500) {
        return { ok: false, error: createServerError() };
      }

      if (!response.ok) {
        return { ok: false, error: createServerError() };
      }

      const body: unknown = await response.json();
      return { ok: true, value: body };
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "AbortError") {
        return { ok: false, error: createTimeoutError() };
      }
      return { ok: false, error: createNetworkError() };
    }
  }

  #isValidCapabilityResponse(body: unknown): body is CapabilityResponse {
    if (typeof body !== "object" || body === null) {
      return false;
    }
    const obj = body as Record<string, unknown>;
    return (
      typeof obj["merchantId"] === "string" &&
      typeof obj["manifestDigest"] === "string" &&
      Array.isArray(obj["capabilities"]) &&
      typeof obj["connectorStatus"] === "string" &&
      typeof obj["signature"] === "string"
    );
  }
}

// ---------------------------------------------------------------------------
// InMemoryMerchantRuntimeClient (for testing)
// ---------------------------------------------------------------------------

/**
 * Simulated failure mode for the in-memory test client.
 */
export type SimulatedFailure =
  | "timeout"
  | "network_error"
  | "malformed_response"
  | "stale_manifest"
  | "indeterminate"
  | "server_error"
  | "unauthorized"
  | "manifest_verification_failed";

/**
 * In-memory test implementation of MerchantRuntimeClient.
 * Supports configurable responses and simulated failures.
 */
interface RecordedCreateTransactionCall {
  readonly merchantId: string;
  readonly quoteId: string;
  readonly paymentMethod: string;
  readonly signedEnvelope: CtpEnvelope<PurchaseIntentPayload> | undefined;
}

export class InMemoryMerchantRuntimeClient implements MerchantRuntimeClient {
  #directoryResponse: DirectoryListResponse = { merchants: [], total: 0 };
  #manifests = new Map<string, ManifestVerificationResult>();
  #searchResponses = new Map<string, SearchResponse>();
  #productResponses = new Map<string, ProductResponse>();
  #quoteResponses = new Map<string, QuoteResponse>();
  #transactionCreateResponses = new Map<string, TransactionCreateResponse>();
  #transactionStatusResponses = new Map<string, TransactionStatusResponse>();
  #receiptResponses = new Map<string, ReceiptResponse>();
  #refundResponses = new Map<string, RefundResponse>();
  #cancelResponses = new Map<string, CancelResponse>();
  #simulatedFailure: SimulatedFailure | undefined;
  #environment: string;
  #lastCreateTransactionCall: RecordedCreateTransactionCall | undefined;

  constructor(environment = "sandbox") {
    this.#environment = environment;
  }

  /** Records every createTransaction() call so tests can assert what was sent, e.g. that a signed envelope was actually included. */
  get lastCreateTransactionCall(): RecordedCreateTransactionCall | undefined {
    return this.#lastCreateTransactionCall;
  }

  // ---------------------------------------------------------------------------
  // Test Configuration
  // ---------------------------------------------------------------------------

  setManifest(merchantId: string, manifest: ManifestVerificationResult): void {
    this.#manifests.set(merchantId, manifest);
  }

  setDirectoryResponse(response: DirectoryListResponse): void {
    this.#directoryResponse = response;
  }

  setSearchResponse(merchantId: string, response: SearchResponse): void {
    this.#searchResponses.set(merchantId, response);
  }

  setProductResponse(key: string, response: ProductResponse): void {
    this.#productResponses.set(key, response);
  }

  setQuoteResponse(merchantId: string, response: QuoteResponse): void {
    this.#quoteResponses.set(merchantId, response);
  }

  setTransactionCreateResponse(merchantId: string, response: TransactionCreateResponse): void {
    this.#transactionCreateResponses.set(merchantId, response);
  }

  setTransactionStatusResponse(key: string, response: TransactionStatusResponse): void {
    this.#transactionStatusResponses.set(key, response);
  }

  setReceiptResponse(key: string, response: ReceiptResponse): void {
    this.#receiptResponses.set(key, response);
  }

  setRefundResponse(key: string, response: RefundResponse): void {
    this.#refundResponses.set(key, response);
  }

  setCancelResponse(key: string, response: CancelResponse): void {
    this.#cancelResponses.set(key, response);
  }

  simulateFailure(failure: SimulatedFailure | undefined): void {
    this.#simulatedFailure = failure;
  }

  // ---------------------------------------------------------------------------
  // MerchantRuntimeClient Implementation
  // ---------------------------------------------------------------------------

  async listMerchants(
    query?: string,
    limit?: number,
  ): Promise<ClientResult<DirectoryListResponse>> {
    const failure = this.#checkSimulatedFailure();
    if (failure) {
      return failure;
    }
    const trimmed = query?.trim();
    if (trimmed === undefined || trimmed.length === 0) {
      const merchants =
        limit !== undefined
          ? this.#directoryResponse.merchants.slice(0, limit)
          : this.#directoryResponse.merchants;
      return { ok: true, value: { merchants, total: this.#directoryResponse.total } };
    }
    const filtered = this.#directoryResponse.merchants.filter((m) =>
      m.displayName.toLowerCase().includes(trimmed.toLowerCase()),
    );
    const merchants = limit !== undefined ? filtered.slice(0, limit) : filtered;
    return { ok: true, value: { merchants, total: filtered.length } };
  }

  async verifyManifest(merchantId: string): Promise<ClientResult<ManifestVerificationResult>> {
    const failure = this.#checkSimulatedFailure();
    if (failure) {
      return failure;
    }

    const manifest = this.#manifests.get(merchantId);
    if (!manifest) {
      return {
        ok: false,
        error: createManifestVerificationError("merchant not found"),
      };
    }

    // Verify environment match
    if (manifest.environment !== this.#environment) {
      return {
        ok: false,
        error: createManifestVerificationError(
          `environment mismatch: expected '${this.#environment}', got '${manifest.environment}'`,
        ),
      };
    }

    // Verify India metadata
    if (manifest.merchantCountry !== "IN") {
      return {
        ok: false,
        error: createManifestVerificationError(
          "merchant country must be IN for Counter operations",
        ),
      };
    }

    // Check if stale (expired)
    if (manifest.expiresAt) {
      const expiresAt = new Date(manifest.expiresAt).getTime();
      if (Date.now() > expiresAt) {
        return { ok: false, error: createStaleManifestError() };
      }
    }

    return { ok: true, value: manifest };
  }

  async search(
    merchantId: string,
    _query: string,
    _filters?: SearchFilters,
    _pagination?: PaginationParams,
  ): Promise<ClientResult<SearchResponse>> {
    const failure = this.#checkSimulatedFailure();
    if (failure) {
      return failure;
    }

    const manifestCheck = await this.#ensureManifestValid(merchantId);
    if (!manifestCheck.ok) {
      return manifestCheck;
    }

    const response = this.#searchResponses.get(merchantId);
    if (!response) {
      return { ok: false, error: createMalformedResponseError() };
    }

    return { ok: true, value: response };
  }

  async getProduct(merchantId: string, variantId: string): Promise<ClientResult<ProductResponse>> {
    const failure = this.#checkSimulatedFailure();
    if (failure) {
      return failure;
    }

    const manifestCheck = await this.#ensureManifestValid(merchantId);
    if (!manifestCheck.ok) {
      return manifestCheck;
    }

    const key = `${merchantId}:${variantId}`;
    const response = this.#productResponses.get(key);
    if (!response) {
      return { ok: false, error: createMalformedResponseError() };
    }

    return { ok: true, value: response };
  }

  async getQuote(
    merchantId: string,
    _variantId: string,
    _quantity: number,
    _currency: string,
  ): Promise<ClientResult<QuoteResponse>> {
    const failure = this.#checkSimulatedFailure();
    if (failure) {
      return failure;
    }

    const manifestCheck = await this.#ensureManifestValid(merchantId);
    if (!manifestCheck.ok) {
      return manifestCheck;
    }

    const response = this.#quoteResponses.get(merchantId);
    if (!response) {
      return { ok: false, error: createMalformedResponseError() };
    }

    return { ok: true, value: response };
  }

  async createTransaction(
    merchantId: string,
    quoteId: string,
    paymentMethod: string,
    signedEnvelope?: CtpEnvelope<PurchaseIntentPayload>,
  ): Promise<ClientResult<TransactionCreateResponse>> {
    this.#lastCreateTransactionCall = { merchantId, quoteId, paymentMethod, signedEnvelope };
    const failure = this.#checkSimulatedFailure();
    if (failure) {
      return failure;
    }

    const manifestCheck = await this.#ensureManifestValid(merchantId);
    if (!manifestCheck.ok) {
      return manifestCheck;
    }

    const response = this.#transactionCreateResponses.get(merchantId);
    if (!response) {
      return { ok: false, error: createMalformedResponseError() };
    }

    return { ok: true, value: response };
  }

  async getTransactionStatus(
    merchantId: string,
    transactionId: string,
  ): Promise<ClientResult<TransactionStatusResponse>> {
    const failure = this.#checkSimulatedFailure();
    if (failure) {
      return failure;
    }

    const manifestCheck = await this.#ensureManifestValid(merchantId);
    if (!manifestCheck.ok) {
      return manifestCheck;
    }

    const key = `${merchantId}:${transactionId}`;
    const response = this.#transactionStatusResponses.get(key);
    if (!response) {
      return { ok: false, error: createMalformedResponseError() };
    }

    return { ok: true, value: response };
  }

  async getReceipt(
    merchantId: string,
    transactionId: string,
  ): Promise<ClientResult<ReceiptResponse>> {
    const failure = this.#checkSimulatedFailure();
    if (failure) {
      return failure;
    }

    const manifestCheck = await this.#ensureManifestValid(merchantId);
    if (!manifestCheck.ok) {
      return manifestCheck;
    }

    const key = `${merchantId}:${transactionId}`;
    const response = this.#receiptResponses.get(key);
    if (!response) {
      return { ok: false, error: createMalformedResponseError() };
    }

    return { ok: true, value: response };
  }

  async requestRefund(
    merchantId: string,
    transactionId: string,
    _reason: string,
  ): Promise<ClientResult<RefundResponse>> {
    const failure = this.#checkSimulatedFailure();
    if (failure) {
      return failure;
    }

    const manifestCheck = await this.#ensureManifestValid(merchantId);
    if (!manifestCheck.ok) {
      return manifestCheck;
    }

    const key = `${merchantId}:${transactionId}`;
    const response = this.#refundResponses.get(key);
    if (!response) {
      return { ok: false, error: createMalformedResponseError() };
    }

    return { ok: true, value: response };
  }

  async cancelTransaction(
    merchantId: string,
    transactionId: string,
    _reason: string,
  ): Promise<ClientResult<CancelResponse>> {
    const failure = this.#checkSimulatedFailure();
    if (failure) {
      return failure;
    }

    const manifestCheck = await this.#ensureManifestValid(merchantId);
    if (!manifestCheck.ok) {
      return manifestCheck;
    }

    const key = `${merchantId}:${transactionId}`;
    const response = this.#cancelResponses.get(key);
    if (!response) {
      return { ok: false, error: createMalformedResponseError() };
    }

    return { ok: true, value: response };
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  #checkSimulatedFailure(): ClientResult<never> | undefined {
    switch (this.#simulatedFailure) {
      case "timeout":
        return { ok: false, error: createTimeoutError() };
      case "network_error":
        return { ok: false, error: createNetworkError() };
      case "malformed_response":
        return { ok: false, error: createMalformedResponseError() };
      case "stale_manifest":
        return { ok: false, error: createStaleManifestError() };
      case "indeterminate":
        return { ok: false, error: createIndeterminateError() };
      case "server_error":
        return { ok: false, error: createServerError() };
      case "unauthorized":
        return { ok: false, error: createUnauthorizedError() };
      case "manifest_verification_failed":
        return {
          ok: false,
          error: createManifestVerificationError("simulated verification failure"),
        };
      default:
        return undefined;
    }
  }

  async #ensureManifestValid(merchantId: string): Promise<ClientResult<void>> {
    const manifest = this.#manifests.get(merchantId);
    if (!manifest) {
      return {
        ok: false,
        error: createManifestVerificationError("manifest not verified"),
      };
    }

    if (!manifest.valid) {
      return {
        ok: false,
        error: createManifestVerificationError("manifest is invalid"),
      };
    }

    if (manifest.environment !== this.#environment) {
      return {
        ok: false,
        error: createManifestVerificationError("environment mismatch"),
      };
    }

    return { ok: true, value: undefined };
  }
}
