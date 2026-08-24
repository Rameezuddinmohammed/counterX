import { describe, expect, it } from "vitest";
import {
  PACKAGE_NAME,
} from "./index.js";
import type {
  RazorpayTestAdapterConfig,
  RazorpayOrderParams,
} from "./index.js";

describe("@counter/razorpay-adapter", () => {
  it("exposes its package identity", () => {
    expect(PACKAGE_NAME).toBe("@counter/razorpay-adapter");
  });

  it("RazorpayTestAdapterConfig type is structurally correct", () => {
    const config: RazorpayTestAdapterConfig = {
      keyId: "rzp_test_key",
      keySecret: "rzp_test_secret",
      webhookSecret: "whsec_test",
      environment: "test",
      baseUrl: "https://api.razorpay.com/v1",
    };
    expect(config.environment).toBe("test");
    expect(config.keyId).toBe("rzp_test_key");
  });

  it("RazorpayOrderParams type is structurally correct", () => {
    const params: RazorpayOrderParams = {
      amount: 50000,
      currency: "INR",
      receipt: "receipt_001",
      notes: { orderId: "order-1" },
      partialPayment: false,
    };
    expect(params.amount).toBe(50000);
    expect(params.currency).toBe("INR");
  });
});
