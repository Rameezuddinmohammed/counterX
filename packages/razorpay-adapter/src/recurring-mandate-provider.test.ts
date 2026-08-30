/**
 * Tests for RazorpayRecurringMandateProvider.
 *
 * Covers:
 * - Customer creation, including reuse when Razorpay reports a duplicate
 * - Registration order creation (the checkout-widget action_required shape)
 * - Callback signature verification (valid and forged)
 * - Token status mapping
 * - Recurring charge outcome mapping (confirmed / declined / indeterminate)
 * - Timeout → indeterminate, matching the one-shot provider's convention
 * - Token cancellation
 */

import { describe, expect, it } from "vitest";

import { MockRazorpayHttp } from "./http-client.js";
import { RazorpayRecurringMandateProvider } from "./recurring-mandate-provider.js";
import { hmacSha256 } from "./signing.js";
import type { RazorpayTestAdapterConfig } from "./index.js";
import type { RazorpayRecurringPayment, RazorpayToken } from "./recurring-types.js";

// ─── Test Helpers ────────────────────────────────────────────────────────────

const TEST_CONFIG: RazorpayTestAdapterConfig = {
  keyId: "rzp_test_key123",
  keySecret: "rzp_test_secret456",
  webhookSecret: "whsec_test_secret789",
  environment: "test",
  baseUrl: "https://api.razorpay.com",
};

const BASE_TIME = 1700000000000;

function createProvider(
  http: MockRazorpayHttp,
  clockTime = BASE_TIME,
): RazorpayRecurringMandateProvider {
  return new RazorpayRecurringMandateProvider({
    config: TEST_CONFIG,
    httpClient: http,
    clock: () => clockTime,
  });
}

function makeRecurringPayment(
  overrides: Partial<RazorpayRecurringPayment> = {},
): RazorpayRecurringPayment {
  return {
    id: "pay_recurring001",
    entity: "payment",
    amount: 15000,
    currency: "INR",
    status: "captured",
    order_id: "order_reg001",
    customer_id: "cust_test001",
    token_id: "token_test001",
    error_code: null,
    error_description: null,
    created_at: 1700000000,
    ...overrides,
  };
}

