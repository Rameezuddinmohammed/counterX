import { describe, expect, it } from "vitest";
import {
  MerchantApplicationProvisioner,
  MerchantApplicationValidationError,
} from "./merchant-application-store.js";

/**
 * Unit coverage for MerchantApplicationProvisioner.updateBusinessBasics's
 * pure input validation — asserted WITHOUT touching a database (a fake that
 * throws on any call proves validation short-circuits before any query),
 * mirroring wallet-user-store.test.ts's split from the DATABASE_URL-gated
 * integration test.
 */
function unreachableDatabase() {
  return {
    query: () => {
      throw new Error("query() should not be called — validation must short-circuit first");
    },
    transaction: () => {
      throw new Error("transaction() should not be called — validation must short-circuit first");
    },
  };
}

describe("MerchantApplicationProvisioner.updateBusinessBasics validation", () => {
  it("rejects an empty legalEntityName before touching the database", async () => {
    const provisioner = new MerchantApplicationProvisioner(unreachableDatabase() as never, "test");
    await expect(
      provisioner.updateBusinessBasics("ctr_merchant_AAAAAAAAAAAAAAAAAAAAAA", {
        legalEntityName: "   ",
        contactEmail: "owner@example.com",
        goodsTypes: ["fulfillment.physical.ship"],
      }),
    ).rejects.toThrow(MerchantApplicationValidationError);
  });

  it("rejects an empty contactEmail before touching the database", async () => {
    const provisioner = new MerchantApplicationProvisioner(unreachableDatabase() as never, "test");
    await expect(
      provisioner.updateBusinessBasics("ctr_merchant_AAAAAAAAAAAAAAAAAAAAAA", {
        legalEntityName: "Acme",
        contactEmail: "",
        goodsTypes: ["fulfillment.physical.ship"],
      }),
    ).rejects.toThrow(MerchantApplicationValidationError);
  });

  it("rejects an empty goodsTypes array before touching the database", async () => {
    const provisioner = new MerchantApplicationProvisioner(unreachableDatabase() as never, "test");
    await expect(
      provisioner.updateBusinessBasics("ctr_merchant_AAAAAAAAAAAAAAAAAAAAAA", {
        legalEntityName: "Acme",
        contactEmail: "owner@example.com",
        goodsTypes: [],
      }),
    ).rejects.toThrow(/goodsTypes must include at least one value/);
  });

  it("rejects an unrecognized goods type before touching the database", async () => {
    const provisioner = new MerchantApplicationProvisioner(unreachableDatabase() as never, "test");
    await expect(
      provisioner.updateBusinessBasics("ctr_merchant_AAAAAAAAAAAAAAAAAAAAAA", {
        legalEntityName: "Acme",
        contactEmail: "owner@example.com",
        goodsTypes: ["not.a.real.capability"],
      }),
    ).rejects.toThrow(/Unknown goods type/);
  });

  it("rejects a malformed merchantId before touching the database", async () => {
    const provisioner = new MerchantApplicationProvisioner(unreachableDatabase() as never, "test");
    await expect(
      provisioner.updateBusinessBasics("not-a-counter-id", {
        legalEntityName: "Acme",
        contactEmail: "owner@example.com",
        goodsTypes: ["fulfillment.physical.ship"],
      }),
    ).rejects.toThrow(/Invalid merchantId/);
  });
});
