/**
 * ConnectorHealthPort implementation for the reference connector.
 *
 * Returns healthy status with subsystem details for catalog,
 * inventory, and event stream components.
 */

import type { Instant } from "@counter/domain";
import type { ConnectorHealthPort, HealthCheck } from "@counter/connector-sdk";

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createHealthPort(): ConnectorHealthPort {
  return {
    async checkHealth(): Promise<HealthCheck> {
      return {
        status: "healthy",
        lastCheckedAt: Date.now() as Instant,
        message: undefined,
        details: [
          {
            component: "catalog",
            status: "healthy",
            latencyMs: 1,
          },
          {
            component: "inventory",
            status: "healthy",
            latencyMs: 1,
          },
          {
            component: "event-stream",
            status: "healthy",
            latencyMs: 1,
          },
        ],
      };
    },
  };
}
