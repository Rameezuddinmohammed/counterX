/**
 * Typed interfaces for Shopify draft order and order operations.
 *
 * All input types carry Counter correlation metadata (correlationId,
 * idempotencyKey) so that every mutation is traceable back to the
 * originating Counter workflow.
 */

// ─── Correlation Metadata ─────────────────────────────────────────────────────

export interface CorrelationMetadata {
  readonly correlationId: string;
  readonly idempotencyKey: string;
}

// ─── Draft Order ──────────────────────────────────────────────────────────────

export interface DraftOrderLineItem {
  readonly variantId: string;
  readonly quantity: number;
}

export interface DraftOrderCreateInput {
  readonly lineItems: readonly DraftOrderLineItem[];
  readonly customerId: string | undefined;
  readonly note: string | undefined;
  readonly tags: readonly string[];
  readonly metadata: CorrelationMetadata;
}

export interface DraftOrderResult {
  readonly draftOrderId: string;
  readonly name: string;
  readonly status: string;
  readonly totalPrice: string;
  readonly currencyCode: string;
  readonly createdAt: string;
}

// ─── Order Finalize ───────────────────────────────────────────────────────────

export interface OrderFinalizeInput {
  readonly draftOrderId: string;
  readonly paymentPending: boolean;
  readonly metadata: CorrelationMetadata;
}

export interface OrderResult {
  readonly orderId: string;
  readonly name: string;
  readonly status: string;
  readonly totalPrice: string;
  readonly currencyCode: string;
  readonly createdAt: string;
}

// ─── Payment Record ───────────────────────────────────────────────────────────

export interface PaymentRecordInput {
  readonly orderId: string;
  readonly metadata: CorrelationMetadata;
}

export interface PaymentRecordResult {
  readonly orderId: string;
  readonly paymentStatus: string;
  readonly paidAt: string;
}

// ─── Order Cancel ─────────────────────────────────────────────────────────────

export interface OrderCancelInput {
  readonly orderId: string;
  readonly reason: string | undefined;
  readonly metadata: CorrelationMetadata;
}

export interface CancelResult {
  readonly orderId: string;
  readonly cancelledAt: string;
}

// ─── Refund ───────────────────────────────────────────────────────────────────

export interface RefundInput {
  readonly orderId: string;
  readonly reason: string | undefined;
  readonly metadata: CorrelationMetadata;
}

export interface RefundResult {
  readonly refundId: string;
  readonly orderId: string;
  readonly refundedAt: string;
}

// ─── Fulfillment (inbound webhook only — no outbound fulfillment API here) ────

/**
 * Shopify's REST-style webhook payload shape for fulfillments/create and
 * fulfillments/update (subscribed in shopify-manifest.ts's events.topics).
 * `order_id` is Shopify's plain NUMERIC order id, as delivered on the
 * webhook — NOT the GraphQL Admin API's `gid://shopify/Order/...` format
 * this codebase's own OrderResult.orderId uses elsewhere. A consumer that
 * needs to join this back to a Counter transaction (see
 * apps/control-plane-api/src/fulfillment-webhook-handler.ts) must construct
 * the matching GID itself before comparing.
 */
export interface ShopifyFulfillmentWebhookPayload {
  readonly id: number;
  readonly order_id: number;
  readonly status: string;
  readonly tracking_company: string | null;
  readonly tracking_number: string | null;
  readonly tracking_url: string | null;
  readonly updated_at: string;
}
