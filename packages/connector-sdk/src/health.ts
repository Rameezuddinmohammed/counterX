/**
 * Connector health checking types.
 *
 * Provides a health port that connectors implement to report their
 * operational status with component-level detail.
 */

import type { Instant } from "@counter/domain";

// ─── Status ───────────────────────────────────────────────────────────────────

export const CONNECTOR_HEALTH_STATUSES = ["healthy", "degraded", "unhealthy", "unknown"] as const;
export type ConnectorHealthStatus = (typeof CONNECTOR_HEALTH_STATUSES)[number];

const healthStatusSet: ReadonlySet<string> = new Set(CONNECTOR_HEALTH_STATUSES);

export function isConnectorHealthStatus(value: unknown): value is ConnectorHealthStatus {
  return typeof value === "string" && healthStatusSet.has(value);
}

// ─── Health Check Detail ──────────────────────────────────────────────────────

export interface HealthCheckDetail {
  readonly component: string;
  readonly status: ConnectorHealthStatus;
  readonly latencyMs: number | undefined;
}

// ─── Health Check ─────────────────────────────────────────────────────────────

export interface HealthCheck {
  readonly status: ConnectorHealthStatus;
  readonly lastCheckedAt: Instant;
  readonly message: string | undefined;
  readonly details: readonly HealthCheckDetail[];
}

// ─── Port ─────────────────────────────────────────────────────────────────────

export interface ConnectorHealthPort {
  checkHealth(): Promise<HealthCheck>;
}
