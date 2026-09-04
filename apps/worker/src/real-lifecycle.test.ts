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
import {
  SolanaSettlementProvider,
  encodeSolanaPaymentReference,
  type FixedDelegationCoordinates,
  type SolanaSettlementPort,
  type SolanaTransferOutcome,
} from "@counter/crypto-adapter";

import { createInMemoryStepLedger, createRealPaymentAuthorizationPort } from "./real-lifecycle.js";
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
    const drafts = shopifyClient.callHistory.filter(
      (c) => c.operation === DRAFT_ORDER_CREATE_MUTATION,
    );
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
    const drafts = shopifyClient.callHistory.filter(
      (c) => c.operation === DRAFT_ORDER_CREATE_MUTATION,
    );
    expect(drafts).toHaveLength(1);
    const finalizes = shopifyClient.callHistory.filter(
      (c) => c.operation === DRAFT_ORDER_COMPLETE_MUTATION,
    );
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

  it("blocks the checkout with ZERO external effect when a kill switch is active", async () => {
    const shopifyClient = createMockGraphQLClient();
    configureShopifySuccess(shopifyClient);
    const http = new MockRazorpayHttp();
    http.onCreateOrder(razorpayOrder("order_rzp_1"));

    const port = createRealPaymentAuthorizationPort({
      shopify: buildShopifyConnector(shopifyClient),
      razorpay: buildRazorpay(http),
      payments: buildPayments(),
      merchantId: merchantId(),
      // An active kill switch denies the checkout BEFORE any external effect.
      killSwitch: {
        blocked: (): Promise<string | undefined> => Promise.resolve("merchant:pilot"),
      },
    });

    const result = await port.authorizeAndCapture({
      transactionId: (() => {
        const r = createCounterId("transaction", new Uint8Array(16).fill(6));
        if (!r.ok) throw new Error("bad txn id");
        return r.value;
      })(),
      amountMinor: 4999,
      currency: "INR",
      idempotencyKey: "order-killed",
    });

    expect(result.status).toBe("declined");
    expect(result.providerReference).toBe("kill-switch-blocked:merchant:pilot");
    // ZERO external effect: no Shopify call and no Razorpay order.
    expect(shopifyClient.callHistory).toHaveLength(0);
    expect(http.requests).toHaveLength(0);
  });

  it("is consulted BEFORE the policy gate and short-circuits it", async () => {
    const shopifyClient = createMockGraphQLClient();
    configureShopifySuccess(shopifyClient);
    const http = new MockRazorpayHttp();
    http.onCreateOrder(razorpayOrder("order_rzp_1"));

    let policyConsulted = false;
    const port = createRealPaymentAuthorizationPort({
      shopify: buildShopifyConnector(shopifyClient),
      razorpay: buildRazorpay(http),
      payments: buildPayments(),
      merchantId: merchantId(),
      policy: {
        allow: (): Promise<boolean> => {
          policyConsulted = true;
          return Promise.resolve(true);
        },
      },
      killSwitch: {
        blocked: (): Promise<string | undefined> => Promise.resolve("platform"),
      },
    });

    const result = await port.authorizeAndCapture({
      transactionId: (() => {
        const r = createCounterId("transaction", new Uint8Array(16).fill(4));
        if (!r.ok) throw new Error("bad txn id");
        return r.value;
      })(),
      amountMinor: 4999,
      currency: "INR",
      idempotencyKey: "order-killed-first",
    });

    expect(result.status).toBe("declined");
    expect(result.providerReference).toBe("kill-switch-blocked:platform");
    // The kill switch short-circuits before the policy gate runs.
    expect(policyConsulted).toBe(false);
    expect(shopifyClient.callHistory).toHaveLength(0);
    expect(http.requests).toHaveLength(0);
  });

  it("allows the checkout when no kill switch is active (allow-all default preserved)", async () => {
    const shopifyClient = createMockGraphQLClient();
    configureShopifySuccess(shopifyClient);
    const http = new MockRazorpayHttp();
    http.onCreateOrder(razorpayOrder("order_rzp_1"));

    const port = createRealPaymentAuthorizationPort({
      shopify: buildShopifyConnector(shopifyClient),
      razorpay: buildRazorpay(http),
      payments: buildPayments(),
      merchantId: merchantId(),
      killSwitch: {
        blocked: (): Promise<string | undefined> => Promise.resolve(undefined),
      },
    });

    const result = await port.authorizeAndCapture({
      transactionId: (() => {
        const r = createCounterId("transaction", new Uint8Array(16).fill(3));
        if (!r.ok) throw new Error("bad txn id");
        return r.value;
      })(),
      amountMinor: 4999,
      currency: "INR",
      idempotencyKey: "order-allowed",
      variantId: "gid://shopify/ProductVariant/100",
    });

    expect(result.status).toBe("captured");
  });

  it("surfaces a Razorpay order timeout AFTER the draft as INDETERMINATE (not failed) and does not double-create", async () => {
    const shopifyClient = createMockGraphQLClient();
    configureShopifySuccess(shopifyClient);
    const http = new MockRazorpayHttp();
    // Simulate the REAL HTTP client's synthetic transport-timeout response: a
    // 503 whose body carries error.reason === "timeout". The request MAY have
    // reached Razorpay, so the outcome is INDETERMINATE, not a hard failure.
    let orderAttempts = 0;
    http.onPath("/v1/orders", () => {
      orderAttempts += 1;
      return {
        status: 503,
        body: {
          error: {
            code: "PROVIDER_UNAVAILABLE",
            reason: "timeout",
            description: "Razorpay request timed out; outcome is indeterminate",
          },
        },
      };
    });

    const port = createRealPaymentAuthorizationPort({
      shopify: buildShopifyConnector(shopifyClient),
      razorpay: buildRazorpay(http),
      payments: buildPayments(),
      merchantId: merchantId(),
      actionTimeoutMs: 5_000,
    });

    const request = {
      transactionId: (() => {
        const r = createCounterId("transaction", new Uint8Array(16).fill(6));
        if (!r.ok) throw new Error("bad txn id");
        return r.value;
      })(),
      amountMinor: 4999,
      currency: "INR",
      idempotencyKey: "order-rzp-timeout",
      variantId: "gid://shopify/ProductVariant/100",
      quantity: 1,
    };

    const result = await port.authorizeAndCapture(request);

    // The Razorpay leg produced an explicit INDETERMINATE outcome (invariant #2),
    // NOT a generic thrown/failed result.
    expect(result.status).toBe("indeterminate");
    expect(result.lastKnownState).toBe("razorpay.order.indeterminate");

    // The draft happened once; the payment/finalize/mark-paid legs did NOT run
    // after the indeterminate Razorpay outcome (no double external effect).
    const drafts = shopifyClient.callHistory.filter(
      (c) => c.operation === DRAFT_ORDER_CREATE_MUTATION,
    );
    expect(drafts).toHaveLength(1);
    const finalizes = shopifyClient.callHistory.filter(
      (c) => c.operation === DRAFT_ORDER_COMPLETE_MUTATION,
    );
    expect(finalizes).toHaveLength(0);

    // The indeterminate outcome is NOT cached, so a later replay can re-drive to
    // resolve the unknown state; the transport is hit exactly once here.
    expect(orderAttempts).toBe(1);
  });

  it("routes a Razorpay order timeout through the handler to INDETERMINATE with a recorded receipt", async () => {
    const shopifyClient = createMockGraphQLClient();
    configureShopifySuccess(shopifyClient);
    const http = new MockRazorpayHttp();
    http.onPath("/v1/orders", () => ({
      status: 503,
      body: {
        error: {
          code: "PROVIDER_UNAVAILABLE",
          reason: "timeout",
          description: "Razorpay request timed out; outcome is indeterminate",
        },
      },
    }));

    const port = createRealPaymentAuthorizationPort({
      shopify: buildShopifyConnector(shopifyClient),
      razorpay: buildRazorpay(http),
      payments: buildPayments(),
      merchantId: merchantId(),
      actionTimeoutMs: 5_000,
    });

    const sink = new RecordingSink();
    const handler = createTransactionLifecycleHandler(port, sink);

    // The handler surfaces INDETERMINATE as a RETRYABLE HandlerError, but only
    // AFTER recording a receipt in the INDETERMINATE phase (matching the Shopify
    // legs). It must NOT collapse to a hard/terminal failure.
    await expect(handler.execute(job, instant(1_000))).rejects.toMatchObject({
      errorClass: "payment.indeterminate",
      retryable: true,
    });
    expect(sink.receipts).toHaveLength(1);
    expect(sink.receipts[0]!.finalState.phase).toBe("INDETERMINATE");
  });

  it("carries the CTP-signed envelope into the recorded receipt (signedEvidence), not just a reference string", async () => {
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

    const sink = new RecordingSink();
    const handler = createTransactionLifecycleHandler(port, sink);
    await handler.execute(job, instant(1_000));

    expect(sink.receipts).toHaveLength(1);
    const receipt = sink.receipts[0]!;
    expect(receipt.finalState.phase).toBe("CLOSED");

    // The signed CTP envelope actually reached the receipt (issue #2 / invariant
    // #3): it is a real envelope object with a signature, not just the reference.
    const envelope = receipt.signedEvidence as
      | { readonly type?: string; readonly signature?: unknown; readonly payload?: unknown }
      | undefined;
    expect(envelope).toBeDefined();
    expect(envelope!.type).toBe("counter.evidence.v1");
    expect(envelope!.signature).toBeDefined();
    expect(envelope!.payload).toBeDefined();
    // And no secrets leaked into the receipt.
    expect(JSON.stringify(receipt)).not.toContain("secret");
    expect(JSON.stringify(receipt)).not.toContain("shpat_");
  });

  it("reconciles a genuine success even when the Shopify order total differs from the intended amount", async () => {
    const shopifyClient = createMockGraphQLClient();
    configureShopifySuccess(shopifyClient);
    // Override the order query so the Shopify order TOTAL (catalog-derived) is a
    // DIFFERENT value from the intended amount. This is the real-world case: the
    // variant price × qty is an independent input from payload.amountMinor.
    // Reconciliation must still succeed because it compares the amount actually
    // captured through the PAYMENT rail against intent, not the order total.
    shopifyClient.setResponse(ORDER_QUERY, {
      data: {
        order: {
          id: "gid://shopify/Order/9",
          name: "#1001",
          displayFinancialStatus: "PAID",
          cancelledAt: null,
          totalPriceSet: { shopMoney: { amount: "123.45", currencyCode: "INR" } },
          createdAt: "2025-01-01T00:00:01Z",
          noteAttributes: [],
        },
      },
      errors: undefined,
      extensions: undefined,
    });
    const http = new MockRazorpayHttp();
    http.onCreateOrder(razorpayOrder("order_rzp_1"));

    const port = createRealPaymentAuthorizationPort({
      shopify: buildShopifyConnector(shopifyClient),
      razorpay: buildRazorpay(http),
      payments: buildPayments(),
      merchantId: merchantId(),
      actionTimeoutMs: 5_000,
    });

    const sink = new RecordingSink();
    const handler = createTransactionLifecycleHandler(port, sink);
    await handler.execute(job, instant(1_000));

    expect(sink.receipts).toHaveLength(1);
    const receipt = sink.receipts[0]!;
    // Genuine success closes and reconciles (payment captured 4999 == intended
    // 4999) even though the Shopify order total is 12345 minor units.
    expect(receipt.finalState.phase).toBe("CLOSED");
    expect(receipt.reconciliation.reconciled).toBe(true);
    expect(receipt.reconciliation.providerAmountMinor).toBe(4999);
    expect(receipt.reconciliation.intendedAmountMinor).toBe(4999);
    // The order total is preserved as audit evidence on the reference.
    expect(receipt.providerReference).toContain("shopify_total_minor:12345");
  });
  it("resumes across a simulated crash: a shared durable ledger prevents a SECOND draft after a crash between draft and finalize", async () => {
    // A shared step ledger stands in for the durable (Postgres) ledger that
    // survives a worker restart. The first port instance crashes (finalize
    // fails -> INDETERMINATE) AFTER the draft succeeded and was recorded.
    const ledger = createInMemoryStepLedger();
    const request = {
      transactionId: (() => {
        const r = createCounterId("transaction", new Uint8Array(16).fill(9));
        if (!r.ok) throw new Error("bad txn id");
        return r.value;
      })(),
      amountMinor: 4999,
      currency: "INR",
      idempotencyKey: "order-crash-resume",
      variantId: "gid://shopify/ProductVariant/100",
      quantity: 1,
    };

    // ── Attempt A: draft succeeds, finalize FAILS -> INDETERMINATE (crash). ──
    const clientA = createMockGraphQLClient();
    configureShopifySuccess(clientA);
    // Force finalize to fail on attempt A (userErrors -> failed -> indeterminate).
    clientA.setResponse(DRAFT_ORDER_COMPLETE_MUTATION, {
      data: {
        draftOrderComplete: {
          draftOrder: { order: null },
          userErrors: [{ field: ["id"], message: "transient finalize failure" }],
        },
      },
      errors: undefined,
      extensions: undefined,
    });
    const httpA = new MockRazorpayHttp();
    httpA.onCreateOrder(razorpayOrder("order_rzp_1"));
    const portA = createRealPaymentAuthorizationPort({
      shopify: buildShopifyConnector(clientA),
      razorpay: buildRazorpay(httpA),
      payments: buildPayments(),
      merchantId: merchantId(),
      actionTimeoutMs: 5_000,
      stepLedger: ledger,
    });

    const first = await portA.authorizeAndCapture(request);
    expect(first.status).toBe("indeterminate");
    // The draft happened exactly once on attempt A and was recorded durably.
    const draftsA = clientA.callHistory.filter((c) => c.operation === DRAFT_ORDER_CREATE_MUTATION);
    expect(draftsA).toHaveLength(1);

    // ── Attempt B: FRESH port + FRESH connector (simulating a restart with a
    //    cleared in-memory dedup) but the SAME durable ledger + SAME key. ──
    const clientB = createMockGraphQLClient();
    configureShopifySuccess(clientB); // finalize now succeeds
    const httpB = new MockRazorpayHttp();
    httpB.onCreateOrder(razorpayOrder("order_rzp_1"));
    const portB = createRealPaymentAuthorizationPort({
      shopify: buildShopifyConnector(clientB),
      razorpay: buildRazorpay(httpB),
      payments: buildPayments(),
      merchantId: merchantId(),
      actionTimeoutMs: 5_000,
      stepLedger: ledger,
    });

    const second = await portB.authorizeAndCapture(request);
    expect(second.status).toBe("captured");

    // The RESUME guarantee: attempt B did NOT re-create the draft (it read the
    // recorded outcome from the durable ledger). It DID drive finalize (which
    // had not been recorded because attempt A left it indeterminate).
    const draftsB = clientB.callHistory.filter((c) => c.operation === DRAFT_ORDER_CREATE_MUTATION);
    expect(draftsB).toHaveLength(0);
    const finalizesB = clientB.callHistory.filter(
      (c) => c.operation === DRAFT_ORDER_COMPLETE_MUTATION,
    );
    expect(finalizesB).toHaveLength(1);

    // Across BOTH attempts, exactly ONE draft order was ever created.
    const totalDrafts = draftsA.length + draftsB.length;
    expect(totalDrafts).toBe(1);
    // The finalized order id is the one from attempt B's success.
    expect(second.providerReference).toContain("shopify_order:gid://shopify/Order/9");
  });

  it("replays every recorded Shopify leg from the durable ledger without re-driving any external effect", async () => {
    // A fully-recorded ledger (all three legs completed) must short-circuit
    // draft, finalize, AND mark-paid on a fresh port instance.
    const ledger = createInMemoryStepLedger();
    await ledger.record("order-replayed", {
      step: "shopify.draft",
      status: "completed",
      reference: "gid://shopify/DraftOrder/1",
    });
    await ledger.record("order-replayed", {
      step: "shopify.finalize",
      status: "completed",
      reference: "gid://shopify/Order/9",
    });
    await ledger.record("order-replayed", {
      step: "shopify.markPaid",
      status: "completed",
      reference: "gid://shopify/Order/9",
    });

    const client = createMockGraphQLClient();
    configureShopifySuccess(client);
    const http = new MockRazorpayHttp();
    http.onCreateOrder(razorpayOrder("order_rzp_1"));
    const port = createRealPaymentAuthorizationPort({
      shopify: buildShopifyConnector(client),
      razorpay: buildRazorpay(http),
      payments: buildPayments(),
      merchantId: merchantId(),
      actionTimeoutMs: 5_000,
      stepLedger: ledger,
    });

    const result = await port.authorizeAndCapture({
      transactionId: (() => {
        const r = createCounterId("transaction", new Uint8Array(16).fill(10));
        if (!r.ok) throw new Error("bad txn id");
        return r.value;
      })(),
      amountMinor: 4999,
      currency: "INR",
      idempotencyKey: "order-replayed",
      variantId: "gid://shopify/ProductVariant/100",
      quantity: 1,
    });

    expect(result.status).toBe("captured");
    // No draft/finalize/mark-paid were re-driven; only the authoritative query
    // (step 7) runs, which is a read, not a mutating external effect.
    expect(
      client.callHistory.filter((c) => c.operation === DRAFT_ORDER_CREATE_MUTATION),
    ).toHaveLength(0);
    expect(
      client.callHistory.filter((c) => c.operation === DRAFT_ORDER_COMPLETE_MUTATION),
    ).toHaveLength(0);
    expect(
      client.callHistory.filter((c) => c.operation === ORDER_MARK_AS_PAID_MUTATION),
    ).toHaveLength(0);
    expect(client.callHistory.filter((c) => c.operation === ORDER_QUERY)).toHaveLength(1);
  });

  it("pre-claim: a claim LOSER does not create a second draft and resumes from the winner's recorded outcome", async () => {
    // A shared durable ledger where the draft has ALREADY been claimed and
    // recorded by a prior winner. A fresh port instance (fresh connector, as a
    // second worker would have) must NOT call draftOrderCreate; it resolves the
    // draft reference from the durable ledger.
    const ledger = createInMemoryStepLedger();
    // Simulate the winner having claimed and recorded the draft.
    await ledger.claim!("order-preclaim", "shopify.draft");
    await ledger.record("order-preclaim", {
      step: "shopify.draft",
      status: "completed",
      reference: "gid://shopify/DraftOrder/1",
    });

    const client = createMockGraphQLClient();
    configureShopifySuccess(client);
    const http = new MockRazorpayHttp();
    http.onCreateOrder(razorpayOrder("order_rzp_1"));
    const port = createRealPaymentAuthorizationPort({
      shopify: buildShopifyConnector(client),
      razorpay: buildRazorpay(http),
      payments: buildPayments(),
      merchantId: merchantId(),
      actionTimeoutMs: 5_000,
      stepLedger: ledger,
    });

    const request = {
      transactionId: (() => {
        const r = createCounterId("transaction", new Uint8Array(16).fill(5));
        if (!r.ok) throw new Error("bad txn id");
        return r.value;
      })(),
      amountMinor: 4999,
      currency: "INR",
      idempotencyKey: "order-preclaim",
      variantId: "gid://shopify/ProductVariant/100",
      quantity: 1,
    };

    const result = await port.authorizeAndCapture(request);
    expect(result.status).toBe("captured");
    // The LOSER never created a draft — it reused the winner's durable reference.
    expect(
      client.callHistory.filter((c) => c.operation === DRAFT_ORDER_CREATE_MUTATION),
    ).toHaveLength(0);
    expect(result.providerReference).toContain("shopify_order:");
  });

  it("pre-claim: two ports racing the SAME key against one shared ledger call draftOrderCreate at most once", async () => {
    // Two separate port instances (distinct connectors, as two workers) share
    // ONE durable ledger. Only the claim winner may create the draft.
    const ledger = createInMemoryStepLedger();
    const request = {
      transactionId: (() => {
        const r = createCounterId("transaction", new Uint8Array(16).fill(6));
        if (!r.ok) throw new Error("bad txn id");
        return r.value;
      })(),
      amountMinor: 4999,
      currency: "INR",
      idempotencyKey: "order-preclaim-race",
      variantId: "gid://shopify/ProductVariant/100",
      quantity: 1,
    };

    const clientA = createMockGraphQLClient();
    configureShopifySuccess(clientA);
    const httpA = new MockRazorpayHttp();
    httpA.onCreateOrder(razorpayOrder("order_rzp_1"));
    const portA = createRealPaymentAuthorizationPort({
      shopify: buildShopifyConnector(clientA),
      razorpay: buildRazorpay(httpA),
      payments: buildPayments(),
      merchantId: merchantId(),
      actionTimeoutMs: 5_000,
      stepLedger: ledger,
    });

    const clientB = createMockGraphQLClient();
    configureShopifySuccess(clientB);
    const httpB = new MockRazorpayHttp();
    httpB.onCreateOrder(razorpayOrder("order_rzp_1"));
    const portB = createRealPaymentAuthorizationPort({
      shopify: buildShopifyConnector(clientB),
      razorpay: buildRazorpay(httpB),
      payments: buildPayments(),
      merchantId: merchantId(),
      actionTimeoutMs: 5_000,
      stepLedger: ledger,
    });

    const [a, b] = await Promise.all([
      portA.authorizeAndCapture(request),
      portB.authorizeAndCapture(request),
    ]);
    for (const outcome of [a, b]) {
      expect(["indeterminate", "captured"]).toContain(outcome.status);
    }

    const draftsA = clientA.callHistory.filter(
      (c) => c.operation === DRAFT_ORDER_CREATE_MUTATION,
    ).length;
    const draftsB = clientB.callHistory.filter(
      (c) => c.operation === DRAFT_ORDER_CREATE_MUTATION,
    ).length;
    // At most ONE real draftOrderCreate across the two racing instances.
    expect(draftsA + draftsB).toBe(1);
  });
});

