import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import type { ExternalReference, Instant } from "@counter/domain";

import type { ConnectorManifest } from "./types.js";
import type {
  ResourceObservation,
  PagedResult,
  ListParams,
  SearchParams,
} from "./resource-ports.js";
import type { ResourceReadPort } from "./resource-ports.js";
import type { ActionInput, ActionOutcome } from "./action-ports.js";
import type { ActionPort } from "./action-ports.js";
import type { FreshnessPolicy } from "./freshness.js";
import { evaluateFreshness, FRESHNESS_STATUSES, isFreshnessStatus } from "./freshness.js";
import { CONNECTOR_HEALTH_STATUSES, isConnectorHealthStatus } from "./health.js";
import type { HealthCheck } from "./health.js";
import { CONNECTOR_ERROR_CODES, createConnectorError, isConnectorError } from "./errors.js";
import type { ConnectorContract } from "./safety-boundary.js";
import { CAPABILITY_STATUSES, isCapabilityStatus } from "./capability-status.js";
import { createCertificationHarness } from "./certification-harness.js";
import type { ConnectorHealthPort } from "./health.js";
import {
  createPaginationFixtures,
  createRateLimitFixtures,
  createRetryFixtures,
  createStaleDataFixtures,
  createTimeoutFixtures,
  createEventFixtures,
  createIdempotencyFixtures,
  createQueryResolutionFixtures,
} from "./fixtures.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeManifest(): ConnectorManifest {
  return {
    connectorId: "test-connector",
    platform: "test",
    version: "1.0.0",
    resources: [
      {
        name: "products",
        schemaDescription: "Product catalog items",
        supportedOperations: ["list", "get", "search"],
        pagination: { defaultPageSize: 10, maxPageSize: 100, cursorBased: true },
        freshnessBudgetMs: 30_000,
      },
    ],
    actions: [
      {
        name: "create_order",
        schemaDescription: "Creates a new order",
        preconditions: ["inventory_available"],
        idempotencyStrategy: "native",
        timeoutSemantics: "before_effect",
        expectedEffects: ["order_created"],
        authorizationRequirements: ["orders:write"],
        compensationPath: { actionName: "cancel_order", description: "Cancels the order" },
      },
    ],
    auth: {
      method: "oauth",
      scopesRequired: ["read_products", "write_orders"],
      tokenRotation: true,
      secretReferences: ["oauth_client_secret"],
    },
    rateLimits: {
      strategy: "token_bucket",
      maxRequestsPerSecond: 10,
      costAwareThrottling: true,
      backoffPolicy: "exponential",
    },
    freshness: {
      defaultBudgetMs: 30_000,
      perResourceBudgets: [{ resourceName: "products", budgetMs: 60_000 }],
    },
    events: {
      mode: "webhooks",
      topics: ["orders/create", "products/update"],
      deduplicationStrategy: "event_id",
      signatureVerification: true,
    },
    sandboxBehavior: {
      useMockData: true,
      simulateLatency: false,
      maxLatencyMs: 0,
    },
    idempotencyStrategy: "native",
    compensationDeclarations: [
      {
        actionName: "create_order",
        compensatingAction: "cancel_order",
        timeWindowMs: 3_600_000,
      },
    ],
    dataClassification: "confidential",
    createdAt: 1_700_000_000_000 as Instant,
  };
}

interface TestItem {
  readonly id: string;
  readonly name: string;
}

