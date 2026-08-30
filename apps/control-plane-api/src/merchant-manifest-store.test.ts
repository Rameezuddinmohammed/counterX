import { describe, expect, it } from "vitest";
import { sha256Digest } from "@counter/domain";
import { MerchantManifestStore, MerchantManifestError } from "./merchant-manifest-store.js";
import type {
  MerchantReadinessServiceLike,
  MerchantReadinessSummary,
} from "./merchant-readiness-store.js";

const TEST_MERCHANT_ID = "ctr_merchant_AAAAAAAAAAAAAAAAAAAAAA";
const TEST_DIGEST = sha256Digest(new TextEncoder().encode("test"));

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

class FakeReadinessService implements MerchantReadinessServiceLike {
  async evaluate(merchantId: string): Promise<MerchantReadinessSummary> {
    return {
      merchantId,
      isReady: true,
      overallStatus: "Advisory",
      checks: [],
      lifecycleState: "SANDBOX_READY",
      versionBindings: {
        connectorVersion: "manual-catalog@1",
        mappingSchemaHash: TEST_DIGEST,
        policyVersion: "1.0.0-default",
        protocolVersion: "0.1",
        paymentProviderVersion: "razorpay-byo@1",
      },
      evaluatedAt: new Date().toISOString(),
    };
  }
}

interface FakeAppRow {
  lifecycle_state: string;
  goods_types: readonly string[] | null;
}

class FakeDatabase {
  app: FakeAppRow | undefined;
  manifest: Record<string, unknown> | undefined;
  upsertCalls = 0;

  async query(text: string, values?: readonly unknown[]) {
    if (text.includes("SELECT lifecycle_state, goods_types")) {
      return { rows: this.app === undefined ? [] : [this.app] };
    }
    if (text.includes("INSERT INTO merchant.capability_manifests")) {
      this.upsertCalls += 1;
      this.manifest = {
        manifest_version: values?.[2],
        capabilities: values?.[3],
        fulfillment_capabilities: values?.[4],
        version_bindings: values?.[5],
        generated_at: values?.[6],
        signature_digest: values?.[7],
      };
      return { rows: [] };
    }
    if (text.includes("SELECT manifest_version, capabilities")) {
      return { rows: this.manifest === undefined ? [] : [this.manifest] };
    }
    throw new Error(`Unexpected query in FakeDatabase: ${text}`);
  }

  transaction(): never {
    throw new Error("transaction() should not be called by this store");
  }
}

describe("MerchantManifestStore", () => {
  it("rejects an invalid merchantId before touching the database", async () => {
    const store = new MerchantManifestStore(
      unreachableDatabase() as never,
      "test",
      new FakeReadinessService(),
    );
    await expect(store.generateAndPersist("not-a-counter-id")).rejects.toThrow(
      MerchantManifestError,
    );
  });

  it("refuses to generate a manifest before SANDBOX_READY", async () => {
    const database = new FakeDatabase();
    database.app = { lifecycle_state: "VERIFYING", goods_types: ["fulfillment.physical.ship"] };
    const store = new MerchantManifestStore(database as never, "test", new FakeReadinessService());
    await expect(store.generateAndPersist(TEST_MERCHANT_ID)).rejects.toThrow(/not SANDBOX_READY/);
    expect(database.upsertCalls).toBe(0);
  });

  it("generates and persists a manifest once SANDBOX_READY", async () => {
    const database = new FakeDatabase();
    database.app = { lifecycle_state: "SANDBOX_READY", goods_types: ["fulfillment.physical.ship"] };
    const store = new MerchantManifestStore(database as never, "test", new FakeReadinessService());

    const manifest = await store.generateAndPersist(TEST_MERCHANT_ID);
    expect(manifest.capabilities).toHaveLength(5);
    expect(manifest.fulfillmentCapabilities).toEqual(["fulfillment.physical.ship"]);
    expect(manifest.versionBindings.paymentProviderVersion).toBe("razorpay-byo@1");
    expect(database.upsertCalls).toBe(1);

    const fetched = await store.getManifest(TEST_MERCHANT_ID);
    expect(fetched?.manifestVersion).toBe("1.0.0");
  });

  it("returns undefined for a merchant with no manifest yet", async () => {
    const database = new FakeDatabase();
    const store = new MerchantManifestStore(database as never, "test", new FakeReadinessService());
    const fetched = await store.getManifest(TEST_MERCHANT_ID);
    expect(fetched).toBeUndefined();
  });
});