// ─── Recurring payment mandate branch ─────────────────────────────────────────

describe("real connector lifecycle — recurring payment mandate branch", () => {
  const activeMandate = {
    status: "active" as const,
    validUntilMs: 10_000_000,
    ceilingMinor: 100_000n,
    eligibleMerchants: [] as readonly string[],
    providerCustomerId: "cust_fake001",
    providerTokenId: "token_fake001",
  };

  function recurringRequest(overrides: Record<string, unknown> = {}) {
    return {
      transactionId: (() => {
        const r = createCounterId("transaction", new Uint8Array(16).fill(9));
        if (!r.ok) throw new Error("bad txn id");
        return r.value;
      })(),
      amountMinor: 4999,
      currency: "INR",
      idempotencyKey: "recurring-order-abc",
      variantId: "gid://shopify/ProductVariant/100",
      quantity: 1,
      paymentReferenceId: "ctr_payment-reference_fake001",
      ...overrides,
    };
  }

  it("charges via chargeRecurring instead of creating a fresh Razorpay order, and still completes the real Shopify flow", async () => {
    const shopifyClient = createMockGraphQLClient();
    configureShopifySuccess(shopifyClient);
    const http = new MockRazorpayHttp(); // no /v1/orders handler configured — proves it's never called

    let chargeCalls = 0;
    const port = createRealPaymentAuthorizationPort({
      shopify: buildShopifyConnector(shopifyClient),
      razorpay: buildRazorpay(http),
      payments: buildPayments(),
      merchantId: merchantId(),
      actionTimeoutMs: 5_000,
      recurringMandateLookup: async () => activeMandate,
      recurringPayments: {
        chargeRecurring: async (params) => {
          chargeCalls += 1;
          expect(params.customerId).toBe("cust_fake001");
          expect(params.tokenId).toBe("token_fake001");
          expect(params.amountPaise).toBe(4999);
          return {
            kind: "confirmed",
            evidence: { reference: "pay_fake001" as never, status: "confirmed" },
          };
        },
      },
    });

    const result = await port.authorizeAndCapture(recurringRequest());

    expect(result.status).toBe("captured");
    expect(chargeCalls).toBe(1);
    // No fresh Razorpay order was ever created for this branch.
    expect(http.requests.filter((r) => r.path === "/v1/orders")).toHaveLength(0);
    // The real Shopify draft still happened — the recurring branch only
    // replaces the payment step, not the rest of the pipeline.
    const drafts = shopifyClient.callHistory.filter(
      (c) => c.operation === DRAFT_ORDER_CREATE_MUTATION,
    );
    expect(drafts).toHaveLength(1);
  });

  it("declines when no recurring provider/lookup is configured at all (fails closed)", async () => {
    const shopifyClient = createMockGraphQLClient();
    configureShopifySuccess(shopifyClient);
    const http = new MockRazorpayHttp();

    const port = createRealPaymentAuthorizationPort({
      shopify: buildShopifyConnector(shopifyClient),
      razorpay: buildRazorpay(http),
      payments: buildPayments(),
      merchantId: merchantId(),
      actionTimeoutMs: 5_000,
      // recurringPayments/recurringMandateLookup intentionally omitted
    });

    const result = await port.authorizeAndCapture(recurringRequest());
    expect(result.status).toBe("declined");
  });

  it("declines when the independent mandate lookup finds no active mandate, without calling chargeRecurring", async () => {
    const shopifyClient = createMockGraphQLClient();
    configureShopifySuccess(shopifyClient);
    const http = new MockRazorpayHttp();

    let chargeCalls = 0;
    const port = createRealPaymentAuthorizationPort({
      shopify: buildShopifyConnector(shopifyClient),
      razorpay: buildRazorpay(http),
      payments: buildPayments(),
      merchantId: merchantId(),
      actionTimeoutMs: 5_000,
      recurringMandateLookup: async () => undefined,
      recurringPayments: {
        chargeRecurring: async () => {
          chargeCalls += 1;
          return { kind: "confirmed", evidence: { reference: "x" as never, status: "confirmed" } };
        },
      },
    });

    const result = await port.authorizeAndCapture(recurringRequest());
    expect(result.status).toBe("declined");
    expect(chargeCalls).toBe(0);
  });

  it("declines when chargeRecurring itself declines", async () => {
    const shopifyClient = createMockGraphQLClient();
    configureShopifySuccess(shopifyClient);
    const http = new MockRazorpayHttp();

    const port = createRealPaymentAuthorizationPort({
      shopify: buildShopifyConnector(shopifyClient),
      razorpay: buildRazorpay(http),
      payments: buildPayments(),
      merchantId: merchantId(),
      actionTimeoutMs: 5_000,
      recurringMandateLookup: async () => activeMandate,
      recurringPayments: {
        chargeRecurring: async () => ({
          kind: "declined",
          reason: { code: "INSUFFICIENT_FUNDS", reason: "declined", retryable: false },
        }),
      },
    });

    const result = await port.authorizeAndCapture(recurringRequest());
    expect(result.status).toBe("declined");
  });
});

