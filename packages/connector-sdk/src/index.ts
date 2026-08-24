/**
 * packages/connector-sdk
 *
 * Merchant connector ports (capability/freshness declarations) and the
 * contract-test harness consumed by product-specific connectors.
 *
 * The SDK defines the contract that all connectors must implement. It
 * enforces that connectors can only return typed observations - they
 * cannot execute arbitrary SQL or mutate domain state directly.
 */

export * from "./types.js";
export * from "./resource-ports.js";
export * from "./action-ports.js";
export * from "./observations.js";
export * from "./freshness.js";
export * from "./health.js";
export * from "./errors.js";
export * from "./capability-status.js";
export * from "./safety-boundary.js";
export * from "./certification-harness.js";
export * from "./fixtures.js";