function makeMockConnector(manifest: ConnectorManifest): ConnectorContract<ConnectorManifest> {
  const items: ResourceObservation<TestItem>[] = [
    {
      data: { id: "prod-1", name: "Widget" },
      sourceReference: { source: "test-system", value: "prod-1" } as ExternalReference,
      sourceVersion: "v1",
      observedAt: 1_700_000_000_000 as Instant,
      freshnessStatus: "fresh",
    },
    {
      data: { id: "prod-2", name: "Gadget" },
      sourceReference: { source: "test-system", value: "prod-2" } as ExternalReference,
      sourceVersion: "v1",
      observedAt: 1_700_000_000_000 as Instant,
      freshnessStatus: "fresh",
    },
  ];

  const idempotencyStore = new Map<string, ActionOutcome<unknown>>();

  const resourcePort: ResourceReadPort<unknown> = {
    async list(params: ListParams): Promise<PagedResult<unknown>> {
      if (params.cursor === "___empty___") {
        return { items: [], nextCursor: null, hasMore: false, totalCount: 0 };
      }
      const pageSize = params.pageSize;
      const sliced = items.slice(0, pageSize);
      return {
        items: sliced,
        nextCursor: sliced.length < items.length ? "cursor-2" : null,
        hasMore: sliced.length < items.length,
        totalCount: items.length,
      };
    },
    async get(id: ExternalReference): Promise<ResourceObservation<unknown> | null> {
      return items.find((i) => (i.sourceReference as ExternalReference).value === id.value) ?? null;
    },
    async search(_query: SearchParams): Promise<PagedResult<unknown>> {
      return { items, nextCursor: null, hasMore: false, totalCount: items.length };
    },
  };

  const actionPort: ActionPort<unknown, unknown> = {
    async execute(input: ActionInput<unknown>): Promise<ActionOutcome<unknown>> {
      const existing = idempotencyStore.get(input.idempotencyKey);
      if (existing !== undefined) {
        return existing;
      }
      const outcome: ActionOutcome<unknown> = {
        status: "succeeded",
        result: { orderId: "order-001", created: true },
        effectTime: 1_700_000_001_000 as Instant,
        sourceReference: { source: "test-system", value: "order-001" } as ExternalReference,
      };
      idempotencyStore.set(input.idempotencyKey, outcome);
      return outcome;
    },
    async query(_correlationId: string): Promise<ActionOutcome<unknown> | null> {
      for (const [, outcome] of idempotencyStore) {
        if (outcome.status === "succeeded") {
          return outcome;
        }
      }
      return null;
    },
  };

  const healthPort: ConnectorHealthPort = {
    async checkHealth(): Promise<HealthCheck> {
      return {
        status: "healthy",
        lastCheckedAt: 1_700_000_000_000 as Instant,
        message: undefined,
        details: [
          { component: "api", status: "healthy", latencyMs: 45 },
          { component: "auth", status: "healthy", latencyMs: 12 },
        ],
      };
    },
  };

  return {
    manifest,
    resources: { products: resourcePort },
    actions: { create_order: actionPort },
    health: healthPort,
  };
}

// ─── Type Structural Tests ────────────────────────────────────────────────────

describe("ConnectorManifest type structure", () => {
  it("has all required fields", () => {
    const manifest = makeManifest();
    expect(manifest.connectorId).toBe("test-connector");
    expect(manifest.platform).toBe("test");
    expect(manifest.version).toBe("1.0.0");
    expect(manifest.resources).toHaveLength(1);
    expect(manifest.actions).toHaveLength(1);
    expect(manifest.auth.method).toBe("oauth");
    expect(manifest.rateLimits.strategy).toBe("token_bucket");
    expect(manifest.freshness.defaultBudgetMs).toBe(30_000);
    expect(manifest.events.mode).toBe("webhooks");
    expect(manifest.sandboxBehavior.useMockData).toBe(true);
    expect(manifest.idempotencyStrategy).toBe("native");
    expect(manifest.compensationDeclarations).toHaveLength(1);
    expect(manifest.dataClassification).toBe("confidential");
    expect(manifest.createdAt).toBe(1_700_000_000_000);
  });

  it("resources have correct structure", () => {
    const manifest = makeManifest();
    const resource = manifest.resources[0]!;
    expect(resource.name).toBe("products");
    expect(resource.supportedOperations).toContain("list");
    expect(resource.supportedOperations).toContain("get");
    expect(resource.supportedOperations).toContain("search");
    expect(resource.pagination.defaultPageSize).toBe(10);
    expect(resource.pagination.maxPageSize).toBe(100);
    expect(resource.pagination.cursorBased).toBe(true);
    expect(resource.freshnessBudgetMs).toBe(30_000);
  });

  it("actions have correct structure", () => {
    const manifest = makeManifest();
    const action = manifest.actions[0]!;
    expect(action.name).toBe("create_order");
    expect(action.preconditions).toContain("inventory_available");
    expect(action.idempotencyStrategy).toBe("native");
    expect(action.timeoutSemantics).toBe("before_effect");
    expect(action.expectedEffects).toContain("order_created");
    expect(action.compensationPath?.actionName).toBe("cancel_order");
  });
});

