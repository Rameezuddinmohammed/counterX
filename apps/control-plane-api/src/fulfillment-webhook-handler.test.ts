import { describe, expect, it } from "vitest";
import { createFulfillmentWebhookHandler } from "./fulfillment-webhook-handler.js";
import type { WebhookEvent } from "@counter/shopify-connector";

const ORDER_NUMERIC_ID = 6130680070195;
const ORDER_GID = `gid://shopify/Order/${ORDER_NUMERIC_ID}`;
const TRANSACTION_ID = "ctr_transaction_test0000000000001";
const MERCHANT_ID = "ctr_merchant_AAAAAAAAAAAAAAAAAAAAAA";
const WALLET_ID = "ctr_wallet_AAAAAAAAAAAAAAAAAAAAAA";

function fulfillmentEvent(overrides: Partial<Record<string, unknown>> = {}): WebhookEvent {
  return {
    topic: "fulfillments/create",
    shopDomain: "test-store.myshopify.com",
    webhookId: "wh-1",
    receivedAt: 1_000 as never,
    payload: {
      id: 999,
      order_id: ORDER_NUMERIC_ID,
      status: "success",
      tracking_company: "Delhivery",
      tracking_number: "TRACK123",
      tracking_url: "https://track.example.com/TRACK123",
      updated_at: "2026-09-02T00:00:00.000Z",
      ...overrides,
    },
  };
}

/** A minimal in-memory fake covering exactly the queries this handler issues. */
class FakeDatabase {
  hasStep = true;
  authorityContext: Record<string, unknown> | null = {
    authorizedMerchantId: MERCHANT_ID,
    walletId: WALLET_ID,
  };
  appendedRows: Array<{ text: string; values: readonly unknown[] }> = [];

  async query(text: string, values?: readonly unknown[]) {
    if (text.includes("SELECT idempotency_key FROM runtime.lifecycle_steps")) {
      return { rows: this.hasStep ? [{ idempotency_key: TRANSACTION_ID }] : [] };
    }
    if (text.includes("SELECT authority_context FROM runtime.workflow_intents")) {
      return {
        rows: this.authorityContext === null ? [] : [{ authority_context: this.authorityContext }],
      };
    }
    if (text.includes("INSERT INTO runtime.outbox_events")) {
      this.appendedRows.push({ text, values: values ?? [] });
      return {
        rows: [
          {
            id: values?.[0],
            environment: values?.[1],
            scope_kind: "platform",
            scope_id: "platform",
            event_type: values?.[2],
            event_version: values?.[3],
            payload: values?.[4],
            correlation_id: values?.[5] ?? null,
            idempotency_key: values?.[6] ?? null,
            status: "pending",
            attempts: 0,
            next_attempt_at: values?.[7],
            created_at: values?.[7],
            dispatched_at: null,
            error_class: null,
            owner: null,
          },
        ],
      };
    }
    throw new Error(`Unexpected query in FakeDatabase: ${text}`);
  }

  transaction(): never {
    throw new Error("transaction() should not be called by this handler");
  }
}

describe("createFulfillmentWebhookHandler", () => {
  it("resolves the Counter transaction from the Shopify order id and appends merchant.order.fulfilled.v1", async () => {
    const database = new FakeDatabase();
    const handler = createFulfillmentWebhookHandler(database as never, "test");

    await handler(fulfillmentEvent());

    expect(database.appendedRows).toHaveLength(1);
    const values = database.appendedRows[0]!.values;
    expect(values[2]).toBe("merchant.order.fulfilled.v1");
    const payload = JSON.parse(values[4] as string) as Record<string, unknown>;
    expect(payload["transactionId"]).toBe(TRANSACTION_ID);
    expect(payload["merchantId"]).toBe(MERCHANT_ID);
    expect(payload["walletId"]).toBe(WALLET_ID);
    expect(payload["fulfillmentStatus"]).toBe("success");
    expect(payload["trackingNumber"]).toBe("TRACK123");
  });

  it("constructs the GID from the webhook's plain numeric order_id before matching", async () => {
    const database = new FakeDatabase();
    let queriedReference: unknown;
    const originalQuery = database.query.bind(database);
    database.query = async (text: string, values?: readonly unknown[]) => {
      if (text.includes("SELECT idempotency_key FROM runtime.lifecycle_steps")) {
        queriedReference = values?.[2];
      }
      return originalQuery(text, values);
    };
    const handler = createFulfillmentWebhookHandler(database as never, "test");

    await handler(fulfillmentEvent());

    expect(queriedReference).toBe(ORDER_GID);
  });

  it("skips (no throw, no append) an order Counter has no record of", async () => {
    const database = new FakeDatabase();
    database.hasStep = false;
    const handler = createFulfillmentWebhookHandler(database as never, "test");

    await handler(fulfillmentEvent());

    expect(database.appendedRows).toHaveLength(0);
  });

  it("skips when the resolved transaction has no authorizedMerchantId", async () => {
    const database = new FakeDatabase();
    database.authorityContext = { walletId: WALLET_ID };
    const handler = createFulfillmentWebhookHandler(database as never, "test");

    await handler(fulfillmentEvent());

    expect(database.appendedRows).toHaveLength(0);
  });

  it("skips a malformed payload without an order_id", async () => {
    const database = new FakeDatabase();
    const handler = createFulfillmentWebhookHandler(database as never, "test");

    await handler({
      topic: "fulfillments/create",
      shopDomain: "test-store.myshopify.com",
      webhookId: "wh-2",
      receivedAt: 1_000 as never,
      payload: { not: "a fulfillment" },
    });

    expect(database.appendedRows).toHaveLength(0);
  });
});
