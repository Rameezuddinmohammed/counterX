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

/** The possible states in a merchant's lifecycle. */
export type MerchantLifecycleState =
  | "pending"
  | "reviewing"
  | "approved"
  | "activated"
  | "suspended"
  | "deactivated";

/** A merchant's profile information. */
export interface MerchantProfile {
  readonly merchantId: string;
  readonly displayName: string;
  readonly legalName: string;
  readonly contactEmail: string;
  readonly lifecycleState: MerchantLifecycleState;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Record of a merchant activation event. */
export interface ActivationRecord {
  readonly merchantId: string;
  readonly activatedAt: string;
  readonly activatedBy: string;
  readonly environment: MerchantEnvironment;
}

/** The environment configuration for a merchant. */
export interface MerchantEnvironment {
  readonly mode: "test" | "live";
  readonly region: string;
  readonly connectorIds: readonly string[];
}

/** A readiness check to verify merchant can operate. */
export interface ReadinessCheck {
  readonly checkId: string;
  readonly merchantId: string;
  readonly category: string;
  readonly executedAt: string;
  readonly findings: readonly ReadinessFinding[];
  readonly passed: boolean;
}

/** An individual finding from a readiness check. */
export interface ReadinessFinding {
  readonly code: string;
  readonly severity: "error" | "warning" | "info";
  readonly message: string;
  readonly remediation: string;
}
