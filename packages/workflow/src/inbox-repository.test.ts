import { CryptoIdGenerator } from "@counter/domain";
import type { Instant } from "@counter/domain";
import { describe, expect, it } from "vitest";
import { InMemoryInboxRepository } from "./in-memory-inbox-repository.js";
import type { InboxEventInput } from "./inbox-repository.js";

const idGen = new CryptoIdGenerator();

function makeInput(overrides?: Partial<InboxEventInput>): InboxEventInput {
  return {
    id: idGen.generate("inbox-event"),
    source: "payments.service",
    sourceEventId: `evt_${Math.random().toString(36).slice(2)}`,
    eventType: "payment.completed",
    payload: { amount: 100 },
    correlationId: undefined,
    ...overrides,
  };
}

describe("InMemoryInboxRepository", () => {
  const now = 1_700_000_000_000 as Instant;
  const later = 1_700_000_001_000 as Instant;

  it("receives a new event", () => {
    const repo = new InMemoryInboxRepository();
    const input = makeInput();
    const result = repo.receive(input, now);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.outcome).toBe("new");
    if (result.value.outcome !== "new") return;
    expect(result.value.event.source).toBe(input.source);
    expect(result.value.event.sourceEventId).toBe(input.sourceEventId);
    expect(result.value.event.status).toBe("received");
    expect(result.value.event.receivedAt).toBe(now);
  });

  it("detects duplicate by source + sourceEventId", () => {
    const repo = new InMemoryInboxRepository();
    const input1 = makeInput({ sourceEventId: "evt_unique_1" });
    const input2 = makeInput({
      source: input1.source,
      sourceEventId: "evt_unique_1",
    });

    const result1 = repo.receive(input1, now);
    expect(result1.ok).toBe(true);
    if (!result1.ok) return;
    expect(result1.value.outcome).toBe("new");

    const result2 = repo.receive(input2, later);
    expect(result2.ok).toBe(true);
    if (!result2.ok) return;
    expect(result2.value.outcome).toBe("duplicate");
  });

  it("allows same sourceEventId from different sources", () => {
    const repo = new InMemoryInboxRepository();
    const input1 = makeInput({ source: "service-a", sourceEventId: "evt_1" });
    const input2 = makeInput({ source: "service-b", sourceEventId: "evt_1" });

    const result1 = repo.receive(input1, now);
    const result2 = repo.receive(input2, now);

    expect(result1.ok).toBe(true);
    expect(result2.ok).toBe(true);
    if (!result1.ok || !result2.ok) return;
    expect(result1.value.outcome).toBe("new");
    expect(result2.value.outcome).toBe("new");
  });

  it("marks event as processed", () => {
    const repo = new InMemoryInboxRepository();
    const input = makeInput();
    const receiveResult = repo.receive(input, now);
    expect(receiveResult.ok).toBe(true);

    const result = repo.markProcessed(input.id, later);
    expect(result.ok).toBe(true);

    const event = repo.getEvent(input.id);
    expect(event?.status).toBe("processed");
    expect(event?.processedAt).toBe(later);
  });

  it("markProcessed on nonexistent event returns error", () => {
    const repo = new InMemoryInboxRepository();
    const fakeId = idGen.generate("inbox-event");
    const result = repo.markProcessed(fakeId, now);
    expect(result.ok).toBe(false);
  });
});

describe("InMemoryInboxRepository - additional scenarios", () => {
  const now = 1_700_000_000_000 as Instant;
  const later = 1_700_000_001_000 as Instant;

  it("duplicate detection still works after markProcessed", () => {
    const repo = new InMemoryInboxRepository();
    const input = makeInput({ sourceEventId: "evt-stable" });
    repo.receive(input, now);
    repo.markProcessed(input.id, later);

    // Same source + sourceEventId should still be detected as duplicate
    const input2 = makeInput({ source: input.source, sourceEventId: "evt-stable" });
    const result = repo.receive(input2, later);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.outcome).toBe("duplicate");
  });

  it("preserves correlationId on the received event", () => {
    const repo = new InMemoryInboxRepository();
    const corrId = idGen.generate("correlation");
    const input = makeInput({ correlationId: corrId });
    const result = repo.receive(input, now);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.value.outcome !== "new") return;
    expect(result.value.event.correlationId).toBe(corrId);
  });
});
