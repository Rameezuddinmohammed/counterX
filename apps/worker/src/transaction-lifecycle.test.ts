import { describe, expect, it } from "vitest";
import { instantFromEpochMilliseconds, type Instant } from "@counter/domain";
import {
  createTransactionLifecycleHandler,
  HandlerError,
  type HandledJob,
  type PaymentAuthorizationPort,
  type PaymentAuthorizationResult,
  type ReceiptSink,
  type TransactionReceipt,
} from "./transaction-lifecycle.js";

function instant(ms: number): Instant {
  const result = instantFromEpochMilliseconds(ms);
  if (!result.ok) {
    throw new Error("bad instant");
  }
  return result.value;
}

class RecordingSink implements ReceiptSink {
  readonly receipts: TransactionReceipt[] = [];
  record(receipt: TransactionReceipt): Promise<void> {
    this.receipts.push(receipt);
    return Promise.resolve();
  }
}

function provider(result: PaymentAuthorizationResult): PaymentAuthorizationPort {
  return {
    authorizeAndCapture: (): Promise<PaymentAuthorizationResult> => Promise.resolve(result),
  };
}

const job: HandledJob = {
  id: "ctr_job_x" as HandledJob["id"],
  type: "transaction.lifecycle",
  payload: { transactionId: "order-123", amountMinor: 4999, currency: "INR" },
};

describe("transaction lifecycle handler", () => {
  it("drives the state machine to CLOSED and reconciles a matching capture", async () => {
    const sink = new RecordingSink();
    const handler = createTransactionLifecycleHandler(
      provider({ status: "captured", capturedMinor: 4999, providerReference: "pay_1" }),
      sink,
    );

    await handler.execute(job, instant(1_000));

    expect(sink.receipts).toHaveLength(1);
    const receipt = sink.receipts[0]!;
    // Real transitions ran: a no-op body would leave phase DRAFT / payment pending.
    expect(receipt.finalState.phase).toBe("CLOSED");
    expect(receipt.finalState.payment).toBe("captured");
    expect(receipt.finalState.order).toBe("committed");
    expect(receipt.finalState.version).toBeGreaterThan(5);
    expect(receipt.reconciliation.reconciled).toBe(true);
    expect(receipt.providerReference).toBe("pay_1");
  });

  it("throws a retryable reconciliation.mismatch when captured amount differs", async () => {
    const sink = new RecordingSink();
    const handler = createTransactionLifecycleHandler(
      provider({ status: "captured", capturedMinor: 4000, providerReference: "pay_2" }),
      sink,
    );

    await expect(handler.execute(job, instant(1_000))).rejects.toMatchObject({
      errorClass: "reconciliation.mismatch",
      retryable: true,
    });
    // Evidence was still recorded, and state moved to INDETERMINATE (not a no-op).
    expect(sink.receipts).toHaveLength(1);
    expect(sink.receipts[0]!.finalState.phase).toBe("INDETERMINATE");
    expect(sink.receipts[0]!.reconciliation.reconciled).toBe(false);
  });

  it("throws a terminal payment.declined when the provider declines", async () => {
    const sink = new RecordingSink();
    const handler = createTransactionLifecycleHandler(
      provider({ status: "declined", capturedMinor: 0, providerReference: "pay_3" }),
      sink,
    );

    await expect(handler.execute(job, instant(1_000))).rejects.toMatchObject({
      errorClass: "payment.declined",
      retryable: false,
    });
    expect(sink.receipts).toHaveLength(0);
  });

  it("rejects an invalid payload terminally", async () => {
    const sink = new RecordingSink();
    const handler = createTransactionLifecycleHandler(
      provider({ status: "captured", capturedMinor: 1, providerReference: "x" }),
      sink,
    );

    await expect(
      handler.execute({ ...job, payload: { transactionId: "" } }, instant(1_000)),
    ).rejects.toBeInstanceOf(HandlerError);
  });
});
