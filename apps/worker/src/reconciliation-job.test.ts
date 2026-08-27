/**
 * Deterministic unit tests for the periodic reconciliation scanner.
 *
 * Uses an in-memory candidate source + step-ledger reader + a mock order-query
 * connector + an in-memory recorder. No network, no DB, no creds. Covers the
 * three required cases:
 *   - an INDETERMINATE txn whose provider evidence shows a settled order
 *     -> resolved to closed;
 *   - an INDETERMINATE txn with no provider effect -> stays indeterminate with
 *     evidence (never fabricates a success);
 *   - an already-resolved txn -> no-op.
 * Plus: a settled order query, an inconclusive (indeterminate) query, and the
 * env guard.
 */
import { describe, expect, it } from "vitest";

import type { ActionOutcome } from "@counter/connector-sdk";
import type { OrderResult } from "@counter/shopify-connector";
import type { Instant } from "@counter/domain";

import {
  reconcileCandidate,
  reconciliationEnabled,
  runReconciliationPass,
  type ReconciliationCandidate,
  type ReconciliationLedgerReader,
  type ReconciliationOrderQuery,
  type ReconciliationRecorder,
  type ReconciliationResolution,
  type ReconciliationScannerConfig,
} from "./reconciliation-job.js";

function nowInstant(): Instant {
  return Date.now() as Instant;
}

function succeededOrder(order: OrderResult): ActionOutcome<OrderResult> {
  return {
    status: "succeeded",
    result: order,
    effectTime: nowInstant(),
    sourceReference: Object.freeze({ source: "shopify", value: order.orderId }),
  };
}

function makeOrder(status: string): OrderResult {
  return Object.freeze({
    orderId: "gid://shopify/Order/123",
    name: "#1001",
    status,
    totalPrice: "100.00",
    currencyCode: "INR",
    createdAt: "2024-01-01T00:00:00Z",
  });
}

/** In-memory ledger keyed on `${key}\u0000${step}` -> reference. */
function makeLedger(entries: Record<string, string>): ReconciliationLedgerReader {
  return {
    lookup(key, step): Promise<{ readonly reference: string | undefined } | undefined> {
      const ref = entries[`${key}\u0000${step}`];
      return Promise.resolve(ref === undefined ? undefined : { reference: ref });
    },
  };
}

/** In-memory recorder capturing resolutions; isResolved is caller-controlled. */
function makeRecorder(resolvedKeys: Set<string> = new Set()): ReconciliationRecorder & {
  readonly recorded: ReconciliationResolution[];
} {
  const recorded: ReconciliationResolution[] = [];
  return {
    recorded,
    record(resolution): Promise<void> {
      recorded.push(resolution);
      return Promise.resolve();
    },
    isResolved(idempotencyKey): Promise<boolean> {
      return Promise.resolve(resolvedKeys.has(idempotencyKey));
    },
  };
}

function makeOrderQuery(outcome: ActionOutcome<OrderResult>): ReconciliationOrderQuery {
  return {
    execute: () => Promise.resolve(outcome),
  };
}

const candidate: ReconciliationCandidate = Object.freeze({
  transactionId: "order-abc",
  idempotencyKey: "order-abc",
});

