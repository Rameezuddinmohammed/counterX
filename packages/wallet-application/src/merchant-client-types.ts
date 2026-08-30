/**
 * Typed client interfaces for merchant runtime operations.
 *
 * Defines the contract between the wallet application layer and the
 * merchant runtime API. All methods return Result types to preserve
 * the Indeterminate state without collapsing it to a failure.
 */

import type {
  ProductResponse,
  QuoteResponse,
  ReceiptResponse,
  RefundResponse,
  SearchResponse,
  TransactionCreateResponse,
  TransactionStatusResponse,
} from "@counter/merchant-contracts";
import type { CtpEnvelope, PurchaseIntentPayload } from "@counter/trust-protocol";
import type { MerchantClientError } from "./client-errors.js";

// ---------------------------------------------------------------------------
// Result Type (local to client, mirrors domain Result pattern)
// ---------------------------------------------------------------------------

export type ClientResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: MerchantClientError };

// ---------------------------------------------------------------------------
// Manifest Verification Result
// ---------------------------------------------------------------------------

/**
 * Result of verifying a merchant's capability manifest.
 * Includes domain, environment, geography (India metadata), capabilities,
 * and health status.
 */
export interface ManifestVerificationResult {
  readonly valid: boolean;
  readonly merchantId: string;
  readonly environment: string;
  readonly verifiedDomains: readonly string[];
  readonly merchantCountry: string;
  readonly capabilities: readonly string[];
  readonly healthStatus: "healthy" | "degraded" | "unavailable";
  readonly expiresAt?: string | undefined;
}

// ---------------------------------------------------------------------------
// Search Filters & Pagination
// ---------------------------------------------------------------------------

export interface SearchFilters {
  readonly category?: string;
  readonly minPrice?: string;
  readonly maxPrice?: string;
  readonly available?: boolean;
  readonly [key: string]: unknown;
}

export interface PaginationParams {
  readonly limit: number;
  readonly cursor?: string;
}

// ---------------------------------------------------------------------------
// Merchant Runtime Client Interface
// ---------------------------------------------------------------------------

/**
 * Typed client for interacting with merchant runtime API endpoints.
 *
 * All methods verify the merchant manifest is fresh and valid before
 * proceeding. Returns Result types to preserve Indeterminate state
 * without collapsing it to a generic failure.
 */
export interface MerchantRuntimeClient {
  /**
   * Verifies the merchant's signed capability manifest.
   * Checks signature, environment, domain ownership, India geography
   * metadata, and operation health.
   */
  verifyManifest(merchantId: string): Promise<ClientResult<ManifestVerificationResult>>;

  /**
   * Searches for products at a merchant with query, optional filters,
   * and pagination.
   */
  search(
    merchantId: string,
    query: string,
    filters?: SearchFilters,
    pagination?: PaginationParams,
  ): Promise<ClientResult<SearchResponse>>;

  /**
   * Gets product details by variant ID from a merchant.
   */
  getProduct(merchantId: string, variantId: string): Promise<ClientResult<ProductResponse>>;

  /**
   * Gets a price quote for a product variant at a given quantity and currency.
   */
  getQuote(
    merchantId: string,
    variantId: string,
    quantity: number,
    currency: string,
  ): Promise<ClientResult<QuoteResponse>>;

  /**
   * Creates a transaction from a confirmed quote. `signedEnvelope`, when
   * present, is a CTP-signed purchase-intent envelope the server verifies
   * against the buyer's registered agent key before proceeding — see
   * PurchaseIntentBuilder.sign(). Omit it for merchant-only/test flows that
   * don't carry a buyer-signed authorization.
   */
  createTransaction(
    merchantId: string,
    quoteId: string,
    paymentMethod: string,
    signedEnvelope?: CtpEnvelope<PurchaseIntentPayload>,
  ): Promise<ClientResult<TransactionCreateResponse>>;

  /**
   * Gets the current status of a transaction.
   */
  getTransactionStatus(
    merchantId: string,
    transactionId: string,
  ): Promise<ClientResult<TransactionStatusResponse>>;

  /**
   * Gets the signed receipt for a completed transaction.
   */
  getReceipt(merchantId: string, transactionId: string): Promise<ClientResult<ReceiptResponse>>;

  /**
   * Requests a refund on a completed transaction. This is a RELAY, not an
   * immediate execution — the server records the request and its reason;
   * the merchant decides (manually, or via their own configured
   * auto-approve threshold) whether it actually happens. See
   * RefundResponse's docs in @counter/merchant-contracts.
   */
  requestRefund(
    merchantId: string,
    transactionId: string,
    reason: string,
  ): Promise<ClientResult<RefundResponse>>;
}
