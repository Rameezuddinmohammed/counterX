import { describe, expect, it } from "vitest";
import { MerchantReadinessService, MerchantReadinessError } from "./merchant-readiness-store.js";
import { createInMemoryPolicyStore, createDefaultPolicyCompiler } from "./policy-routes.js";

const TEST_MERCHANT_ID = "ctr_merchant_AAAAAAAAAAAAAAAAAAAAAA";
const TEST_ACTOR_ID = "ctr_merchant-user_AAAAAAAAAAAAAAAAAAAAAA";

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
  merchant_user_actor_id: string;
  goods_types: readonly string[] | null;
  catalog_confirmed_at: string | null;
}

/** A minimal in-memory fake covering exactly the queries MerchantReadinessService issues. */
class FakeDatabase {
  app: FakeAppRow | undefined;
  shopifyConnectedAt: string | undefined;
  manualItemCount = 0;
  paymentVerifiedAt: string | undefined;
  updates: Array<{ state: string; version: number }> = [];

  async query(text: string, _values?: readonly unknown[]) {
    if (
      text.includes("FROM merchant.onboarding_applications") &&
      text.includes("SELECT lifecycle_state")
    ) {
      return { rows: this.app === undefined ? [] : [this.app] };
    }
    if (text.includes("FROM merchant.shopify_connections")) {
      return {
        rows:
          this.shopifyConnectedAt === undefined ? [] : [{ connected_at: this.shopifyConnectedAt }],
      };
    }
    if (text.includes("FROM merchant.manual_catalog_items") && text.includes("count(*)")) {
      return { rows: [{ count: String(this.manualItemCount) }] };
    }
    if (text.includes("FROM merchant.payment_connections")) {
      return {
        rows: this.paymentVerifiedAt === undefined ? [] : [{ verified_at: this.paymentVerifiedAt }],
      };
    }
    if (text.includes("UPDATE merchant.onboarding_applications")) {
      const state = _values?.[2] as string;
      const version = _values?.[3] as number;
      this.updates.push({ state, version });
      if (this.app !== undefined) {
        this.app = { ...this.app, lifecycle_state: state, lifecycle_version: version };
      }
      return { rows: [] };
    }
    throw new Error(`Unexpected query in FakeDatabase: ${text}`);
  }

  transaction(): never {
    throw new Error("transaction() should not be called by this service");
  }
}

describe("MerchantReadinessService", () => {
  it("rejects an invalid merchantId before touching the database", async () => {
    const service = new MerchantReadinessService(
      unreachableDatabase() as never,
      "test",
      createInMemoryPolicyStore(),
      createDefaultPolicyCompiler(),
    );
    await expect(service.evaluate("not-a-counter-id")).rejects.toThrow(/Invalid merchantId/);
  });

  it("throws MerchantReadinessError for a nonexistent merchant", async () => {
    const database = new FakeDatabase();
    const service = new MerchantReadinessService(
      database as never,
      "test",
      createInMemoryPolicyStore(),
      createDefaultPolicyCompiler(),
    );
    await expect(service.evaluate(TEST_MERCHANT_ID)).rejects.toThrow(MerchantReadinessError);
  });

  it("is Blocking when nothing is configured beyond the application itself", async () => {
    const database = new FakeDatabase();
    database.app = {
      lifecycle_state: "VERIFYING",
      lifecycle_version: 3,
      merchant_user_actor_id: TEST_ACTOR_ID,
      goods_types: ["fulfillment.physical.ship"],
      catalog_confirmed_at: null,
    };
    const service = new MerchantReadinessService(
      database as never,
      "test",
      createInMemoryPolicyStore(),
      createDefaultPolicyCompiler(),
    );
    const result = await service.evaluate(TEST_MERCHANT_ID);
    expect(result.isReady).toBe(false);
    expect(result.overallStatus).toBe("Blocking");
    expect(result.lifecycleState).toBe("VERIFYING");
    // No auto-transition happened.
    expect(database.updates).toHaveLength(0);
  });

  it("is ready and auto-transitions VERIFYING -> SANDBOX_READY once everything is configured", async () => {
    const database = new FakeDatabase();
    database.app = {
      lifecycle_state: "VERIFYING",
      lifecycle_version: 3,
      merchant_user_actor_id: TEST_ACTOR_ID,
      goods_types: ["fulfillment.physical.ship"],
      catalog_confirmed_at: new Date().toISOString(),
    };
    database.manualItemCount = 1;
    database.paymentVerifiedAt = new Date().toISOString();
    const service = new MerchantReadinessService(
      database as never,
      "test",
      createInMemoryPolicyStore(),
      createDefaultPolicyCompiler(),
    );
    const result = await service.evaluate(TEST_MERCHANT_ID);
    expect(result.isReady).toBe(true);
    expect(result.lifecycleState).toBe("SANDBOX_READY");
    expect(database.updates).toEqual([{ state: "SANDBOX_READY", version: 4 }]);
    expect(result.versionBindings.paymentProviderVersion).toBe("razorpay-byo@1");
    expect(result.versionBindings.protocolVersion).toBe("0.1");
  });

  it("synthesizes and persists a default policy when none exists yet", async () => {
    const database = new FakeDatabase();
    database.app = {
      lifecycle_state: "VERIFYING",
      lifecycle_version: 1,
      merchant_user_actor_id: TEST_ACTOR_ID,
      goods_types: ["fulfillment.digital.deliver"],
      catalog_confirmed_at: new Date().toISOString(),
    };
    database.manualItemCount = 1;
    database.paymentVerifiedAt = new Date().toISOString();
    const policyStore = createInMemoryPolicyStore();
    const service = new MerchantReadinessService(
      database as never,
      "test",
      policyStore,
      createDefaultPolicyCompiler(),
    );
    await service.evaluate(TEST_MERCHANT_ID);

    const persisted = await policyStore.get(TEST_MERCHANT_ID);
    expect(persisted).toBeDefined();
    expect(persisted?.config.policyVersion).toBe("1.0.0-default");
    expect(persisted?.config.rules).toHaveLength(1);
  });

  it("does not re-transition once already SANDBOX_READY (idempotent)", async () => {
    const database = new FakeDatabase();
    database.app = {
      lifecycle_state: "SANDBOX_READY",
      lifecycle_version: 4,
      merchant_user_actor_id: TEST_ACTOR_ID,
      goods_types: ["fulfillment.physical.ship"],
      catalog_confirmed_at: new Date().toISOString(),
    };
    database.manualItemCount = 1;
    database.paymentVerifiedAt = new Date().toISOString();
    const service = new MerchantReadinessService(
      database as never,
      "test",
      createInMemoryPolicyStore(),
      createDefaultPolicyCompiler(),
    );
    const result = await service.evaluate(TEST_MERCHANT_ID);
    expect(result.lifecycleState).toBe("SANDBOX_READY");
    expect(database.updates).toHaveLength(0);
  });
});