describe("real connector lifecycle — Solana devnet settlement branch", () => {
  const coordinates: FixedDelegationCoordinates = {
    subscriptionAuthorityPda: "DjmxNyCj9ahQRPD1zU4zNZmEXbafCeEpruMHFmkTzBo",
    fixedDelegationPda: "DjmxNyCj9ahQRPD1zU4zNZmEXbafCeEpruMHFmkTzBo",
    delegatorAddress: "DjmxNyCj9ahQRPD1zU4zNZmEXbafCeEpruMHFmkTzBo",
    delegatorAta: "DjmxNyCj9ahQRPD1zU4zNZmEXbafCeEpruMHFmkTzBo",
    delegateeAddress: "DjmxNyCj9ahQRPD1zU4zNZmEXbafCeEpruMHFmkTzBo",
    tokenMint: "So11111111111111111111111111111111111111112",
  };
  const merchantReceivingAddress = "DjmxNyCj9ahQRPD1zU4zNZmEXbafCeEpruMHFmkTzBo";

  function solanaRequest(overrides: Record<string, unknown> = {}) {
    return {
      transactionId: (() => {
        const r = createCounterId("transaction", new Uint8Array(16).fill(11));
        if (!r.ok) throw new Error("bad txn id");
        return r.value;
      })(),
      amountMinor: 4999,
      currency: "INR",
      idempotencyKey: "solana-order-abc",
      variantId: "gid://shopify/ProductVariant/100",
      quantity: 1,
      paymentReferenceId: encodeSolanaPaymentReference(coordinates),
      ...overrides,
    };
  }

  function mockSolanaPort(outcome: SolanaTransferOutcome): SolanaSettlementPort {
    return {
      transferFixed: async () => outcome,
      getSignatureStatus: async () => "confirmed",
    };
  }

  it("settles via the Solana provider instead of creating a Razorpay order, and still completes the real Shopify flow", async () => {
    const shopifyClient = createMockGraphQLClient();
    configureShopifySuccess(shopifyClient);
    const http = new MockRazorpayHttp(); // no /v1/orders handler configured — proves it's never called

    const port = createRealPaymentAuthorizationPort({
      shopify: buildShopifyConnector(shopifyClient),
      razorpay: buildRazorpay(http),
      payments: buildPayments(),
      merchantId: merchantId(),
      actionTimeoutMs: 5_000,
      solanaSettlement: {
        provider: new SolanaSettlementProvider({
          port: mockSolanaPort({ kind: "landed", signature: "5xyzSignatureFake" }),
        }),
        merchantReceivingAddress,
      },
    });

    const result = await port.authorizeAndCapture(solanaRequest());

    expect(result.status).toBe("captured");
    // No fresh Razorpay order was ever created for this branch.
    expect(http.requests.filter((r) => r.path === "/v1/orders")).toHaveLength(0);
    // The real Shopify draft still happened — this branch only replaces the
    // payment step, not the rest of the pipeline.
    const drafts = shopifyClient.callHistory.filter(
      (c) => c.operation === DRAFT_ORDER_CREATE_MUTATION,
    );
    expect(drafts).toHaveLength(1);
  });

  it("declines when no Solana settlement provider is configured at all (fails closed)", async () => {
    const shopifyClient = createMockGraphQLClient();
    configureShopifySuccess(shopifyClient);
    const http = new MockRazorpayHttp();

    const port = createRealPaymentAuthorizationPort({
      shopify: buildShopifyConnector(shopifyClient),
      razorpay: buildRazorpay(http),
      payments: buildPayments(),
      merchantId: merchantId(),
      actionTimeoutMs: 5_000,
      // solanaSettlement intentionally omitted
    });

    const result = await port.authorizeAndCapture(solanaRequest());
    expect(result.status).toBe("declined");
  });

  it("declines when the payment reference decodes to nothing (malformed/foreign reference)", async () => {
    const shopifyClient = createMockGraphQLClient();
    configureShopifySuccess(shopifyClient);
    const http = new MockRazorpayHttp();

    const port = createRealPaymentAuthorizationPort({
      shopify: buildShopifyConnector(shopifyClient),
      razorpay: buildRazorpay(http),
      payments: buildPayments(),
      merchantId: merchantId(),
      actionTimeoutMs: 5_000,
      solanaSettlement: {
        provider: new SolanaSettlementProvider({
          port: mockSolanaPort({ kind: "landed", signature: "should-never-be-called" }),
        }),
        merchantReceivingAddress,
      },
    });

    const result = await port.authorizeAndCapture(
      solanaRequest({ paymentReferenceId: "solana-mandate:not-valid-base64json!!!" }),
    );
    expect(result.status).toBe("declined");
  });

  it("declines when the on-chain transfer is declined (e.g. exceeds the remaining cap)", async () => {
    const shopifyClient = createMockGraphQLClient();
    configureShopifySuccess(shopifyClient);
    const http = new MockRazorpayHttp();

    const port = createRealPaymentAuthorizationPort({
      shopify: buildShopifyConnector(shopifyClient),
      razorpay: buildRazorpay(http),
      payments: buildPayments(),
      merchantId: merchantId(),
      actionTimeoutMs: 5_000,
      solanaSettlement: {
        provider: new SolanaSettlementProvider({
          port: mockSolanaPort({ kind: "declined", reason: "AMOUNT_EXCEEDS_LIMIT" }),
        }),
        merchantReceivingAddress,
      },
    });

    const result = await port.authorizeAndCapture(solanaRequest());
    expect(result.status).toBe("declined");
  });

  it("returns indeterminate (never declined) when the transfer's outcome is uncertain", async () => {
    const shopifyClient = createMockGraphQLClient();
    configureShopifySuccess(shopifyClient);
    const http = new MockRazorpayHttp();

    const port = createRealPaymentAuthorizationPort({
      shopify: buildShopifyConnector(shopifyClient),
      razorpay: buildRazorpay(http),
      payments: buildPayments(),
      merchantId: merchantId(),
      actionTimeoutMs: 5_000,
      solanaSettlement: {
        provider: new SolanaSettlementProvider({
          port: mockSolanaPort({ kind: "indeterminate", reason: "RPC transport error" }),
        }),
        merchantReceivingAddress,
      },
    });

    const result = await port.authorizeAndCapture(solanaRequest());
    expect(result.status).toBe("indeterminate");
  });

  it("a plain Razorpay one-shot request (no paymentReferenceId) is completely unaffected", async () => {
    const shopifyClient = createMockGraphQLClient();
    configureShopifySuccess(shopifyClient);
    const http = new MockRazorpayHttp();
    http.onCreateOrder(razorpayOrder("order_rzp_1"));

    let solanaCalls = 0;
    const port = createRealPaymentAuthorizationPort({
      shopify: buildShopifyConnector(shopifyClient),
      razorpay: buildRazorpay(http),
      payments: buildPayments(),
      merchantId: merchantId(),
      actionTimeoutMs: 5_000,
      solanaSettlement: {
        provider: new SolanaSettlementProvider({
          port: {
            transferFixed: async () => {
              solanaCalls += 1;
              return { kind: "landed", signature: "must-not-be-called" };
            },
            getSignatureStatus: async () => "confirmed",
          },
        }),
        merchantReceivingAddress,
      },
    });

    await port.authorizeAndCapture({
      transactionId: (() => {
        const r = createCounterId("transaction", new Uint8Array(16).fill(12));
        if (!r.ok) throw new Error("bad txn id");
        return r.value;
      })(),
      amountMinor: 4999,
      currency: "INR",
      idempotencyKey: "plain-razorpay-order",
      variantId: "gid://shopify/ProductVariant/100",
      quantity: 1,
      // paymentReferenceId intentionally omitted — this is the existing
      // one-shot Razorpay path, must route there exactly as before.
    });

    expect(solanaCalls).toBe(0);
    expect(http.requests.filter((r) => r.path === "/v1/orders")).toHaveLength(1);
  });
});
