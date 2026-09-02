/**
 * Outbox dispatcher: claims pending `runtime.outbox_events` rows and fans
 * each one out to its real consumer(s) by event type.
 *
 * This closes a real, long-standing gap: packages/workflow's
 * OutboxRepository (claim/markDispatched/markFailed/markDeadLetter,
 * exponential backoff, dead-letter terminal state) and its Postgres
 * implementation have existed and been unit-tested for a long time, but
 * only append() was ever called in production
 * (apps/worker/src/main.ts's createOutboxReceiptSink writes
 * transaction.receipt.v1 rows). Nothing ever polled/claimed/dispatched a
 * row until this file — every outbox row sat at status='pending' forever.
 *
 * DELIVERY SEMANTICS: at-least-once, by design — PostgresOutboxRepository's
 * claim() sets an owner but does NOT move status away from 'pending', so a
 * dispatcher that crashes between claiming a row and marking it dispatched
 * leaves it eligible for another claim on the next poll (same trade-off
 * webhook systems like Stripe/GitHub/Shopify itself make). Every consumer
 * below is written to be safe under a duplicate delivery:
 *   - the outbound merchant webhook POST carries the outbox event's own id
 *     as `event_id` in the delivered body, so a well-behaved receiver can
 *     dedupe on it (the same idiom this codebase already consumes on the
 *     INBOUND side — Shopify's X-Shopify-Webhook-Id, see webhook-routes.ts);
 *   - the buyer-notifications projection write is a real, idempotent
 *     ON CONFLICT DO NOTHING (see buyer-notification-store.ts).
 *
 * EVENT TYPES HANDLED:
 *   - merchant.order.created.v1 / merchant.order.fulfilled.v1: POST to the
 *     merchant's registered webhook endpoint (merchant.webhook_endpoints),
 *     HMAC-SHA256 signed over the raw JSON body (same construction as
 *     @counter/razorpay-adapter's signing.ts, duplicated rather than
 *     imported to avoid a payment-provider-package dependency for a
 *     generic primitive). ALSO projected into runtime.buyer_notifications
 *     when the payload carries a walletId — fan-out: one event, two
 *     consumers, exactly the design this table exists for. A merchant with
 *     no registered endpoint is NOT an error: the event still projects
 *     buyer-side (if it has a walletId) and is marked dispatched, not
 *     retried forever waiting for a registration that may never come.
 *   - any other event type (including the pre-existing
 *     transaction.receipt.v1, which was never meant to be pushed anywhere —
 *     it's read directly by the out-of-band reconciliation scanner, see
 *     reconciliation-boot.ts): marked dispatched with no delivery attempt.
 *     This is what actually stops these rows from sitting 'pending'
 *     forever now that something finally claims the table.
 *
 * RETRY: a delivery attempt that throws (network error, non-2xx from the
 * merchant's endpoint, a Postgres error) calls markFailed(), which the
 * repository turns into real exponential backoff. After MAX_ATTEMPTS
 * failures the event moves to dead_letter — a human-visible terminal
 * state, never silently dropped.
 */
import { createHmac, randomBytes } from "node:crypto";
import { createCounterId, instantFromEpochMilliseconds, type Instant } from "@counter/domain";
import type {
  AsyncOutboxRepository,
  PostgresBuyerNotificationStore,
  PostgresWebhookEndpointReadStore,
} from "@counter/data";
import type { OutboxEvent } from "@counter/workflow";

const MAX_ATTEMPTS = 5;
const DELIVERY_TIMEOUT_MS = 10_000;

