/**
 * packages/merchant-contracts
 *
 * Merchant API route schemas: capability, search, quote, transaction,
 * receipt contracts. Defines the API contract types for merchant-facing
 * endpoints including request/response shapes and error contracts.
 */

export const PACKAGE_NAME = "@counter/merchant-contracts";

export * from "./route-schemas.js";
export { generateOpenApiSpec, type OpenApiSpec } from "./openapi-generator.js";
