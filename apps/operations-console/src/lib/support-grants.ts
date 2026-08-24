/**
 * Support grant management for the operations console.
 *
 * Support grants are scoped, time-limited, and audited access
 * permissions given to support operators for merchant accounts.
 */

// ─── Types ─────────────────────────────────────────────────────────────────────

/**
 * Status of a support grant.
 */
export type GrantStatus = "active" | "expired" | "revoked";

/**
 * A support grant provides scoped, time-limited access for support operators.
 */
export interface SupportGrant {
  readonly id: string;
  readonly merchantId: string;
  readonly operatorId: string;
  readonly permissions: readonly string[];
  readonly reason: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly revokedAt?: string;
  readonly revokedBy?: string;
  readonly status: GrantStatus;
}

/**
 * Configuration for creating a new support grant.
 */
export interface CreateGrantConfig {
  readonly merchantId: string;
  readonly operatorId: string;
  readonly permissions: readonly string[];
  readonly reason: string;
  readonly durationMinutes: number;
}

/**
 * Port for grant persistence (dependency injection).
 */
export interface GrantStore {
  save(grant: SupportGrant): Promise<void>;
  findById(id: string): Promise<SupportGrant | null>;
  findByMerchant(merchantId: string): Promise<readonly SupportGrant[]>;
  update(grant: SupportGrant): Promise<void>;
}

/**
 * Result of a grant operation.
 */
export interface GrantOperationResult {
  readonly success: boolean;
  readonly grantId: string;
  readonly message: string;
}

// ─── Validation ─────────────────────────────────────────────────────────────────

/**
 * Valid permissions that can be granted for support access.
 */
export const VALID_PERMISSIONS: readonly string[] = Object.freeze([
  "view_transactions",
  "view_merchant_details",
  "view_audit_log",
  "retry_transaction",
  "void_transaction",
  "issue_refund",
  "export_data",
]);

/**
 * Maximum grant duration (8 hours).
 */
export const MAX_GRANT_DURATION_MINUTES = 480;

/**
 * Validates a grant configuration.
 */
export function validateGrantConfig(config: CreateGrantConfig): {
  readonly valid: boolean;
  readonly errors: readonly string[];
} {
  const errors: string[] = [];

  if (!config.merchantId) errors.push("Merchant ID is required");
  if (!config.operatorId) errors.push("Operator ID is required");
  if (!config.reason || config.reason.length < 10) {
    errors.push("Reason is required and must be at least 10 characters");
  }
  if (config.permissions.length === 0) {
    errors.push("At least one permission is required");
  }
  const invalidPerms = config.permissions.filter((p) => !VALID_PERMISSIONS.includes(p));
  if (invalidPerms.length > 0) {
    errors.push(`Invalid permissions: ${invalidPerms.join(", ")}`);
  }
  if (config.durationMinutes < 1) {
    errors.push("Duration must be at least 1 minute");
  }
  if (config.durationMinutes > MAX_GRANT_DURATION_MINUTES) {
    errors.push(`Duration cannot exceed ${MAX_GRANT_DURATION_MINUTES} minutes`);
  }

  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

// ─── Grant Operations ───────────────────────────────────────────────────────────

/**
 * Generates a unique grant ID.
 */
function generateGrantId(): string {
  return `grant-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Creates a new support grant with mandatory reason and expiry.
 */
export async function createSupportGrant(
  store: GrantStore,
  config: CreateGrantConfig,
): Promise<GrantOperationResult> {
  const validation = validateGrantConfig(config);
  if (!validation.valid) {
    return Object.freeze({
      success: false,
      grantId: "",
      message: `Validation failed: ${validation.errors.join("; ")}`,
    });
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.durationMinutes * 60000);

  const grant: SupportGrant = Object.freeze({
    id: generateGrantId(),
    merchantId: config.merchantId,
    operatorId: config.operatorId,
    permissions: Object.freeze([...config.permissions]),
    reason: config.reason,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    status: "active" as const,
  });

  await store.save(grant);

  return Object.freeze({
    success: true,
    grantId: grant.id,
    message: `Support grant created, expires at ${grant.expiresAt}`,
  });
}

/**
 * Revokes an active support grant.
 */
export async function revokeSupportGrant(
  store: GrantStore,
  grantId: string,
  revokedBy: string,
): Promise<GrantOperationResult> {
  const existing = await store.findById(grantId);

  if (!existing) {
    return Object.freeze({
      success: false,
      grantId,
      message: "Grant not found",
    });
  }

  if (existing.status !== "active") {
    return Object.freeze({
      success: false,
      grantId,
      message: `Cannot revoke grant with status: ${existing.status}`,
    });
  }

  const revoked: SupportGrant = Object.freeze({
    ...existing,
    status: "revoked" as const,
    revokedAt: new Date().toISOString(),
    revokedBy,
  });

  await store.update(revoked);

  return Object.freeze({
    success: true,
    grantId,
    message: "Support grant revoked",
  });
}

/**
 * Lists active grants for a given merchant.
 * Filters out expired grants based on current time.
 */
export async function listActiveGrants(
  store: GrantStore,
  merchantId: string,
): Promise<readonly SupportGrant[]> {
  const grants = await store.findByMerchant(merchantId);
  const now = new Date();

  return Object.freeze(
    grants.filter(
      (g) => g.status === "active" && new Date(g.expiresAt) > now,
    ),
  );
}
