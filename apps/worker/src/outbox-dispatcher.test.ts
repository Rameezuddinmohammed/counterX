import { describe, expect, it } from "vitest";
import {
  createCounterId,
  instantFromEpochMilliseconds,
  type CanonicalError,
  type CounterId,
  type Instant,
  type Result,
} from "@counter/domain";
import { InMemoryOutboxRepository } from "@counter/workflow";
import type { OutboxEvent } from "@counter/workflow";
import type { AsyncOutboxRepository } from "@counter/data";
import {
  runOutboxDispatchTick,
  type OutboxDispatcherConfig,
  type OutboxDispatcherDeps,
} from "./outbox-dispatcher.js";

// ─── Test helpers ─────────────────────────────────────────────────────────────

function counterId<Kind extends Parameters<typeof createCounterId>[0]>(
  kind: Kind,
  seed: number,
): CounterId<Kind> {
  const result = createCounterId(kind, new Uint8Array(16).fill(seed));
  if (!result.ok) {
    throw new Error(`Could not create ${String(kind)} id`);
  }
  return result.value;
}

function instant(ms: number): Instant {
  const result = instantFromEpochMilliseconds(ms);
  if (!result.ok) {
    throw new Error("bad instant");
  }
  return result.value;
}

/** Adapts the synchronous InMemoryOutboxRepository to the async contract, same idiom as worker-loop.test.ts. */
class AsyncInMemoryOutboxRepository implements AsyncOutboxRepository {
  readonly inner = new InMemoryOutboxRepository();

  append(
    events: Parameters<InMemoryOutboxRepository["append"]>[0],
    now: Instant,
  ): Promise<Result<readonly OutboxEvent[], CanonicalError>> {
    return Promise.resolve(this.inner.append(events, now));
  }
  claim(
    limit: number,
    owner: string,
    now: Instant,
  ): Promise<Result<readonly OutboxEvent[], CanonicalError>> {
    return Promise.resolve(this.inner.claim(limit, owner, now));
  }
  markDispatched(
    ids: readonly CounterId<"outbox-event">[],
    now: Instant,
  ): Promise<Result<void, CanonicalError>> {
    return Promise.resolve(this.inner.markDispatched(ids, now));
  }
  markFailed(
    id: CounterId<"outbox-event">,
    errorClass: string,
    now: Instant,
  ): Promise<Result<void, CanonicalError>> {
    return Promise.resolve(this.inner.markFailed(id, errorClass, now));
  }
  markDeadLetter(
    id: CounterId<"outbox-event">,
    owner: string,
  ): Promise<Result<void, CanonicalError>> {
    return Promise.resolve(this.inner.markDeadLetter(id, owner));
  }
}

interface RecordedWrite {
  readonly walletId: string;
  readonly notificationType: string;
  readonly transactionId: string | undefined;
}

class FakeWebhookEndpoints {
  #endpoints = new Map<string, { url: string; signingSecret: string }>();

  set(merchantId: string, url: string, signingSecret: string): void {
    this.#endpoints.set(merchantId, { url, signingSecret });
  }

  findByMerchantId(merchantId: string) {
    return Promise.resolve(this.#endpoints.get(merchantId));
  }
}

class FakeBuyerNotifications {
  readonly writes: RecordedWrite[] = [];

