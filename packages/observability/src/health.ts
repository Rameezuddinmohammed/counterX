/**
 * Dependency health check registry.
 *
 * Each dependency (database, provider, outbox worker, etc.) implements a
 * health check returning its current status. The registry aggregates checks
 * to produce a fleet-level health signal.
 */
import type { Instant } from "@counter/domain";

export const HEALTH_STATUSES = ["healthy", "degraded", "unhealthy"] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

/**
 * Result of a single dependency health check.
 */
export interface DependencyHealthResult {
  readonly name: string;
  readonly status: HealthStatus;
  readonly lastChecked: Instant;
  readonly message?: string;
}

/**
 * Interface that each dependency health check must implement.
 */
export interface DependencyHealthCheck {
  readonly name: string;
  check(): Promise<DependencyHealthResult>;
}

/**
 * Aggregated health status across all registered dependencies.
 */
export interface AggregateHealthResult {
  readonly status: HealthStatus;
  readonly dependencies: readonly DependencyHealthResult[];
}

/**
 * Registry of dependency health checks with fleet-level aggregation.
 */
export interface HealthRegistry {
  /** Register a dependency health check. */
  register(check: DependencyHealthCheck): void;
  /** Run all checks and return aggregated health status. */
  checkAll(): Promise<AggregateHealthResult>;
}

/**
 * Creates a new health check registry.
 */
export function createHealthRegistry(): HealthRegistry {
  const checks: DependencyHealthCheck[] = [];

  return Object.freeze({
    register(check: DependencyHealthCheck): void {
      checks.push(check);
    },

    async checkAll(): Promise<AggregateHealthResult> {
      const results = await Promise.all(checks.map((c) => c.check()));
      const status = aggregateStatus(results);
      return Object.freeze({ status, dependencies: Object.freeze(results) });
    },
  });
}

/**
 * Determines the aggregate status from individual dependency results.
 * Any unhealthy dependency makes the aggregate unhealthy.
 * Any degraded dependency (with no unhealthy) makes the aggregate degraded.
 * All healthy means the aggregate is healthy.
 */
function aggregateStatus(results: readonly DependencyHealthResult[]): HealthStatus {
  if (results.length === 0) {
    return "healthy";
  }

  let hasDegraded = false;
  for (const result of results) {
    if (result.status === "unhealthy") {
      return "unhealthy";
    }
    if (result.status === "degraded") {
      hasDegraded = true;
    }
  }

  return hasDegraded ? "degraded" : "healthy";
}
