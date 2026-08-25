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