describe("reconcileCandidate", () => {
  it("resolves to closed when provider evidence shows a settled (PAID) order", async () => {
    const recorder = makeRecorder();
    const config: ReconciliationScannerConfig = {
      source: { listIndeterminate: () => Promise.resolve([candidate]) },
      ledger: makeLedger({ "order-abc\u0000shopify.finalize": "gid://shopify/Order/123" }),
      orderQuery: makeOrderQuery(succeededOrder(makeOrder("PAID"))),
      recorder,
    };

    const resolution = await reconcileCandidate(config, candidate);

    expect(resolution.disposition).toBe("resolved_closed");
    expect(resolution.orderReference).toBe("gid://shopify/Order/123");
    expect(recorder.recorded).toHaveLength(1);
    expect(recorder.recorded[0]?.disposition).toBe("resolved_closed");
  });

  it("stays indeterminate (no fabricated success) when there is NO provider effect", async () => {
    const recorder = makeRecorder();
    const config: ReconciliationScannerConfig = {
      source: { listIndeterminate: () => Promise.resolve([candidate]) },
      // No finalize reference recorded -> no confirmed provider effect.
      ledger: makeLedger({}),
      orderQuery: makeOrderQuery(succeededOrder(makeOrder("PAID"))),
      recorder,
    };

    const resolution = await reconcileCandidate(config, candidate);

    expect(resolution.disposition).toBe("no_provider_effect");
    expect(resolution.orderReference).toBeUndefined();
    // NEVER closed without a real order reference.
    expect(resolution.disposition).not.toBe("resolved_closed");
    expect(recorder.recorded[0]?.disposition).toBe("no_provider_effect");
  });

  it("is a no-op for an already-resolved candidate", async () => {
    const recorder = makeRecorder(new Set(["order-abc"]));
    const config: ReconciliationScannerConfig = {
      source: { listIndeterminate: () => Promise.resolve([candidate]) },
      ledger: makeLedger({ "order-abc\u0000shopify.finalize": "gid://shopify/Order/123" }),
      orderQuery: makeOrderQuery(succeededOrder(makeOrder("PAID"))),
      recorder,
    };

    const resolution = await reconcileCandidate(config, candidate);

    expect(resolution.disposition).toBe("already_resolved");
    // Nothing new recorded.
    expect(recorder.recorded).toHaveLength(0);
  });

  it("stays indeterminate when the order exists but is NOT settled", async () => {
    const recorder = makeRecorder();
    const config: ReconciliationScannerConfig = {
      source: { listIndeterminate: () => Promise.resolve([candidate]) },
      ledger: makeLedger({ "order-abc\u0000shopify.finalize": "gid://shopify/Order/123" }),
      orderQuery: makeOrderQuery(succeededOrder(makeOrder("PENDING"))),
      recorder,
    };

    const resolution = await reconcileCandidate(config, candidate);

    expect(resolution.disposition).toBe("still_indeterminate");
    expect(resolution.orderReference).toBe("gid://shopify/Order/123");
  });

  it("stays indeterminate when the order query itself is inconclusive", async () => {
    const recorder = makeRecorder();
    const inconclusive: ActionOutcome<OrderResult> = {
      status: "indeterminate",
      correlationId: "order-abc",
      lastKnownState: "query.timeout",
    };
    const config: ReconciliationScannerConfig = {
      source: { listIndeterminate: () => Promise.resolve([candidate]) },
      ledger: makeLedger({ "order-abc\u0000shopify.finalize": "gid://shopify/Order/123" }),
      orderQuery: makeOrderQuery(inconclusive),
      recorder,
    };

    const resolution = await reconcileCandidate(config, candidate);

    expect(resolution.disposition).toBe("still_indeterminate");
    expect(resolution.evidence).toContain("inconclusive");
  });
});

describe("runReconciliationPass", () => {
  it("resolves every candidate in a single pass", async () => {
    const recorder = makeRecorder();
    const config: ReconciliationScannerConfig = {
      source: {
        listIndeterminate: () =>
          Promise.resolve([
            { transactionId: "a", idempotencyKey: "a" },
            { transactionId: "b", idempotencyKey: "b" },
          ]),
      },
      ledger: makeLedger({
        "a\u0000shopify.finalize": "gid://shopify/Order/A",
        // b has no provider effect.
      }),
      orderQuery: makeOrderQuery(succeededOrder(makeOrder("PAID"))),
      recorder,
    };

    const resolutions = await runReconciliationPass(config);

    expect(resolutions).toHaveLength(2);
    expect(resolutions.find((r) => r.transactionId === "a")?.disposition).toBe("resolved_closed");
    expect(resolutions.find((r) => r.transactionId === "b")?.disposition).toBe(
      "no_provider_effect",
    );
  });
});

describe("reconciliationEnabled", () => {
  it("is off unless RECONCILIATION_ENABLED is truthy", () => {
    expect(reconciliationEnabled({})).toBe(false);
    expect(reconciliationEnabled({ RECONCILIATION_ENABLED: "0" })).toBe(false);
    expect(reconciliationEnabled({ RECONCILIATION_ENABLED: "false" })).toBe(false);
    expect(reconciliationEnabled({ RECONCILIATION_ENABLED: "1" })).toBe(true);
    expect(reconciliationEnabled({ RECONCILIATION_ENABLED: "true" })).toBe(true);
    expect(reconciliationEnabled({ RECONCILIATION_ENABLED: "TRUE" })).toBe(true);
  });
});
