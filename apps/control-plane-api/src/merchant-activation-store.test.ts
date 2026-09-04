import { describe, expect, it } from "vitest";
import { MerchantActivationStore, MerchantActivationError } from "./merchant-activation-store.js";

const TEST_MERCHANT_ID = "ctr_merchant_AAAAAAAAAAAAAAAAAAAAAA";
const TEST_OPERATOR_ID = "ctr_operator_AAAAAAAAAAAAAAAAAAAAAA";

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

interface FakeAppRow {
  lifecycle_state: string;
  lifecycle_version: number;
}

class FakeDatabase {
  app: FakeAppRow | undefined;
  updateCalls = 0;

  async query(text: string, values?: readonly unknown[]) {
    if (text.includes("SELECT lifecycle_state, lifecycle_version")) {
      return { rows: this.app === undefined ? [] : [this.app] };
    }
    if (text.includes("UPDATE merchant.onboarding_applications")) {
      this.updateCalls += 1;
      if (this.app !== undefined) {
        this.app = {
          lifecycle_state: values?.[2] as string,
          lifecycle_version: values?.[3] as number,
        };
      }
      return { rows: this.app === undefined ? [] : [this.app] };
    }
    throw new Error(`Unexpected query in FakeDatabase: ${text}`);
  }

  async transaction<T>(operation: (session: FakeDatabase) => Promise<T>): Promise<T> {
    return operation(this);
  }
}

describe("MerchantActivationStore", () => {
  it("rejects an invalid merchantId before touching the database", async () => {
    const store = new MerchantActivationStore(unreachableDatabase() as never, "test");
    await expect(store.approve("not-a-counter-id", TEST_OPERATOR_ID, "looks good")).rejects.toThrow(
      MerchantActivationError,
    );
  });

  it("rejects an invalid operatorId before touching the database", async () => {
    const store = new MerchantActivationStore(unreachableDatabase() as never, "test");
    await expect(store.approve(TEST_MERCHANT_ID, "not-a-counter-id", "looks good")).rejects.toThrow(
      MerchantActivationError,
    );
  });

  it("rejects an empty reason before touching the database", async () => {
    const store = new MerchantActivationStore(unreachableDatabase() as never, "test");
    await expect(store.approve(TEST_MERCHANT_ID, TEST_OPERATOR_ID, "   ")).rejects.toThrow(
      /reason must not be empty/,
    );
  });

  it("throws for an unknown merchant application", async () => {
    const database = new FakeDatabase();
    const store = new MerchantActivationStore(database as never, "test");
    await expect(store.approve(TEST_MERCHANT_ID, TEST_OPERATOR_ID, "looks good")).rejects.toThrow(
      /No such merchant application/,
    );
  });

  it("refuses to approve a merchant that isn't in ACTIVATION_REVIEW", async () => {
    const database = new FakeDatabase();
    database.app = { lifecycle_state: "SANDBOX_READY", lifecycle_version: 5 };
    const store = new MerchantActivationStore(database as never, "test");
    await expect(store.approve(TEST_MERCHANT_ID, TEST_OPERATOR_ID, "looks good")).rejects.toThrow(
      /not in ACTIVATION_REVIEW/,
    );
    expect(database.updateCalls).toBe(0);
  });

  it("approves a merchant in ACTIVATION_REVIEW, transitioning to ACTIVE through the real state machine", async () => {
    const database = new FakeDatabase();
    database.app = { lifecycle_state: "ACTIVATION_REVIEW", lifecycle_version: 6 };
    const store = new MerchantActivationStore(database as never, "test");

    const result = await store.approve(TEST_MERCHANT_ID, TEST_OPERATOR_ID, "docs verified");

    expect(result.lifecycleState).toBe("ACTIVE");
    expect(result.lifecycleVersion).toBe(7);
    expect(database.updateCalls).toBe(1);
    expect(database.app?.lifecycle_state).toBe("ACTIVE");
  });

  it("is idempotent: approving an already-ACTIVE merchant is a no-op, not an error", async () => {
    const database = new FakeDatabase();
    database.app = { lifecycle_state: "ACTIVE", lifecycle_version: 7 };
    const store = new MerchantActivationStore(database as never, "test");

    const result = await store.approve(TEST_MERCHANT_ID, TEST_OPERATOR_ID, "docs verified");

    expect(result.lifecycleState).toBe("ACTIVE");
    expect(result.lifecycleVersion).toBe(7);
    expect(database.updateCalls).toBe(0);
  });
});
