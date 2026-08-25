/**
 * ShopifyHealthPort implementing ConnectorHealthPort.
 *
 * Checks API connectivity, auth validity, and rate limit budget
 * to report connector health status.
 */

import type { Instant } from "@counter/domain";
import type { ConnectorHealthPort, HealthCheck, HealthCheckDetail, ConnectorHealthStatus } from "@counter/connector-sdk";
import type { ShopifyGraphQLPort } from "./graphql-client.js";
import type { ShopifyAuthConfig } from "./auth.js";
import { validateToken, checkScopes } from "./auth.js";

// --- Constants ---

const RATE_LIMIT_DEGRADED_THRESHOLD = 0.3;
const REQUIRED_SCOPES: readonly string[] = [
  "read_products",
  "write_draft_orders",
  "read_orders",
  "write_orders",
  "read_inventory",
];

// --- Health Port Configuration ---

export interface ShopifyHealthConfig {
  readonly client: ShopifyGraphQLPort;
  readonly authConfig: ShopifyAuthConfig;
}

// --- Health Port Factory ---

export function createShopifyHealthPort(config: ShopifyHealthConfig): ConnectorHealthPort {
  return {
    async checkHealth(): Promise<HealthCheck> {
      const details: HealthCheckDetail[] = [];
      let overallStatus: ConnectorHealthStatus = "healthy";

      // Component 1: Auth validity
      const authDetail = checkAuthValidity(config.authConfig);
      details.push(authDetail);
      if (authDetail.status === "unhealthy") {
        overallStatus = "unhealthy";
      }

      // Component 2: API connectivity
      const apiDetail = await checkApiConnectivity(config.client);
      details.push(apiDetail);
      if (apiDetail.status === "unhealthy") {
        overallStatus = "unhealthy";
      }

      // Component 3: Rate limit budget
      const rateLimitDetail = await checkRateLimitBudget(config.client);
      details.push(rateLimitDetail);
      if (rateLimitDetail.status === "degraded" && overallStatus === "healthy") {
        overallStatus = "degraded";
      }
      if (rateLimitDetail.status === "unhealthy") {
        overallStatus = "unhealthy";
      }

      return {
        status: overallStatus,
        lastCheckedAt: Date.now() as Instant,
        message: overallStatus === "healthy" ? undefined : `Connector is ${overallStatus}`,
        details,
      };
    },
  };
}

// --- Component Checks ---

function checkAuthValidity(authConfig: ShopifyAuthConfig): HealthCheckDetail {
  const tokenResult = validateToken(authConfig);
  if (!tokenResult.ok) {
    return {
      component: "auth_validity",
      status: "unhealthy",
      latencyMs: 0,
    };
  }

  const scopeResult = checkScopes([...authConfig.scopes], [...REQUIRED_SCOPES]);
  if (!scopeResult.satisfied) {
    return {
      component: "auth_validity",
      status: "unhealthy",
      latencyMs: 0,
    };
  }

  return {
    component: "auth_validity",
    status: "healthy",
    latencyMs: 0,
  };
}

async function checkApiConnectivity(client: ShopifyGraphQLPort): Promise<HealthCheckDetail> {
  const startMs = Date.now();
  try {
    await client.query("{ shop { name } }", {});
    const latencyMs = Date.now() - startMs;
    return {
      component: "api_connectivity",
      status: "healthy",
      latencyMs,
    };
  } catch {
    const latencyMs = Date.now() - startMs;
    return {
      component: "api_connectivity",
      status: "unhealthy",
      latencyMs,
    };
  }
}

async function checkRateLimitBudget(client: ShopifyGraphQLPort): Promise<HealthCheckDetail> {
  const startMs = Date.now();
  try {
    const response = await client.query("{ shop { name } }", {});
    const latencyMs = Date.now() - startMs;

    const throttleStatus = response.extensions?.cost?.throttleStatus;
    if (!throttleStatus) {
      return {
        component: "rate_limit_budget",
        status: "healthy",
        latencyMs,
      };
    }

    const fillRatio = throttleStatus.currentlyAvailable / throttleStatus.maximumAvailable;
    const status: ConnectorHealthStatus =
      fillRatio < RATE_LIMIT_DEGRADED_THRESHOLD ? "degraded" : "healthy";

    return {
      component: "rate_limit_budget",
      status,
      latencyMs,
    };
  } catch {
    const latencyMs = Date.now() - startMs;
    return {
      component: "rate_limit_budget",
      status: "healthy",
      latencyMs,
    };
  }
}
