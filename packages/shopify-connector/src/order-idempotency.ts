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
 * Recursively sorts object keys for deterministic JSON serialization.
 * Handles nested objects, arrays, and primitive values.
 */
function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(value as Record<string, unknown>).sort();
    for (const key of keys) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Compute a deterministic hash of the payload for divergent-duplicate
 * detection. Uses recursive key sorting for stability across all nesting levels.
 */
export function computePayloadHash(payload: unknown): string {
  return JSON.stringify(canonicalize(payload));
}

// ─── Store Configuration ──────────────────────────────────────────────────────

export interface IdempotencyStoreOptions {
  /** Maximum number of entries before LRU eviction. Default: 10000 */
  readonly maxSize?: number;
  /** Time-to-live for entries in milliseconds. Default: 3600000 (1 hour) */
  readonly ttlMs?: number;
}

const DEFAULT_MAX_SIZE = 10_000;
const DEFAULT_TTL_MS = 3_600_000; // 1 hour

// ─── Idempotency Store ────────────────────────────────────────────────────────

export interface IdempotencyLookup<T> {
  readonly status: "new" | "cached" | "divergent";
  readonly cachedOutcome?: ActionOutcome<T> | undefined;
}

export interface IdempotencyStore<T> {
  lookup(idempotencyKey: string, payloadHash: string): IdempotencyLookup<T>;
  record(idempotencyKey: string, payloadHash: string, outcome: ActionOutcome<T>): void;
  clear(): void;
  readonly size: number;
}

export function createIdempotencyStore<T>(options?: IdempotencyStoreOptions): IdempotencyStore<T> {
  const maxSize = options?.maxSize ?? DEFAULT_MAX_SIZE;
  const ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
  const entries = new Map<string, IdempotencyEntry<T>>();

  function evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of entries) {
      if (now - entry.recordedAt > ttlMs) {
        entries.delete(key);
      }
    }
  }

  function evictOldest(): void {
    // Map iteration order is insertion order; delete the first (oldest) entry
    const firstKey = entries.keys().next().value;
    if (firstKey !== undefined) {
      entries.delete(firstKey);
    }
  }

  return {
    lookup(idempotencyKey: string, payloadHash: string): IdempotencyLookup<T> {
      const entry = entries.get(idempotencyKey);
      if (!entry) {
        return { status: "new" };
      }
      // Check TTL expiry
      if (Date.now() - entry.recordedAt > ttlMs) {
        entries.delete(idempotencyKey);
        return { status: "new" };
      }
      if (entry.payloadHash !== payloadHash) {
        return { status: "divergent" };
      }
      return { status: "cached", cachedOutcome: entry.outcome };
    },

    record(idempotencyKey: string, payloadHash: string, outcome: ActionOutcome<T>): void {
      // Evict expired entries periodically
      evictExpired();
      // Enforce max size with LRU-style eviction (oldest first)
      while (entries.size >= maxSize) {
        evictOldest();
      }
      entries.set(idempotencyKey, Object.freeze({
        payloadHash,
        outcome,
        recordedAt: Date.now(),
      }));
    },

    clear(): void {
      entries.clear();
    },

    get size(): number {
      return entries.size;
    },
  };
}
