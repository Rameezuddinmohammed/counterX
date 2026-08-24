/**
 * packages/merchant-application
 *
 * Merchant lifecycle, activation, tenancy, ownership verification, and
 * readiness. Manages the full lifecycle of a merchant from application
 * through activation to ongoing operation.
 */

export const PACKAGE_NAME = "@counter/merchant-application";

export { MERCHANT_APP_CONFIG_KEYS } from "./config.js";
export type { ConfigKeyDescriptor } from "./config.js";

// Tenancy and organization model
export * from "./tenancy.js";

// Lifecycle state machine
export * from "./lifecycle.js";

// Allowlist invitation
export * from "./invitation.js";

// Activation snapshot
export * from "./activation.js";

// Suspension and reactivation
export * from "./suspension.js";

// Persistence port interfaces
export * from "./repositories.js";
