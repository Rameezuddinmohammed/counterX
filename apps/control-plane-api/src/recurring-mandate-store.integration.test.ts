/**
 * Integration proof for RecurringMandateProvisioner against the LIVE
 * Supabase Postgres (DATABASE_URL-gated). Mirrors wallet-user-store
 * .integration.test.ts's gating + seed/cleanup discipline: uses a
 * uniquely-keyed wallet (provisioned fresh via WalletUserProvisioner) so it
 * never collides with real data, and in afterAll DELETEs exactly what it
 * inserted, in FK-safe order. It NEVER drops/truncates/migrates.
 *
 * The Razorpay side is faked (RazorpayRecurringMandateProviderLike) so this
 * proves the SQL/schema is correct without needing live Razorpay
 * credentials — that's covered separately by
 * recurring-mandate-provider.test.ts's mocked-HTTP tests.
 *
 * SKIPPED unless DATABASE_URL is present.
 */
import { afterAll, beforeAll, expect } from "vitest";
import { describe as vitestDescribe, it as vitestIt } from "vitest";
import { PostgresDatabase } from "@counter/data";
import { WalletUserProvisioner } from "./wallet-user-store.js";
import {
  RecurringMandateProvisioner,
  type RazorpayRecurringMandateProviderLike,
} from "./recurring-mandate-store.js";

const databaseUrl = process.env["DATABASE_URL"];
const gatedDescribe = databaseUrl ? vitestDescribe : vitestDescribe.skip;

const TEST_ENV = "sandbox";
const RUN_ID = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

class FakeRazorpayRecurringMandateProvider implements RazorpayRecurringMandateProviderLike {
  cancelledTokens: Array<{ customerId: string; tokenId: string }> = [];
  createCustomerCalls = 0;

  async createCustomer(): Promise<string> {
    this.createCustomerCalls += 1;
    return `cust_fake_${RUN_ID}`;
  }

  async createRegistrationOrder(): ReturnType<
    RazorpayRecurringMandateProviderLike["createRegistrationOrder"]
  > {
    return {
      kind: "action_required",
      action: {
        url: "https://api.razorpay.com/checkout",
        method: "POST",
        metadata: {
          razorpay_order_id: `order_fake_${RUN_ID}`,
          razorpay_key_id: "rzp_test_fakekey",
        },
      },
      expiresAt: { epochMilliseconds: Date.now() + 600_000 } as never,
    };
  }

  async verifyRegistrationCallback(): ReturnType<
    RazorpayRecurringMandateProviderLike["verifyRegistrationCallback"]
  > {
    return {
      verified: true,
      providerTokenId: `token_fake_${RUN_ID}`,
      providerPaymentId: `pay_fake_${RUN_ID}`,
    };
  }

  async cancelToken(customerId: string, tokenId: string): Promise<void> {
    this.cancelledTokens.push({ customerId, tokenId });
  }
}

