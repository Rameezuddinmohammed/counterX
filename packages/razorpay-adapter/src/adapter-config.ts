/**
 * Configuration types for the Razorpay test adapter.
 *
 * Extracted into a separate module to avoid circular dependencies
 * between internal modules and the barrel index.ts.
 */

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
