import { describe, expect, it } from "vitest";
import {
  MerchantPaymentConnectionStore,
  PaymentConnectionError,
} from "./merchant-payment-connection-store.js";
import type { RazorpayHttpPort } from "@counter/razorpay-adapter";

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
  rows: Array<{ key_id: string; verified_at: string }> = [];
  insertCalls = 0;

  async query(text: string, values?: readonly unknown[]) {
    if (text.includes("SELECT 1 FROM merchant.scopes")) {
      return { rows: this.merchantExists ? [{ "?column?": 1 }] : [] };
    }
    if (text.includes("INSERT INTO merchant.payment_connections")) {
      this.insertCalls += 1;
      const keyId = values?.[2] as string;
      const verifiedAt = values?.[4] as string;
      this.rows = [{ key_id: keyId, verified_at: verifiedAt }];
      return { rows: [] };
    }
    if (text.includes("SELECT key_id, verified_at FROM merchant.payment_connections")) {
      return { rows: this.rows };
    }
    throw new Error(`Unexpected query in FakeDatabase: ${text}`);
  }

  transaction(): never {
    throw new Error("transaction() should not be called by this store");
  }
}

function mockHttpClient(status: number): RazorpayHttpPort {
  return {
    request: async <T>() => ({ status, body: {} as T }),
  };
}

describe("MerchantPaymentConnectionStore", () => {
  it("rejects an empty keyId before touching the database", async () => {
    const store = new MerchantPaymentConnectionStore(unreachableDatabase() as never, "test");
    await expect(
      store.connectRazorpay(TEST_MERCHANT_ID, { keyId: "", keySecret: "secret" }),
    ).rejects.toThrow(PaymentConnectionError);
  });

  it("rejects an empty keySecret before touching the database", async () => {
    const store = new MerchantPaymentConnectionStore(unreachableDatabase() as never, "test");
    await expect(
      store.connectRazorpay(TEST_MERCHANT_ID, { keyId: "rzp_test_x", keySecret: "" }),
    ).rejects.toThrow(PaymentConnectionError);
  });

  it("rejects a nonexistent merchant without calling Razorpay", async () => {
    const database = new FakeDatabase();
    database.merchantExists = false;
    let httpCalled = false;
    const store = new MerchantPaymentConnectionStore(database as never, "test", {}, () => {
      httpCalled = true;
      return mockHttpClient(200);
    });
    await expect(
      store.connectRazorpay(TEST_MERCHANT_ID, { keyId: "rzp_test_x", keySecret: "secret" }),
    ).rejects.toThrow(/No such merchant/);
    expect(httpCalled).toBe(false);
  });

  it("never persists credentials Razorpay rejects (401)", async () => {
    const database = new FakeDatabase();
    const store = new MerchantPaymentConnectionStore(database as never, "test", {}, () =>
      mockHttpClient(401),
    );
    await expect(
      store.connectRazorpay(TEST_MERCHANT_ID, { keyId: "rzp_test_bad", keySecret: "wrong" }),
    ).rejects.toThrow(PaymentConnectionError);
    expect(database.insertCalls).toBe(0);
  });

  it("persists credentials and reports connected once Razorpay accepts them (200)", async () => {
    const database = new FakeDatabase();
    const store = new MerchantPaymentConnectionStore(database as never, "test", {}, () =>
      mockHttpClient(200),
    );
    const result = await store.connectRazorpay(TEST_MERCHANT_ID, {
      keyId: "rzp_test_good",
      keySecret: "correct",
    });
    expect(result.connected).toBe(true);
    expect(result.keyId).toBe("rzp_test_good");
    expect(database.insertCalls).toBe(1);

    const status = await store.getConnectionStatus(TEST_MERCHANT_ID);
    expect(status.connected).toBe(true);
    expect(status.keyId).toBe("rzp_test_good");
  });

  it("reports disconnected for a merchant with no stored connection", async () => {
    const database = new FakeDatabase();
    const store = new MerchantPaymentConnectionStore(database as never, "test");
    const status = await store.getConnectionStatus(TEST_MERCHANT_ID);
    expect(status.connected).toBe(false);
  });
});
