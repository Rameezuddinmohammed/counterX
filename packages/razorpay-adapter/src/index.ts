/**
 * packages/razorpay-adapter
 *
 * Razorpay Standard Checkout test adapter: server-side order creation,
 * callback verification, webhook processing. Implements the payment-sdk
 * provider interface for Razorpay in test environments.
 */

export const PACKAGE_NAME = "@counter/razorpay-adapter";

export { RAZORPAY_CONFIG_KEYS } from "./config.js";
export type { ConfigKeyDescriptor } from "./config.js";

/** Configuration for the Razorpay test adapter. */
export interface RazorpayTestAdapterConfig {
  readonly keyId: string;
  readonly keySecret: string;
  readonly webhookSecret: string;
  readonly environment: "test" | "live";
  readonly baseUrl: string;
}

/** Parameters for creating a Razorpay order. */
export interface RazorpayOrderParams {
  readonly amount: number;
  readonly currency: string;
  readonly receipt: string;
  readonly notes: Record<string, string>;
  readonly partialPayment: boolean;
}

// Types
export {
  amountToPaise,
  paiseToAmount,
} from "./types.js";
export type {
  RazorpayOrder,
  RazorpayPayment,
  RazorpayRefund,
  RazorpayWebhookEvent,
  RazorpayCallbackParams,
  RazorpaySignatureComponents,
} from "./types.js";

// HTTP Client
export type {
  RazorpayHttpPort,
  RazorpayHttpRequest,
  RazorpayHttpResponse,
} from "./http-client.js";
export { MockRazorpayHttp } from "./http-client.js";

// Provider
export { RazorpayTestProvider } from "./razorpay-provider.js";
export type { RazorpayProviderConfig } from "./razorpay-provider.js";

// Webhook Processor
export {
  WebhookDeduplicator,
  processWebhookEvent,
  normalizeRefundEvidence,
} from "./webhook-processor.js";
export type {
  ProcessedEvent,
  WebhookProcessingResult,
} from "./webhook-processor.js";

// Payment Action Grant
export {
  GRANT_EXPIRY_MS,
  createPaymentActionGrant,
  validateGrant,
  enforceGrant,
} from "./payment-action-grant.js";
export type {
  PaymentActionGrant,
  PaymentActionGrantBindings,
  GrantValidationResult,
} from "./payment-action-grant.js";

// Certification Workflow
export { RazorpayCertificationWorkflow } from "./certification-workflow.js";
export type {
  CertificationWorkflowConfig,
  CertificationStartCommand,
  CertificationStartResult,
  CertificationActionRequired,
  CertificationDeclined,
  CertificationCallbackCommand,
  CertificationCallbackResult,
  CertificationSuccess,
  CertificationBlocked,
  CertificationCallbackFailed,
  CertificationPolicyPort,
  CertificationPolicyDecision,
  CertificationDraftOrderPort,
  CertificationDraftResult,
  CertificationFinalizeResult,
  CertificationFindingPort,
  CertificationRefundPort,
} from "./certification-workflow.js";
