import { describe, expect, it } from "vitest";

import {
  selectPaymentAuthorizationPort,
  createDeterministicPaymentAuthorizationPort,
} from "./boot.js";
import type { EnvironmentBag } from "./connector-env.js";
import { createCounterId, type CounterId } from "@counter/domain";

function txnId(fill: number): CounterId<"transaction"> {
  const r = createCounterId("transaction", new Uint8Array(16).fill(fill));
  if (!r.ok) throw new Error("bad txn id");
  return r.value;
}

describe("selectPaymentAuthorizationPort", () => {
  it("falls back to the deterministic port in local/test without credentials", () => {
    const env: EnvironmentBag = { COUNTER_ENV: "test" };
    const selection = selectPaymentAuthorizationPort(env);
    expect(selection.mode).toBe("deterministic");
  });

  it("throws (fail loud) in a prod-like environment without credentials", () => {
    const env: EnvironmentBag = { COUNTER_ENV: "production" };
    expect(() => selectPaymentAuthorizationPort(env)).toThrow(/production-like/);
  });

  it("selects the real port when both credential sets are present", () => {
    const env: EnvironmentBag = {
      COUNTER_ENV: "test",
      SHOPIFY_STORE_DOMAIN: "counter-commerce-agent.myshopify.com",
      SHOPIFY_ACCESS_TOKEN: "shpat_fake",
      RAZORPAY_KEY_ID: "rzp_test_fake",
      RAZORPAY_KEY_SECRET: "secret_fake",
      RAZORPAY_WEBHOOK_SECRET: "whsecret_fake",
    };
    const selection = selectPaymentAuthorizationPort(env);
    expect(selection.mode).toBe("real");
  });

  it("uses deterministic when only Shopify credentials are present (local/test)", () => {
    const env: EnvironmentBag = {
      COUNTER_ENV: "local",
      SHOPIFY_STORE_DOMAIN: "counter-commerce-agent.myshopify.com",
      SHOPIFY_ACCESS_TOKEN: "shpat_fake",
    };
    const selection = selectPaymentAuthorizationPort(env);
    expect(selection.mode).toBe("deterministic");
  });
});

describe("deterministic PaymentAuthorizationPort", () => {
  it("captures the intended amount and is stable across replays", async () => {
    const port = createDeterministicPaymentAuthorizationPort();
    const request = {
      transactionId: txnId(2),
      amountMinor: 4999,
      currency: "INR",
      idempotencyKey: "order-det",
    };
    const first = await port.authorizeAndCapture(request);
    const second = await port.authorizeAndCapture(request);
    expect(first.status).toBe("captured");
    expect(first.capturedMinor).toBe(4999);
    expect(second.providerReference).toBe(first.providerReference);
  });
});
