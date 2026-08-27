/**
 * Durable idempotency integration for agent-runtime mutating routes.
 *
 * The @counter/http-api-kit idempotency middleware only extracts and validates
 * the Idempotency-Key header; the actual dedup happens here at the service
 * layer. This module defines a small async port (acquire/complete/fail) that
 * mirrors @counter/data's PostgresIdempotencyStore, plus an in-memory adapter
 * for local/test. Route wiring calls acquire() before invoking a handler:
 *   - acquired      -> run the handler, then complete() with the response
 *   - replay        -> return the persisted response snapshot verbatim
 *   - in_flight     -> a concurrent request holds the key (409)
 *   - digest_conflict -> same key, different request body (409)
 *
 * NOTE: PostgresIdempotencyStore hardcodes environment='local', scope
 * 'platform', operation 'default' in its SQL. This durable layer therefore
 * partitions every key under that single logical scope; keep this in mind when
 * broadening to per-merchant/per-operation scoping later.
 */
import {
  type CanonicalError,
  type Instant,
  type Result,
  type Sha256Digest,
} from "@counter/domain";
import { InMemoryIdempotencyStore, type IdempotencyAcquireResult } from "@counter/workflow";

export interface RuntimeIdempotencyStore {
  acquire(
    key: string,
    digest: Sha256Digest,
    now: Instant,
  ): Promise<Result<IdempotencyAcquireResult, CanonicalError>>;
  complete(
    key: string,
    responseSnapshot: unknown,
    now: Instant,
  ): Promise<Result<void, CanonicalError>>;
  fail(key: string): Promise<Result<void, CanonicalError>>;
}

/**
 * Wraps the synchronous in-memory workflow store in the async port so the same
 * route wiring works for both in-memory (local/test) and Postgres (production).
 */
export function createInMemoryRuntimeIdempotencyStore(): RuntimeIdempotencyStore {
  const store = new InMemoryIdempotencyStore();
  return {
    acquire(key, digest, now) {
      return Promise.resolve(store.acquire(key, digest, now));
    },
    complete(key, responseSnapshot, now) {
      return Promise.resolve(store.complete(key, responseSnapshot, now));
    },
    fail(key) {
      return Promise.resolve(store.fail(key));
    },
  };
}
