/**
 * Merchant organization and tenant-environment types.
 *
 * Each merchant operates within an organization. Each organization can have
 * multiple tenant-environments (e.g. sandbox, production). Cross-tenant
 * isolation is enforced at the type level via branded IDs and environment tags.
 */

import type { Brand } from "@counter/domain";
import type { CounterId, Instant, Environment } from "@counter/domain";

// ─── Organization ID ────────────────────────────────────────────────────────

/** Branded identifier for a merchant organization. */
export type OrganizationId = Brand<string, "OrganizationId">;

// ─── Tenant Status ──────────────────────────────────────────────────────────

export const TENANT_STATUSES = ["active", "suspended", "deprovisioned"] as const;

export type TenantStatus = (typeof TENANT_STATUSES)[number];

const tenantStatusSet: ReadonlySet<string> = new Set(TENANT_STATUSES);

export function isTenantStatus(value: unknown): value is TenantStatus {
  return typeof value === "string" && tenantStatusSet.has(value);
}

// ─── Merchant Organization ──────────────────────────────────────────────────

/**
 * A merchant organization is the top-level entity that owns one or more
 * tenant-environments. It represents the legal entity operating the merchant.
 */
export interface MerchantOrganization {
  readonly organizationId: OrganizationId;
  readonly legalName: string;
  readonly displayName: string;
  readonly contactEmail: string;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

// ─── Merchant Tenant Environment ────────────────────────────────────────────

/**
 * A tenant-environment is the combination of a merchant ID and an environment.
 * Cross-tenant isolation is enforced by requiring both the merchantId and the
 * environment to identify a specific runtime boundary.
 */
export interface MerchantTenantEnvironment {
  readonly merchantId: CounterId<"merchant">;
  readonly organizationId: OrganizationId;
  readonly environment: Environment;
  readonly status: TenantStatus;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}
