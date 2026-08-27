import { describe, expect, it } from "vitest";

import type { MerchantId } from "@counter/domain";
import { createCounterId } from "@counter/domain";
import { createTestSignerA, TEST_KID_A } from "@counter/trust-protocol";
import {
  createMockGraphQLClient,
  DRAFT_ORDER_CREATE_MUTATION,
  DRAFT_ORDER_COMPLETE_MUTATION,
  ORDER_MARK_AS_PAID_MUTATION,
  ORDER_QUERY,
  DraftOrderCreateAction,
  DraftOrderQueryAction,
  OrderFinalizeAction,
  PaymentRecordAction,
  OrderQueryAction,
  OrderCancelAction,
  OrderRefundAction,
  type MockShopifyClient,
  type ShopifyConnector,
} from "@counter/shopify-connector";
import {
  MockRazorpayHttp,
  RazorpayTestProvider,
  type RazorpayOrder,
} from "@counter/razorpay-adapter";
import { CounterTestPaymentProvider } from "@counter/payment-sdk";

import { createRealPaymentAuthorizationPort } from "./real-lifecycle.js";
import {
  createTransactionLifecycleHandler,
  type HandledJob,
  type ReceiptSink,
  type TransactionReceipt,
} from "./transaction-lifecycle.js";
import { instantFromEpochMilliseconds, type Instant } from "@counter/domain";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function merchantId(): MerchantId {
  const result = createCounterId("merchant", new Uint8Array(16).fill(7));
  if (!result.ok) throw new Error("bad merchant id");
  return result.value;
}

function instant(ms: number): Instant {
  const result = instantFromEpochMilliseconds(ms);
  if (!result.ok) throw new Error("bad instant");
  return result.value;
}

function buildShopifyConnector(client: MockShopifyClient): ShopifyConnector {
  return {
    client,
    draftOrderCreate: new DraftOrderCreateAction(client),
    draftOrderQuery: new DraftOrderQueryAction(client),
    orderFinalize: new OrderFinalizeAction(client),
    paymentRecord: new PaymentRecordAction(client),
    orderQuery: new OrderQueryAction(client),
    orderCancel: new OrderCancelAction(client),
    orderRefund: new OrderRefundAction(client),
    health: undefined,
  };
}

function configureShopifySuccess(client: MockShopifyClient): void {
  client.setResponse(DRAFT_ORDER_CREATE_MUTATION, {
    data: {
      draftOrderCreate: {
        draftOrder: {
          id: "gid://shopify/DraftOrder/1",
          name: "#D1",
          status: "OPEN",
          totalPrice: "49.99",
          currencyCode: "INR",
          createdAt: "2025-01-01T00:00:00Z",
        },
        userErrors: [],
      },
    },
    errors: undefined,
    extensions: undefined,
  });
  client.setResponse(DRAFT_ORDER_COMPLETE_MUTATION, {
    data: {
      draftOrderComplete: {
        draftOrder: {
          order: {
            id: "gid://shopify/Order/9",
            name: "#1001",
            displayFinancialStatus: "PENDING",
            totalPriceSet: { shopMoney: { amount: "49.99", currencyCode: "INR" } },
            createdAt: "2025-01-01T00:00:01Z",
          },
        },
        userErrors: [],
      },
    },
    errors: undefined,
    extensions: undefined,
  });
  client.setResponse(ORDER_MARK_AS_PAID_MUTATION, {
    data: {
      orderMarkAsPaid: {
        order: {
          id: "gid://shopify/Order/9",
          displayFinancialStatus: "PAID",
          processedAt: "2025-01-01T00:00:02Z",
        },
        userErrors: [],
      },
    },
    errors: undefined,
    extensions: undefined,
  });
  client.setResponse(ORDER_QUERY, {
    data: {
      order: {
        id: "gid://shopify/Order/9",
        name: "#1001",
        displayFinancialStatus: "PAID",
        cancelledAt: null,
        totalPriceSet: { shopMoney: { amount: "49.99", currencyCode: "INR" } },
        createdAt: "2025-01-01T00:00:01Z",
        noteAttributes: [],
      },
    },
    errors: undefined,
    extensions: undefined,
  });
}

