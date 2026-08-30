import { describe, expect, it } from "vitest";
import type { CounterId, Instant } from "@counter/domain";
import {
  normalizeShopifyObservation,
  normalizeTestProviderObservation,
  normalizeRazorpayObservation,
  normalizeAgentClaim,
} from "./observation-normalizer.js";
import type {
  ShopifyObservation,
  TestProviderObservation,
  RazorpayObservation,
  AgentClaimObservation,
  NormalizerContext,
} from "./observation-normalizer.js";

const NOW = 1_700_000_000_000 as Instant;

function makeContext(overrides: Partial<NormalizerContext> = {}): NormalizerContext {
  return {
    evidenceId: "ctr_evidence_AAAAAAAAAAAAAAAAAAAAAA" as CounterId<"evidence">,
    transactionId: "ctr_transaction_BBBBBBBBBBBBBBBBBBBBBB" as CounterId<"transaction">,
    environment: "test" as const,
    now: NOW,
    ...overrides,
  };
}

describe("observation-normalizer", () => {
  describe("normalizeShopifyObservation", () => {
    it("maps a paid Shopify order to order_committed", () => {
      const observation: ShopifyObservation = {
        orderId: "order_123",
        orderNumber: "1001",
        status: "active",
        financialStatus: "paid",
        totalPrice: "999",
        currency: "INR",
      };

      const record = normalizeShopifyObservation(observation, makeContext());

      expect(record.source).toBe("merchant_connector");
      expect(record.observationMethod).toBe("connector_read");
      expect(record.canonicalClaim.type).toBe("order_committed");
      expect(record.canonicalClaim.details["orderId"]).toBe("order_123");
      expect(record.canonicalClaim.details["amount"]).toBe("999");
      expect(record.canonicalClaim.details["currency"]).toBe("INR");
      expect(record.dataClassification).toBe("restricted");
    });

    it("maps a cancelled Shopify order to order_cancelled", () => {
      const observation: ShopifyObservation = {
        orderId: "order_456",
        orderNumber: "1002",
        status: "cancelled",
        cancelledAt: "2024-01-01T00:00:00Z",
      };

      const record = normalizeShopifyObservation(observation, makeContext());

      expect(record.canonicalClaim.type).toBe("order_cancelled");
      expect(record.sourceId).toBe("shopify:order_456");
    });

    it("maps a shipped fulfillment status to fulfillment_shipped", () => {
      const observation: ShopifyObservation = {
        orderId: "order_789",
        orderNumber: "1003",
        status: "active",
        fulfillmentStatus: "shipped",
      };

      const record = normalizeShopifyObservation(observation, makeContext());

      expect(record.canonicalClaim.type).toBe("fulfillment_shipped");
    });

    it("maps a delivered fulfillment status to fulfillment_delivered", () => {
      const observation: ShopifyObservation = {
        orderId: "order_001",
        orderNumber: "1004",
        status: "active",
        fulfillmentStatus: "delivered",
      };

      const record = normalizeShopifyObservation(observation, makeContext());

      expect(record.canonicalClaim.type).toBe("fulfillment_delivered");
    });

    it("maps a refunded order to refund_issued", () => {
      const observation: ShopifyObservation = {
        orderId: "order_002",
        orderNumber: "1005",
        status: "active",
        financialStatus: "refunded",
      };

      const record = normalizeShopifyObservation(observation, makeContext());

      expect(record.canonicalClaim.type).toBe("refund_issued");
    });

    it("handles missing optional fields gracefully", () => {
      const observation: ShopifyObservation = {
        orderId: "order_min",
        orderNumber: "1006",
        status: "active",
      };

      const record = normalizeShopifyObservation(observation, makeContext());

      expect(record.canonicalClaim.type).toBe("order_committed");
      expect(record.canonicalClaim.details["amount"]).toBeUndefined();
      expect(record.canonicalClaim.details["currency"]).toBeUndefined();
      expect(record.sourceVersion).toBeUndefined();
    });

    it("includes sourceVersion when provided", () => {
      const observation: ShopifyObservation = {
        orderId: "order_ver",
        orderNumber: "1007",
        status: "active",
        financialStatus: "paid",
        sourceVersion: "2024-01",
      };

      const record = normalizeShopifyObservation(observation, makeContext());

      expect(record.sourceVersion).toBe("2024-01");
    });

    it("sets the originalArtifactRef to a shopify URL", () => {
      const observation: ShopifyObservation = {
        orderId: "order_ref",
        orderNumber: "1008",
        status: "active",
      };

      const record = normalizeShopifyObservation(observation, makeContext());

      expect(record.originalArtifactRef).toBe("shopify://orders/order_ref");
    });

    it("produces a valid integrity digest", () => {
      const observation: ShopifyObservation = {
        orderId: "order_integrity",
        orderNumber: "1009",
        status: "active",
        financialStatus: "paid",
      };

      const record = normalizeShopifyObservation(observation, makeContext());

      expect(record.integrityDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    });
  });

  describe("normalizeTestProviderObservation", () => {
    it("maps captured status to payment_confirmed", () => {
      const observation: TestProviderObservation = {
        paymentId: "pay_001",
        status: "captured",
        amount: 1500,
        currency: "INR",
      };

      const record = normalizeTestProviderObservation(observation, makeContext());

      expect(record.source).toBe("payment_provider");
      expect(record.observationMethod).toBe("signed_envelope");
      expect(record.canonicalClaim.type).toBe("payment_confirmed");
      expect(record.canonicalClaim.details["amount"]).toBe(1500);
      expect(record.canonicalClaim.details["currency"]).toBe("INR");
    });

    it("maps declined status to payment_declined", () => {
      const observation: TestProviderObservation = {
        paymentId: "pay_002",
        status: "declined",
        amount: 500,
        currency: "INR",
        failureReason: "insufficient_funds",
      };

      const record = normalizeTestProviderObservation(observation, makeContext());

      expect(record.canonicalClaim.type).toBe("payment_declined");
      expect(record.canonicalClaim.details["failureReason"]).toBe("insufficient_funds");
    });

    it("maps authorized status to authorization_created", () => {
      const observation: TestProviderObservation = {
        paymentId: "pay_003",
        status: "authorized",
        amount: 2000,
        currency: "INR",
        authorizationId: "auth_xyz",
      };

      const record = normalizeTestProviderObservation(observation, makeContext());

      expect(record.canonicalClaim.type).toBe("authorization_created");
      expect(record.canonicalClaim.details["authorizationId"]).toBe("auth_xyz");
    });

    it("maps voided status to authorization_voided", () => {
      const observation: TestProviderObservation = {
        paymentId: "pay_004",
        status: "voided",
        amount: 2000,
        currency: "INR",
      };

      const record = normalizeTestProviderObservation(observation, makeContext());

      expect(record.canonicalClaim.type).toBe("authorization_voided");
    });

    it("maps refunded status to refund_issued", () => {
      const observation: TestProviderObservation = {
        paymentId: "pay_005",
        status: "refunded",
        amount: 750,
        currency: "INR",
        refundId: "refund_abc",
      };

      const record = normalizeTestProviderObservation(observation, makeContext());

      expect(record.canonicalClaim.type).toBe("refund_issued");
      expect(record.canonicalClaim.details["refundId"]).toBe("refund_abc");
    });

    it("maps unknown status to payment_pending", () => {
      const observation: TestProviderObservation = {
        paymentId: "pay_006",
        status: "pending",
        amount: 300,
        currency: "INR",
      };

      const record = normalizeTestProviderObservation(observation, makeContext());

      expect(record.canonicalClaim.type).toBe("payment_pending");
    });

    it("sets originalArtifactRef to test-provider URL", () => {
      const observation: TestProviderObservation = {
        paymentId: "pay_ref",
        status: "captured",
        amount: 100,
        currency: "INR",
      };

      const record = normalizeTestProviderObservation(observation, makeContext());

      expect(record.originalArtifactRef).toBe("counter-test-provider://payments/pay_ref");
    });
  });

  describe("normalizeRazorpayObservation", () => {
    it("maps captured status to payment_confirmed via api_query", () => {
      const observation: RazorpayObservation = {
        paymentId: "pay_rzp_001",
        status: "captured",
        amount: 5000,
        currency: "INR",
        method: "upi",
        isWebhook: false,
      };

      const record = normalizeRazorpayObservation(observation, makeContext());

      expect(record.source).toBe("payment_provider");
      expect(record.observationMethod).toBe("api_query");
      expect(record.canonicalClaim.type).toBe("payment_confirmed");
      expect(record.canonicalClaim.details["amount"]).toBe(5000);
      expect(record.canonicalClaim.details["paymentMethod"]).toBe("upi");
    });

    it("uses verified_webhook method when isWebhook is true", () => {
      const observation: RazorpayObservation = {
        paymentId: "pay_rzp_002",
        status: "captured",
        amount: 3000,
        currency: "INR",
        isWebhook: true,
      };

      const record = normalizeRazorpayObservation(observation, makeContext());

      expect(record.observationMethod).toBe("verified_webhook");
    });

    it("maps authorized status to authorization_created", () => {
      const observation: RazorpayObservation = {
        paymentId: "pay_rzp_003",
        status: "authorized",
        amount: 4000,
        currency: "INR",
        isWebhook: false,
      };

      const record = normalizeRazorpayObservation(observation, makeContext());

      expect(record.canonicalClaim.type).toBe("authorization_created");
    });

    it("maps failed status to payment_declined", () => {
      const observation: RazorpayObservation = {
        paymentId: "pay_rzp_004",
        status: "failed",
        amount: 2000,
        currency: "INR",
        errorCode: "BAD_REQUEST_ERROR",
        errorDescription: "Card declined",
        isWebhook: false,
      };

      const record = normalizeRazorpayObservation(observation, makeContext());

      expect(record.canonicalClaim.type).toBe("payment_declined");
      expect(record.canonicalClaim.details["errorCode"]).toBe("BAD_REQUEST_ERROR");
      expect(record.canonicalClaim.details["errorDescription"]).toBe("Card declined");
    });

    it("maps refunded status to refund_issued", () => {
      const observation: RazorpayObservation = {
        paymentId: "pay_rzp_005",
        status: "refunded",
        amount: 1000,
        currency: "INR",
        refundId: "rfnd_abc",
        refundAmount: 500,
        isWebhook: true,
      };

      const record = normalizeRazorpayObservation(observation, makeContext());

      expect(record.canonicalClaim.type).toBe("refund_issued");
      expect(record.canonicalClaim.details["refundId"]).toBe("rfnd_abc");
      expect(record.canonicalClaim.details["refundAmount"]).toBe(500);
    });

    it("maps unknown status to payment_pending", () => {
      const observation: RazorpayObservation = {
        paymentId: "pay_rzp_006",
        status: "created",
        amount: 800,
        currency: "INR",
        isWebhook: false,
      };

      const record = normalizeRazorpayObservation(observation, makeContext());

      expect(record.canonicalClaim.type).toBe("payment_pending");
    });

    it("includes optional Razorpay fields in details", () => {
      const observation: RazorpayObservation = {
        paymentId: "pay_rzp_007",
        status: "captured",
        amount: 6000,
        currency: "INR",
        method: "netbanking",
        orderId: "order_rzp_001",
        isWebhook: false,
      };

      const record = normalizeRazorpayObservation(observation, makeContext());

      expect(record.canonicalClaim.details["paymentMethod"]).toBe("netbanking");
      expect(record.canonicalClaim.details["orderId"]).toBe("order_rzp_001");
    });

    it("sets originalArtifactRef to razorpay URL", () => {
      const observation: RazorpayObservation = {
        paymentId: "pay_rzp_ref",
        status: "captured",
        amount: 100,
        currency: "INR",
        isWebhook: false,
      };

      const record = normalizeRazorpayObservation(observation, makeContext());

      expect(record.originalArtifactRef).toBe("razorpay://payments/pay_rzp_ref");
    });
  });

  describe("normalizeAgentClaim", () => {
    it("produces agent_claim source with local_record method", () => {
      const observation: AgentClaimObservation = {
        agentId: "agent_001",
        claimType: "payment_confirmed",
        details: { note: "Agent observed payment success" },
      };

      const record = normalizeAgentClaim(observation, makeContext());

      expect(record.source).toBe("agent_claim");
      expect(record.observationMethod).toBe("local_record");
      expect(record.canonicalClaim.type).toBe("payment_confirmed");
      expect(record.canonicalClaim.details["note"]).toBe("Agent observed payment success");
      expect(record.canonicalClaim.details["agentId"]).toBe("agent_001");
    });

    it("includes confidence when provided", () => {
      const observation: AgentClaimObservation = {
        agentId: "agent_002",
        claimType: "order_committed",
        details: {},
        confidence: 0.85,
      };

      const record = normalizeAgentClaim(observation, makeContext());

      expect(record.canonicalClaim.details["confidence"]).toBe(0.85);
    });

    it("does not set originalArtifactRef for agent claims", () => {
      const observation: AgentClaimObservation = {
        agentId: "agent_003",
        claimType: "fulfillment_shipped",
        details: { trackingNumber: "TRACK123" },
      };

      const record = normalizeAgentClaim(observation, makeContext());

      expect(record.originalArtifactRef).toBeUndefined();
    });

    it("handles different claim types", () => {
      const claimTypes = [
        "payment_confirmed",
        "payment_declined",
        "order_committed",
        "order_cancelled",
        "refund_issued",
      ] as const;

      for (const claimType of claimTypes) {
        const observation: AgentClaimObservation = {
          agentId: "agent_multi",
          claimType,
          details: {},
        };

        const record = normalizeAgentClaim(observation, makeContext());
        expect(record.canonicalClaim.type).toBe(claimType);
      }
    });

    it("preserves all details from the observation", () => {
      const observation: AgentClaimObservation = {
        agentId: "agent_004",
        claimType: "payment_confirmed",
        details: {
          amount: 1000,
          merchantName: "TestShop",
          timestamp: "2024-01-01T12:00:00Z",
        },
      };

      const record = normalizeAgentClaim(observation, makeContext());

      expect(record.canonicalClaim.details["amount"]).toBe(1000);
      expect(record.canonicalClaim.details["merchantName"]).toBe("TestShop");
      expect(record.canonicalClaim.details["timestamp"]).toBe("2024-01-01T12:00:00Z");
    });

    it("uses the correct sourceId format", () => {
      const observation: AgentClaimObservation = {
        agentId: "agent_src",
        claimType: "payment_pending",
        details: {},
      };

      const record = normalizeAgentClaim(observation, makeContext());

      expect(record.sourceId).toBe("agent:agent_src");
    });
  });

  describe("cross-normalizer consistency", () => {
    it("all normalizers produce frozen records", () => {
      const ctx = makeContext();

      const shopify = normalizeShopifyObservation(
        { orderId: "o1", orderNumber: "1", status: "active", financialStatus: "paid" },
        ctx,
      );
      const testProvider = normalizeTestProviderObservation(
        { paymentId: "p1", status: "captured", amount: 100, currency: "INR" },
        ctx,
      );
      const razorpay = normalizeRazorpayObservation(
        { paymentId: "r1", status: "captured", amount: 100, currency: "INR", isWebhook: false },
        ctx,
      );
      const agent = normalizeAgentClaim(
        { agentId: "a1", claimType: "payment_confirmed", details: {} },
        ctx,
      );

      expect(Object.isFrozen(shopify)).toBe(true);
      expect(Object.isFrozen(testProvider)).toBe(true);
      expect(Object.isFrozen(razorpay)).toBe(true);
      expect(Object.isFrozen(agent)).toBe(true);
    });

    it("all normalizers produce valid integrity digests", () => {
      const ctx = makeContext();

      const records = [
        normalizeShopifyObservation(
          { orderId: "o1", orderNumber: "1", status: "active", financialStatus: "paid" },
          ctx,
        ),
        normalizeTestProviderObservation(
          { paymentId: "p1", status: "captured", amount: 100, currency: "INR" },
          ctx,
        ),
        normalizeRazorpayObservation(
          { paymentId: "r1", status: "captured", amount: 100, currency: "INR", isWebhook: false },
          ctx,
        ),
        normalizeAgentClaim({ agentId: "a1", claimType: "payment_confirmed", details: {} }, ctx),
      ];

      for (const record of records) {
        expect(record.integrityDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
      }
    });

    it("all normalizers set environment from context", () => {
      const ctx = makeContext({ environment: "test" });

      const records = [
        normalizeShopifyObservation({ orderId: "o1", orderNumber: "1", status: "active" }, ctx),
        normalizeTestProviderObservation(
          { paymentId: "p1", status: "captured", amount: 100, currency: "INR" },
          ctx,
        ),
        normalizeRazorpayObservation(
          { paymentId: "r1", status: "captured", amount: 100, currency: "INR", isWebhook: false },
          ctx,
        ),
        normalizeAgentClaim({ agentId: "a1", claimType: "payment_confirmed", details: {} }, ctx),
      ];

      for (const record of records) {
        expect(record.environment).toBe("test");
      }
    });
  });
});
