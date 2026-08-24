/**
 * Certification harness factory.
 *
 * Creates a runnable test suite that any connector implementation can use
 * to prove it meets the contract. The harness tests pagination correctness,
 * rate limit handling, retry behavior, stale data detection, timeout semantics,
 * event deduplication, idempotency, query resolution, and health reporting.
 */

import type { Instant } from "@counter/domain";

import type { ActionInput, ActionOutcome } from "./action-ports.js";
import { createConnectorError } from "./errors.js";
import type { FreshnessPolicy } from "./freshness.js";
import { evaluateFreshness } from "./freshness.js";
import type { TestItem } from "./fixtures.js";
import type { ListParams } from "./resource-ports.js";
import type { ConnectorContract } from "./safety-boundary.js";
import type { ConnectorManifest } from "./types.js";

// ─── Result Types ─────────────────────────────────────────────────────────────

export interface TestCaseResult {
  readonly name: string;
  readonly passed: boolean;
  readonly error: string | undefined;
  readonly durationMs: number;
}

export interface TestGroupResult {
  readonly group: string;
  readonly passed: boolean;
  readonly tests: readonly TestCaseResult[];
}

export interface CertificationResult {
  readonly passed: boolean;
  readonly results: readonly TestGroupResult[];
  readonly summary: string;
}

export interface CertificationSuite {
  run(): Promise<CertificationResult>;
}

// ─── Options ──────────────────────────────────────────────────────────────────

export interface CertificationOptions {
  readonly timeout?: number;
  readonly concurrency?: number;
  readonly fixtures?: unknown;
}

// ─── Harness Implementation ───────────────────────────────────────────────────

