/**
 * Configuration keys for the Razorpay adapter.
 *
 * Documents expected environment variables without containing secrets.
 * Actual values are resolved at runtime from the deployment environment.
 */

export interface ConfigKeyDescriptor {
  readonly name: string;
  readonly purpose: string;
  readonly required: boolean;
}

/**
 * Expected environment variable names for Razorpay adapter configuration.
 */
export const RAZORPAY_CONFIG_KEYS: readonly ConfigKeyDescriptor[] = [
  {
    name: "RAZORPAY_KEY_ID",
    purpose: "Razorpay API key ID for authentication",
    required: true,
  },
  {
    name: "RAZORPAY_KEY_SECRET",
    purpose: "Razorpay API key secret for server-side authentication",
    required: true,
  },
  {
    name: "RAZORPAY_WEBHOOK_SECRET",
    purpose: "Secret for verifying Razorpay webhook signatures",
    required: true,
  },
  {
    name: "RAZORPAY_ENVIRONMENT",
    purpose: "Deployment environment: test or live",
    required: true,
  },
  {
    name: "RAZORPAY_BASE_URL",
    purpose: "Base URL for Razorpay API (overridable for test environments)",
    required: false,
  },
] as const;
