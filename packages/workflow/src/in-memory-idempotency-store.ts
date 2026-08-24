import {
  type CanonicalError,
  type Instant,
  type Result,
  type Sha256Digest,
  createCanonicalError,
  err,
  ok,
  sha256DigestsEqual,
} from "@counter/domain";
import type {
  IdempotencyAcquireResult,
  IdempotencyEntry,
  IdempotencyStore,
} from "./idempotency-store.js";

export class InMemoryIdempotencyStore implements IdempotencyStore {
  readonly #entries: Map<string, IdempotencyEntry> = new Map();

  public acquire(
    key: string,
    digest: Sha256Digest,
    now: Instant,
  ): Result<IdempotencyAcquireResult, CanonicalError> {
    const existing = this.#entries.get(key);

    if (existing === undefined) {
      const entry: IdempotencyEntry = Object.freeze({
        key,
        digest,
        status: "pending",
        responseSnapshot: undefined,
        createdAt: now,
        completedAt: undefined,
      });
      this.#entries.set(key, entry);
      return ok({ outcome: "acquired", entry });
    }

    if (!sha256DigestsEqual(existing.digest, digest)) {
      return ok({ outcome: "digest_conflict" });
    }

    if (existing.status === "completed") {
      return ok({ outcome: "replay", responseSnapshot: existing.responseSnapshot });
    }

    if (existing.status === "pending") {
      return ok({ outcome: "in_flight" });
    }

    // status === "failed" with same digest: allow re-acquire
    const entry: IdempotencyEntry = Object.freeze({
      key,
      digest,
      status: "pending",
      responseSnapshot: undefined,
      createdAt: now,
      completedAt: undefined,
    });
    this.#entries.set(key, entry);
    return ok({ outcome: "acquired", entry });
  }

  public complete(
    key: string,
    responseSnapshot: unknown,
    now: Instant,
  ): Result<void, CanonicalError> {
    const existing = this.#entries.get(key);
    if (existing === undefined) {
      return err(
        createCanonicalError({
          category: "validation",
          code: "INVALID_FORMAT",
          message: "Idempotency key not found",
        }),
      );
    }

    const updated: IdempotencyEntry = Object.freeze({
      ...existing,
      status: "completed",
      responseSnapshot,
      completedAt: now,
    });
    this.#entries.set(key, updated);
    return ok(undefined);
  }

  public fail(key: string): Result<void, CanonicalError> {
    const existing = this.#entries.get(key);
    if (existing === undefined) {
      return err(
        createCanonicalError({
          category: "validation",
          code: "INVALID_FORMAT",
          message: "Idempotency key not found",
        }),
      );
    }

    const updated: IdempotencyEntry = Object.freeze({
      ...existing,
      status: "failed",
    });
    this.#entries.set(key, updated);
    return ok(undefined);
  }

  /** Test helper: get current entry for inspection. */
  public getEntry(key: string): IdempotencyEntry | undefined {
    return this.#entries.get(key);
  }
}
