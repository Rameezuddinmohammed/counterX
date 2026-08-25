/**
 * Configuration keys for the Shopify connector.
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
 * Expected environment variable names for Shopify connector configuration.
 */
export const SHOPIFY_CONFIG_KEYS: readonly ConfigKeyDescriptor[] = [
  {
    name: "SHOPIFY_SHOP_DOMAIN",
    purpose: "The myshopify.com domain for the target store",
    required: true,
  },
  {
    name: "SHOPIFY_ACCESS_TOKEN",
    purpose: "Admin API access token for authenticated requests",
    required: true,
  },
  {
    name: "SHOPIFY_API_VERSION",
    purpose: "Shopify Admin API version (e.g. 2024-01)",
    required: true,
  },
  {
    name: "SHOPIFY_WEBHOOK_SECRET",
    purpose: "HMAC secret for verifying incoming Shopify webhooks",
    required: true,
  },
  {
    name: "SHOPIFY_SCOPES",
    purpose: "Comma-separated list of OAuth scopes granted to the app",
    required: false,
  },
] as const;
