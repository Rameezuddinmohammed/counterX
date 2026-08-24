import { sha256Digest } from "@counter/domain";
import type { Instant, Sha256Digest } from "@counter/domain";
import { describe, expect, it } from "vitest";
import { InMemoryIdempotencyStore } from "./in-memory-idempotency-store.js";

function makeDigest(content: string): Sha256Digest {
  return sha256Digest(Buffer.from(content, "utf-8"));
}

describe("InMemoryIdempotencyStore", () => {
  const now = 1_700_000_000_000 as Instant;
  const later = 1_700_000_001_000 as Instant;

  it("acquires a new key successfully", () => {
    const store = new InMemoryIdempotencyStore();
    const digest = makeDigest("request-body-1");
    const result = store.acquire("payment::create::abc", digest, now);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.outcome).toBe("acquired");
    if (result.value.outcome !== "acquired") return;
    expect(result.value.entry.key).toBe("payment::create::abc");
    expect(result.value.entry.status).toBe("pending");
    expect(result.value.entry.digest).toBe(digest);
  });

  it("returns replay for a completed key with same digest", () => {
    const store = new InMemoryIdempotencyStore();
    const digest = makeDigest("request-body-1");
    const response = { id: "txn_123", status: "completed" };

    store.acquire("key-1", digest, now);
    store.complete("key-1", response, later);

    const result = store.acquire("key-1", digest, later);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.outcome).toBe("replay");
    if (result.value.outcome !== "replay") return;
    expect(result.value.responseSnapshot).toEqual(response);
  });

  it("returns digest_conflict for same key with different digest", () => {
    const store = new InMemoryIdempotencyStore();
    const digest1 = makeDigest("body-a");
    const digest2 = makeDigest("body-b");

    store.acquire("key-1", digest1, now);

    const result = store.acquire("key-1", digest2, later);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.outcome).toBe("digest_conflict");
  });

  it("returns in_flight for same key with same digest when pending", () => {
    const store = new InMemoryIdempotencyStore();
    const digest = makeDigest("body-a");

    store.acquire("key-1", digest, now);

    // Second request with same key + digest while first is still pending
    const result = store.acquire("key-1", digest, later);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.outcome).toBe("in_flight");
  });

  it("allows re-acquire after failure with same digest", () => {
    const store = new InMemoryIdempotencyStore();
    const digest = makeDigest("body-a");

    store.acquire("key-1", digest, now);
    store.fail("key-1");

    const result = store.acquire("key-1", digest, later);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.outcome).toBe("acquired");
  });

  it("complete sets response snapshot", () => {
    const store = new InMemoryIdempotencyStore();
    const digest = makeDigest("body");
    const response = { amount: 100 };

    store.acquire("key-1", digest, now);
    const result = store.complete("key-1", response, later);

    expect(result.ok).toBe(true);
    const entry = store.getEntry("key-1");
    expect(entry?.status).toBe("completed");
    expect(entry?.responseSnapshot).toEqual(response);
    expect(entry?.completedAt).toBe(later);
  });

  it("fail on nonexistent key returns error", () => {
    const store = new InMemoryIdempotencyStore();
    const result = store.fail("nonexistent");
    expect(result.ok).toBe(false);
  });

  it("complete on nonexistent key returns error", () => {
    const store = new InMemoryIdempotencyStore();
    const result = store.complete("nonexistent", {}, now);
    expect(result.ok).toBe(false);
  });
});

describe("InMemoryIdempotencyStore - scope isolation", () => {
  const now = 1_700_000_000_000 as Instant;
  const later = 1_700_000_001_000 as Instant;

  it("different keys do not interfere with each other", () => {
    const store = new InMemoryIdempotencyStore();
    const digest = makeDigest("body");

    store.acquire("key-1", digest, now);
    store.acquire("key-2", digest, now);

    // Complete key-1, key-2 should still be pending (in_flight)
    store.complete("key-1", { result: "ok" }, later);

    const result1 = store.acquire("key-1", digest, later);
    expect(result1.ok).toBe(true);
    if (!result1.ok) return;
    expect(result1.value.outcome).toBe("replay");

    const result2 = store.acquire("key-2", digest, later);
    expect(result2.ok).toBe(true);
    if (!result2.ok) return;
    expect(result2.value.outcome).toBe("in_flight");
  });

  it("concurrent requests with same key - second is in_flight", () => {
    const store = new InMemoryIdempotencyStore();
    const digest = makeDigest("same-body");

    const first = store.acquire("concurrent-key", digest, now);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.outcome).toBe("acquired");

    const second = store.acquire("concurrent-key", digest, now);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.outcome).toBe("in_flight");
  });
});
