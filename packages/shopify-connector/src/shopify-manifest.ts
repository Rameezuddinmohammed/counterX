/**
 * Full ConnectorManifest declaration for the Shopify connector.
 *
 * Platform: shopify, API version: 2025-07.
 * Follows the reference-connector manifest pattern.
 */

import type { Instant } from "@counter/domain";
import type { ConnectorManifest } from "@counter/connector-sdk";

// --- Manifest ---

export const SHOPIFY_CONNECTOR_MANIFEST: ConnectorManifest = {
  connectorId: "shopify-connector",
  platform: "shopify",
  version: "2025-07",

  resources: [
    {
      name: "products",
      schemaDescription: "Shopify products with title, description, status, and metadata",
      supportedOperations: ["list", "get", "search"],
      pagination: {
        defaultPageSize: 50,
        maxPageSize: 250,
        cursorBased: true,
      },
      freshnessBudgetMs: 60_000,
    },
    {
      name: "variants",
      schemaDescription: "Product variants with SKU, price, inventory quantity, and options",
      supportedOperations: ["list", "get", "search"],
      pagination: {
        defaultPageSize: 50,
        maxPageSize: 250,
        cursorBased: true,
      },
      freshnessBudgetMs: 30_000,
    },
  ],

  actions: [
    {
      name: "create_draft_order",
      schemaDescription: "Creates a draft order with line items and customer info",
      preconditions: ["products must exist", "inventory must be available"],
      idempotencyStrategy: "native",
      timeoutSemantics: "before_effect",
      expectedEffects: ["draft_order_created event emitted"],
      authorizationRequirements: ["write_draft_orders"],
      compensationPath: null,
    },
    {
      name: "complete_draft_order",
      schemaDescription: "Completes a draft order, converting it to a real order",
      preconditions: ["draft order must exist"],
      idempotencyStrategy: "native",
      timeoutSemantics: "after_effect",
      expectedEffects: ["order_created event emitted", "inventory reserved"],
      authorizationRequirements: ["write_draft_orders"],
      compensationPath: {
        actionName: "cancel_order",
        description: "Cancel the completed order",
      },
    },
    {
      name: "mark_order_paid",
      schemaDescription: "Marks an order as paid",
      preconditions: ["order must exist", "order must not already be paid"],
      idempotencyStrategy: "native",
      timeoutSemantics: "after_effect",
      expectedEffects: ["order_paid event emitted"],
      authorizationRequirements: ["write_orders"],
      compensationPath: {
        actionName: "create_refund",
        description: "Refund the paid order",
      },
    },
    {
      name: "cancel_order",
      schemaDescription: "Cancels an existing order and releases held inventory",
      preconditions: ["order must exist", "order must not be fulfilled"],
      idempotencyStrategy: "native",
      timeoutSemantics: "before_effect",
      expectedEffects: ["order_cancelled event emitted", "inventory released"],
      authorizationRequirements: ["write_orders"],
      compensationPath: null,
    },
    {
      name: "create_refund",
      schemaDescription: "Creates a refund for a completed and paid order",
      preconditions: ["order must be paid"],
      idempotencyStrategy: "native",
      timeoutSemantics: "after_effect",
      expectedEffects: ["refund_created event emitted"],
      authorizationRequirements: ["write_orders"],
      compensationPath: null,
    },
  ],

  auth: {
    method: "oauth",
    scopesRequired: [
      "read_products",
      "write_draft_orders",
      "read_orders",
      "write_orders",
      "read_inventory",
    ],
    tokenRotation: true,
    secretReferences: [
      "SHOPIFY_ACCESS_TOKEN",
      "SHOPIFY_WEBHOOK_SECRET",
    ],
  },

  rateLimits: {
    strategy: "token_bucket",
    maxRequestsPerSecond: 50,
    costAwareThrottling: true,
    backoffPolicy: "exponential",
  },

  freshness: {
    defaultBudgetMs: 60_000,
    perResourceBudgets: [
      { resourceName: "products", budgetMs: 60_000 },
      { resourceName: "variants", budgetMs: 30_000 },
    ],
  },

  events: {
    mode: "both",
    topics: [
      "products/create",
      "products/update",
      "products/delete",
      "orders/create",
      "orders/updated",
      "orders/cancelled",
      "orders/paid",
      "refunds/create",
      "inventory_levels/update",
    ],
    deduplicationStrategy: "webhook_id",
    signatureVerification: true,
  },

  sandboxBehavior: {
    useMockData: true,
    simulateLatency: false,
    maxLatencyMs: 0,
  },

  idempotencyStrategy: "native",

  compensationDeclarations: [
    {
      actionName: "complete_draft_order",
      compensatingAction: "cancel_order",
      timeWindowMs: 3_600_000,
    },
    {
      actionName: "mark_order_paid",
      compensatingAction: "create_refund",
      timeWindowMs: 86_400_000,
    },
  ],

  dataClassification: "confidential",

  createdAt: 1_700_000_000_000 as Instant,
};
