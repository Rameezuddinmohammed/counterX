/**
 * packages/merchant-contracts
 *
 * Merchant API route schemas: capability, search, quote, transaction,
 * receipt contracts. Defines the API contract types for merchant-facing
 * endpoints.
 */

export const PACKAGE_NAME = "@counter/merchant-contracts";

/** Schema for merchant capability discovery route. */
export interface MerchantCapabilitySchema {
  readonly merchantId: string;
  readonly capabilities: readonly string[];
  readonly connectorStatus: "connected" | "disconnected" | "degraded";
}

/** Schema for merchant product search route. */
export interface MerchantSearchSchema {
  readonly query: string;
  readonly merchantId: string;
  readonly limit: number;
  readonly offset: number;
  readonly filters: Record<string, unknown>;
}

/** Schema for merchant quote request route. */
export interface MerchantQuoteSchema {
  readonly merchantId: string;
  readonly variantId: string;
  readonly quantity: number;
  readonly requestedAt: string;
}

/** Schema for merchant transaction route. */
export interface MerchantTransactionSchema {
  readonly transactionId: string;
  readonly merchantId: string;
  readonly action: "create" | "confirm" | "cancel" | "refund";
  readonly amount: string;
  readonly currency: string;
}

/** Schema for merchant receipt route. */
export interface MerchantReceiptSchema {
  readonly receiptId: string;
  readonly transactionId: string;
  readonly merchantId: string;
  readonly issuedAt: string;
  readonly items: readonly MerchantReceiptItem[];
}

/** An individual item on a merchant receipt. */
export interface MerchantReceiptItem {
  readonly variantId: string;
  readonly quantity: number;
  readonly unitPrice: string;
  readonly total: string;
}
