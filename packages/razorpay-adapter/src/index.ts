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
