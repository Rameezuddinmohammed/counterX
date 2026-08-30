/**
 * Integration proof for MerchantApplicationProvisioner against the LIVE
 * Supabase Postgres (DATABASE_URL-gated). Mirrors
 * wallet-user-store.integration.test.ts's gating + seed/cleanup discipline:
 * uses uniquely-keyed rows (a per-run suffix) so it never collides with real
 * data, and in afterAll DELETEs exactly what it inserted, in FK-safe order.
 * It NEVER drops/truncates/migrates.
 *
 * SKIPPED unless DATABASE_URL is present.
 */
import { afterAll, beforeAll, expect } from "vitest";
import { describe as vitestDescribe, it as vitestIt } from "vitest";
import { PostgresDatabase } from "@counter/data";
import { MerchantApplicationProvisioner } from "./merchant-application-store.js";

const databaseUrl = process.env["DATABASE_URL"];
const gatedDescribe = databaseUrl ? vitestDescribe : vitestDescribe.skip;

const TEST_ENV = "sandbox";
const RUN_ID = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const SUBJECT_A = `merchant-application-store-test|${RUN_ID}-a`;
const SUBJECT_B = `merchant-application-store-test|${RUN_ID}-b`;

gatedDescribe("MerchantApplicationProvisioner (real Supabase)", () => {
  let database: PostgresDatabase;
  let provisioner: MerchantApplicationProvisioner;
  const insertedMerchantIds: string[] = [];

  beforeAll(() => {
    database = new PostgresDatabase(databaseUrl as string);
    provisioner = new MerchantApplicationProvisioner(database, TEST_ENV);
  });

  afterAll(async () => {
    // FK-safe deletion order: onboarding_applications/manual_catalog_items
    // reference merchant.scopes and identity.actors, so both go first;
    // actors reference scope_registry (via the require_registered_owner_scope
    // trigger, not a literal FK, but scope_registry must still outlive
    // merchant.scopes per its own FK); scope_registry last.
    for (const merchantId of insertedMerchantIds) {
      await database.query(
        `DELETE FROM merchant.manual_catalog_items WHERE environment = $1 AND merchant_id = $2`,
        [TEST_ENV, merchantId],
      );
      await database.query(
        `DELETE FROM merchant.onboarding_applications WHERE environment = $1 AND merchant_id = $2`,
        [TEST_ENV, merchantId],
      );
      await database.query(
        `DELETE FROM identity.actors WHERE environment = $1 AND owner_scope_id = $2`,
        [TEST_ENV, merchantId],
      );
      await database.query(
        `DELETE FROM merchant.scopes WHERE environment = $1 AND merchant_id = $2`,
        [TEST_ENV, merchantId],
      );
      await database.query(
        `DELETE FROM identity.scope_registry WHERE environment = $1 AND scope_id = $2`,
        [TEST_ENV, merchantId],
      );
    }
    await database.close();
  });

  vitestIt(
    "provisions a real merchant application for a new subject, and is idempotent on repeat click/login",
    async () => {
      const first = await provisioner.provisionForAuth0Subject(SUBJECT_A);
      insertedMerchantIds.push(first.merchantId);
      expect(first.created).toBe(true);
      expect(first.merchantId).toMatch(/^ctr_merchant_/);
      expect(first.lifecycleState).toBe("DRAFT");
      expect(first.approvalStatus).toBe("pending");

      const second = await provisioner.provisionForAuth0Subject(SUBJECT_A);
      expect(second.created).toBe(false);
      expect(second.merchantId).toBe(first.merchantId);

      const rows = await database.query(
        `SELECT merchant_id FROM merchant.onboarding_applications WHERE environment = $1 AND auth0_subject = $2`,
        [TEST_ENV, SUBJECT_A],
      );
      expect(rows.rows).toHaveLength(1);
    },
  );

  vitestIt("different subjects get different merchants", async () => {
    const a = await provisioner.provisionForAuth0Subject(SUBJECT_A);
    const b = await provisioner.provisionForAuth0Subject(SUBJECT_B);
    insertedMerchantIds.push(b.merchantId);
    expect(a.merchantId).not.toBe(b.merchantId);
  });

  vitestIt("updateBusinessBasics records fields and transitions DRAFT -> CONNECTING", async () => {
    const { merchantId } = await provisioner.provisionForAuth0Subject(
      `merchant-application-store-test|${RUN_ID}-c`,
    );
    insertedMerchantIds.push(merchantId);

    const updated = await provisioner.updateBusinessBasics(merchantId, {
      legalEntityName: "Test Merchant Pvt Ltd",
      contactEmail: "owner@test-merchant.example",
      goodsTypes: ["fulfillment.physical.ship", "fulfillment.digital.deliver"],
    });

    expect(updated.legalEntityName).toBe("Test Merchant Pvt Ltd");
    expect(updated.contactEmail).toBe("owner@test-merchant.example");
    expect(updated.goodsTypes).toEqual([
      "fulfillment.physical.ship",
      "fulfillment.digital.deliver",
    ]);
    expect(updated.lifecycleState).toBe("CONNECTING");
    expect(updated.lifecycleVersion).toBe(1);

    const fetched = await provisioner.getApplication(merchantId);
    expect(fetched?.lifecycleState).toBe("CONNECTING");
  });

  vitestIt("rejects an unknown goods type", async () => {
    const { merchantId } = await provisioner.provisionForAuth0Subject(
      `merchant-application-store-test|${RUN_ID}-d`,
    );
    insertedMerchantIds.push(merchantId);

    await expect(
      provisioner.updateBusinessBasics(merchantId, {
        legalEntityName: "Test Merchant",
        contactEmail: "owner@test.example",
        goodsTypes: ["fulfillment.teleport.instant"],
      }),
    ).rejects.toThrow(/Unknown goods type/);
  });

  vitestIt("refuses business basics for a nonexistent merchant", async () => {
    await expect(
      provisioner.updateBusinessBasics("ctr_merchant_doesnotexist0000000000", {
        legalEntityName: "Ghost Merchant",
        contactEmail: "ghost@test.example",
        goodsTypes: ["fulfillment.physical.ship"],
      }),
    ).rejects.toThrow(/No such merchant application/);
  });

  vitestIt(
    "getApplicationByAuth0Subject finds the application without a known merchantId",
    async () => {
      const subject = `merchant-application-store-test|${RUN_ID}-e`;
      const { merchantId } = await provisioner.provisionForAuth0Subject(subject);
      insertedMerchantIds.push(merchantId);

      const found = await provisioner.getApplicationByAuth0Subject(subject);
      expect(found?.merchantId).toBe(merchantId);
    },
  );

  vitestIt(
    "markCatalogConnected refuses with no catalog, then succeeds (CONNECTING -> MAPPING) once a manual item exists",
    async () => {
      const { merchantId } = await provisioner.provisionForAuth0Subject(
        `merchant-application-store-test|${RUN_ID}-f`,
      );
      insertedMerchantIds.push(merchantId);
      await provisioner.updateBusinessBasics(merchantId, {
        legalEntityName: "Test Merchant",
        contactEmail: "owner@test.example",
        goodsTypes: ["fulfillment.physical.ship"],
      });

      await expect(provisioner.markCatalogConnected(merchantId)).rejects.toThrow(
        /No catalog connection found/,
      );

      const item = await provisioner.addManualCatalogItem(merchantId, {
        name: "Hand-thrown mug",
        priceMinor: 45000,
        currency: "INR",
      });
      expect(item.name).toBe("Hand-thrown mug");
      expect(item.priceMinor).toBe(45000);

      const items = await provisioner.listManualCatalogItems(merchantId);
      expect(items).toHaveLength(1);

      const connected = await provisioner.markCatalogConnected(merchantId);
      expect(connected.lifecycleState).toBe("MAPPING");
      expect(connected.lifecycleVersion).toBe(2);

      // Idempotent: calling again once past CONNECTING is a no-op, not an error.
      const again = await provisioner.markCatalogConnected(merchantId);
      expect(again.lifecycleState).toBe("MAPPING");
      expect(again.lifecycleVersion).toBe(2);
    },
  );

  vitestIt("refuses a manual catalog item for a nonexistent merchant", async () => {
    await expect(
      provisioner.addManualCatalogItem("ctr_merchant_doesnotexist0000000000", {
        name: "Ghost item",
        priceMinor: 100,
        currency: "INR",
      }),
    ).rejects.toThrow(/No such merchant/);
  });
});
