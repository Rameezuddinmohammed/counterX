import { describe, expect, it } from "vitest";
import {
  MerchantWebhookEndpointStore,
  WebhookEndpointValidationError,
} from "./merchant-webhook-endpoint-store.js";

const TEST_MERCHANT_ID = "ctr_merchant_AAAAAAAAAAAAAAAAAAAAAA";

function unreachableDatabase() {
  return {
    query: () => {
      throw new Error("query() should not be called — validation must short-circuit first");
    },
    transaction: () => {
      throw new Error("transaction() should not be called");
    },
  };
}

/** A minimal in-memory fake covering exactly the queries this store issues. */
class FakeDatabase {
  merchantExists = true;
  rows: Array<{ url: string }> = [];
  upsertCalls = 0;
  lastUpsertValues: readonly unknown[] | undefined;

  async query(text: string, values?: readonly unknown[]) {
    if (text.includes("SELECT 1 FROM merchant.scopes")) {
      return { rows: this.merchantExists ? [{ "?column?": 1 }] : [] };
    }
    if (text.includes("INSERT INTO merchant.webhook_endpoints")) {
      this.upsertCalls += 1;
      this.lastUpsertValues = values;
      const url = values?.[2] as string;
      this.rows = [{ url }];
      return { rows: [] };
    }
    if (text.includes("SELECT url FROM merchant.webhook_endpoints")) {
      return { rows: this.rows };
    }
    throw new Error(`Unexpected query in FakeDatabase: ${text}`);
  }

  transaction(): never {
    throw new Error("transaction() should not be called by this store");
  }
}

describe("MerchantWebhookEndpointStore", () => {
  it("rejects a malformed URL before touching the database", async () => {
    const store = new MerchantWebhookEndpointStore(unreachableDatabase() as never, "test");
    await expect(store.register(TEST_MERCHANT_ID, "not-a-url")).rejects.toThrow(
      WebhookEndpointValidationError,
    );
  });

  it("rejects a non-https URL before touching the database", async () => {
    const store = new MerchantWebhookEndpointStore(unreachableDatabase() as never, "test");
    await expect(
      store.register(TEST_MERCHANT_ID, "http://merchant.example.com/webhook"),
    ).rejects.toThrow(/https/);
  });

  it("rejects a nonexistent merchant", async () => {
    const database = new FakeDatabase();
    database.merchantExists = false;
    const store = new MerchantWebhookEndpointStore(database as never, "test");
    await expect(
      store.register(TEST_MERCHANT_ID, "https://merchant.example.com/webhook"),
    ).rejects.toThrow(/No such merchant/);
    expect(database.upsertCalls).toBe(0);
  });

  it("registers a real endpoint, generates a real secret, and never repeats it on a later status read", async () => {
    const database = new FakeDatabase();
    const store = new MerchantWebhookEndpointStore(database as never, "test");
    const registration = await store.register(
      TEST_MERCHANT_ID,
      "https://merchant.example.com/webhook",
    );
    expect(registration.url).toBe("https://merchant.example.com/webhook");
    expect(registration.signingSecret).toMatch(/^whsec_/);
    expect(database.upsertCalls).toBe(1);

    const status = await store.getStatus(TEST_MERCHANT_ID);
    expect(status.connected).toBe(true);
    expect(status.url).toBe("https://merchant.example.com/webhook");
    expect(status).not.toHaveProperty("signingSecret");
  });

  it("generates a DIFFERENT secret on each registration (rotation)", async () => {
    const database = new FakeDatabase();
    const store = new MerchantWebhookEndpointStore(database as never, "test");
    const first = await store.register(TEST_MERCHANT_ID, "https://merchant.example.com/webhook");
    const second = await store.register(TEST_MERCHANT_ID, "https://merchant.example.com/webhook");
    expect(first.signingSecret).not.toBe(second.signingSecret);
  });

  it("reports disconnected for a merchant with no stored endpoint", async () => {
    const database = new FakeDatabase();
    const store = new MerchantWebhookEndpointStore(database as never, "test");
    const status = await store.getStatus(TEST_MERCHANT_ID);
    expect(status.connected).toBe(false);
  });
});
