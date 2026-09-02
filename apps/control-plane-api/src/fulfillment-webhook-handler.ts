/**
 * Real Shopify fulfillments/create + fulfillments/update webhook handler —
 * Phase 2 of the remote-MCP plan (notifications backbone). Wired as
 * WebhookRoutesOptions.onShopifyFulfillmentWebhook (webhook-routes.ts),
 * called only AFTER real HMAC verification + dedup already succeeded (see
 * that file's header) — this function's own job is purely: resolve which
 * Counter transaction/merchant/wallet a Shopify order id belongs to, then
 * append a merchant.order.fulfilled.v1 event to the SAME durable outbox
 * apps/worker/src/main.ts's receipt sink writes to, so the SAME dispatcher
 * (apps/worker/src/outbox-dispatcher.ts) fans it out identically.
 *
 * RESOLUTION PATH (Shopify order id -> Counter transaction/merchant/wallet):
 * this codebase has no dedicated reverse index for it, so this handler
 * joins two existing durable tables that already carry the data:
 *   1. runtime.lifecycle_steps, step='shopify.finalize' — its `reference`
 *      column holds the real Shopify order GID (see
 *      apps/worker/src/real-lifecycle.ts's STEP_FINALIZE), giving us the
 *      transaction's idempotency_key (== Counter's stable per-transaction
 *      reference).
 *   2. runtime.workflow_intents, keyed on that same transaction_id — its
 *      authority_context JSONB carries authorizedMerchantId/walletId
 *      (written by apps/worker/src/transaction-persistence.ts's
 *      PostgresTransactionProjectionStore.start(), which is ALWAYS called
 *      before the real Shopify effects run — see that file — so this row
 *      exists by the time a fulfillment can possibly have happened).
 *
 * Shopify's webhook payload carries a plain NUMERIC order_id, not the
 * `gid://shopify/Order/...` format the finalize step stored — this handler
 * constructs the matching GID before querying.
 *
 * A webhook for an order Counter has no record of (a manual/non-agent order
 * in the same store, or a real timing race) is NOT an error — it's simply
 * skipped, logged, and the webhook still returns 200 (already-verified
 * webhooks must never be retried by Shopify for a reason unrelated to
 * verification).
 */
import type { Environment } from "@counter/domain";
import { createCounterId, instantFromEpochMilliseconds } from "@counter/domain";
import type { TransactionalDatabase } from "@counter/data";
import { PostgresOutboxRepository } from "@counter/data";
import type { WebhookEvent } from "@counter/shopify-connector";
import type { ShopifyFulfillmentWebhookPayload } from "@counter/shopify-connector";

const STEP_FINALIZE = "shopify.finalize";

export interface FulfillmentWebhookLogger {
  info(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

const NOOP_LOGGER: FulfillmentWebhookLogger = { info: () => undefined, error: () => undefined };

function isFulfillmentPayload(value: unknown): value is ShopifyFulfillmentWebhookPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>)["order_id"] === "number"
  );
}

interface AuthorityContext {
  readonly authorizedMerchantId?: string;
  readonly walletId?: string;
}

export function createFulfillmentWebhookHandler(
  database: TransactionalDatabase,
  environment: Environment,
  logger: FulfillmentWebhookLogger = NOOP_LOGGER,
): (event: WebhookEvent) => Promise<void> {
  const outbox = new PostgresOutboxRepository(database, environment);

  return async (event: WebhookEvent): Promise<void> => {
    if (!isFulfillmentPayload(event.payload)) {
      logger.error("fulfillment webhook payload missing order_id — skipping", {
        webhookId: event.webhookId,
      });
      return;
    }
    const payload = event.payload;
    const orderGid = `gid://shopify/Order/${payload.order_id}`;

    const stepResult = await database.query<{ idempotency_key: string }>(
      `SELECT idempotency_key FROM runtime.lifecycle_steps
        WHERE environment = $1 AND step = $2 AND reference = $3 AND status = 'completed'
        LIMIT 1`,
      [environment, STEP_FINALIZE, orderGid],
    );
    const transactionId = stepResult.rows[0]?.idempotency_key;
    if (transactionId === undefined) {
      logger.info("fulfillment webhook for an order with no known Counter transaction — skipping", {
        orderGid,
        webhookId: event.webhookId,
      });
      return;
    }

    const intentResult = await database.query<{ authority_context: AuthorityContext }>(
      `SELECT authority_context FROM runtime.workflow_intents
        WHERE environment = $1 AND transaction_id = $2
        ORDER BY created_at DESC
        LIMIT 1`,
      [environment, transactionId],
    );
    const authorityContext = intentResult.rows[0]?.authority_context;
    const merchantId = authorityContext?.authorizedMerchantId;
    if (merchantId === undefined) {
      logger.error("resolved a transaction with no authorizedMerchantId — skipping", {
        transactionId,
        webhookId: event.webhookId,
      });
      return;
    }

    const idResult = createCounterId("outbox-event", crypto.getRandomValues(new Uint8Array(16)));
    if (!idResult.ok) {
      logger.error("failed to derive an outbox-event id", { transactionId });
      return;
    }
    const nowResult = instantFromEpochMilliseconds(Date.now());
    if (!nowResult.ok) {
      logger.error("failed to derive current instant", { transactionId });
      return;
    }

    const appendResult = await outbox.append(
      [
        {
          id: idResult.value,
          eventType: "merchant.order.fulfilled.v1",
          eventVersion: 1,
          payload: {
            transactionId,
            merchantId,
            walletId: authorityContext?.walletId,
            fulfillmentStatus: payload.status,
            trackingCompany: payload.tracking_company,
            trackingNumber: payload.tracking_number,
            trackingUrl: payload.tracking_url,
          },
          correlationId: undefined,
          idempotencyKey: `${transactionId}:fulfillment:${payload.id}:${payload.status}`,
        },
      ],
      nowResult.value,
    );
    if (!appendResult.ok) {
      logger.error("failed to append merchant.order.fulfilled.v1 to outbox", {
        transactionId,
        error: appendResult.error.message,
      });
    }
  };
}