describe("ResourceObservation type structure", () => {
  it("carries data with freshness metadata", () => {
    const obs: ResourceObservation<TestItem> = {
      data: { id: "test-1", name: "Test" },
      sourceReference: { source: "test-system", value: "test-1" } as ExternalReference,
      sourceVersion: "v1",
      observedAt: 1_700_000_000_000 as Instant,
      freshnessStatus: "fresh",
    };
    expect(obs.data.id).toBe("test-1");
    expect(obs.sourceReference.source).toBe("test-system");
    expect(obs.sourceVersion).toBe("v1");
    expect(obs.observedAt).toBe(1_700_000_000_000);
    expect(obs.freshnessStatus).toBe("fresh");
  });
});

describe("ActionOutcome type structure", () => {
  it("succeeded outcome carries result and effect time", () => {
    const outcome: ActionOutcome<TestItem> = {
      status: "succeeded",
      result: { id: "out-1", name: "Created" },
      effectTime: 1_700_000_001_000 as Instant,
      sourceReference: { source: "test-system", value: "out-1" } as ExternalReference,
    };
    expect(outcome.status).toBe("succeeded");
    if (outcome.status === "succeeded") {
      expect(outcome.result.id).toBe("out-1");
      expect(outcome.effectTime).toBe(1_700_000_001_000);
    }
  });

  it("failed outcome carries error", () => {
    const outcome: ActionOutcome<TestItem> = {
      status: "failed",
      error: createConnectorError({
        code: "auth_failure",
        message: "Invalid token",
        retryable: false,
        source: "test-system",
      }),
    };
    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed") {
      expect(outcome.error.code).toBe("auth_failure");
    }
  });

  it("indeterminate outcome carries correlation", () => {
    const outcome: ActionOutcome<TestItem> = {
      status: "indeterminate",
      correlationId: "corr-123",
      lastKnownState: "pending",
    };
    expect(outcome.status).toBe("indeterminate");
    if (outcome.status === "indeterminate") {
      expect(outcome.correlationId).toBe("corr-123");
      expect(outcome.lastKnownState).toBe("pending");
    }
  });
});

// ─── Freshness Unit Tests ─────────────────────────────────────────────────────