function razorpayOrder(id: string): RazorpayOrder {
  return {
    id,
    entity: "order",
    amount: 4999,
    amount_paid: 0,
    amount_due: 4999,
    currency: "INR",
    receipt: "r",
    status: "created",
    notes: {},
    created_at: 1,
  };
}

function buildRazorpay(http: MockRazorpayHttp): RazorpayTestProvider {
  return new RazorpayTestProvider({
    config: {
      keyId: "rzp_test_key",
      keySecret: "secret",
      webhookSecret: "whsecret",
      environment: "test",
      baseUrl: "https://api.razorpay.com/v1",
    },
    httpClient: http,
    clock: () => 1_000,
  });
}

function buildPayments(): CounterTestPaymentProvider {
  return new CounterTestPaymentProvider({
    environment: "test",
    signer: createTestSignerA(),
    kid: TEST_KID_A,
    clock: () => 1_000,
  });
}

class RecordingSink implements ReceiptSink {
  readonly receipts: TransactionReceipt[] = [];
  record(receipt: TransactionReceipt): Promise<void> {
    this.receipts.push(receipt);
    return Promise.resolve();
  }
}

const jobPayload = {
  transactionId: "order-abc",
  amountMinor: 4999,
  currency: "INR",
  variantId: "gid://shopify/ProductVariant/100",
  quantity: 1,
};

