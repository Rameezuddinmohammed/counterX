/**
 * Configuration keys for the merchant-application package.
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
 * Expected environment variable names for merchant application configuration.
 */
export const MERCHANT_APP_CONFIG_KEYS: readonly ConfigKeyDescriptor[] = [
  {
    name: "MERCHANT_DEFAULT_REGION",
    purpose: "Default region for new merchant environments",
    required: true,
  },
  {
    name: "MERCHANT_ACTIVATION_TIMEOUT_MS",
    purpose: "Timeout in milliseconds for merchant activation workflows",
    required: false,
  },
  {
    name: "MERCHANT_MAX_CONNECTORS",
    purpose: "Maximum number of connectors a merchant can register",
    required: false,
  },
  {
    name: "MERCHANT_READINESS_CHECK_INTERVAL_MS",
    purpose: "Interval in milliseconds between readiness check executions",
    required: false,
  },
] as const;