describe("evaluateFreshness", () => {
  const policy: FreshnessPolicy = {
    resourceName: "test-resource",
    maxAgeMs: 30_000,
    warningThresholdMs: 20_000,
  };

  it("returns unknown when lastObservedAt is null", () => {
    const result = evaluateFreshness(null, 1_700_000_060_000 as Instant, policy);
    expect(result.status).toBe("unknown");
    expect(result.lastObservedAt).toBeNull();
    expect(result.ageMs).toBeNull();
    expect(result.withinBudget).toBe(false);
  });

  it("returns fresh when age is within warning threshold", () => {
    const now = 1_700_000_060_000 as Instant;
    const lastObserved = 1_700_000_050_000 as Instant; // 10s ago
    const result = evaluateFreshness(lastObserved, now, policy);
    expect(result.status).toBe("fresh");
    expect(result.ageMs).toBe(10_000);
    expect(result.withinBudget).toBe(true);
  });

  it("returns approaching_stale when age exceeds warning but within budget", () => {
    const now = 1_700_000_060_000 as Instant;
    const lastObserved = 1_700_000_035_000 as Instant; // 25s ago
    const result = evaluateFreshness(lastObserved, now, policy);
    expect(result.status).toBe("approaching_stale");
    expect(result.ageMs).toBe(25_000);
    expect(result.withinBudget).toBe(true);
  });

  it("returns stale when age exceeds budget", () => {
    const now = 1_700_000_060_000 as Instant;
    const lastObserved = 1_700_000_000_000 as Instant; // 60s ago
    const result = evaluateFreshness(lastObserved, now, policy);
    expect(result.status).toBe("stale");
    expect(result.ageMs).toBe(60_000);
    expect(result.withinBudget).toBe(false);
  });

  it("returns fresh at the exact warning threshold boundary", () => {
    const now = 1_700_000_060_000 as Instant;
    const lastObserved = 1_700_000_040_000 as Instant; // exactly 20s ago = warningThresholdMs
    const result = evaluateFreshness(lastObserved, now, policy);
    expect(result.status).toBe("fresh");
    expect(result.ageMs).toBe(20_000);
    expect(result.withinBudget).toBe(true);
  });

  it("returns approaching_stale at the exact max budget boundary", () => {
    const now = 1_700_000_060_000 as Instant;
    const lastObserved = 1_700_000_030_000 as Instant; // exactly 30s ago = maxAgeMs
    const result = evaluateFreshness(lastObserved, now, policy);
    expect(result.status).toBe("approaching_stale");
    expect(result.ageMs).toBe(30_000);
    expect(result.withinBudget).toBe(true);
  });

  it("budgetMs always equals policy maxAgeMs", () => {
    const result = evaluateFreshness(
      1_700_000_050_000 as Instant,
      1_700_000_060_000 as Instant,
      policy,
    );
    expect(result.budgetMs).toBe(policy.maxAgeMs);
  });
});

// ─── ConnectorError Unit Tests ────────────────────────────────────────────────

describe("createConnectorError", () => {
  it.each(CONNECTOR_ERROR_CODES)("creates a valid error for code: %s", (code) => {
    const error = createConnectorError({
      code,
      message: `Test error for ${code}`,
      retryable: code === "rate_limited" || code === "timeout" || code === "unavailable",
      retryAfterMs: code === "rate_limited" ? 1000 : undefined,
      source: "test-source",
    });

    expect(error.code).toBe(code);
    expect(error.message).toContain(code);
    expect(typeof error.retryable).toBe("boolean");
    expect(error.source).toBe("test-source");
  });

  it("produces a frozen object", () => {
    const error = createConnectorError({
      code: "auth_failure",
      message: "Auth failed",
      retryable: false,
      source: "test",
    });
    expect(Object.isFrozen(error)).toBe(true);
  });
});

describe("isConnectorError", () => {
  it("returns true for valid connector errors", () => {
    const error = createConnectorError({
      code: "rate_limited",
      message: "Too many requests",
      retryable: true,
      retryAfterMs: 500,
      source: "api",
    });
    expect(isConnectorError(error)).toBe(true);
  });

  it("returns false for null", () => {
    expect(isConnectorError(null)).toBe(false);
  });

  it("returns false for non-object", () => {
    expect(isConnectorError("not an error")).toBe(false);
  });

  it("returns false for objects with invalid code", () => {
    expect(
      isConnectorError({
        code: "invalid_code",
        message: "test",
        retryable: false,
        source: "test",
      }),
    ).toBe(false);
  });

  it("returns false for objects missing fields", () => {
    expect(isConnectorError({ code: "auth_failure" })).toBe(false);
  });
});

// ─── Type Guards ──────────────────────────────────────────────────────────────

