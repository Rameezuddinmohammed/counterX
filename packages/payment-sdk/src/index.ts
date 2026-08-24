/**
 * packages/payment-sdk
 *
 * `PaymentAuthorization` and `PaymentProvider` ports (see design.md
 * "Authorization and policy" ports section) plus the deterministic test
 * provider, contract harness, and autonomous checkout orchestrator.
 */

export const PACKAGE_NAME = "@counter/payment-sdk";

export * from "./types.js";
export * from "./authorization.js";
export * from "./test-authorization.js";
export * from "./provider.js";
export * from "./test-provider.js";
export * from "./contract-harness.js";
export * from "./checkout-types.js";
export * from "./checkout-limits.js";
export * from "./kill-switch.js";
export * from "./checkout-orchestrator.js";
