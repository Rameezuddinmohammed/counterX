import { describe, expect, it } from "vitest";
import { PACKAGE_NAME, RAZORPAY_CONFIG_KEYS } from "./index.js";
import type {
  RazorpayTestAdapterConfig,
  RazorpayOrderParams,
  ConfigKeyDescriptor,
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

  it("exports RAZORPAY_CONFIG_KEYS describing expected environment variables", () => {
    expect(RAZORPAY_CONFIG_KEYS.length).toBeGreaterThan(0);
    for (const key of RAZORPAY_CONFIG_KEYS) {
      const descriptor: ConfigKeyDescriptor = key;
      expect(descriptor.name).toBeTruthy();
      expect(descriptor.purpose).toBeTruthy();
      expect(typeof descriptor.required).toBe("boolean");
    }
  });
});
