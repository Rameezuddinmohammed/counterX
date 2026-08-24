/**
 * packages/reference-connector
 *
 * Generic REST reference connector for contract testing and certification.
 * Provides a baseline implementation of the connector-sdk ports that can
 * be used for testing and as a template for new connectors.
 */

import type { ConnectorContract, ConnectorManifest, ResourceReadPort, ActionPort } from "@counter/connector-sdk";

import {
  createQuoteAction,
  createDraftOrderAction,
  createCompleteOrderAction,
  createCancelOrderAction,
  createRefundAction,
  InventoryStore,
} from "./actions.js";
import { ALL_VARIANTS } from "./catalog.js";
import { DeterministicEventStream } from "./event-stream.js";
import { createFaultControls } from "./fault-controls.js";
import type { FaultControlsConfig } from "./fault-controls.js";
import { createHealthPort } from "./health.js";
import { REFERENCE_CONNECTOR_MANIFEST } from "./manifest.js";
import { createProductResourcePort, createVariantResourcePort } from "./resources.js";

// ─── Package Identity ─────────────────────────────────────────────────────────

export const PACKAGE_NAME = "@counter/reference-connector";

// ─── Re-exports ───────────────────────────────────────────────────────────────

export { REFERENCE_CONNECTOR_MANIFEST } from "./manifest.js";
export { createFaultControls, DEFAULT_FAULT_CONFIG } from "./fault-controls.js";
export type { FaultControls, FaultControlsConfig } from "./fault-controls.js";
export { DeterministicEventStream, EVENT_TOPICS } from "./event-stream.js";
export type { EventTopic, ConnectorEvent } from "./event-stream.js";
export { createProductResourcePort, createVariantResourcePort } from "./resources.js";
export { createHealthPort } from "./health.js";
export {
  createQuoteAction,
  createDraftOrderAction,
  createCompleteOrderAction,
  createCancelOrderAction,
  createRefundAction,
  InventoryStore,
} from "./actions.js";
export type {
  QuotePayload,
  QuoteResult,
  OrderPayload,
  OrderResult,
  CancelPayload,
  CancelResult,
  RefundPayload,
  RefundResult,
} from "./actions.js";
export {
  CATALOG_PRODUCTS,
  ALL_VARIANTS,
  CONNECTOR_SOURCE,
  getProduct,
  getVariant,
  findProductsByName,
  findVariantsByName,
  productReference,
  variantReference,
} from "./catalog.js";
export type { Product, ProductVariant } from "./catalog.js";

// ─── Connector Options ────────────────────────────────────────────────────────

export interface ReferenceConnectorOptions {
  readonly faultConfig?: Partial<FaultControlsConfig>;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createReferenceConnector(
  options: ReferenceConnectorOptions = {},
): ConnectorContract<ConnectorManifest> {
  const faultControls = createFaultControls(options.faultConfig);
  const eventStream = new DeterministicEventStream(faultControls);

  // Initialize inventory from catalog
  const initialInventory = new Map<string, number>();
  for (const variant of ALL_VARIANTS) {
    initialInventory.set(variant.variantId, variant.inventoryQuantity);
  }
  const inventory = new InventoryStore(initialInventory);

  const resources: Readonly<Record<string, ResourceReadPort<unknown>>> = {
    products: createProductResourcePort(faultControls),
    variants: createVariantResourcePort(faultControls),
  };

  const actions: Readonly<Record<string, ActionPort<unknown, unknown>>> = {
    create_quote: createQuoteAction(eventStream, faultControls) as ActionPort<unknown, unknown>,
    create_draft_order: createDraftOrderAction(eventStream, inventory, faultControls) as ActionPort<unknown, unknown>,
    complete_order: createCompleteOrderAction(eventStream, inventory, faultControls) as ActionPort<unknown, unknown>,
    cancel_order: createCancelOrderAction(eventStream, inventory, faultControls) as ActionPort<unknown, unknown>,
    create_refund: createRefundAction(eventStream, faultControls) as ActionPort<unknown, unknown>,
  };

  return {
    manifest: REFERENCE_CONNECTOR_MANIFEST,
    resources,
    actions,
    health: createHealthPort(),
  };
}
