/**
 * Capability-level status types.
 *
 * Provides a snapshot of the operational status of each resource and
 * action within a connector, including freshness assessments.
 */

import type { Instant } from "@counter/domain";

import type { FreshnessAssessment } from "./freshness.js";
import type { HealthCheck } from "./health.js";

// ─── Status ───────────────────────────────────────────────────────────────────

export const CAPABILITY_STATUSES = ["available", "degraded", "suspended", "unavailable"] as const;
export type CapabilityStatus = (typeof CAPABILITY_STATUSES)[number];

const capabilityStatusSet: ReadonlySet<string> = new Set(CAPABILITY_STATUSES);

export function isCapabilityStatus(value: unknown): value is CapabilityStatus {
  return typeof value === "string" && capabilityStatusSet.has(value);
}

// ─── Resource Capability Status ───────────────────────────────────────────────

export interface ResourceCapabilityStatus {
  readonly resourceName: string;
  readonly status: CapabilityStatus;
  readonly freshness: FreshnessAssessment;
  readonly lastSuccessfulSync: Instant | null;
}

// ─── Action Capability Status ─────────────────────────────────────────────────

export interface ActionCapabilityStatus {
  readonly actionName: string;
  readonly status: CapabilityStatus;
  readonly lastExecutedAt: Instant | null;
  readonly consecutiveFailures: number;
}

// ─── Connector Capability Report ──────────────────────────────────────────────

export interface ConnectorCapabilityReport {
  readonly connectorId: string;
  readonly overallStatus: CapabilityStatus;
  readonly resources: readonly ResourceCapabilityStatus[];
  readonly actions: readonly ActionCapabilityStatus[];
  readonly lastHealthCheck: HealthCheck;
}
