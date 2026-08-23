/**
 * packages/payment-sdk
 *
 * `PaymentAuthorization` and `PaymentProvider` ports (see design.md
 * "Authorization and policy" ports section) plus the deterministic test
 * provider and contract harness.
 */

export const PACKAGE_NAME = "@counter/payment-sdk";

export * from "./types.js";
export * from "./authorization.js";
export * from "./test-authorization.js";
export * from "./provider.js";
export * from "./test-provider.js";
export * from "./contract-harness.js";