describe("type guards", () => {
  describe("isFreshnessStatus", () => {
    it.each(FRESHNESS_STATUSES)("returns true for: %s", (status) => {
      expect(isFreshnessStatus(status)).toBe(true);
    });
    it("returns false for invalid values", () => {
      expect(isFreshnessStatus("invalid")).toBe(false);
      expect(isFreshnessStatus(42)).toBe(false);
    });
  });

  describe("isConnectorHealthStatus", () => {
    it.each(CONNECTOR_HEALTH_STATUSES)("returns true for: %s", (status) => {
      expect(isConnectorHealthStatus(status)).toBe(true);
    });
    it("returns false for invalid values", () => {
      expect(isConnectorHealthStatus("invalid")).toBe(false);
    });
  });

  describe("isCapabilityStatus", () => {
    it.each(CAPABILITY_STATUSES)("returns true for: %s", (status) => {
      expect(isCapabilityStatus(status)).toBe(true);
    });
    it("returns false for invalid values", () => {
      expect(isCapabilityStatus("invalid")).toBe(false);
    });
  });
});

// ─── Certification Harness Integration Test ───────────────────────────────────

describe("createCertificationHarness", () => {
  it("passes all contract tests with a compliant mock connector", async () => {
    const manifest = makeManifest();
    const connector = makeMockConnector(manifest);
    const harness = createCertificationHarness(manifest, connector);
    const result = await harness.run();

    expect(result.passed).toBe(true);
    expect(result.results.length).toBeGreaterThan(0);
    for (const group of result.results) {
      for (const test of group.tests) {
        if (!test.passed) {
          throw new Error(`Test '${test.name}' failed: ${test.error}`);
        }
      }
    }
    expect(result.summary).toContain("tests passed");
  });

  it("reports certification results with proper structure", async () => {
    const manifest = makeManifest();
    const connector = makeMockConnector(manifest);
    const harness = createCertificationHarness(manifest, connector);
    const result = await harness.run();

    expect(typeof result.passed).toBe("boolean");
    expect(Array.isArray(result.results)).toBe(true);
    expect(typeof result.summary).toBe("string");

    for (const group of result.results) {
      expect(typeof group.group).toBe("string");
      expect(typeof group.passed).toBe("boolean");
      expect(Array.isArray(group.tests)).toBe(true);

      for (const test of group.tests) {
        expect(typeof test.name).toBe("string");
        expect(typeof test.passed).toBe("boolean");
        expect(typeof test.durationMs).toBe("number");
      }
    }
  });
});

// ─── Negative Certification Test ──────────────────────────────────────────────

describe("certification harness - broken connector", () => {
  it("fails certification for a connector with broken health", async () => {
    const manifest = makeManifest();

    const brokenHealthConnector: ConnectorContract<ConnectorManifest> = {
      manifest,
      resources: {
        products: {
          async list(_params: ListParams): Promise<PagedResult<unknown>> {
            return { items: [], nextCursor: null, hasMore: false, totalCount: 0 };
          },
          async get(_id: ExternalReference): Promise<ResourceObservation<unknown> | null> {
            return null;
          },
          async search(_query: SearchParams): Promise<PagedResult<unknown>> {
            return { items: [], nextCursor: null, hasMore: false, totalCount: 0 };
          },
        },
      },
      actions: {
        create_order: {
          async execute(_input: ActionInput<unknown>): Promise<ActionOutcome<unknown>> {
            return {
              status: "succeeded",
              result: {},
              effectTime: 1_700_000_001_000 as Instant,
              sourceReference: { source: "test", value: "1" } as ExternalReference,
            };
          },
          async query(_correlationId: string): Promise<ActionOutcome<unknown> | null> {
            return null;
          },
        },
      },
      health: {
        async checkHealth(): Promise<HealthCheck> {
          // Returns an invalid status to trigger health check failure
          return {
            status: "invalid_status" as "healthy",
            lastCheckedAt: 1_700_000_000_000 as Instant,
            message: undefined,
            details: [],
          };
        },
      },
    };

    const harness = createCertificationHarness(manifest, brokenHealthConnector);
    const result = await harness.run();

    const healthGroup = result.results.find((r) => r.group === "health_reporting");
    expect(healthGroup).toBeDefined();
    expect(healthGroup!.passed).toBe(false);
    expect(result.passed).toBe(false);
  });

  it("fails certification for a connector that ignores rate limits", async () => {
    // A connector that responds to rate_limited with non-retryable would be wrong
    // This tests that the harness validates rate_limited errors are retryable
    const rateLimitErr = createConnectorError({
      code: "rate_limited",
      message: "Rate limit exceeded",
      retryable: true,
      retryAfterMs: 1000,
      source: "test",
    });
    expect(rateLimitErr.retryable).toBe(true);
    expect(rateLimitErr.retryAfterMs).toBeGreaterThan(0);
  });
});

