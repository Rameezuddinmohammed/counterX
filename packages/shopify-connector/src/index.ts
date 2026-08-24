/**
 * packages/shopify-connector
 *
 * Shopify Admin API adapter: authentication, catalog sync, typed
 * draft/order actions. Implements the connector-sdk ports for the
 * Shopify platform.
 */

export const PACKAGE_NAME = "@counter/shopify-connector";

export { SHOPIFY_CONFIG_KEYS } from "./config.js";
export type { ConfigKeyDescriptor } from "./config.js";

// ─── GraphQL Client ───────────────────────────────────────────────────────────

export type {
  ShopifyGraphQLPort,
  ShopifyGraphQLResponse,
  ShopifyGraphQLError,
  ShopifyThrottleStatus,
} from "./graphql-client.js";

export {
  createHttpGraphQLClient,
  validateShopDomainSsrf,
  isPrivateIp,
} from "./http-graphql-client.js";
export type {
  HttpGraphQLClientConfig,
  DomainValidationResult,
} from "./http-graphql-client.js";

export {
  createMockGraphQLClient,
} from "./mock-graphql-client.js";
export type {
  MockShopifyClient,
  MockCallRecord,
  MockFault,
  MockGraphQLClientConfig,
} from "./mock-graphql-client.js";

// ─── Authentication ───────────────────────────────────────────────────────────

export {
  validateToken,
  verifyWebhookSignature,
  checkScopes,
  validateShopDomain,
  redactCredentials,
} from "./auth.js";
export type {
  ShopifyTokenValidation,
  ScopeCheckResult,
} from "./auth.js";

// ─── Health ───────────────────────────────────────────────────────────────────

export { createShopifyHealthPort } from "./health.js";
export type { ShopifyHealthConfig } from "./health.js";

// ─── Manifest ─────────────────────────────────────────────────────────────────

export { SHOPIFY_CONNECTOR_MANIFEST } from "./shopify-manifest.js";

// ─── Catalog Queries ──────────────────────────────────────────────────────────

export {
  SHOPIFY_MAPPING_VERSION,
  PRODUCTS_LIST_ESTIMATED_COST,
  SINGLE_PRODUCT_ESTIMATED_COST,
  PRODUCT_COUNT_ESTIMATED_COST,
  PRODUCTS_LIST_QUERY,
  SINGLE_PRODUCT_QUERY,
  PRODUCT_COUNT_QUERY,
  mapShopifyVariant,
  mapShopifyProduct,
  mapVariantToPriceSnapshot,
  mapVariantToInventorySnapshot,
} from "./catalog-queries.js";
export type {
  ShopifyMoneyV2,
  ShopifyVariantNode,
  ShopifyProductNode,
  ShopifyProductsListResponse,
  ShopifySingleProductResponse,
  ShopifyProductCountResponse,
  ShopifyInventoryLevel,
} from "./catalog-queries.js";

// ─── Sync Cursor ──────────────────────────────────────────────────────────────

export { InMemoryCursorStore, SYNC_STATES } from "./sync-cursor.js";
export type { DurableCursor, CursorStore, SyncState } from "./sync-cursor.js";

// ─── Catalog Sync ─────────────────────────────────────────────────────────────

export { CatalogSyncService } from "./catalog-sync.js";
export type {
  WebhookEvent,
  WebhookProductPayload,
  WebhookVariantPayload,
  BackfillOptions,
  SyncResult,
} from "./catalog-sync.js";

// ─── Webhook Inbox ────────────────────────────────────────────────────────────

export { WebhookInbox } from "./webhook-inbox.js";
export type {
  WebhookHeaders,
  WebhookAcceptance,
  DeadLetterEntry,
} from "./webhook-inbox.js";

// ─── Retry ────────────────────────────────────────────────────────────────────

export {
  DEFAULT_RETRY_CONFIG,
  calculateDelay,
  sleep,
  withRetry,
  withRetryResult,
  extractShopifyRateLimit,
} from "./retry.js";
export type {
  RetryConfig,
  RetryExhaustedError,
  RateLimitContext,
} from "./retry.js";

// ─── Legacy Types (backward compat) ──────────────────────────────────────────

/**
 * @deprecated Use `ConnectorManifest` from `@counter/connector-sdk` with `SHOPIFY_CONNECTOR_MANIFEST` instead.
 */
export interface ShopifyConnectorManifest {
  readonly connectorId: string;
  readonly platform: "shopify";
  readonly apiVersion: string;
  readonly capabilities: readonly string[];
  readonly supportedActions: readonly string[];
}

/**
 * @deprecated Use `ShopifyAuthConfig` from `./auth.js` instead.
 */
export type { ShopifyAuthConfig } from "./auth.js";
