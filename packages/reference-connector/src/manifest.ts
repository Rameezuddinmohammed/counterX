/**
 * Full ConnectorManifest declaration for the reference connector.
 *
 * This connector is certificationOnly - not advertised in pilot discovery.
 */

import type { Instant } from "@counter/domain";
import type { ConnectorManifest } from "@counter/connector-sdk";

// ─── Manifest ─────────────────────────────────────────────────────────────────

export const REFERENCE_CONNECTOR_MANIFEST: ConnectorManifest = {
  connectorId: "reference-connector",
  platform: "reference",
  version: "0.1.0",

  resources: [
    {
      name: "products",
      schemaDescription: "Synthetic apparel products with size/color variants",
      supportedOperations: ["list", "get", "search"],
      pagination: {
        defaultPageSize: 10,
        maxPageSize: 50,
        cursorBased: true,
      },
      freshnessBudgetMs: 30_000,
    },
    {
      name: "variants",
      schemaDescription: "Individual product variants with SKU, price, and inventory",
      supportedOperations: ["list", "get", "search"],
      pagination: {
        defaultPageSize: 20,
        maxPageSize: 100,
        cursorBased: true,
      },
      freshnessBudgetMs: 15_000,
    },
  ],

  actions: [
    {
      name: "create_quote",
      schemaDescription: "Creates a price quote for a variant and quantity",
      preconditions: [],
      idempotencyStrategy: "native",
      timeoutSemantics: "before_effect",
      expectedEffects: ["quote_created event emitted"],
      authorizationRequirements: ["connector.write"],
      compensationPath: null,
    },
    {
      name: "create_draft_order",
      schemaDescription: "Creates a draft order from a quote",
      preconditions: ["quote must exist"],
      idempotencyStrategy: "native",
      timeoutSemantics: "before_effect",
      expectedEffects: ["draft_order_created event emitted"],
      authorizationRequirements: ["connector.write"],
      compensationPath: {
        actionName: "cancel_order",
        description: "Cancel the draft order",
      },
    },
    {
      name: "complete_order",
      schemaDescription: "Completes a draft order and reserves inventory",
      preconditions: ["order must be in draft state"],
      idempotencyStrategy: "native",
      timeoutSemantics: "after_effect",
      expectedEffects: ["inventory reserved", "order_completed event emitted"],
      authorizationRequirements: ["connector.write"],
      compensationPath: {
        actionName: "cancel_order",
        description: "Cancel and release inventory",
      },
    },
    {
      name: "cancel_order",
      schemaDescription: "Cancels an order and releases reserved inventory",
      preconditions: ["order must exist"],
      idempotencyStrategy: "native",
      timeoutSemantics: "before_effect",
      expectedEffects: ["inventory released", "order_cancelled event emitted"],
      authorizationRequirements: ["connector.write"],
      compensationPath: null,
    },
    {
      name: "create_refund",
      schemaDescription: "Creates a refund for a completed order",
      preconditions: ["order must be completed"],
      idempotencyStrategy: "native",
      timeoutSemantics: "after_effect",
      expectedEffects: ["refund_created event emitted"],
      authorizationRequirements: ["connector.write"],
      compensationPath: null,
    },
  ],

  auth: {
    method: "api_key",
    scopesRequired: ["connector.read", "connector.write"],
    tokenRotation: false,
    secretReferences: ["REFERENCE_CONNECTOR_API_KEY"],
  },

  rateLimits: {
    strategy: "token_bucket",
    maxRequestsPerSecond: 100,
    costAwareThrottling: false,
    backoffPolicy: "exponential",
  },

  freshness: {
    defaultBudgetMs: 30_000,
    perResourceBudgets: [
      { resourceName: "products", budgetMs: 30_000 },
      { resourceName: "variants", budgetMs: 15_000 },
    ],
  },

  events: {
    mode: "polling",
    topics: [
      "quote_created",
      "draft_order_created",
      "order_completed",
      "order_cancelled",
      "refund_created",
    ],
    deduplicationStrategy: "sequence_number",
    signatureVerification: false,
  },

  sandboxBehavior: {
    useMockData: true,
    simulateLatency: false,
    maxLatencyMs: 0,
  },

  idempotencyStrategy: "native",

  compensationDeclarations: [
    {
      actionName: "complete_order",
      compensatingAction: "cancel_order",
      timeWindowMs: 3_600_000,
    },
  ],

  dataClassification: "internal",

  createdAt: 1_700_000_000_000 as Instant,
};