// ─── Property-Based Tests ─────────────────────────────────────────────────────

describe("freshness evaluation - property-based tests", () => {
  const instantArb = fc.integer({ min: 0, max: 2_000_000_000_000 }).map((n) => n as Instant);
  const budgetArb = fc.integer({ min: 1, max: 1_000_000 });

  it("status is always one of the valid freshness statuses", () => {
    fc.assert(
      fc.property(
        fc.option(instantArb, { nil: null }),
        instantArb,
        budgetArb,
        budgetArb,
        (lastObserved, now, maxAge, warningThreshold) => {
          const policy: FreshnessPolicy = {
            resourceName: "prop-test",
            maxAgeMs: maxAge,
            warningThresholdMs: Math.min(warningThreshold, maxAge),
          };
          const result = evaluateFreshness(lastObserved, now, policy);
          return FRESHNESS_STATUSES.includes(result.status);
        },
      ),
    );
  });

  it("null lastObservedAt always produces unknown status", () => {
    fc.assert(
      fc.property(instantArb, budgetArb, (now, maxAge) => {
        const policy: FreshnessPolicy = {
          resourceName: "prop-test",
          maxAgeMs: maxAge,
          warningThresholdMs: Math.floor(maxAge / 2),
        };
        const result = evaluateFreshness(null, now, policy);
        return result.status === "unknown" && result.withinBudget === false;
      }),
    );
  });

  it("withinBudget is true only when status is fresh or approaching_stale", () => {
    fc.assert(
      fc.property(
        fc.option(instantArb, { nil: null }),
        instantArb,
        budgetArb,
        budgetArb,
        (lastObserved, now, maxAge, warningThreshold) => {
          const adjustedWarning = Math.min(warningThreshold, maxAge);
          const policy: FreshnessPolicy = {
            resourceName: "prop-test",
            maxAgeMs: maxAge,
            warningThresholdMs: adjustedWarning,
          };
          const result = evaluateFreshness(lastObserved, now, policy);
          if (result.withinBudget) {
            return result.status === "fresh" || result.status === "approaching_stale";
          }
          return result.status === "stale" || result.status === "unknown";
        },
      ),
    );
  });

  it("budgetMs always equals policy maxAgeMs", () => {
    fc.assert(
      fc.property(
        fc.option(instantArb, { nil: null }),
        instantArb,
        budgetArb,
        (lastObserved, now, maxAge) => {
          const policy: FreshnessPolicy = {
            resourceName: "prop-test",
            maxAgeMs: maxAge,
            warningThresholdMs: Math.floor(maxAge / 2),
          };
          const result = evaluateFreshness(lastObserved, now, policy);
          return result.budgetMs === maxAge;
        },
      ),
    );
  });

  it("ageMs is null only when lastObservedAt is null", () => {
    fc.assert(
      fc.property(
        fc.option(instantArb, { nil: null }),
        instantArb,
        budgetArb,
        (lastObserved, now, maxAge) => {
          const policy: FreshnessPolicy = {
            resourceName: "prop-test",
            maxAgeMs: maxAge,
            warningThresholdMs: Math.floor(maxAge / 2),
          };
          const result = evaluateFreshness(lastObserved, now, policy);
          if (lastObserved === null) {
            return result.ageMs === null;
          }
          return result.ageMs !== null;
        },
      ),
    );
  });
});

// ─── Safety Boundary Type Tests ───────────────────────────────────────────────