const job: HandledJob = {
  id: "ctr_job_x" as HandledJob["id"],
  type: "transaction.lifecycle",
  payload: jobPayload,
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("real connector lifecycle (mocked network)", () => {
  it("drives draft -> real razorpay order -> signed payment evidence -> finalize -> mark paid -> query -> reconcile -> receipt", async () => {
    const shopifyClient = createMockGraphQLClient();
    configureShopifySuccess(shopifyClient);
    const http = new MockRazorpayHttp();
    http.onCreateOrder(razorpayOrder("order_rzp_1"));

    const payments = buildPayments();

    const port = createRealPaymentAuthorizationPort({
      shopify: buildShopifyConnector(shopifyClient),
      razorpay: buildRazorpay(http),
      payments,
      merchantId: merchantId(),
      actionTimeoutMs: 5_000,
    });

    const sink = new RecordingSink();
    const handler = createTransactionLifecycleHandler(port, sink);

    await handler.execute(job, instant(1_000));

    // Lifecycle reached CLOSED with reconciliation matching intended amount.
    expect(sink.receipts).toHaveLength(1);
    const receipt = sink.receipts[0]!;
    expect(receipt.finalState.phase).toBe("CLOSED");
    expect(receipt.finalState.payment).toBe("captured");
    expect(receipt.finalState.order).toBe("committed");
    expect(receipt.reconciliation.reconciled).toBe(true);
    expect(receipt.reconciliation.providerAmountMinor).toBe(4999);

    // A REAL Razorpay order was created (proves the integration).
    const orderCreates = http.requests.filter((r) => r.path === "/v1/orders");
    expect(orderCreates).toHaveLength(1);
    expect(orderCreates[0]!.idempotencyKey).toBe("order-abc");

    // Provider reference carries provider ids (payment / shopify order / razorpay order),
    // NOT secrets.
    expect(receipt.providerReference).toContain("shopify_order:gid://shopify/Order/9");
    expect(receipt.providerReference).toContain("razorpay_order:order_rzp_1");
    expect(receipt.providerReference).not.toContain("secret");
    expect(receipt.providerReference).not.toContain("shpat_");

    // Payment evidence is typed + CTP-signed (query returns a confirmed envelope).
    const evidence = await payments.query(
      `test-auth-ref-order-abc` as Parameters<typeof payments.query>[0],
    );
    expect(evidence.status).toBe("confirmed");
    expect(evidence.providerData?.["envelope"]).toBeDefined();

    // Shopify received exactly one of each mutation.
    const drafts = shopifyClient.callHistory.filter((c) => c.operation === DRAFT_ORDER_CREATE_MUTATION);
    expect(drafts).toHaveLength(1);
  });

  it("is idempotent: replaying the same transaction creates at most one draft and one razorpay order", async () => {
    const shopifyClient = createMockGraphQLClient();
    configureShopifySuccess(shopifyClient);
    const http = new MockRazorpayHttp();
    http.onCreateOrder(razorpayOrder("order_rzp_1"));

    const port = createRealPaymentAuthorizationPort({
      shopify: buildShopifyConnector(shopifyClient),
      razorpay: buildRazorpay(http),
      payments: buildPayments(),
      merchantId: merchantId(),
      actionTimeoutMs: 5_000,
    });

    const request = {
      transactionId: (() => {
        const r = createCounterId("transaction", new Uint8Array(16).fill(3));
        if (!r.ok) throw new Error("bad txn id");
        return r.value;
      })(),
      amountMinor: 4999,
      currency: "INR",
      idempotencyKey: "order-abc",
      variantId: "gid://shopify/ProductVariant/100",
      quantity: 1,
    };

    const first = await port.authorizeAndCapture(request);
    const second = await port.authorizeAndCapture(request);

    expect(first.status).toBe("captured");
    expect(second.status).toBe("captured");
    // Same external reference returned on replay.
    expect(second.providerReference).toBe(first.providerReference);

    // At most ONE draft create and ONE razorpay order across both attempts.
    const drafts = shopifyClient.callHistory.filter((c) => c.operation === DRAFT_ORDER_CREATE_MUTATION);
    expect(drafts).toHaveLength(1);
    const finalizes = shopifyClient.callHistory.filter((c) => c.operation === DRAFT_ORDER_COMPLETE_MUTATION);
    expect(finalizes).toHaveLength(1);
    const orderCreates = http.requests.filter((r) => r.path === "/v1/orders");
    expect(orderCreates).toHaveLength(1);
  });

  it("surfaces a Shopify draft timeout as INDETERMINATE, not failed", async () => {
    const shopifyClient = createMockGraphQLClient();
    // No response configured + tiny timeout -> the action's timeout race fires.
    shopifyClient.setFault({ kind: "timeout", durationMs: 50 });
    const http = new MockRazorpayHttp();
    http.onCreateOrder(razorpayOrder("order_rzp_1"));

    const port = createRealPaymentAuthorizationPort({
      shopify: buildShopifyConnector(shopifyClient),
      razorpay: buildRazorpay(http),
      payments: buildPayments(),
      merchantId: merchantId(),
      actionTimeoutMs: 1,
    });

    const result = await port.authorizeAndCapture({
      transactionId: (() => {
        const r = createCounterId("transaction", new Uint8Array(16).fill(4));
        if (!r.ok) throw new Error("bad txn id");
        return r.value;
      })(),
      amountMinor: 4999,
      currency: "INR",
      idempotencyKey: "order-timeout",
      variantId: "gid://shopify/ProductVariant/100",
      quantity: 1,
    });

    expect(result.status).toBe("indeterminate");
    // No razorpay order should have been created before the draft resolved.
    const orderCreates = http.requests.filter((r) => r.path === "/v1/orders");
    expect(orderCreates).toHaveLength(0);
  });

  it("declines when the policy gate rejects", async () => {
    const shopifyClient = createMockGraphQLClient();
    configureShopifySuccess(shopifyClient);
    const http = new MockRazorpayHttp();
    http.onCreateOrder(razorpayOrder("order_rzp_1"));

    const port = createRealPaymentAuthorizationPort({
      shopify: buildShopifyConnector(shopifyClient),
      razorpay: buildRazorpay(http),
      payments: buildPayments(),
      merchantId: merchantId(),
      policy: { allow: (): Promise<boolean> => Promise.resolve(false) },
    });

    const result = await port.authorizeAndCapture({
      transactionId: (() => {
        const r = createCounterId("transaction", new Uint8Array(16).fill(5));
        if (!r.ok) throw new Error("bad txn id");
        return r.value;
      })(),
      amountMinor: 4999,
      currency: "INR",
      idempotencyKey: "order-denied",
    });

    expect(result.status).toBe("declined");
    // No external effects when policy denies.
    expect(shopifyClient.callHistory).toHaveLength(0);
    expect(http.requests).toHaveLength(0);
  });
});
