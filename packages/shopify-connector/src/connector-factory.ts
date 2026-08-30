/**
 * Env-gated factory for a REAL Shopify connector.
 *
 * Bundles the real HTTP GraphQL client ({@link createHttpGraphQLClient}, which
 * already performs SSRF validation and sets the `X-Shopify-Access-Token`
 * header) together with the seven Shopify order {@link ActionPort}s so a caller
 * can drive the full draft -> finalize -> mark-paid -> query lifecycle from a
 * single resolved-credentials object.
 *
 * DEPENDENCY DIRECTION: the credential resolver (`resolveShopifyCredentials`)
 * lives in `apps/worker` and MUST NOT be imported here — packages must not
 * depend on apps (enforced by dependency-cruiser). The worker/scripts resolve
 * credentials and pass a plain config object into this factory.
 */

import type { ConnectorHealthPort } from "@counter/connector-sdk";

import { createHttpGraphQLClient } from "./http-graphql-client.js";
import type { ShopifyGraphQLPort } from "./graphql-client.js";
import {
  DraftOrderCreateAction,
  DraftOrderQueryAction,
  OrderFinalizeAction,
  PaymentRecordAction,
  OrderQueryAction,
  OrderCancelAction,
  OrderRefundAction,
} from "./order-actions.js";
import { createShopifyHealthPort } from "./health.js";
import type { ShopifyAuthConfig } from "./auth.js";

// ─── Factory Configuration ────────────────────────────────────────────────────

/**
 * Resolved Shopify Admin API credentials. Mirrors the shape produced by the
 * worker's `resolveShopifyCredentials` helper.
 */
export interface ShopifyConnectorConfig {
  readonly shopDomain: string;
  readonly accessToken: string;
  readonly apiVersion?: string | undefined;
}

// ─── Bundled Connector ──────────────────────────────────────────────────────

/**
 * The bundle of a real GraphQL client plus the seven order ActionPorts, all
 * bound to the same authenticated client.
 */
export interface ShopifyConnector {
  /** The underlying authenticated GraphQL client (shared by every action). */
  readonly client: ShopifyGraphQLPort;
  readonly draftOrderCreate: DraftOrderCreateAction;
  readonly draftOrderQuery: DraftOrderQueryAction;
  readonly orderFinalize: OrderFinalizeAction;
  readonly paymentRecord: PaymentRecordAction;
  readonly orderQuery: OrderQueryAction;
  readonly orderCancel: OrderCancelAction;
  readonly orderRefund: OrderRefundAction;
  /**
   * Optional health port. Only constructed when `authConfig` is supplied
   * (health checks need the token/scopes metadata, not just the client).
   */
  readonly health?: ConnectorHealthPort | undefined;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Constructs a {@link ShopifyConnector} from resolved credentials.
 *
 * Reuses the existing SSRF validation and authentication in
 * {@link createHttpGraphQLClient}; the seven order ActionPorts are wired to the
 * single client so they share its throttle tracking and idempotency behavior.
 * No mutation logic is duplicated here.
 *
 * When `authConfig` is provided a {@link ConnectorHealthPort} is also built so
 * the worker can probe connectivity/auth/rate-limit budget before driving a
 * real transaction.
 */
export function createShopifyConnectorFromConfig(
  config: ShopifyConnectorConfig,
  authConfig?: ShopifyAuthConfig,
): ShopifyConnector {
  const client = createHttpGraphQLClient({
    shopDomain: config.shopDomain,
    accessToken: config.accessToken,
    apiVersion: config.apiVersion,
  });

  const connector: ShopifyConnector = {
    client,
    draftOrderCreate: new DraftOrderCreateAction(client),
    draftOrderQuery: new DraftOrderQueryAction(client),
    orderFinalize: new OrderFinalizeAction(client),
    paymentRecord: new PaymentRecordAction(client),
    orderQuery: new OrderQueryAction(client),
    orderCancel: new OrderCancelAction(client),
    orderRefund: new OrderRefundAction(client),
    health: authConfig !== undefined ? createShopifyHealthPort({ client, authConfig }) : undefined,
  };

  return connector;
}
