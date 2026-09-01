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

export type { RazorpayTestAdapterConfig, RazorpayOrderParams } from "./adapter-config.js";

// Types
export { amountToPaise, paiseToAmount } from "./types.js";
export type {
  RazorpayOrder,
  RazorpayPayment,
  RazorpayRefund,
  RazorpayWebhookTokenEntity,
  RazorpayWebhookSubscriptionEntity,
  RazorpayWebhookEvent,
  RazorpayCallbackParams,
  RazorpaySignatureComponents,
} from "./types.js";

// HTTP Client
export type { RazorpayHttpPort, RazorpayHttpRequest, RazorpayHttpResponse } from "./http-client.js";
export { MockRazorpayHttp } from "./http-client.js";

// Real fetch-based HTTP client
export {
  createRazorpayHttpClient,
  redactAuthorization,
  RAZORPAY_IDEMPOTENCY_HEADER,
  DEFAULT_REQUEST_TIMEOUT_MS,
  TRANSPORT_UNAVAILABLE_STATUS,
} from "./real-http-client.js";
export type { RealRazorpayHttpConfig, TransportFailureBody } from "./real-http-client.js";

// Real provider factory
export {
  createRealRazorpayProvider,
  createRealRazorpayRecurringMandateProvider,
  createRealRazorpayOrderVerificationProvider,
} from "./real-provider-factory.js";
export type { RealRazorpayProviderConfig } from "./real-provider-factory.js";

// Provider
export { RazorpayTestProvider } from "./razorpay-provider.js";
export type { RazorpayProviderConfig } from "./razorpay-provider.js";

// Order verification provider (real one-time payment capture — see file header)
export { RazorpayOrderVerificationProvider } from "./order-verification-provider.js";
export type { RazorpayOrderVerificationProviderConfig } from "./order-verification-provider.js";

// Recurring payment mandate (UPI Autopay / e-mandate) provider
export { RazorpayRecurringMandateProvider } from "./recurring-mandate-provider.js";
export type {
  RazorpayRecurringMandateProviderConfig,
  CreateCustomerParams,
  CreateRegistrationOrderParams,
  RegistrationCallbackInput,
  RegistrationCallbackResult,
  TokenStatus,
  ChargeRecurringParams,
} from "./recurring-mandate-provider.js";
export type {
  RazorpayCustomer,
  RazorpayToken,
  RazorpayRecurringOrder,
  RazorpayRecurringPayment,
} from "./recurring-types.js";

// Shared signing helpers
export { hmacSha256, timingSafeEquals } from "./signing.js";

// Webhook Processor
export {
  WebhookDeduplicator,
  processWebhookEvent,
  normalizeRefundEvidence,
} from "./webhook-processor.js";
export type { ProcessedEvent, WebhookProcessingResult } from "./webhook-processor.js";

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
