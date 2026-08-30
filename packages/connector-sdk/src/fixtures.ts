/**
 * Contract test fixtures for the certification harness.
 *
 * These fixtures provide typed test data for validating connector
 * implementations across all contract scenarios: pagination, rate
 * limiting, retries, freshness, timeouts, events, idempotency,
 * and query resolution.
 */

import type { ExternalReference, Instant, Sha256Digest } from "@counter/domain";

import type { ActionOutcome } from "./action-ports.js";
import type { ConnectorError } from "./errors.js";
import { createConnectorError } from "./errors.js";
import type { ResourceObservation } from "./resource-ports.js";

// ─── Test Item Type ───────────────────────────────────────────────────────────

export interface TestItem {
  readonly id: string;
  readonly name: string;
  readonly value: number;
}

// ─── Pagination Fixtures ──────────────────────────────────────────────────────

function makeTestObservation(item: TestItem, index: number): ResourceObservation<TestItem> {
  return {
    data: item,
    sourceReference: { source: "test-system", value: item.id } as ExternalReference,
    sourceVersion: `v${index}`,
    observedAt: 1_700_000_000_000 as Instant,
    freshnessStatus: "fresh",
  };
}

function makeTestItems(count: number): TestItem[] {
  const items: TestItem[] = [];
  for (let i = 0; i < count; i++) {
    items.push({ id: `item-${i}`, name: `Item ${i}`, value: i });
  }
  return items;
}

export interface PaginationFixtures {
  readonly multiPageItems: readonly ResourceObservation<TestItem>[];
  readonly singlePageItems: readonly ResourceObservation<TestItem>[];
  readonly emptyResult: readonly ResourceObservation<TestItem>[];
}

export function createPaginationFixtures(): PaginationFixtures {
  const multiItems = makeTestItems(25);
  const singleItems = makeTestItems(3);

  return {
    multiPageItems: multiItems.map((item, i) => makeTestObservation(item, i)),
    singlePageItems: singleItems.map((item, i) => makeTestObservation(item, i)),
    emptyResult: [],
  };
}

// ─── Rate Limit Fixtures ──────────────────────────────────────────────────────

export interface RateLimitFixtures {
  readonly rateLimitedError: ConnectorError;
  readonly retryAfterMs: number;
}

export function createRateLimitFixtures(): RateLimitFixtures {
  return {
    rateLimitedError: createConnectorError({
      code: "rate_limited",
      message: "Rate limit exceeded, retry after 1000ms",
      retryable: true,
      retryAfterMs: 1000,
      source: "test-system",
    }),
    retryAfterMs: 1000,
  };
}

// ─── Retry Fixtures ───────────────────────────────────────────────────────────

export interface RetryFixtures {
  readonly retryableError: ConnectorError;
  readonly nonRetryableError: ConnectorError;
  readonly successAfterRetry: ActionOutcome<TestItem>;
}

export function createRetryFixtures(): RetryFixtures {
  return {
    retryableError: createConnectorError({
      code: "unavailable",
      message: "Service temporarily unavailable",
      retryable: true,
      retryAfterMs: 500,
      source: "test-system",
    }),
    nonRetryableError: createConnectorError({
      code: "auth_failure",
      message: "Invalid credentials",
      retryable: false,
      source: "test-system",
    }),
    successAfterRetry: {
      status: "succeeded",
      result: { id: "retry-item", name: "Retried Item", value: 42 },
      effectTime: 1_700_000_001_000 as Instant,
      sourceReference: { source: "test-system", value: "retry-item" } as ExternalReference,
    },
  };
}

// ─── Stale Data Fixtures ──────────────────────────────────────────────────────

export interface StaleDataFixtures {
  readonly freshObservationTime: Instant;
  readonly staleObservationTime: Instant;
  readonly currentTime: Instant;
  readonly budgetMs: number;
  readonly warningThresholdMs: number;
}

export function createStaleDataFixtures(): StaleDataFixtures {
  const currentTime = 1_700_000_060_000 as Instant;
  return {
    freshObservationTime: 1_700_000_050_000 as Instant,
    staleObservationTime: 1_700_000_000_000 as Instant,
    currentTime,
    budgetMs: 30_000,
    warningThresholdMs: 20_000,
  };
}

// ─── Timeout Fixtures ─────────────────────────────────────────────────────────

export interface TimeoutFixtures {
  readonly beforeEffectTimeout: ConnectorError;
  readonly afterEffectIndeterminate: ActionOutcome<TestItem>;
}

export function createTimeoutFixtures(): TimeoutFixtures {
  return {
    beforeEffectTimeout: createConnectorError({
      code: "timeout",
      message: "Request timed out before effect was applied",
      retryable: true,
      source: "test-system",
    }),
    afterEffectIndeterminate: {
      status: "indeterminate",
      correlationId: "timeout-corr-001",
      lastKnownState: "request_sent",
    },
  };
}

// ─── Event Fixtures ───────────────────────────────────────────────────────────

export interface EventFixtures {
  readonly duplicateEventId: string;
  readonly outOfOrderSequencePositions: readonly number[];
  readonly verifiedWebhookDigest: Sha256Digest;
}

export function createEventFixtures(): EventFixtures {
  return {
    duplicateEventId: "evt-duplicate-001",
    outOfOrderSequencePositions: [3, 1, 2, 5, 4],
    verifiedWebhookDigest:
      "sha256:a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2" as Sha256Digest,
  };
}

// ─── Idempotency Fixtures ─────────────────────────────────────────────────────

export interface IdempotencyFixtures {
  readonly idempotencyKey: string;
  readonly firstCallResult: ActionOutcome<TestItem>;
  readonly duplicateCallResult: ActionOutcome<TestItem>;
  readonly differentKeyResult: ActionOutcome<TestItem>;
}

export function createIdempotencyFixtures(): IdempotencyFixtures {
  const result: ActionOutcome<TestItem> = {
    status: "succeeded",
    result: { id: "idemp-item", name: "Idempotent Item", value: 100 },
    effectTime: 1_700_000_001_000 as Instant,
    sourceReference: { source: "test-system", value: "idemp-item" } as ExternalReference,
  };
  const differentResult: ActionOutcome<TestItem> = {
    status: "succeeded",
    result: { id: "idemp-item-2", name: "Different Item", value: 200 },
    effectTime: 1_700_000_002_000 as Instant,
    sourceReference: { source: "test-system", value: "idemp-item-2" } as ExternalReference,
  };

  return {
    idempotencyKey: "idemp-key-001",
    firstCallResult: result,
    duplicateCallResult: result,
    differentKeyResult: differentResult,
  };
}

// ─── Query Resolution Fixtures ────────────────────────────────────────────────

export interface QueryResolutionFixtures {
  readonly indeterminateOutcome: ActionOutcome<TestItem>;
  readonly resolvedSuccess: ActionOutcome<TestItem>;
  readonly resolvedFailure: ActionOutcome<TestItem>;
}

export function createQueryResolutionFixtures(): QueryResolutionFixtures {
  return {
    indeterminateOutcome: {
      status: "indeterminate",
      correlationId: "query-corr-001",
      lastKnownState: "pending",
    },
    resolvedSuccess: {
      status: "succeeded",
      result: { id: "resolved-item", name: "Resolved Item", value: 99 },
      effectTime: 1_700_000_003_000 as Instant,
      sourceReference: { source: "test-system", value: "resolved-item" } as ExternalReference,
    },
    resolvedFailure: {
      status: "failed",
      error: createConnectorError({
        code: "conflict",
        message: "Resource was modified by another request",
        retryable: false,
        source: "test-system",
      }),
    },
  };
}
