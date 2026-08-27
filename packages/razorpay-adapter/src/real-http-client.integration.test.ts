/**
 * Creds-gated REAL integration test for the fetch-based Razorpay HTTP client.
 *
 * This test hits the REAL Razorpay test API (https://api.razorpay.com/v1). It
 * runs ONLY when RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are present in the
 * environment; otherwise it skips cleanly via `describe.skip`, so the baseline
 * test count is unaffected in CI/sandbox where creds are absent.
 *
 * It creates a real test order (INR 1.00 = 100 paise) with a unique receipt,
 * asserts a 200 with an `order_`-prefixed id, then queries the order back.
 *
 * SECURITY: never asserts on, prints, or logs secret values.
 */

import { describe, expect, it } from "vitest";

import { createRazorpayHttpClient } from "./real-http-client.js";
import type { RazorpayOrder } from "./types.js";

const keyId = process.env["RAZORPAY_KEY_ID"];
const keySecret = process.env["RAZORPAY_KEY_SECRET"];
const baseUrl = process.env["RAZORPAY_BASE_URL"] ?? "https://api.razorpay.com/v1";

const liveDescribe = keyId && keySecret ? describe : describe.skip;

liveDescribe("real Razorpay HTTP client (live, creds-gated)", () => {
  it("creates and queries a real test order", async () => {
    const client = createRazorpayHttpClient({
      keyId: keyId as string,
      keySecret: keySecret as string,
      baseUrl,
      timeoutMs: 20_000,
    });

    const receipt = `counterx-it-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const idempotencyKey = `it-${receipt}`;

    const created = await client.request<RazorpayOrder>({
      method: "POST",
      path: "/orders",
      body: {
        amount: 100, // 100 paise = INR 1.00
        currency: "INR",
        receipt,
        partial_payment: false,
      },
      idempotencyKey,
    });

    expect(created.status).toBe(200);
    expect(created.body.id).toMatch(/^order_/);

    const orderId = created.body.id;
    const fetched = await client.request<RazorpayOrder>({
      method: "GET",
      path: `/orders/${orderId}`,
    });

    expect(fetched.status).toBe(200);
    expect(fetched.body.id).toBe(orderId);
  });
});