gatedDescribe("RecurringMandateProvisioner (real Supabase)", () => {
  let database: PostgresDatabase;
  let walletUserProvisioner: WalletUserProvisioner;
  let razorpay: FakeRazorpayRecurringMandateProvider;
  let provisioner: RecurringMandateProvisioner;
  let walletId: string;
  let principalId: string;
  const insertedWalletIds: string[] = [];

  beforeAll(async () => {
    database = new PostgresDatabase(databaseUrl as string);
    walletUserProvisioner = new WalletUserProvisioner(database, TEST_ENV);
    razorpay = new FakeRazorpayRecurringMandateProvider();
    provisioner = new RecurringMandateProvisioner(database, TEST_ENV, razorpay);

    const wallet = await walletUserProvisioner.provisionForAuth0Subject(
      `recurring-mandate-store-test|${RUN_ID}`,
    );
    walletId = wallet.walletId;
    principalId = wallet.walletUserActorId;
    insertedWalletIds.push(walletId);
  });

  afterAll(async () => {
    for (const id of insertedWalletIds) {
      await database.query(
        `DELETE FROM wallet.recurring_payment_mandates WHERE environment = $1 AND wallet_id = $2`,
        [TEST_ENV, id],
      );
      await database.query(
        `DELETE FROM identity.wallet_users WHERE environment = $1 AND wallet_id = $2`,
        [TEST_ENV, id],
      );
      await database.query(
        `DELETE FROM identity.actors WHERE environment = $1 AND owner_scope_id = $2`,
        [TEST_ENV, id],
      );
      await database.query(`DELETE FROM wallet.scopes WHERE environment = $1 AND wallet_id = $2`, [
        TEST_ENV,
        id,
      ]);
      await database.query(
        `DELETE FROM identity.scope_registry WHERE environment = $1 AND scope_id = $2`,
        [TEST_ENV, id],
      );
    }
    await database.close();
  });

  vitestIt("begins registration, inserting a pending row", async () => {
    const result = await provisioner.beginRegistration({
      walletId,
      principalId,
      contactName: "Integration Test",
      contactEmail: "integration@example.com",
      contactPhone: "+911234567890",
      ceilingMinor: 500_000n,
      validUntil: "2027-01-01T00:00:00Z",
      eligibleMerchants: ["ctr_merchant_test"],
      eligibleOperations: ["purchase"],
    });

    expect(result.referenceId).toMatch(/^ctr_payment-reference_/);
    expect(result.checkout.razorpayOrderId).toBe(`order_fake_${RUN_ID}`);
    expect(razorpay.createCustomerCalls).toBe(1);

    const list = await provisioner.list(walletId);
    expect(list).toHaveLength(1);
    expect(list[0]?.status).toBe("pending");
  });

  vitestIt(
    "reuses the wallet's existing Razorpay customer id on a second registration, never calling createCustomer again",
    async () => {
      const callsBefore = razorpay.createCustomerCalls;
      const result = await provisioner.beginRegistration({
        walletId,
        principalId,
        contactName: "Integration Test",
        contactEmail: "integration@example.com",
        contactPhone: "+911234567890",
        ceilingMinor: 300_000n,
        validUntil: "2027-01-01T00:00:00Z",
        eligibleMerchants: [],
        eligibleOperations: [],
      });

      expect(result.checkout.razorpayCustomerId).toBe(`cust_fake_${RUN_ID}`);
      expect(razorpay.createCustomerCalls).toBe(callsBefore);
    },
  );

  vitestIt("confirms registration, activating the row with the verified token id", async () => {
    const begin = await provisioner.beginRegistration({
      walletId,
      principalId,
      contactName: "Integration Test",
      contactEmail: "integration@example.com",
      contactPhone: "+911234567890",
      ceilingMinor: 250_000n,
      validUntil: "2027-01-01T00:00:00Z",
      eligibleMerchants: [],
      eligibleOperations: [],
    });

    const confirmed = await provisioner.confirmRegistration({
      walletId,
      referenceId: begin.referenceId,
      razorpayOrderId: `order_fake_${RUN_ID}`,
      razorpayPaymentId: `pay_fake_${RUN_ID}`,
      razorpaySignature: "irrelevant-fake-verifies-unconditionally",
    });

    expect(confirmed.status).toBe("active");
    expect(confirmed.referenceId).toBe(begin.referenceId);
  });

  vitestIt("revokes an active mandate and cancels its Razorpay token", async () => {
    const begin = await provisioner.beginRegistration({
      walletId,
      principalId,
      contactName: "Integration Test",
      contactEmail: "integration@example.com",
      contactPhone: "+911234567890",
      ceilingMinor: 100_000n,
      validUntil: "2027-01-01T00:00:00Z",
      eligibleMerchants: [],
      eligibleOperations: [],
    });
    await provisioner.confirmRegistration({
      walletId,
      referenceId: begin.referenceId,
      razorpayOrderId: `order_fake_${RUN_ID}`,
      razorpayPaymentId: `pay_fake_${RUN_ID}`,
      razorpaySignature: "irrelevant-fake-verifies-unconditionally",
    });

    await provisioner.revoke(walletId, begin.referenceId);

    const list = await provisioner.list(walletId);
    const revoked = list.find((m) => m.referenceId === begin.referenceId);
    expect(revoked?.status).toBe("revoked");
    expect(razorpay.cancelledTokens).toContainEqual({
      customerId: `cust_fake_${RUN_ID}`,
      tokenId: `token_fake_${RUN_ID}`,
    });
  });

  vitestIt("refuses to begin registration for a nonexistent wallet", async () => {
    await expect(
      provisioner.beginRegistration({
        walletId: "ctr_wallet_doesnotexist00000000",
        principalId,
        contactName: "Integration Test",
        contactEmail: "integration@example.com",
        contactPhone: "+911234567890",
        ceilingMinor: 100_000n,
        validUntil: "2027-01-01T00:00:00Z",
        eligibleMerchants: [],
        eligibleOperations: [],
      }),
    ).rejects.toThrow(/No such wallet/);
  });
});