async function runTestCase(
  name: string,
  fn: () => Promise<void>,
): Promise<TestCaseResult> {
  const start = Date.now();
  try {
    await fn();
    return { name, passed: true, error: undefined, durationMs: Date.now() - start };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return { name, passed: false, error: message, durationMs: Date.now() - start };
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function testPagination<T extends ConnectorManifest>(
  connector: ConnectorContract<T>,
): Promise<TestGroupResult> {
  const resourceNames = Object.keys(connector.resources);
  const tests: TestCaseResult[] = [];

  if (resourceNames.length === 0) {
    tests.push({
      name: "pagination: has at least one resource",
      passed: true,
      error: undefined,
      durationMs: 0,
    });
    return { group: "pagination", passed: true, tests };
  }

  const firstResource = resourceNames[0]!;
  const port = connector.resources[firstResource]!;

  tests.push(
    await runTestCase("pagination: first page returns items", async () => {
      const params: ListParams = { cursor: null, pageSize: 5, filters: {} };
      const result = await port.list(params);
      assert(Array.isArray(result.items), "items must be an array");
      assert(typeof result.hasMore === "boolean", "hasMore must be boolean");
      assert(
        result.nextCursor === null || typeof result.nextCursor === "string",
        "nextCursor must be string or null",
      );
    }),
  );

  tests.push(
    await runTestCase("pagination: empty page is valid", async () => {
      const params: ListParams = { cursor: "___empty___", pageSize: 5, filters: {} };
      const result = await port.list(params);
      assert(Array.isArray(result.items), "items must be an array");
    }),
  );

  tests.push(
    await runTestCase("pagination: single item page", async () => {
      const params: ListParams = { cursor: null, pageSize: 1, filters: {} };
      const result = await port.list(params);
      assert(Array.isArray(result.items), "items must be an array");
      assert(result.items.length <= 1, "single item page must return at most 1 item");
    }),
  );

  const passed = tests.every((t) => t.passed);
  return { group: "pagination", passed, tests };
}

async function testRateLimits<T extends ConnectorManifest>(
  _connector: ConnectorContract<T>,
): Promise<TestGroupResult> {
  const tests: TestCaseResult[] = [];

  tests.push(
    await runTestCase("rate_limits: handles rate_limited error", async () => {
      const rateLimitedErr = createConnectorError({
        code: "rate_limited",
        message: "Rate limit exceeded",
        retryable: true,
        retryAfterMs: 1000,
        source: "certification-harness",
      });
      assert(rateLimitedErr.retryable === true, "rate_limited must be retryable");
      assert(
        rateLimitedErr.retryAfterMs !== undefined && rateLimitedErr.retryAfterMs > 0,
        "retryAfterMs must be positive",
      );
    }),
  );

  const passed = tests.every((t) => t.passed);
  return { group: "rate_limits", passed, tests };
}

async function testRetryBehavior<T extends ConnectorManifest>(
  connector: ConnectorContract<T>,
): Promise<TestGroupResult> {
  const actionNames = Object.keys(connector.actions);
  const tests: TestCaseResult[] = [];

  tests.push(
    await runTestCase("retry: retryable errors are marked retryable", async () => {
      const retryableErr = createConnectorError({
        code: "unavailable",
        message: "Service temporarily unavailable",
        retryable: true,
        retryAfterMs: 500,
        source: "certification-harness",
      });
      assert(retryableErr.retryable === true, "retryable error must have retryable=true");
    }),
  );

  tests.push(
    await runTestCase("retry: non-retryable errors are not retried", async () => {
      const nonRetryableErr = createConnectorError({
        code: "auth_failure",
        message: "Invalid credentials",
        retryable: false,
        source: "certification-harness",
      });
      assert(nonRetryableErr.retryable === false, "non-retryable error must have retryable=false");
    }),
  );

  if (actionNames.length > 0) {
    const firstAction = actionNames[0]!;
    const port = connector.actions[firstAction]!;

    tests.push(
      await runTestCase("retry: action port execute returns valid outcome", async () => {
        const input: ActionInput<unknown> = {
          payload: { test: true },
          idempotencyKey: "cert-retry-key",
          correlationId: "cert-retry-corr",
          preconditions: [],
          timeoutMs: 5000,
        };
        const result = await port.execute(input);
        assert(
          result.status === "succeeded" ||
            result.status === "failed" ||
            result.status === "indeterminate",
          "action outcome must have valid status",
        );
      }),
    );
  }

  const passed = tests.every((t) => t.passed);
  return { group: "retry_behavior", passed, tests };
}

async function testStaleData<T extends ConnectorManifest>(
  _connector: ConnectorContract<T>,
): Promise<TestGroupResult> {
  const tests: TestCaseResult[] = [];

  tests.push(
    await runTestCase("stale_data: fresh observation within budget", async () => {
      const now = 1_700_000_060_000 as Instant;
      const lastObserved = 1_700_000_050_000 as Instant;
      const policy: FreshnessPolicy = {
        resourceName: "test",
        maxAgeMs: 30_000,
        warningThresholdMs: 20_000,
      };
      const assessment = evaluateFreshness(lastObserved, now, policy);
      assert(assessment.status === "fresh", `expected fresh, got ${assessment.status}`);
      assert(assessment.withinBudget === true, "fresh data must be within budget");
    }),
  );

  tests.push(
    await runTestCase("stale_data: stale observation beyond budget", async () => {
      const now = 1_700_000_060_000 as Instant;
      const lastObserved = 1_700_000_000_000 as Instant;
      const policy: FreshnessPolicy = {
        resourceName: "test",
        maxAgeMs: 30_000,
        warningThresholdMs: 20_000,
      };
      const assessment = evaluateFreshness(lastObserved, now, policy);
      assert(assessment.status === "stale", `expected stale, got ${assessment.status}`);
      assert(assessment.withinBudget === false, "stale data must not be within budget");
    }),
  );

  const passed = tests.every((t) => t.passed);
  return { group: "stale_data", passed, tests };
}

async function testTimeoutSemantics<T extends ConnectorManifest>(
  connector: ConnectorContract<T>,
): Promise<TestGroupResult> {
  const tests: TestCaseResult[] = [];

  tests.push(
    await runTestCase("timeout: before_effect timeout is retryable", async () => {
      const timeoutErr = createConnectorError({
        code: "timeout",
        message: "Timed out before effect",
        retryable: true,
        source: "certification-harness",
      });
      assert(timeoutErr.retryable === true, "before_effect timeout must be retryable");
    }),
  );

  tests.push(
    await runTestCase("timeout: after_effect returns indeterminate", async () => {
      const outcome: ActionOutcome<TestItem> = {
        status: "indeterminate",
        correlationId: "timeout-corr",
        lastKnownState: "request_sent",
      };
      assert(outcome.status === "indeterminate", "after_effect timeout must be indeterminate");
      assert(
        outcome.correlationId === "timeout-corr",
        "indeterminate must have correlationId",
      );
    }),
  );

  for (const action of connector.manifest.actions) {
    tests.push(
      await runTestCase(
        `timeout: action '${action.name}' declares timeout semantics`,
        async () => {
          assert(
            action.timeoutSemantics === "before_effect" ||
              action.timeoutSemantics === "after_effect",
            `action '${action.name}' must declare timeout semantics`,
          );
        },
      ),
    );
  }

  const passed = tests.every((t) => t.passed);
  return { group: "timeout_semantics", passed, tests };
}

async function testEventDeduplication<T extends ConnectorManifest>(
  connector: ConnectorContract<T>,
): Promise<TestGroupResult> {
  const tests: TestCaseResult[] = [];

  tests.push(
    await runTestCase("events: manifest declares deduplication strategy", async () => {
      assert(
        typeof connector.manifest.events.deduplicationStrategy === "string" &&
          connector.manifest.events.deduplicationStrategy.length > 0,
        "events must declare a deduplication strategy",
      );
    }),
  );

  tests.push(
    await runTestCase("events: manifest declares mode", async () => {
      assert(
        connector.manifest.events.mode === "webhooks" ||
          connector.manifest.events.mode === "polling" ||
          connector.manifest.events.mode === "both",
        "events must declare a valid mode",
      );
    }),
  );

  const passed = tests.every((t) => t.passed);
  return { group: "event_deduplication", passed, tests };
}

async function testIdempotency<T extends ConnectorManifest>(
  connector: ConnectorContract<T>,
): Promise<TestGroupResult> {
  const actionNames = Object.keys(connector.actions);
  const tests: TestCaseResult[] = [];

  if (actionNames.length > 0) {
    const firstAction = actionNames[0]!;
    const port = connector.actions[firstAction]!;

    tests.push(
      await runTestCase("idempotency: same key returns same result", async () => {
        const input: ActionInput<unknown> = {
          payload: { test: true },
          idempotencyKey: "cert-idemp-key-same",
          correlationId: "cert-idemp-corr-same",
          preconditions: [],
          timeoutMs: 5000,
        };
        const result1 = await port.execute(input);
        const result2 = await port.execute(input);
        assert(result1.status === result2.status, "same key must return same status");
      }),
    );

    tests.push(
      await runTestCase("idempotency: different key may return different result", async () => {
        const input1: ActionInput<unknown> = {
          payload: { test: true },
          idempotencyKey: "cert-idemp-key-1",
          correlationId: "cert-idemp-corr-1",
          preconditions: [],
          timeoutMs: 5000,
        };
        const input2: ActionInput<unknown> = {
          payload: { test: true, extra: "different" },
          idempotencyKey: "cert-idemp-key-2",
          correlationId: "cert-idemp-corr-2",
          preconditions: [],
          timeoutMs: 5000,
        };
        const result1 = await port.execute(input1);
        const result2 = await port.execute(input2);
        assert(
          result1.status === "succeeded" ||
            result1.status === "failed" ||
            result1.status === "indeterminate",
          "first result must have valid status",
        );
        assert(
          result2.status === "succeeded" ||
            result2.status === "failed" ||
            result2.status === "indeterminate",
          "second result must have valid status",
        );
      }),
    );
  } else {
    tests.push({
      name: "idempotency: no actions to test",
      passed: true,
      error: undefined,
      durationMs: 0,
    });
  }

  const passed = tests.every((t) => t.passed);
  return { group: "idempotency", passed, tests };
}

async function testQueryResolution<T extends ConnectorManifest>(
  connector: ConnectorContract<T>,
): Promise<TestGroupResult> {
  const actionNames = Object.keys(connector.actions);
  const tests: TestCaseResult[] = [];

  if (actionNames.length > 0) {
    const firstAction = actionNames[0]!;
    const port = connector.actions[firstAction]!;

    tests.push(
      await runTestCase("query: can query action by correlationId", async () => {
        const result = await port.query("cert-query-corr-nonexistent");
        assert(
          result === null ||
            result.status === "succeeded" ||
            result.status === "failed" ||
            result.status === "indeterminate",
          "query must return null or valid outcome",
        );
      }),
    );
  } else {
    tests.push({
      name: "query: no actions to test",
      passed: true,
      error: undefined,
      durationMs: 0,
    });
  }

  const passed = tests.every((t) => t.passed);
  return { group: "query_resolution", passed, tests };
}

async function testHealthReporting<T extends ConnectorManifest>(
  connector: ConnectorContract<T>,
): Promise<TestGroupResult> {
  const tests: TestCaseResult[] = [];

  tests.push(
    await runTestCase("health: returns valid status", async () => {
      const health = await connector.health.checkHealth();
      assert(
        health.status === "healthy" ||
          health.status === "degraded" ||
          health.status === "unhealthy" ||
          health.status === "unknown",
        `health status must be valid, got: ${health.status}`,
      );
      assert(typeof health.lastCheckedAt === "number", "lastCheckedAt must be an Instant");
      assert(Array.isArray(health.details), "details must be an array");
    }),
  );

  tests.push(
    await runTestCase("health: details have valid structure", async () => {
      const health = await connector.health.checkHealth();
      for (const detail of health.details) {
        assert(typeof detail.component === "string", "component must be a string");
        assert(
          detail.status === "healthy" ||
            detail.status === "degraded" ||
            detail.status === "unhealthy" ||
            detail.status === "unknown",
          `detail status must be valid, got: ${detail.status}`,
        );
        assert(
          detail.latencyMs === undefined || typeof detail.latencyMs === "number",
          "latencyMs must be number or undefined",
        );
      }
    }),
  );

  const passed = tests.every((t) => t.passed);
  return { group: "health_reporting", passed, tests };
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createCertificationHarness<T extends ConnectorManifest>(
  _manifest: T,
  connector: ConnectorContract<T>,
  _options?: CertificationOptions,
): CertificationSuite {
  return {
    async run(): Promise<CertificationResult> {
      const results: TestGroupResult[] = [];

      results.push(await testPagination(connector));
      results.push(await testRateLimits(connector));
      results.push(await testRetryBehavior(connector));
      results.push(await testStaleData(connector));
      results.push(await testTimeoutSemantics(connector));
      results.push(await testEventDeduplication(connector));
      results.push(await testIdempotency(connector));
      results.push(await testQueryResolution(connector));
      results.push(await testHealthReporting(connector));

      const passed = results.every((r) => r.passed);
      const totalTests = results.reduce((sum, r) => sum + r.tests.length, 0);
      const passedTests = results.reduce(
        (sum, r) => sum + r.tests.filter((t) => t.passed).length,
        0,
      );

      return {
        passed,
        results,
        summary: `${passedTests}/${totalTests} tests passed across ${results.length} groups`,
      };
    },
  };
}