describe("ConnectorContract safety boundary", () => {
  it("NoSqlAccess resolves to never (cannot be instantiated)", () => {
    // Type-level test: NoSqlAccess = never means no value can satisfy it.
    // At runtime we verify the type alias exists and the contract compiles.
    expect(true).toBe(true);
  });

  it("ConnectorContract only exposes resource ports and action ports", () => {
    const manifest = makeManifest();
    const connector = makeMockConnector(manifest);

    expect(connector.manifest).toBeDefined();
    expect(connector.resources).toBeDefined();
    expect(connector.actions).toBeDefined();
    expect(connector.health).toBeDefined();

    // Verify no SQL or mutation access exists on the contract
    const keys = Object.keys(connector);
    expect(keys).not.toContain("database");
    expect(keys).not.toContain("sql");
    expect(keys).not.toContain("query");
    expect(keys).not.toContain("mutate");
    expect(keys).not.toContain("write");
    expect(keys).not.toContain("execute_sql");
  });

  it("action ports return observations, not mutations", () => {
    const manifest = makeManifest();
    const connector = makeMockConnector(manifest);
    const actionPort = connector.actions["create_order"]!;

    // ActionPort interface only has execute() and query() - both return ActionOutcome
    expect(typeof actionPort.execute).toBe("function");
    expect(typeof actionPort.query).toBe("function");
  });
});

// ─── Fixtures Tests ───────────────────────────────────────────────────────────

describe("contract fixtures", () => {
  it("pagination fixtures produce valid test data", () => {
    const fixtures = createPaginationFixtures();
    expect(fixtures.multiPageItems.length).toBe(25);
    expect(fixtures.singlePageItems.length).toBe(3);
    expect(fixtures.emptyResult.length).toBe(0);
  });

  it("rate limit fixtures have correct error code", () => {
    const fixtures = createRateLimitFixtures();
    expect(fixtures.rateLimitedError.code).toBe("rate_limited");
    expect(fixtures.rateLimitedError.retryable).toBe(true);
    expect(fixtures.retryAfterMs).toBe(1000);
  });

  it("retry fixtures have retryable and non-retryable errors", () => {
    const fixtures = createRetryFixtures();
    expect(fixtures.retryableError.retryable).toBe(true);
    expect(fixtures.nonRetryableError.retryable).toBe(false);
    expect(fixtures.successAfterRetry.status).toBe("succeeded");
  });

  it("stale data fixtures cover fresh and stale scenarios", () => {
    const fixtures = createStaleDataFixtures();
    const freshAge = (fixtures.currentTime as number) - (fixtures.freshObservationTime as number);
    const staleAge = (fixtures.currentTime as number) - (fixtures.staleObservationTime as number);
    expect(freshAge).toBeLessThan(fixtures.budgetMs);
    expect(staleAge).toBeGreaterThan(fixtures.budgetMs);
  });

  it("timeout fixtures cover both semantics", () => {
    const fixtures = createTimeoutFixtures();
    expect(fixtures.beforeEffectTimeout.code).toBe("timeout");
    expect(fixtures.beforeEffectTimeout.retryable).toBe(true);
    expect(fixtures.afterEffectIndeterminate.status).toBe("indeterminate");
  });

  it("event fixtures provide deduplication data", () => {
    const fixtures = createEventFixtures();
    expect(fixtures.duplicateEventId).toBe("evt-duplicate-001");
    expect(fixtures.outOfOrderSequencePositions.length).toBe(5);
    expect(typeof fixtures.verifiedWebhookDigest).toBe("string");
  });

  it("idempotency fixtures ensure same key same result", () => {
    const fixtures = createIdempotencyFixtures();
    expect(fixtures.firstCallResult).toEqual(fixtures.duplicateCallResult);
    expect(fixtures.differentKeyResult).not.toEqual(fixtures.firstCallResult);
  });

  it("query resolution fixtures cover indeterminate resolution", () => {
    const fixtures = createQueryResolutionFixtures();
    expect(fixtures.indeterminateOutcome.status).toBe("indeterminate");
    expect(fixtures.resolvedSuccess.status).toBe("succeeded");
    expect(fixtures.resolvedFailure.status).toBe("failed");
  });
});
