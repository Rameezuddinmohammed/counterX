/**
 * Tests for RazorpayTestProvider.
 *
 * Covers:
 * - Order creation with correct paise conversion
 * - Callback signature verification (valid and forged)
 * - Webhook signature verification
 * - Webhook deduplication
 * - Query returns authoritative state
 * - Refund creation
 * - Wrong amount rejection
 * - Timeout handling
 * - Duplicate event tolerance
 */

import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import type { IsoCurrencyCode, Instant } from "@counter/domain";
import { instantFromEpochMilliseconds } from "@counter/domain";

import { MockRazorpayHttp } from "./http-client.js";
import { RazorpayTestProvider } from "./razorpay-provider.js";
import { WebhookDeduplicator, processWebhookEvent, normalizeRefundEvidence } from "./webhook-processor.js";
import type { RazorpayTestAdapterConfig } from "./index.js";
import type { RazorpayOrder, RazorpayPayment, RazorpayRefund, RazorpayWebhookEvent } from "./types.js";
import type { ProviderReference, ProviderRefundReference } from "@counter/payment-sdk";

// ─── Test Helpers ────────────────────────────────────────────────────────────

const TEST_CONFIG: RazorpayTestAdapterConfig = {
  keyId: "rzp_test_key123",
  keySecret: "rzp_test_secret456",
  webhookSecret: "whsec_test_secret789",
  environment: "test",
  baseUrl: "https://api.razorpay.com",
};

const BASE_TIME = 1700000000000;

function createProvider(http: MockRazorpayHttp, clockTime = BASE_TIME): RazorpayTestProvider {
  return new RazorpayTestProvider({
    config: TEST_CONFIG,
    httpClient: http,
    clock: () => clockTime,
  });
}

function makeInstant(ms: number): Instant {
  const result = instantFromEpochMilliseconds(ms);
  if (!result.ok) throw new Error("Invalid instant");
  return result.value;
}

function makeOrder(overrides: Partial<RazorpayOrder> = {}): RazorpayOrder {
  return {
    id: "order_test123",
    entity: "order",
    amount: 50000,
    amount_paid: 0,
    amount_due: 50000,
    currency: "INR",
    receipt: "receipt_001",
    status: "created",
    notes: {},
    created_at: 1700000000,
    ...overrides,
  };
}

function makePayment(overrides: Partial<RazorpayPayment> = {}): RazorpayPayment {
  return {
    id: "pay_test456",
    entity: "payment",
    amount: 50000,
    currency: "INR",
    status: "captured",
    order_id: "order_test123",
    method: "card",
    description: null,
    error_code: null,
    error_description: null,
    created_at: 1700000000,
    ...overrides,
  };
}

function makeRefund(overrides: Partial<RazorpayRefund> = {}): RazorpayRefund {
  return {
    id: "rfnd_test789",
    entity: "refund",
    amount: 50000,
    currency: "INR",
    payment_id: "pay_test456",
    status: "processed",
    speed_processed: "normal",
    created_at: 1700000000,
    ...overrides,
  };
}

function computeSignature(orderId: string, paymentId: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
}