function makeToken(overrides: Partial<RazorpayToken> = {}): RazorpayToken {
  return {
    id: "token_test001",
    entity: "token",
    method: "upi",
    max_amount: 500_000,
    expired_at: null,
    recurring: true,
    recurring_details: { status: "confirmed" },
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("RazorpayRecurringMandateProvider", () => {
  describe("createCustomer", () => {
    it("returns the new customer id on success", async () => {
      const http = new MockRazorpayHttp();
      http.onPath("/v1/customers", () => ({
        status: 200,
        body: {
          id: "cust_new001",
          entity: "customer",
          name: "A",
          contact: "+911234567890",
          email: "a@example.com",
          created_at: 1700000000,
        },
      }));
      const provider = createProvider(http);

      const customerId = await provider.createCustomer({
        name: "A",
        contact: "+911234567890",
        email: "a@example.com",
      });

      expect(customerId).toBe("cust_new001");
    });

    it("reuses the existing customer id when Razorpay reports a duplicate", async () => {
      const http = new MockRazorpayHttp();
      http.onPath("/v1/customers", () => ({
        status: 400,
        body: { error: { metadata: { customer_id: "cust_existing001" } } },
      }));
      const provider = createProvider(http);

      const customerId = await provider.createCustomer({
        name: "A",
        contact: "+911234567890",
        email: "a@example.com",
      });

      expect(customerId).toBe("cust_existing001");
    });

    it("throws when Razorpay fails with no reusable customer id", async () => {
      const http = new MockRazorpayHttp();
      http.onPath("/v1/customers", () => ({ status: 500, body: {} }));
      const provider = createProvider(http);

      await expect(
        provider.createCustomer({ name: "A", contact: "+911234567890", email: "a@example.com" }),
      ).rejects.toThrow();
    });
  });

  describe("createRegistrationOrder", () => {
    it("rejects a non-positive ceiling", async () => {
      const http = new MockRazorpayHttp();
      const provider = createProvider(http);

      await expect(
        provider.createRegistrationOrder({
          customerId: "cust_001",
          ceilingPaise: 0,
          validUntilEpochSeconds: 1800000000,
          idempotencyKey: "idem-001",
        }),
      ).rejects.toThrow();
    });

    it("returns action_required with public key_id only, never key_secret", async () => {
      const http = new MockRazorpayHttp();
      http.onPath("/v1/orders", () => ({ status: 200, body: { id: "order_reg001" } }));
      const provider = createProvider(http);

      const result = await provider.createRegistrationOrder({
        customerId: "cust_001",
        ceilingPaise: 500_000,
        validUntilEpochSeconds: 1800000000,
        idempotencyKey: "idem-001",
      });

      expect(result.kind).toBe("action_required");
      if (result.kind !== "action_required") throw new Error("expected action_required");
      const metadata = result.action.metadata;
      if (metadata === undefined) throw new Error("expected metadata");
      expect(metadata["razorpay_key_id"]).toBe("rzp_test_key123");
      expect(JSON.stringify(metadata)).not.toContain("rzp_test_secret456");
      expect(metadata["razorpay_order_id"]).toBe("order_reg001");
    });

    it("returns indeterminate on a transport timeout, never a thrown error", async () => {
      const http = new MockRazorpayHttp();
      http.onPath("/v1/orders", () => ({
        status: 503,
        body: { error: { reason: "timeout" } },
      }));
      const provider = createProvider(http);

      const result = await provider.createRegistrationOrder({
        customerId: "cust_001",
        ceilingPaise: 500_000,
        validUntilEpochSeconds: 1800000000,
        idempotencyKey: "idem-001",
      });

      expect(result.kind).toBe("indeterminate");
    });

    it("forwards the idempotency key", async () => {
      const http = new MockRazorpayHttp();
      http.onPath("/v1/orders", () => ({ status: 200, body: { id: "order_reg001" } }));
      const provider = createProvider(http);

      await provider.createRegistrationOrder({
        customerId: "cust_001",
        ceilingPaise: 500_000,
        validUntilEpochSeconds: 1800000000,
        idempotencyKey: "idem-specific-001",
      });

      expect(http.lastRequest?.idempotencyKey).toBe("idem-specific-001");
    });
  });

  describe("verifyRegistrationCallback", () => {
    it("verifies a valid signature and returns the provider token id", async () => {
      const http = new MockRazorpayHttp();
      http.onPath("/v1/payments/pay_recurring001", () => ({
        status: 200,
        body: makeRecurringPayment(),
      }));
      const provider = createProvider(http);

      const signature = hmacSha256("order_reg001|pay_recurring001", TEST_CONFIG.keySecret);
      const result = await provider.verifyRegistrationCallback({
        razorpayOrderId: "order_reg001",
        razorpayPaymentId: "pay_recurring001",
        razorpaySignature: signature,
      });

      expect(result.verified).toBe(true);
      if (!result.verified) throw new Error("expected verified");
      expect(result.providerTokenId).toBe("token_test001");
    });

    it("rejects a forged signature without querying Razorpay", async () => {
      const http = new MockRazorpayHttp();
      const provider = createProvider(http);

      const result = await provider.verifyRegistrationCallback({
        razorpayOrderId: "order_reg001",
        razorpayPaymentId: "pay_recurring001",
        razorpaySignature: "forged-signature",
      });

      expect(result.verified).toBe(false);
      expect(http.requests.length).toBe(0);
    });

    it("rejects when the payment has no token_id", async () => {
      const http = new MockRazorpayHttp();
      http.onPath("/v1/payments/pay_recurring001", () => ({
        status: 200,
        body: makeRecurringPayment({ token_id: null }),
      }));
      const provider = createProvider(http);

      const signature = hmacSha256("order_reg001|pay_recurring001", TEST_CONFIG.keySecret);
      const result = await provider.verifyRegistrationCallback({
        razorpayOrderId: "order_reg001",
        razorpayPaymentId: "pay_recurring001",
        razorpaySignature: signature,
      });

      expect(result.verified).toBe(false);
    });
  });

  describe("fetchTokenStatus", () => {
    it("maps a confirmed token", async () => {
      const http = new MockRazorpayHttp();
      http.onPath("/v1/customers/cust_001/tokens/token_001", () => ({
        status: 200,
        body: makeToken({ recurring_details: { status: "confirmed" } }),
      }));
      const provider = createProvider(http);

      expect(await provider.fetchTokenStatus("cust_001", "token_001")).toBe("confirmed");
    });

    it("maps a cancelled token", async () => {
      const http = new MockRazorpayHttp();
      http.onPath("/v1/customers/cust_001/tokens/token_001", () => ({
        status: 200,
        body: makeToken({ recurring_details: { status: "cancelled" } }),
      }));
      const provider = createProvider(http);

      expect(await provider.fetchTokenStatus("cust_001", "token_001")).toBe("cancelled");
    });

    it("maps a pending token", async () => {
      const http = new MockRazorpayHttp();
      http.onPath("/v1/customers/cust_001/tokens/token_001", () => ({
        status: 200,
        body: makeToken({ recurring_details: { status: "pending" } }),
      }));
      const provider = createProvider(http);

      expect(await provider.fetchTokenStatus("cust_001", "token_001")).toBe("pending");
    });

    it("treats a query failure as pending, not a thrown error", async () => {
      const http = new MockRazorpayHttp();
      http.onPath("/v1/customers/cust_001/tokens/token_001", () => ({ status: 500, body: {} }));
      const provider = createProvider(http);

      expect(await provider.fetchTokenStatus("cust_001", "token_001")).toBe("pending");
    });
  });

  describe("chargeRecurring", () => {
    it("returns confirmed for a captured payment", async () => {
      const http = new MockRazorpayHttp();
      http.onPath("/v1/payments/create/recurring", () => ({
        status: 200,
        body: makeRecurringPayment({ status: "captured" }),
      }));
      const provider = createProvider(http);

      const result = await provider.chargeRecurring({
        customerId: "cust_001",
        tokenId: "token_001",
        amountPaise: 15000,
        idempotencyKey: "idem-charge-001",
      });

      expect(result.kind).toBe("confirmed");
    });

    it("returns declined for a failed payment, without throwing", async () => {
      const http = new MockRazorpayHttp();
      http.onPath("/v1/payments/create/recurring", () => ({
        status: 200,
        body: makeRecurringPayment({
          status: "failed",
          error_code: "BAD_REQUEST_ERROR",
          error_description: "Insufficient funds",
        }),
      }));
      const provider = createProvider(http);

      const result = await provider.chargeRecurring({
        customerId: "cust_001",
        tokenId: "token_001",
        amountPaise: 15000,
        idempotencyKey: "idem-charge-002",
      });

      expect(result.kind).toBe("declined");
      if (result.kind !== "declined") throw new Error("expected declined");
      expect(result.reason.reason).toBe("Insufficient funds");
    });

    it("returns declined (not thrown) for a hard non-2xx Razorpay error", async () => {
      const http = new MockRazorpayHttp();
      http.onPath("/v1/payments/create/recurring", () => ({ status: 400, body: {} }));
      const provider = createProvider(http);

      const result = await provider.chargeRecurring({
        customerId: "cust_001",
        tokenId: "token_001",
        amountPaise: 15000,
        idempotencyKey: "idem-charge-003",
      });

      expect(result.kind).toBe("declined");
    });

    it("returns indeterminate on a transport timeout", async () => {
      const http = new MockRazorpayHttp();
      http.onPath("/v1/payments/create/recurring", () => ({
        status: 503,
        body: { error: { reason: "timeout" } },
      }));
      const provider = createProvider(http);

      const result = await provider.chargeRecurring({
        customerId: "cust_001",
        tokenId: "token_001",
        amountPaise: 15000,
        idempotencyKey: "idem-charge-004",
      });

      expect(result.kind).toBe("indeterminate");
    });

    it("returns indeterminate for a pending (not yet resolved) payment", async () => {
      const http = new MockRazorpayHttp();
      http.onPath("/v1/payments/create/recurring", () => ({
        status: 200,
        body: makeRecurringPayment({ status: "created" }),
      }));
      const provider = createProvider(http);

      const result = await provider.chargeRecurring({
        customerId: "cust_001",
        tokenId: "token_001",
        amountPaise: 15000,
        idempotencyKey: "idem-charge-005",
      });

      expect(result.kind).toBe("indeterminate");
    });

    it("forwards the idempotency key", async () => {
      const http = new MockRazorpayHttp();
      http.onPath("/v1/payments/create/recurring", () => ({
        status: 200,
        body: makeRecurringPayment(),
      }));
      const provider = createProvider(http);

      await provider.chargeRecurring({
        customerId: "cust_001",
        tokenId: "token_001",
        amountPaise: 15000,
        idempotencyKey: "idem-charge-unique",
      });

      expect(http.lastRequest?.idempotencyKey).toBe("idem-charge-unique");
    });
  });

  describe("cancelToken", () => {
    it("succeeds on a 200 response", async () => {
      const http = new MockRazorpayHttp();
      http.onPath("/v1/customers/cust_001/tokens/token_001", () => ({
        status: 200,
        body: { id: "token_001", entity: "token", deleted: true },
      }));
      const provider = createProvider(http);

      await expect(provider.cancelToken("cust_001", "token_001")).resolves.toBeUndefined();
    });

    it("uses a DELETE request", async () => {
      const http = new MockRazorpayHttp();
      http.onPath("/v1/customers/cust_001/tokens/token_001", () => ({
        status: 200,
        body: {},
      }));
      const provider = createProvider(http);

      await provider.cancelToken("cust_001", "token_001");

      expect(http.lastRequest?.method).toBe("DELETE");
    });

    it("throws on a non-200 response", async () => {
      const http = new MockRazorpayHttp();
      http.onPath("/v1/customers/cust_001/tokens/token_001", () => ({ status: 500, body: {} }));
      const provider = createProvider(http);

      await expect(provider.cancelToken("cust_001", "token_001")).rejects.toThrow();
    });
  });
});
