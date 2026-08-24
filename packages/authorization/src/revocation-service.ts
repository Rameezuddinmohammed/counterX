/**
 * Revocation service and store.
 *
 * Implements monotonic, durable revocation for keys, agents, mandates,
 * and payment-authorization-references. Once revoked at time T,
 * isRevoked(id, type, atTime) returns true for any time >= T.
 *
 * Concurrent revocation racing with usage is safe: only the first
 * revocation is recorded, subsequent are idempotent.
 */

import { type Result, ok, type Instant, compareInstants } from "@counter/domain";

// ---------------------------------------------------------------------------
// Revocation Scope Types
// ---------------------------------------------------------------------------

export const REVOCATION_SCOPE_TYPES = [
  "key",
  "agent",
  "mandate",
  "payment_authorization_reference",
] as const;

export type RevocationScopeType = (typeof REVOCATION_SCOPE_TYPES)[number];

const revocationScopeTypeSet: ReadonlySet<string> = new Set(REVOCATION_SCOPE_TYPES);

export function isRevocationScopeType(value: unknown): value is RevocationScopeType {
  return typeof value === "string" && revocationScopeTypeSet.has(value);
}

// ---------------------------------------------------------------------------
// Revocation Scope
// ---------------------------------------------------------------------------

export interface RevocationScope {
  readonly scopeType: RevocationScopeType;
  readonly scopeId: string;
  readonly effectiveTime: Instant;
  readonly reason?: string;
}

// ---------------------------------------------------------------------------
// Revocation Entry (internal storage)
// ---------------------------------------------------------------------------

interface RevocationEntry {
  readonly scopeType: RevocationScopeType;
  readonly scopeId: string;
  readonly effectiveTime: Instant;
  readonly recordedAt: Instant;
  readonly reason?: string;
}

// ---------------------------------------------------------------------------
// RevocationStore Port
// ---------------------------------------------------------------------------

/**
 * Port for revocation persistence.
 * Implementations may be in-memory (tests) or database-backed (production).
 */
export interface RevocationStore {
  /**
   * Records a revocation. Monotonic: if already revoked, takes the earlier
   * effective time. Returns ok(void) on success.
   */
  revoke(scope: RevocationScope): Promise<Result<void>>;

  /**
   * Checks if a scope is revoked at the given time.
   * Returns true if revoked at or before atTime.
   */
  isRevoked(scopeType: RevocationScopeType, scopeId: string, atTime: Instant): Promise<boolean>;

  /**
   * Returns the effective revocation time for a scope, if revoked.
   */
  getRevocationTime(
    scopeType: RevocationScopeType,
    scopeId: string,
  ): Promise<Instant | undefined>;
}

// ---------------------------------------------------------------------------
// InMemoryRevocationStore
// ---------------------------------------------------------------------------

/**
 * In-memory implementation of RevocationStore for tests and pilot.
 * Uses a composite key of (scopeType, scopeId) and stores the earliest
 * effective time (monotonic revocation).
 */
export class InMemoryRevocationStore implements RevocationStore {
  readonly #entries: Map<string, RevocationEntry> = new Map();
  readonly #pending: Map<string, Promise<Result<void>>> = new Map();

  public async revoke(scope: RevocationScope): Promise<Result<void>> {
    const key = this.#compositeKey(scope.scopeType, scope.scopeId);

    // Check for pending operation on the same key
    const pendingOp = this.#pending.get(key);
    if (pendingOp !== undefined) {
      await pendingOp;
    }

    // Create the operation promise for concurrency safety
    let resolve!: (value: Result<void>) => void;
    const operation = new Promise<Result<void>>((r) => {
      resolve = r;
    });
    this.#pending.set(key, operation);

    const existing = this.#entries.get(key);

    if (existing !== undefined) {
      // Monotonic: take the earlier effective time
      if (compareInstants(scope.effectiveTime, existing.effectiveTime) < 0) {
        const reasonValue = scope.reason ?? existing.reason;
        const updated: RevocationEntry = Object.freeze({
          scopeType: scope.scopeType,
          scopeId: scope.scopeId,
          effectiveTime: scope.effectiveTime,
          recordedAt: existing.recordedAt,
          ...(reasonValue !== undefined ? { reason: reasonValue } : {}),
        });







        this.#entries.set(key, updated);
      }
      // Idempotent: already revoked
      this.#pending.delete(key);
      resolve(ok(undefined));
      return ok(undefined);
    }

    // Record new revocation
    const entry: RevocationEntry = Object.freeze({
      scopeType: scope.scopeType,
      scopeId: scope.scopeId,
      effectiveTime: scope.effectiveTime,
      recordedAt: scope.effectiveTime,
      ...(scope.reason !== undefined ? { reason: scope.reason } : {}),
    });







    this.#entries.set(key, entry);
    this.#pending.delete(key);
    resolve(ok(undefined));
    return ok(undefined);
  }

  public async isRevoked(
    scopeType: RevocationScopeType,
    scopeId: string,
    atTime: Instant,
  ): Promise<boolean> {
    const key = this.#compositeKey(scopeType, scopeId);
    const entry = this.#entries.get(key);
    if (entry === undefined) {
      return false;
    }
    return compareInstants(atTime, entry.effectiveTime) >= 0;
  }

  public async getRevocationTime(
    scopeType: RevocationScopeType,
    scopeId: string,
  ): Promise<Instant | undefined> {
    const key = this.#compositeKey(scopeType, scopeId);
    const entry = this.#entries.get(key);
    return entry?.effectiveTime;
  }

  /** Returns the total number of revocation entries. Test utility. */
  public get size(): number {
    return this.#entries.size;
  }

  /** Clears all entries. Test utility only. */
  public clear(): void {
    this.#entries.clear();
    this.#pending.clear();
  }

  #compositeKey(scopeType: RevocationScopeType, scopeId: string): string {
    return `${scopeType}:${scopeId}`;
  }
}
