/**
 * Idempotency tracking for Shopify order mutations.
 *
 * Tracks correlationId -> outcome mappings. On duplicate request with
 * the same idempotencyKey, returns the cached outcome. Detects
 * divergent duplicates (same key, different payload) and rejects them.
 */

import type { ActionOutcome } from "@counter/connector-sdk";

// ─── Stored Entry ─────────────────────────────────────────────────────────────

interface IdempotencyEntry<T> {
  readonly payloadHash: string;
  readonly outcome: ActionOutcome<T>;
  readonly recordedAt: number;
}

// ─── Payload Hashing ──────────────────────────────────────────────────────────

/**
 * Compute a deterministic hash of the payload for divergent-duplicate
 * detection. Recursively sorts object keys for stability.
 */
export function computePayloadHash(payload: unknown): string {
  return JSON.stringify(sortDeep(payload));
}

function sortDeep(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(sortDeep);
  if (typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).sort()) {
      sorted[key] = sortDeep((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

// ─── Idempotency Store ────────────────────────────────────────────────────────

export interface IdempotencyLookup<T> {
  readonly status: "new" | "cached" | "divergent";
  readonly cachedOutcome?: ActionOutcome<T> | undefined;
}

export interface IdempotencyStore<T> {
  lookup(idempotencyKey: string, payloadHash: string): IdempotencyLookup<T>;
  record(idempotencyKey: string, payloadHash: string, outcome: ActionOutcome<T>): void;
  clear(): void;
}

export function createIdempotencyStore<T>(): IdempotencyStore<T> {
  const entries = new Map<string, IdempotencyEntry<T>>();

  return {
    lookup(idempotencyKey: string, payloadHash: string): IdempotencyLookup<T> {
      const entry = entries.get(idempotencyKey);
      if (!entry) {
        return { status: "new" };
      }
      if (entry.payloadHash !== payloadHash) {
        return { status: "divergent" };
      }
      return { status: "cached", cachedOutcome: entry.outcome };
    },

    record(idempotencyKey: string, payloadHash: string, outcome: ActionOutcome<T>): void {
      entries.set(idempotencyKey, Object.freeze({
        payloadHash,
        outcome,
        recordedAt: Date.now(),
      }));
    },

    clear(): void {
      entries.clear();
    },
  };
}
