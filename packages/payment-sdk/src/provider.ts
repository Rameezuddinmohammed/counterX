import type {
  AuthorizePayment,
  CapturePayment,
  CreatePaymentInstruction,
  PaymentOperationResult,
  ProviderCapabilities,
  ProviderContext,
  ProviderPaymentEvidence,
  ProviderReference,
  ProviderRefundEvidence,
  ProviderRefundReference,
  RawClientReturn,
  RawWebhook,
  RefundCommand,
  UntrustedOrVerifiedReturn,
  VerifiedProviderEvent,
  VoidPayment,
} from "./types.js";

/**
 * Port interface for payment provider adapters.
 *
 * Implementations wrap a specific provider's API (e.g., Stripe, Razorpay)
 * behind this uniform contract so the SDK can orchestrate payment flows
 * without coupling to provider-specific details.
 */
export interface PaymentProvider {
  capabilities(context: ProviderContext): Promise<ProviderCapabilities>;
  createInstruction(command: CreatePaymentInstruction): Promise<PaymentOperationResult>;
  verifyClientReturn(input: RawClientReturn): Promise<UntrustedOrVerifiedReturn>;
  authorize?(command: AuthorizePayment): Promise<PaymentOperationResult>;
  capture?(command: CapturePayment): Promise<PaymentOperationResult>;
  void?(command: VoidPayment): Promise<PaymentOperationResult>;
  query(reference: ProviderReference): Promise<ProviderPaymentEvidence>;
  refund(command: RefundCommand): Promise<PaymentOperationResult>;
  queryRefund(reference: ProviderRefundReference): Promise<ProviderRefundEvidence>;
  verifyWebhook(input: RawWebhook): Promise<VerifiedProviderEvent>;
}
