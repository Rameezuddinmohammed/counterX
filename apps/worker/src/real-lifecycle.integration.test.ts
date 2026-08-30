/**
 * Creds-gated REAL connector integration test.
 *
 * This drives the real Shopify + Razorpay + CTP-signed payment lifecycle
 * against the live provider APIs. It is SKIPPED unless BOTH
 * SHOPIFY_ACCESS_TOKEN and RAZORPAY_KEY_ID are present in the environment, so
 * it never affects the default test baseline and never requires real network
 * access or secrets in CI.
 *
 * SECURITY: credentials are read from the environment only; nothing is logged.
 */
import { describe, expect, it } from "vitest";

import { instantFromEpochMilliseconds, type Instant } from "@counter/domain";

import { selectPaymentAuthorizationPort } from "./boot.js";
import {
  createTransactionLifecycleHandler,
  type HandledJob,
  type ReceiptSink,
  type TransactionReceipt,
} from "./transaction-lifecycle.js";

const hasCreds =
  (process.env["SHOPIFY_ACCESS_TOKEN"]?.trim() ?? "").length > 0 &&
  (process.env["RAZORPAY_KEY_ID"]?.trim() ?? "").length > 0;

const credDescribe = hasCreds ? describe : describe.skip;

function instant(ms: number): Instant {
  const result = instantFromEpochMilliseconds(ms);
  if (!result.ok) throw new Error("bad instant");
  return result.value;
}

class RecordingSink implements ReceiptSink {
  readonly receipts: TransactionReceipt[] = [];
  record(receipt: TransactionReceipt): Promise<void> {
    this.receipts.push(receipt);
    return Promise.resolve();
  }
}

credDescribe("real connector lifecycle (creds-gated, live network)", () => {
  it("completes one real transaction lifecycle end to end", async () => {
    const selection = selectPaymentAuthorizationPort(process.env);
    expect(selection.mode).toBe("real");

    const sink = new RecordingSink();
    const handler = createTransactionLifecycleHandler(selection.port, sink);

    const variantId = process.env["SHOPIFY_TEST_VARIANT_GID"];
    const job: HandledJob = {
      id: "ctr_job_live" as HandledJob["id"],
      type: "transaction.lifecycle",
      payload: {
        transactionId: `order-live-${Date.now()}`,
        amountMinor: 100,
        currency: "INR",
        ...(variantId !== undefined ? { variantId } : {}),
        quantity: 1,
      },
    };

    await handler.execute(job, instant(Date.now()));

    expect(sink.receipts).toHaveLength(1);
    const receipt = sink.receipts[0]!;
    expect(receipt.finalState.phase).toBe("CLOSED");
    expect(receipt.providerReference).toContain("shopify_order:");
    expect(receipt.providerReference).toContain("razorpay_order:");
  }, 60_000);
});