  write(input: { walletId: string; notificationType: string; transactionId: string | undefined }) {
    this.writes.push(input);
    return Promise.resolve(true);
  }
}

interface RecordedFetchCall {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

function fakeFetch(responses: readonly { status: number }[]): {
  fetchImpl: typeof fetch;
  calls: RecordedFetchCall[];
} {
  const calls: RecordedFetchCall[] = [];
  let callIndex = 0;
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const body = typeof init?.body === "string" ? init.body : "";
    calls.push({ url, headers, body });
    const response = responses[Math.min(callIndex, responses.length - 1)]!;
    callIndex += 1;
    return new Response(null, { status: response.status });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function config(overrides: Partial<OutboxDispatcherConfig> = {}): OutboxDispatcherConfig {
  return { owner: "dispatcher-1", batchSize: 10, pollIntervalMs: 1_000, ...overrides };
}

const MERCHANT_ID = "ctr_merchant_AAAAAAAAAAAAAAAAAAAAAA";
const WALLET_ID = "ctr_wallet_AAAAAAAAAAAAAAAAAAAAAA";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("runOutboxDispatchTick", () => {
  it("marks a non-routing event (e.g. transaction.receipt.v1) dispatched with no delivery attempt", async () => {
    const repo = new AsyncInMemoryOutboxRepository();
    repo.inner.append(
      [
        {
          id: counterId("outbox-event", 1),
          eventType: "transaction.receipt.v1",
          eventVersion: 1,
          payload: { transactionId: "t1" },
          correlationId: undefined,
          idempotencyKey: "t1",
        },
      ],
      instant(1_000),
    );
    const { fetchImpl, calls } = fakeFetch([{ status: 200 }]);
    const deps: OutboxDispatcherDeps = {
      webhookEndpoints: new FakeWebhookEndpoints(),
      buyerNotifications: new FakeBuyerNotifications(),
      fetchImpl,
    };

    const result = await runOutboxDispatchTick(repo, deps, config(), undefined, () =>
      instant(2_000),
    );

    expect(result).toEqual({ claimed: 1, dispatched: 1, failed: 0 });
    expect(calls).toHaveLength(0);
    const event = repo.inner.getAll()[0]!;
    expect(event.status).toBe("dispatched");
  });

  it("delivers merchant.order.created.v1 to the registered endpoint, HMAC-signed", async () => {
    const repo = new AsyncInMemoryOutboxRepository();
    repo.inner.append(
      [
        {
          id: counterId("outbox-event", 2),
          eventType: "merchant.order.created.v1",
          eventVersion: 1,
          payload: { transactionId: "t2", merchantId: MERCHANT_ID },
          correlationId: undefined,
          idempotencyKey: "t2",
        },
      ],
      instant(1_000),
    );
    const webhookEndpoints = new FakeWebhookEndpoints();
    webhookEndpoints.set(
      MERCHANT_ID,
      "https://merchant.example.com/webhooks/counter",
      "test-secret",
    );
    const { fetchImpl, calls } = fakeFetch([{ status: 200 }]);
    const deps: OutboxDispatcherDeps = {
      webhookEndpoints,
      buyerNotifications: new FakeBuyerNotifications(),
      fetchImpl,
    };

    const result = await runOutboxDispatchTick(repo, deps, config(), undefined, () =>
      instant(2_000),
    );

    expect(result).toEqual({ claimed: 1, dispatched: 1, failed: 0 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://merchant.example.com/webhooks/counter");
    expect(calls[0]!.headers["x-counter-event-id"]).toBe(counterId("outbox-event", 2));
    expect(calls[0]!.headers["x-counter-signature"]).toMatch(/^[0-9a-f]{64}$/);
    const parsedBody = JSON.parse(calls[0]!.body) as { event_type: string; data: unknown };
    expect(parsedBody.event_type).toBe("merchant.order.created.v1");
  });

  it("does not error and still dispatches when the merchant has no registered endpoint", async () => {
    const repo = new AsyncInMemoryOutboxRepository();
    repo.inner.append(
      [
        {
          id: counterId("outbox-event", 3),
          eventType: "merchant.order.created.v1",
          eventVersion: 1,
          payload: { transactionId: "t3", merchantId: MERCHANT_ID },
          correlationId: undefined,
          idempotencyKey: "t3",
        },
      ],
      instant(1_000),
    );
    const { fetchImpl, calls } = fakeFetch([{ status: 200 }]);
    const deps: OutboxDispatcherDeps = {
      webhookEndpoints: new FakeWebhookEndpoints(), // nothing registered
      buyerNotifications: new FakeBuyerNotifications(),
      fetchImpl,
    };

    const result = await runOutboxDispatchTick(repo, deps, config(), undefined, () =>
      instant(2_000),
    );

    expect(result).toEqual({ claimed: 1, dispatched: 1, failed: 0 });
    expect(calls).toHaveLength(0);
  });

  it("fans out into runtime.buyer_notifications when the payload carries a walletId", async () => {
    const repo = new AsyncInMemoryOutboxRepository();
    repo.inner.append(
      [
        {
          id: counterId("outbox-event", 4),
          eventType: "merchant.order.created.v1",
          eventVersion: 1,
          payload: { transactionId: "t4", merchantId: MERCHANT_ID, walletId: WALLET_ID },
          correlationId: undefined,
          idempotencyKey: "t4",
        },
      ],
      instant(1_000),
    );
    const buyerNotifications = new FakeBuyerNotifications();
    const { fetchImpl } = fakeFetch([{ status: 200 }]);
    const deps: OutboxDispatcherDeps = {
      webhookEndpoints: new FakeWebhookEndpoints(),
      buyerNotifications,
      fetchImpl,
    };

    await runOutboxDispatchTick(repo, deps, config(), undefined, () => instant(2_000));

    expect(buyerNotifications.writes).toHaveLength(1);
    expect(buyerNotifications.writes[0]).toMatchObject({
      walletId: WALLET_ID,
      notificationType: "merchant.order.created.v1",
      transactionId: "t4",
    });
  });

  it("retries with backoff on a failed delivery (non-2xx), without dead-lettering before MAX_ATTEMPTS", async () => {
    const repo = new AsyncInMemoryOutboxRepository();
    const eventId = counterId("outbox-event", 5);
    repo.inner.append(
      [
        {
          id: eventId,
          eventType: "merchant.order.created.v1",
          eventVersion: 1,
          payload: { transactionId: "t5", merchantId: MERCHANT_ID },
          correlationId: undefined,
          idempotencyKey: "t5",
        },
      ],
      instant(1_000),
    );
    const webhookEndpoints = new FakeWebhookEndpoints();
    webhookEndpoints.set(
      MERCHANT_ID,
      "https://merchant.example.com/webhooks/counter",
      "test-secret",
    );
    const { fetchImpl } = fakeFetch([{ status: 500 }]);
    const deps: OutboxDispatcherDeps = {
      webhookEndpoints,
      buyerNotifications: new FakeBuyerNotifications(),
      fetchImpl,
    };

    const result = await runOutboxDispatchTick(repo, deps, config(), undefined, () =>
      instant(2_000),
    );

    expect(result).toEqual({ claimed: 1, dispatched: 0, failed: 1 });
    const event = repo.inner.getAll()[0]!;
    expect(event.status).toBe("failed");
    expect(event.attempts).toBe(1);
    expect(event.nextAttemptAt).toBeGreaterThan(2_000);
  });

  it("dead-letters after MAX_ATTEMPTS consecutive failures", async () => {
    const repo = new AsyncInMemoryOutboxRepository();
    const eventId = counterId("outbox-event", 6);
    repo.inner.append(
      [
        {
          id: eventId,
          eventType: "merchant.order.created.v1",
          eventVersion: 1,
          payload: { transactionId: "t6", merchantId: MERCHANT_ID },
          correlationId: undefined,
          idempotencyKey: "t6",
        },
      ],
      instant(1_000),
    );
    const webhookEndpoints = new FakeWebhookEndpoints();
    webhookEndpoints.set(
      MERCHANT_ID,
      "https://merchant.example.com/webhooks/counter",
      "test-secret",
    );
    const deps: OutboxDispatcherDeps = {
      webhookEndpoints,
      buyerNotifications: new FakeBuyerNotifications(),
      fetchImpl: fakeFetch([{ status: 500 }]).fetchImpl,
    };

    // MAX_ATTEMPTS is 5 inside the module; drive 5 failing ticks, each with a
    // clock far enough past the previous backoff to be reclaimable immediately.
    let clockMs = 2_000;
    let lastResult;
    for (let i = 0; i < 5; i += 1) {
      lastResult = await runOutboxDispatchTick(repo, deps, config(), undefined, () =>
        instant(clockMs),
      );
      clockMs += 10_000_000; // comfortably past any exponential backoff window
    }

    expect(lastResult).toEqual({ claimed: 1, dispatched: 0, failed: 1 });
    const event = repo.inner.getAll()[0]!;
    expect(event.status).toBe("dead_letter");
  });

  it("is a no-op when there are no claimable events", async () => {
    const repo = new AsyncInMemoryOutboxRepository();
    const deps: OutboxDispatcherDeps = {
      webhookEndpoints: new FakeWebhookEndpoints(),
      buyerNotifications: new FakeBuyerNotifications(),
      fetchImpl: fakeFetch([{ status: 200 }]).fetchImpl,
    };

    const result = await runOutboxDispatchTick(repo, deps, config(), undefined, () =>
      instant(2_000),
    );

    expect(result).toEqual({ claimed: 0, dispatched: 0, failed: 0 });
  });
});
