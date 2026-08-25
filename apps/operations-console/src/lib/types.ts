/**
 * Shared TypeScript types for the Operations Console.
 *
 * These represent the data shapes consumed from operator APIs.
 * Real data comes from control-plane-api endpoints built in future tasks.
 */

/**
 * Health status for a single fleet dependency.
 */
export interface FleetHealth {
  readonly name: string;
  readonly status: "healthy" | "degraded" | "unhealthy";
  readonly lastChecked: string;
  readonly message?: string;
}

/**
 * Summary of an active incident.
 */
export interface IncidentSummary {
  readonly id: string;
  readonly title: string;
  readonly severity: "critical" | "warning" | "info";
  readonly scope: string;
  readonly startedAt: string;
  readonly resolvedAt?: string;
}

/**
 * Status of a job queue.
 */
export interface QueueStatus {
  readonly name: string;
  readonly depth: number;
  readonly oldestJobAge: number;
  readonly processingRate: number;
}

/**
 * A dead letter entry awaiting replay or purge.
 */
export interface DeadLetterEntry {
  readonly id: string;
  readonly queue: string;
  readonly failedAt: string;
  readonly attempts: number;
  readonly lastError: string;
}

/**
 * View of a kill switch for the console UI.
 */
export interface KillSwitchView {
  readonly id: string;
  readonly scope: string;
  readonly entityId: string | null;
  readonly status: "active" | "inactive";
  readonly reason: string;
  readonly activatedBy: string;
  readonly activatedAt: string;
  readonly expiresAt: string | null;
}

/**
 * View of an active support session (grant).
 */
export interface SupportSessionView {
  readonly grantId: string;
  readonly operatorId: string;
  readonly targetScope: string;
  readonly permissions: readonly string[];
  readonly reason: string;
  readonly purpose: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

/**
 * Status of a payment adapter or connector release.
 */
export interface AdapterReleaseStatus {
  readonly adapterId: string;
  readonly name: string;
  readonly version: string;
  readonly status: "healthy" | "degraded" | "offline";
  readonly lastDeployed: string;
  readonly transactionCount: number;
}

/**
 * Type guard for FleetHealth arrays.
 */
export function isFleetHealthArray(value: unknown): value is FleetHealth[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        "name" in item &&
        "status" in item &&
        "lastChecked" in item,
    )
  );
}

/**
 * Type guard for IncidentSummary arrays.
 */
export function isIncidentSummaryArray(value: unknown): value is IncidentSummary[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        "id" in item &&
        "title" in item &&
        "severity" in item &&
        "scope" in item &&
        "startedAt" in item,
    )
  );
}

/**
 * Type guard for QueueStatus arrays.
 */
export function isQueueStatusArray(value: unknown): value is QueueStatus[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        "name" in item &&
        "depth" in item &&
        "oldestJobAge" in item &&
        "processingRate" in item,
    )
  );
}

/**
 * Type guard for KillSwitchView arrays.
 */
export function isKillSwitchViewArray(value: unknown): value is KillSwitchView[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        "id" in item &&
        "scope" in item &&
        "status" in item &&
        "reason" in item,
    )
  );
}
