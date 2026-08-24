import { CryptoIdGenerator } from "@counter/domain";
import type { Instant } from "@counter/domain";
import { describe, expect, it } from "vitest";
import { InMemoryOutboxRepository } from "./in-memory-outbox-repository.js";
import type { OutboxEventInput } from "./outbox-repository.js";

const idGen = new CryptoIdGenerator();

function makeInput(overrides?: Partial<OutboxEventInput>): OutboxEventInput {
  return {
    id: idGen.generate("outbox-event"),
    eventType: "payment.completed",
    eventVersion: 1,
    payload: { amount: 100, currency: "USD" },
    correlationId: undefined,
    idempotencyKey: undefined,
    ...overrides,
  };
}

describe("InMemoryOutboxRepository", () => {
  const now = 1_700_000_000_000 as Instant;
  const later = 1_700_000_001_000 as Instant;

  it("appends events with pending status", () => {
    const repo = new InMemoryOutboxRepository();
    const input = makeInput();
    const result = repo.append([input], now);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]!.status).toBe("pending");
    expect(result.value[0]!.createdAt).toBe(now);
    expect(result.value[0]!.attempts).toBe(0);
  });

  it("claims pending events", () => {
    const repo = new InMemoryOutboxRepository();
    const input1 = makeInput();
    const input2 = makeInput();
    repo.append([input1, input2], now);

    const result = repo.claim(10, "worker-1", now);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
    expect(result.value[0]!.owner).toBe("worker-1");
  });

  it("limits claimed events", () => {
    const repo = new InMemoryOutboxRepository();
    repo.append([makeInput(), makeInput(), makeInput()], now);

    const result = repo.claim(2, "worker-1", now);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
  });

  it("marks events as dispatched", () => {
    const repo = new InMemoryOutboxRepository();
    const input = makeInput();
    repo.append([input], now);
    repo.claim(10, "worker-1", now);

    const result = repo.markDispatched([input.id], later);
    expect(result.ok).toBe(true);

    const all = repo.getAll();
    expect(all[0]!.status).toBe("dispatched");
    expect(all[0]!.dispatchedAt).toBe(later);
  });

  it("marks event as failed with exponential backoff", () => {
    const repo = new InMemoryOutboxRepository();
    const input = makeInput();
    repo.append([input], now);
    repo.claim(10, "worker-1", now);

    // First failure: backoff = 1000 * 2^0 = 1000ms
    const result = repo.markFailed(input.id, "TimeoutError", later);
    expect(result.ok).toBe(true);

    const all = repo.getAll();
    expect(all[0]!.status).toBe("failed");
    expect(all[0]!.attempts).toBe(1);
    expect(all[0]!.nextAttemptAt).toBe(later + 1000);
    expect(all[0]!.errorClass).toBe("TimeoutError");
  });

  it("failed events are not claimable until nextAttemptAt but are claimable after", () => {
    const repo = new InMemoryOutboxRepository();
    const input = makeInput();
    repo.append([input], now);
    repo.claim(10, "worker-1", now);
    repo.markFailed(input.id, "TimeoutError", now);

    // Try claiming before nextAttemptAt (nextAttemptAt = now + 1000)
    const tooEarly = (now + 500) as Instant;
    const resultEarly = repo.claim(10, "worker-2", tooEarly);
    expect(resultEarly.ok).toBe(true);
    if (!resultEarly.ok) return;
    expect(resultEarly.value).toHaveLength(0);

    // After nextAttemptAt, the failed event should be claimable
    const afterBackoff = (now + 1001) as Instant;
    const resultLater = repo.claim(10, "worker-2", afterBackoff);
    expect(resultLater.ok).toBe(true);
    if (!resultLater.ok) return;
    expect(resultLater.value).toHaveLength(1);
    expect(resultLater.value[0]!.status).toBe("failed");
  });

  it("marks event as dead letter", () => {
    const repo = new InMemoryOutboxRepository();
    const input = makeInput();
    repo.append([input], now);
    repo.claim(10, "worker-1", now);

    const result = repo.markDeadLetter(input.id, "admin");
    expect(result.ok).toBe(true);

    const all = repo.getAll();
    expect(all[0]!.status).toBe("dead_letter");
    expect(all[0]!.owner).toBe("admin");
  });

  it("markDispatched with unknown id returns error", () => {
    const repo = new InMemoryOutboxRepository();
    const fakeId = idGen.generate("outbox-event");
    const result = repo.markDispatched([fakeId], now);
    expect(result.ok).toBe(false);
  });
});

describe("InMemoryOutboxRepository - additional scenarios", () => {
  const now = 1_700_000_000_000 as Instant;

  it("claim respects nextAttemptAt for failed events eligible for retry", () => {
    const repo = new InMemoryOutboxRepository();
    const input = makeInput();
    repo.append([input], now);
    repo.claim(10, "worker-1", now);

    // Mark failed - nextAttemptAt = now + 1000
    repo.markFailed(input.id, "Timeout", now);

    // Before nextAttemptAt, the event should not be claimable
    const beforeNext = (now + 999) as Instant;
    const resultBefore = repo.claim(10, "worker-2", beforeNext);
    expect(resultBefore.ok).toBe(true);
    if (!resultBefore.ok) return;
    expect(resultBefore.value).toHaveLength(0);

    // At exactly nextAttemptAt (nextAttemptAt <= now), the event is claimable
    const atNextAttempt = (now + 1000) as Instant;
    const resultAt = repo.claim(10, "worker-2", atNextAttempt);
    expect(resultAt.ok).toBe(true);
    if (!resultAt.ok) return;
    expect(resultAt.value).toHaveLength(1);
  });

  it("second markFailed increases backoff exponentially", () => {
    const repo = new InMemoryOutboxRepository();
    const input = makeInput();
    repo.append([input], now);
    repo.claim(10, "worker-1", now);

    // First failure: backoff = 1000 * 2^0 = 1000ms
    repo.markFailed(input.id, "Error", now);
    let all = repo.getAll();
    expect(all[0]!.attempts).toBe(1);
    expect(all[0]!.nextAttemptAt).toBe(now + 1000);

    // Second failure: backoff = 1000 * 2^1 = 2000ms
    const t2 = (now + 1001) as Instant;
    repo.markFailed(input.id, "Error", t2);
    all = repo.getAll();
    expect(all[0]!.attempts).toBe(2);
    expect(all[0]!.nextAttemptAt).toBe(t2 + 2000);
  });
});
