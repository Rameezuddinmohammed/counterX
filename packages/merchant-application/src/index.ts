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

// Ownership verification
export * from "./verification.js";
export * from "./verification-methods.js";
export * from "./verification-service.js";
export * from "./verification-repository.js";

// Readiness engine and types
export * from "./readiness-types.js";
export * from "./readiness-engine.js";

// Capability manifest
export * from "./capability-manifest.js";

// Health evaluator
export * from "./health-evaluator.js";

// Pilot certification
export * from "./pilot-certification.js";

// Requirement traceability
export * from "./requirement-traceability.js";

// Evidence bundle
export * from "./evidence-bundle.js";