export interface DispatcherLogger {
  info(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

const NOOP_LOGGER: DispatcherLogger = { info: () => undefined, error: () => undefined };

export interface OutboxDispatcherDeps {
  readonly webhookEndpoints: Pick<PostgresWebhookEndpointReadStore, "findByMerchantId">;
  readonly buyerNotifications: Pick<PostgresBuyerNotificationStore, "write">;
  /** Injectable for tests; defaults to the global fetch. */
  readonly fetchImpl?: typeof fetch;
}

export interface OrderLifecyclePayload {
  readonly transactionId?: string;
  readonly merchantId?: string;
  readonly walletId?: string;
  readonly [key: string]: unknown;
}

function isOrderLifecyclePayload(value: unknown): value is OrderLifecyclePayload {
  return typeof value === "object" && value !== null;
}

const ORDER_LIFECYCLE_EVENT_TYPES: ReadonlySet<string> = new Set([
  "merchant.order.created.v1",
  "merchant.order.fulfilled.v1",
]);

/** Same HMAC_SHA256-hex construction as @counter/razorpay-adapter's signing.ts. */
function hmacSha256Hex(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("hex");
}

async function deliverMerchantWebhook(
  event: OutboxEvent,
  endpoint: { readonly url: string; readonly signingSecret: string },
  fetchImpl: typeof fetch,
): Promise<void> {
  const body = JSON.stringify({
    event_id: event.id,
    event_type: event.eventType,
    event_version: event.eventVersion,
    created_at: new Date(Number(event.createdAt)).toISOString(),
    data: event.payload,
  });
  const signature = hmacSha256Hex(body, endpoint.signingSecret);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
  try {
    const response = await fetchImpl(endpoint.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-counter-signature": signature,
        "x-counter-event-id": event.id,
      },
      body,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Merchant webhook endpoint returned HTTP ${response.status}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Dispatches a single claimed outbox event. Throws on any failure that
 * should count as a delivery failure (the caller calls markFailed); returns
 * normally on success or on an event type/shape this dispatcher intends to
 * skip delivery for (the caller calls markDispatched either way).
 */
export async function dispatchOutboxEvent(
  event: OutboxEvent,
  deps: OutboxDispatcherDeps,
  logger: DispatcherLogger = NOOP_LOGGER,
): Promise<void> {
  if (!ORDER_LIFECYCLE_EVENT_TYPES.has(event.eventType)) {
    // Not a routing-dependent event (e.g. transaction.receipt.v1) — nothing
    // to deliver, just let the caller mark it dispatched.
    return;
  }

  const payload = isOrderLifecyclePayload(event.payload) ? event.payload : undefined;
  if (payload === undefined) {
    logger.error("outbox event payload is not an object — skipping delivery", {
      eventId: event.id,
      eventType: event.eventType,
    });
    return;
  }

  const fetchImpl = deps.fetchImpl ?? fetch;

  if (payload.merchantId !== undefined) {
    const endpoint = await deps.webhookEndpoints.findByMerchantId(payload.merchantId);
    if (endpoint !== undefined) {
      await deliverMerchantWebhook(event, endpoint, fetchImpl);
    }
  }

  if (payload.walletId !== undefined) {
    const idResult = createCounterId("buyer-notification", randomBytes(16));
    if (!idResult.ok) {
      throw new Error("Failed to derive a buyer-notification id");
    }
    await deps.buyerNotifications.write({
      id: idResult.value,
      walletId: payload.walletId,
      notificationType: event.eventType,
      transactionId: payload.transactionId,
      payload: event.payload,
    });
  }
}

export interface OutboxDispatcherConfig {
  readonly owner: string;
  readonly batchSize: number;
  readonly pollIntervalMs: number;
}

export interface DispatcherLoop {
  readonly done: Promise<void>;
  stop(): void;
}

function nowInstant(): Instant {
  const result = instantFromEpochMilliseconds(Date.now());
  if (!result.ok) {
    throw new Error("Failed to derive current instant for outbox dispatch");
  }
  return result.value;
}

/** One poll/claim/dispatch/complete cycle. Exported so tests can drive it without real timers. */
export async function runOutboxDispatchTick(
  outbox: AsyncOutboxRepository,
  deps: OutboxDispatcherDeps,
  config: OutboxDispatcherConfig,
  logger: DispatcherLogger = NOOP_LOGGER,
  clock: () => Instant = nowInstant,
): Promise<{ readonly claimed: number; readonly dispatched: number; readonly failed: number }> {
  const now = clock();
  const claimResult = await outbox.claim(config.batchSize, config.owner, now);
  if (!claimResult.ok) {
    logger.error("outbox claim failed", { error: claimResult.error.message });
    return { claimed: 0, dispatched: 0, failed: 0 };
  }

  const events = claimResult.value;
  let dispatched = 0;
  let failed = 0;

  for (const event of events) {
    try {
      await dispatchOutboxEvent(event, deps, logger);
      const markResult = await outbox.markDispatched([event.id], clock());
      if (!markResult.ok) {
        logger.error("markDispatched failed", {
          eventId: event.id,
          error: markResult.error.message,
        });
        failed += 1;
        continue;
      }
      dispatched += 1;
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      logger.error("outbox dispatch failed", {
        eventId: event.id,
        eventType: event.eventType,
        attempts: event.attempts,
        error: message,
      });
      if (event.attempts + 1 >= MAX_ATTEMPTS) {
        const deadLetterResult = await outbox.markDeadLetter(event.id, config.owner);
        if (!deadLetterResult.ok) {
          logger.error("markDeadLetter failed", {
            eventId: event.id,
            error: deadLetterResult.error.message,
          });
        }
        continue;
      }
      const failResult = await outbox.markFailed(event.id, "dispatch.error", clock());
      if (!failResult.ok) {
        logger.error("markFailed failed", { eventId: event.id, error: failResult.error.message });
      }
    }
  }

  return { claimed: events.length, dispatched, failed };
}

/** Runs runOutboxDispatchTick repeatedly until stop() is called. Mirrors worker-loop.ts's createWorkerLoop. */
export function createOutboxDispatcherLoop(
  outbox: AsyncOutboxRepository,
  deps: OutboxDispatcherDeps,
  config: OutboxDispatcherConfig,
  logger: DispatcherLogger = NOOP_LOGGER,
  clock: () => Instant = nowInstant,
): DispatcherLoop {
  let running = true;
  let wake: (() => void) | undefined;

  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const timer = setTimeout(() => {
        wake = undefined;
        resolve();
      }, ms);
      wake = () => {
        clearTimeout(timer);
        wake = undefined;
        resolve();
      };
    });

  const done = (async () => {
    logger.info("outbox dispatcher loop started", { owner: config.owner });
    while (running) {
      try {
        await runOutboxDispatchTick(outbox, deps, config, logger, clock);
      } catch (error) {
        logger.error("outbox dispatcher tick threw", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      if (running) {
        await sleep(config.pollIntervalMs);
      }
    }
    logger.info("outbox dispatcher loop stopped", { owner: config.owner });
  })();

  return {
    done,
    stop(): void {
      running = false;
      if (wake !== undefined) {
        wake();
      }
    },
  };
}
