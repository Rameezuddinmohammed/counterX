/**
 * packages/shopify-connector
 *
 * Shopify Admin API adapter: authentication, catalog sync, typed
 * draft/order actions. Implements the connector-sdk ports for the
 * Shopify platform.
 */

export const PACKAGE_NAME = "@counter/shopify-connector";

/** Manifest describing the Shopify connector capabilities. */
export interface ShopifyConnectorManifest {
  readonly connectorId: string;
  readonly platform: "shopify";
  readonly apiVersion: string;
  readonly capabilities: readonly string[];
  readonly supportedActions: readonly string[];
}

/** Authentication configuration for connecting to Shopify. */
export interface ShopifyAuthConfig {
  readonly shopDomain: string;
  readonly accessToken: string;
  readonly apiVersion: string;
  readonly scopes: readonly string[];
}