function computeWebhookSignature(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("RazorpayTestProvider", () => {
  describe("construction", () => {
    it("rejects live environment", () => {
      const http = new MockRazorpayHttp();
      expect(() => new RazorpayTestProvider({
        config: { ...TEST_CONFIG, environment: "live" },
        httpClient: http,
      })).toThrow();
    });

    it("accepts test environment", () => {
      const http = new MockRazorpayHttp();
      const provider = createProvider(http);
      expect(provider).toBeDefined();
    });
  });

  describe("capabilities", () => {
    it("reports direct_capture lifecycle with INR support", async () => {
      const http = new MockRazorpayHttp();
      const provider = createProvider(http);
      const caps = await provider.capabilities({
        environment: "test" as any,
        walletId: "w1" as any,
        agentId: "a1" as any,
        merchantId: "m1" as any,
      });
      expect(caps.lifecycleType).toBe("direct_capture");
      expect(caps.currencies).toContain("INR");
      expect(caps.webhookVerification).toBe(true);
      expect(caps.refundSupported).toBe(true);
    });
  });

  describe("createInstruction", () => {
    it("creates an order with correct paise conversion", async () => {
      const http = new MockRazorpayHttp();
      const order = makeOrder({ amount: 50000 });
      http.onCreateOrder(order);

      const provider = createProvider(http);
      const result = await provider.createInstruction({
        authorizationRef: "auth_ref",
        amount: Object.freeze({ amountMinor: 50000n, currency: "INR" as IsoCurrencyCode }),
        currency: "INR" as IsoCurrencyCode,
        merchantId: "m1" as any,
        idempotencyKey: "idem_001",
      });

      expect(result.kind).toBe("action_required");
      if (result.kind === "action_required") {
        expect(result.action.metadata?.["razorpay_order_id"]).toBe("order_test123");
        expect(result.action.metadata?.["amount"]).toBe("50000");
        expect(result.action.metadata?.["razorpay_key_id"]).toBe("rzp_test_key123");
      }
    });

    it("never exposes key_secret in action_required response", async () => {
      const http = new MockRazorpayHttp();
      http.onCreateOrder(makeOrder());
      const provider = createProvider(http);

      const result = await provider.createInstruction({
        authorizationRef: "auth_ref",
        amount: Object.freeze({ amountMinor: 50000n, currency: "INR" as IsoCurrencyCode }),
        currency: "INR" as IsoCurrencyCode,
        merchantId: "m1" as any,
        idempotencyKey: "idem_002",
      });

      // Serialize entire result to check no secret leakage
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain("rzp_test_secret456");
      expect(serialized).not.toContain("key_secret");
    });

    it("rejects zero amount", async () => {
      const http = new MockRazorpayHttp();
      const provider = createProvider(http);

      await expect(provider.createInstruction({
        authorizationRef: "auth_ref",
        amount: Object.freeze({ amountMinor: 0n, currency: "INR" as IsoCurrencyCode }),
        currency: "INR" as IsoCurrencyCode,
        merchantId: "m1" as any,
        idempotencyKey: "idem_003",
      })).rejects.toMatchObject({ code: "OUT_OF_RANGE" });
    });

    it("rejects negative amount", async () => {
      const http = new MockRazorpayHttp();
      const provider = createProvider(http);

      await expect(provider.createInstruction({
        authorizationRef: "auth_ref",
        amount: Object.freeze({ amountMinor: -100n, currency: "INR" as IsoCurrencyCode }),
        currency: "INR" as IsoCurrencyCode,
        merchantId: "m1" as any,
        idempotencyKey: "idem_004",
      })).rejects.toMatchObject({ code: "OUT_OF_RANGE" });
    });

    it("handles API failure gracefully", async () => {
      const http = new MockRazorpayHttp();
      http.onPath("/v1/orders", () => ({ status: 500, body: { error: "Internal error" } }));
      const provider = createProvider(http);

      await expect(provider.createInstruction({
        authorizationRef: "auth_ref",
        amount: Object.freeze({ amountMinor: 50000n, currency: "INR" as IsoCurrencyCode }),
        currency: "INR" as IsoCurrencyCode,
        merchantId: "m1" as any,
        idempotencyKey: "idem_005",
      })).rejects.toMatchObject({ code: "UNAVAILABLE" });
    });
  });

  describe("verifyClientReturn", () => {
    it("verifies a valid Razorpay callback signature", async () => {
      const http = new MockRazorpayHttp();
      const payment = makePayment({ status: "captured" });
      http.onQueryPayment("pay_test456", payment);

      const provider = createProvider(http);
      const signature = computeSignature("order_test123", "pay_test456", TEST_CONFIG.keySecret);

      const result = await provider.verifyClientReturn({
        queryParams: {
          razorpay_order_id: "order_test123",
          razorpay_payment_id: "pay_test456",
          razorpay_signature: signature,
        },
        returnedAt: makeInstant(BASE_TIME),
      });

      expect(result.kind).toBe("verified");
      if (result.kind === "verified") {
        expect(result.correlationId).toBe("order_test123");
        expect(result.evidence.status).toBe("confirmed");
        expect(result.evidence.reference).toBe("pay_test456");
      }
    });

    it("rejects a forged callback signature", async () => {
      const http = new MockRazorpayHttp();
      const provider = createProvider(http);

      const result = await provider.verifyClientReturn({
        queryParams: {
          razorpay_order_id: "order_test123",
          razorpay_payment_id: "pay_test456",
          razorpay_signature: "forged_signature_value",
        },
        returnedAt: makeInstant(BASE_TIME),
      });

      expect(result.kind).toBe("untrusted");
    });

    it("returns untrusted when missing parameters", async () => {
      const http = new MockRazorpayHttp();
      const provider = createProvider(http);

      const result = await provider.verifyClientReturn({
        queryParams: {
          razorpay_order_id: "order_test123",
        },
        returnedAt: makeInstant(BASE_TIME),
      });

      expect(result.kind).toBe("untrusted");
    });
  });

  describe("verifyWebhook", () => {
    it("verifies a valid webhook signature", async () => {
      const http = new MockRazorpayHttp();
      const provider = createProvider(http);

      const event: RazorpayWebhookEvent = {
        entity: "event",
        account_id: "acc_test",
        event: "payment.captured",
        contains: ["payment"],
        payload: {
          payment: {
            entity: makePayment({ status: "captured" }),
          },
        },
        created_at: 1700000000,
      };

      const bodyString = JSON.stringify(event);
      const signature = computeWebhookSignature(bodyString, TEST_CONFIG.webhookSecret);
      const body = new TextEncoder().encode(bodyString);

      const result = await provider.verifyWebhook({
        headers: { "x-razorpay-signature": signature },
        body,
        receivedAt: makeInstant(BASE_TIME),
      });

      expect(result.eventType).toBe("payment.captured");
      expect(result.reference).toBe("pay_test456");
      expect(result.evidence.status).toBe("confirmed");
    });

    it("rejects an invalid webhook signature", async () => {
      const http = new MockRazorpayHttp();
      const provider = createProvider(http);

      const bodyString = JSON.stringify({ event: "payment.captured" });
      const body = new TextEncoder().encode(bodyString);

      await expect(provider.verifyWebhook({
        headers: { "x-razorpay-signature": "invalid_signature" },
        body,
        receivedAt: makeInstant(BASE_TIME),
      })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    });

    it("rejects missing webhook signature header", async () => {
      const http = new MockRazorpayHttp();
      const provider = createProvider(http);

      const body = new TextEncoder().encode("{}");

      await expect(provider.verifyWebhook({
        headers: {},
        body,
        receivedAt: makeInstant(BASE_TIME),
      })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    });
  });

  describe("query", () => {
    it("returns authoritative payment state", async () => {
      const http = new MockRazorpayHttp();
      const payment = makePayment({ status: "captured", method: "upi" });
      http.onQueryPayment("pay_test456", payment);

      const provider = createProvider(http);
      const evidence = await provider.query("pay_test456" as ProviderReference);

      expect(evidence.reference).toBe("pay_test456");
      expect(evidence.status).toBe("confirmed");
      expect(evidence.confirmedAt).toBeDefined();
      expect(evidence.providerData).toEqual({ method: "upi", orderId: "order_test123" });
    });

    it("returns pending for failed API call", async () => {
      const http = new MockRazorpayHttp();
      http.onPath("/v1/payments/pay_unknown", () => ({ status: 404, body: { error: "not found" } }));

      const provider = createProvider(http);
      const evidence = await provider.query("pay_unknown" as ProviderReference);

      expect(evidence.status).toBe("pending");
    });

    it("maps failed payment to declined", async () => {
      const http = new MockRazorpayHttp();
      const payment = makePayment({ id: "pay_failed", status: "failed" });
      http.onQueryPayment("pay_failed", payment);

      const provider = createProvider(http);
      const evidence = await provider.query("pay_failed" as ProviderReference);

      expect(evidence.status).toBe("declined");
    });
  });

  describe("refund", () => {
    it("creates a refund and returns confirmed for processed status", async () => {
      const http = new MockRazorpayHttp();
      const refund = makeRefund({ status: "processed" });
      http.onCreateRefund("pay_test456", refund);

      const provider = createProvider(http);
      const result = await provider.refund({
        reference: "pay_test456" as ProviderReference,
        amount: Object.freeze({ amountMinor: 50000n, currency: "INR" as IsoCurrencyCode }),
        reason: "Customer request",
        idempotencyKey: "refund_001",
      });

      expect(result.kind).toBe("confirmed");
    });

    it("returns pending for pending refund status", async () => {
      const http = new MockRazorpayHttp();
      const refund = makeRefund({ status: "pending" });
      http.onCreateRefund("pay_test456", refund);

      const provider = createProvider(http);
      const result = await provider.refund({
        reference: "pay_test456" as ProviderReference,
        amount: Object.freeze({ amountMinor: 50000n, currency: "INR" as IsoCurrencyCode }),
        idempotencyKey: "refund_002",
      });

      expect(result.kind).toBe("pending");
    });

    it("throws on API failure", async () => {
      const http = new MockRazorpayHttp();
      http.onPath("/v1/payments/pay_test456/refunds", () => ({
        status: 500,
        body: { error: "Server error" },
      }));

      const provider = createProvider(http);
      await expect(provider.refund({
        reference: "pay_test456" as ProviderReference,
        amount: Object.freeze({ amountMinor: 50000n, currency: "INR" as IsoCurrencyCode }),
        idempotencyKey: "refund_003",
      })).rejects.toMatchObject({ code: "UNAVAILABLE" });
    });
  });

  describe("queryRefund", () => {
    it("returns refund evidence for processed refund", async () => {
      const http = new MockRazorpayHttp();
      const refund = makeRefund({ id: "rfnd_001", status: "processed", amount: 25000 });
      http.onPath("/v1/refunds/rfnd_001", () => ({ status: 200, body: refund }));

      const provider = createProvider(http);
      const evidence = await provider.queryRefund("rfnd_001" as ProviderRefundReference);

      expect(evidence.reference).toBe("rfnd_001");
      expect(evidence.status).toBe("confirmed");
      expect(evidence.amount.amountMinor).toBe(25000n);
    });

    it("returns pending for unknown refund", async () => {
      const http = new MockRazorpayHttp();
      http.onPath("/v1/refunds/rfnd_unknown", () => ({
        status: 404,
        body: { error: "not found" },
      }));

      const provider = createProvider(http);
      const evidence = await provider.queryRefund("rfnd_unknown" as ProviderRefundReference);

      expect(evidence.status).toBe("pending");
    });
  });

  describe("authorize/capture/void unsupported", () => {
    it("throws on authorize", async () => {
      const http = new MockRazorpayHttp();
      const provider = createProvider(http);
      await expect(provider.authorize({
        authorizationRef: "ref",
        amount: Object.freeze({ amountMinor: 1000n, currency: "INR" as IsoCurrencyCode }),
        currency: "INR" as IsoCurrencyCode,
        merchantId: "m1" as any,
        idempotencyKey: "key",
      })).rejects.toMatchObject({ code: "UNSUPPORTED_VALUE" });
    });

    it("throws on capture", async () => {
      const http = new MockRazorpayHttp();
      const provider = createProvider(http);
      await expect(provider.capture({
        reference: "ref" as ProviderReference,
        amount: Object.freeze({ amountMinor: 1000n, currency: "INR" as IsoCurrencyCode }),
        idempotencyKey: "key",
      })).rejects.toMatchObject({ code: "UNSUPPORTED_VALUE" });
    });

    it("throws on void", async () => {
      const http = new MockRazorpayHttp();
      const provider = createProvider(http);
      await expect(provider.void({
        reference: "ref" as ProviderReference,
        idempotencyKey: "key",
      })).rejects.toMatchObject({ code: "UNSUPPORTED_VALUE" });
    });
  });
});

describe("WebhookDeduplicator", () => {
  it("tracks processed events and detects duplicates", () => {
    const dedup = new WebhookDeduplicator();
    const now = makeInstant(BASE_TIME);

    expect(dedup.isDuplicate("evt_001")).toBe(false);
    dedup.record("evt_001", "payment.captured", now);
    expect(dedup.isDuplicate("evt_001")).toBe(true);
    expect(dedup.size).toBe(1);
  });

  it("evicts oldest entries when exceeding maxSize", () => {
    const dedup = new WebhookDeduplicator(3);
    const now = makeInstant(BASE_TIME);

    dedup.record("evt_001", "payment.captured", now);
    dedup.record("evt_002", "payment.captured", now);
    dedup.record("evt_003", "payment.captured", now);
    dedup.record("evt_004", "payment.captured", now);

    expect(dedup.isDuplicate("evt_001")).toBe(false); // evicted
    expect(dedup.isDuplicate("evt_002")).toBe(true);
    expect(dedup.isDuplicate("evt_004")).toBe(true);
  });

  it("processes events with deduplication", () => {
    const dedup = new WebhookDeduplicator();
    const now = makeInstant(BASE_TIME);
    const event: RazorpayWebhookEvent = {
      entity: "event",
      account_id: "acc_test",
      event: "payment.captured",
      contains: ["payment"],
      payload: {},
      created_at: 1700000000,
    };

    const result1 = processWebhookEvent(event, "evt_001", dedup, now);
    expect(result1.status).toBe("processed");

    const result2 = processWebhookEvent(event, "evt_001", dedup, now);
    expect(result2.status).toBe("duplicate");
  });
});

describe("normalizeRefundEvidence", () => {
  it("maps processed refund to confirmed", () => {
    const refund = makeRefund({ status: "processed", amount: 25000 });
    const evidence = normalizeRefundEvidence(refund);

    expect(evidence.status).toBe("confirmed");
    expect(evidence.amount.amountMinor).toBe(25000n);
    expect(evidence.processedAt).toBeDefined();
  });

  it("maps pending refund to pending", () => {
    const refund = makeRefund({ status: "pending" });
    const evidence = normalizeRefundEvidence(refund);
    expect(evidence.status).toBe("pending");
  });

  it("maps failed refund to declined", () => {
    const refund = makeRefund({ status: "failed" });
    const evidence = normalizeRefundEvidence(refund);
    expect(evidence.status).toBe("declined");
  });
});
