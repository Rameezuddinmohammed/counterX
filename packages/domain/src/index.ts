/**
 * Canonical, infrastructure-free domain primitives for Counter products.
 *
 * This package intentionally imports no frameworks, database drivers, cloud
 * SDKs, providers, MCP transports, or adapters (ADR-0001).
 */

export const PACKAGE_NAME = "@counter/domain";

export * from "./actor-scope.js";
export type { Brand } from "./brand.js";
export * from "./clock.js";
export * from "./currency.js";
export * from "./decimal-quantity.js";
export * from "./digest.js";
export * from "./environment.js";
export * from "./errors.js";
export * from "./ids.js";
export * from "./instant.js";
export * from "./money.js";
export * from "./result.js";
