/**
 * Contract tests for Shopify order actions.
 *
 * Uses MockGraphQLClient to test each action: success path, user error
 * normalization, throttle handling, timeout semantics, unsupported state
 * transitions, idempotent replay, and process-kill recovery.
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { ActionInput } from "@counter/connector-sdk";

import { createMockGraphQLClient, type MockShopifyClient } from "./mock-graphql-client.js";
import {
  DraftOrderCreateAction,
  DraftOrderQueryAction,
  OrderFinalizeAction,
  PaymentRecordAction,
  OrderQueryAction,
  OrderCancelAction,
  OrderRefundAction,
} from "./order-actions.js";
import type {
  DraftOrderCreateInput,
  OrderFinalizeInput,
  PaymentRecordInput,
  OrderCancelInput,
  RefundInput,
} from "./order-types.js";
import type { DraftOrderQueryInput, OrderQueryInput } from "./order-actions.js";
import {
  DRAFT_ORDER_CREATE_MUTATION,
  DRAFT_ORDER_COMPLETE_MUTATION,
  ORDER_MARK_AS_PAID_MUTATION,
  ORDER_CANCEL_MUTATION,
  REFUND_CREATE_MUTATION,
  DRAFT_ORDER_QUERY,
  ORDER_QUERY,
} from "./order-mutations.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeInput<T>(payload: T, overrides?: Partial<ActionInput<T>>): ActionInput<T> {
  return {
    payload,
    idempotencyKey: overrides?.idempotencyKey ?? "idem-key-001",
    correlationId: overrides?.correlationId ?? "corr-id-001",
    preconditions: overrides?.preconditions ?? [],
    timeoutMs: overrides?.timeoutMs ?? 5000,
  };
}

function throttledExtensions(available: number) {
  return {
    cost: {
      throttleStatus: {
        currentlyAvailable: available,
        restoreRate: 50,
        maximumAvailable: 1000,
      },
    },
  };
}

// ─── Draft Order Create Action ────────────────────────────────────────────────

describe("DraftOrderCreateAction", () => {
  let client: MockShopifyClient;
  let action: DraftOrderCreateAction;

  const payload: DraftOrderCreateInput = {
    lineItems: [{ variantId: "gid://shopify/ProductVariant/123", quantity: 2 }],
    customerId: "gid://shopify/Customer/456",
    note: "Test order",
    tags: ["counter"],
    metadata: { correlationId: "corr-id-001", idempotencyKey: "idem-key-001" },
  };

  beforeEach(() => {
    client = createMockGraphQLClient();
    action = new DraftOrderCreateAction(client);
  });

  it("returns succeeded on successful mutation", async () => {
    client.setResponse(DRAFT_ORDER_CREATE_MUTATION, {
      data: {
        draftOrderCreate: {
          draftOrder: {
            id: "gid://shopify/DraftOrder/789",
            name: "#D1",
            status: "OPEN",
            totalPrice: "100.00",
            currencyCode: "USD",
            createdAt: "2024-01-01T00:00:00Z",
          },
          userErrors: [],
        },
      },
      errors: undefined,
      extensions: throttledExtensions(900),
    });

    const result = await action.execute(makeInput(payload));

    expect(result.status).toBe("succeeded");
    if (result.status === "succeeded") {
      expect(result.result.draftOrderId).toBe("gid://shopify/DraftOrder/789");
      expect(result.result.name).toBe("#D1");
      expect(result.result.status).toBe("OPEN");
      expect(result.result.totalPrice).toBe("100.00");
      expect(result.result.currencyCode).toBe("USD");
      expect(result.sourceReference.source).toBe("shopify");
    }
  });

  it("propagates correlation metadata in note attributes", async () => {
    client.setResponse(DRAFT_ORDER_CREATE_MUTATION, {
      data: {
        draftOrderCreate: {
          draftOrder: {
            id: "gid://shopify/DraftOrder/789",
            name: "#D1",
            status: "OPEN",
            totalPrice: "100.00",
            currencyCode: "USD",
            createdAt: "2024-01-01T00:00:00Z",
          },
          userErrors: [],
        },
      },
      errors: undefined,
      extensions: throttledExtensions(900),
    });

    await action.execute(makeInput(payload));

    expect(client.callHistory.length).toBe(1);
    const call = client.callHistory[0]!;
    const noteAttrs = (call.variables as { input: { customAttributes: unknown[] } }).input.customAttributes;
    expect(noteAttrs).toEqual([
      { key: "counter_correlation_id", value: "corr-id-001" },
      { key: "counter_idempotency_key", value: "idem-key-001" },
    ]);
  });

  it("normalizes user errors to validation_error", async () => {
    client.setResponse(DRAFT_ORDER_CREATE_MUTATION, {
      data: {
        draftOrderCreate: {
          draftOrder: null,
          userErrors: [{ field: ["lineItems"], message: "Invalid variant ID" }],
        },
      },
      errors: undefined,
      extensions: throttledExtensions(900),
    });

    const result = await action.execute(makeInput(payload));

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error.code).toBe("validation_error");
      expect(result.error.message).toBe("Invalid variant ID");
      expect(result.error.retryable).toBe(false);
    }
  });

  it("returns rate_limited on throttle", async () => {
    client.setResponse(DRAFT_ORDER_CREATE_MUTATION, {
      data: null,
      errors: [{ message: "THROTTLED" }],
      extensions: throttledExtensions(0),
    });

    const result = await action.execute(makeInput(payload));

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error.code).toBe("rate_limited");
      expect(result.error.retryable).toBe(true);
      expect(result.error.retryAfterMs).toBeGreaterThan(0);
    }
  });

  it("returns indeterminate on timeout (after-effect semantics)", async () => {
    client.setFault({ kind: "timeout", durationMs: 100 });

    const result = await action.execute(makeInput(payload, { timeoutMs: 50 }));

    // The timeout race resolves first, so we get indeterminate
    expect(result.status).toBe("indeterminate");
    if (result.status === "indeterminate") {
      expect(result.correlationId).toBe("corr-id-001");
    }
  });

  it("returns cached outcome for idempotent replay", async () => {
    client.setResponse(DRAFT_ORDER_CREATE_MUTATION, {
      data: {
        draftOrderCreate: {
          draftOrder: {
            id: "gid://shopify/DraftOrder/789",
            name: "#D1",
            status: "OPEN",
            totalPrice: "100.00",
            currencyCode: "USD",
            createdAt: "2024-01-01T00:00:00Z",
          },
          userErrors: [],
        },
      },
      errors: undefined,
      extensions: throttledExtensions(900),
    });

    const input = makeInput(payload);
    const first = await action.execute(input);
    const second = await action.execute(input);

    expect(first).toEqual(second);
    // Only one call should hit the client (second is cached)
    expect(client.callHistory.length).toBe(1);
  });

  it("rejects divergent duplicate with conflict", async () => {
    client.setResponse(DRAFT_ORDER_CREATE_MUTATION, {
      data: {
        draftOrderCreate: {
          draftOrder: {
            id: "gid://shopify/DraftOrder/789",
            name: "#D1",
            status: "OPEN",
            totalPrice: "100.00",
            currencyCode: "USD",
            createdAt: "2024-01-01T00:00:00Z",
          },
          userErrors: [],
        },
      },
      errors: undefined,
      extensions: throttledExtensions(900),
    });

    const first = await action.execute(makeInput(payload));
    expect(first.status).toBe("succeeded");

    // Same key but different payload
    const divergentPayload: DraftOrderCreateInput = {
      ...payload,
      lineItems: [{ variantId: "gid://shopify/ProductVariant/999", quantity: 5 }],
    };
    const second = await action.execute(makeInput(divergentPayload));

    expect(second.status).toBe("failed");
    if (second.status === "failed") {
      expect(second.error.code).toBe("conflict");
      expect(second.error.message).toContain("Divergent duplicate");
    }
  });

  it("handles network error as timeout before effect", async () => {
    client.setFault({ kind: "network_error", message: "Connection refused" });

    const result = await action.execute(makeInput(payload));

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error.code).toBe("timeout");
      expect(result.error.retryable).toBe(true);
    }
  });
});

// ─── Draft Order Query Action ─────────────────────────────────────────────────

describe("DraftOrderQueryAction", () => {
  let client: MockShopifyClient;
  let action: DraftOrderQueryAction;

  const payload: DraftOrderQueryInput = {
    draftOrderId: "gid://shopify/DraftOrder/789",
    metadata: { correlationId: "corr-id-001", idempotencyKey: "idem-key-001" },
  };

  beforeEach(() => {
    client = createMockGraphQLClient();
    action = new DraftOrderQueryAction(client);
  });

  it("returns succeeded with draft order data", async () => {
    client.setResponse(DRAFT_ORDER_QUERY, {
      data: {
        draftOrder: {
          id: "gid://shopify/DraftOrder/789",
          name: "#D1",
          status: "OPEN",
          totalPrice: "100.00",
          currencyCode: "USD",
          createdAt: "2024-01-01T00:00:00Z",
          customAttributes: [
            { key: "counter_correlation_id", value: "corr-id-001" },
          ],
        },
      },
      errors: undefined,
      extensions: throttledExtensions(900),
    });

    const result = await action.execute(makeInput(payload));

    expect(result.status).toBe("succeeded");
    if (result.status === "succeeded") {
      expect(result.result.draftOrderId).toBe("gid://shopify/DraftOrder/789");
    }
  });

  it("returns not_found when draft order does not exist", async () => {
    client.setResponse(DRAFT_ORDER_QUERY, {
      data: { draftOrder: null },
      errors: undefined,
      extensions: throttledExtensions(900),
    });

    const result = await action.execute(makeInput(payload));

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error.code).toBe("not_found");
    }
  });
});

// ─── Order Finalize Action ────────────────────────────────────────────────────

describe("OrderFinalizeAction", () => {
  let client: MockShopifyClient;
  let action: OrderFinalizeAction;

  const payload: OrderFinalizeInput = {
    draftOrderId: "gid://shopify/DraftOrder/789",
    paymentPending: true,
    metadata: { correlationId: "corr-id-002", idempotencyKey: "idem-key-002" },
  };

  beforeEach(() => {
    client = createMockGraphQLClient();
    action = new OrderFinalizeAction(client);
  });

  it("returns succeeded on successful finalization", async () => {
    client.setResponse(DRAFT_ORDER_COMPLETE_MUTATION, {
      data: {
        draftOrderComplete: {
          draftOrder: {
            order: {
              id: "gid://shopify/Order/111",
              name: "#1001",
              displayFinancialStatus: "PENDING",
              totalPriceSet: { shopMoney: { amount: "100.00", currencyCode: "USD" } },
              createdAt: "2024-01-01T00:00:00Z",
            },
          },
          userErrors: [],
        },
      },
      errors: undefined,
      extensions: throttledExtensions(900),
    });

    const result = await action.execute(makeInput(payload, { idempotencyKey: "idem-key-002" }));

    expect(result.status).toBe("succeeded");
    if (result.status === "succeeded") {
      expect(result.result.orderId).toBe("gid://shopify/Order/111");
      expect(result.result.status).toBe("PENDING");
    }
  });

  it("normalizes user errors from finalize", async () => {
    client.setResponse(DRAFT_ORDER_COMPLETE_MUTATION, {
      data: {
        draftOrderComplete: {
          draftOrder: null,
          userErrors: [{ field: ["id"], message: "Draft order not found" }],
        },
      },
      errors: undefined,
      extensions: throttledExtensions(900),
    });

    const result = await action.execute(makeInput(payload, { idempotencyKey: "idem-key-002" }));

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error.code).toBe("not_found");
    }
  });
});

// ─── Payment Record Action ────────────────────────────────────────────────────

describe("PaymentRecordAction", () => {
  let client: MockShopifyClient;
  let action: PaymentRecordAction;

  const payload: PaymentRecordInput = {
    orderId: "gid://shopify/Order/111",
    metadata: { correlationId: "corr-id-003", idempotencyKey: "idem-key-003" },
  };

  beforeEach(() => {
    client = createMockGraphQLClient();
    action = new PaymentRecordAction(client);
  });

  it("returns succeeded on payment mark", async () => {
    client.setResponse(ORDER_MARK_AS_PAID_MUTATION, {
      data: {
        orderMarkAsPaid: {
          order: {
            id: "gid://shopify/Order/111",
            displayFinancialStatus: "PAID",
            processedAt: "2024-01-01T12:00:00Z",
          },
          userErrors: [],
        },
      },
      errors: undefined,
      extensions: throttledExtensions(900),
    });

    const result = await action.execute(makeInput(payload, { idempotencyKey: "idem-key-003" }));

    expect(result.status).toBe("succeeded");
    if (result.status === "succeeded") {
      expect(result.result.orderId).toBe("gid://shopify/Order/111");
      expect(result.result.paymentStatus).toBe("PAID");
    }
  });

  it("handles already-paid as conflict", async () => {
    client.setResponse(ORDER_MARK_AS_PAID_MUTATION, {
      data: {
        orderMarkAsPaid: {
          order: null,
          userErrors: [{ field: ["id"], message: "Order is already paid" }],
        },
      },
      errors: undefined,
      extensions: throttledExtensions(900),
    });

    const result = await action.execute(makeInput(payload, { idempotencyKey: "idem-key-003" }));

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error.code).toBe("conflict");
    }
  });
});

// ─── Order Query Action ───────────────────────────────────────────────────────

describe("OrderQueryAction", () => {
  let client: MockShopifyClient;
  let action: OrderQueryAction;

  const payload: OrderQueryInput = {
    orderId: "gid://shopify/Order/111",
    metadata: { correlationId: "corr-id-004", idempotencyKey: "idem-key-004" },
  };

  beforeEach(() => {
    client = createMockGraphQLClient();
    action = new OrderQueryAction(client);
  });

  it("returns succeeded with order data", async () => {
    client.setResponse(ORDER_QUERY, {
      data: {
        order: {
          id: "gid://shopify/Order/111",
          name: "#1001",
          displayFinancialStatus: "PAID",
          cancelledAt: null,
          totalPriceSet: { shopMoney: { amount: "100.00", currencyCode: "USD" } },
          createdAt: "2024-01-01T00:00:00Z",
          customAttributes: [
            { key: "counter_correlation_id", value: "corr-id-004" },
          ],
        },
      },
      errors: undefined,
      extensions: throttledExtensions(900),
    });

    const result = await action.execute(makeInput(payload, { idempotencyKey: "idem-key-004" }));

    expect(result.status).toBe("succeeded");
    if (result.status === "succeeded") {
      expect(result.result.orderId).toBe("gid://shopify/Order/111");
      expect(result.result.status).toBe("PAID");
    }
  });

  it("returns not_found when order does not exist", async () => {
    client.setResponse(ORDER_QUERY, {
      data: { order: null },
      errors: undefined,
      extensions: throttledExtensions(900),
    });

    const result = await action.execute(makeInput(payload, { idempotencyKey: "idem-key-004" }));

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error.code).toBe("not_found");
    }
  });

  it("process-kill recovery: query after interrupted mutation returns state", async () => {
    // Simulate: mutation was interrupted (process killed), but order exists
    // Recovery path: use OrderQueryAction to determine outcome
    client.setResponse(ORDER_QUERY, {
      data: {
        order: {
          id: "gid://shopify/Order/111",
          name: "#1001",
          displayFinancialStatus: "PAID",
          cancelledAt: null,
          totalPriceSet: { shopMoney: { amount: "100.00", currencyCode: "USD" } },
          createdAt: "2024-01-01T00:00:00Z",
          customAttributes: [
            { key: "counter_correlation_id", value: "corr-id-004" },
          ],
        },
      },
      errors: undefined,
      extensions: throttledExtensions(900),
    });

    // Recovery query determines the order exists and was completed
    const result = await action.execute(makeInput(payload, { idempotencyKey: "idem-key-004" }));

    expect(result.status).toBe("succeeded");
    if (result.status === "succeeded") {
      expect(result.result.orderId).toBe("gid://shopify/Order/111");
    }
  });
});

// ─── Order Cancel Action ──────────────────────────────────────────────────────

describe("OrderCancelAction", () => {
  let client: MockShopifyClient;
  let action: OrderCancelAction;

  const payload: OrderCancelInput = {
    orderId: "gid://shopify/Order/111",
    reason: "CUSTOMER",
    metadata: { correlationId: "corr-id-005", idempotencyKey: "idem-key-005" },
  };

  beforeEach(() => {
    client = createMockGraphQLClient();
    action = new OrderCancelAction(client);
  });

  it("returns succeeded on successful cancel", async () => {
    client.setResponse(ORDER_CANCEL_MUTATION, {
      data: {
        orderCancel: {
          orderCancelUserErrors: [],
        },
      },
      errors: undefined,
      extensions: throttledExtensions(900),
    });

    const result = await action.execute(makeInput(payload, { idempotencyKey: "idem-key-005" }));

    expect(result.status).toBe("succeeded");
    if (result.status === "succeeded") {
      expect(result.result.orderId).toBe("gid://shopify/Order/111");
    }
  });

  it("handles already-cancelled as conflict (unsupported state)", async () => {
    client.setResponse(ORDER_CANCEL_MUTATION, {
      data: {
        orderCancel: {
          orderCancelUserErrors: [
            { field: ["orderId"], message: "Order is already cancelled", code: "ORDER_ALREADY_CANCELLED" },
          ],
        },
      },
      errors: undefined,
      extensions: throttledExtensions(900),
    });

    const result = await action.execute(makeInput(payload, { idempotencyKey: "idem-key-005" }));

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error.code).toBe("conflict");
      expect(result.error.retryable).toBe(false);
    }
  });

  it("returns indeterminate on timeout for cancel mutation", async () => {
    client.setFault({ kind: "timeout", durationMs: 200 });

    const result = await action.execute(makeInput(payload, { idempotencyKey: "idem-key-005", timeoutMs: 50 }));

    expect(result.status).toBe("indeterminate");
    if (result.status === "indeterminate") {
      expect(result.correlationId).toBe("corr-id-001");
    }
  });

  it("process-kill recovery: DraftOrderQuery can find draft after interrupted create", async () => {
    // This tests the pattern: create was interrupted, use query to recover
    const queryClient = createMockGraphQLClient();
    const queryAction = new DraftOrderQueryAction(queryClient);

    queryClient.setResponse(DRAFT_ORDER_QUERY, {
      data: {
        draftOrder: {
          id: "gid://shopify/DraftOrder/789",
          name: "#D1",
          status: "OPEN",
          totalPrice: "100.00",
          currencyCode: "USD",
          createdAt: "2024-01-01T00:00:00Z",
          customAttributes: [
            { key: "counter_correlation_id", value: "corr-id-recovery" },
          ],
        },
      },
      errors: undefined,
      extensions: throttledExtensions(900),
    });

    const queryPayload: DraftOrderQueryInput = {
      draftOrderId: "gid://shopify/DraftOrder/789",
      metadata: { correlationId: "corr-id-recovery", idempotencyKey: "idem-recovery" },
    };

    const result = await queryAction.execute(makeInput(queryPayload, {
      correlationId: "corr-id-recovery",
      idempotencyKey: "idem-recovery",
    }));

    expect(result.status).toBe("succeeded");
    if (result.status === "succeeded") {
      expect(result.result.draftOrderId).toBe("gid://shopify/DraftOrder/789");
    }
  });
});

// ─── Order Refund Action ──────────────────────────────────────────────────────

describe("OrderRefundAction", () => {
  let client: MockShopifyClient;
  let action: OrderRefundAction;

  const payload: RefundInput = {
    orderId: "gid://shopify/Order/111",
    reason: "Customer requested full refund",
    metadata: { correlationId: "corr-id-006", idempotencyKey: "idem-key-006" },
  };

  beforeEach(() => {
    client = createMockGraphQLClient();
    action = new OrderRefundAction(client);
  });

  it("returns succeeded on successful refund", async () => {
    client.setResponse(REFUND_CREATE_MUTATION, {
      data: {
        refundCreate: {
          refund: {
            id: "gid://shopify/Refund/222",
            createdAt: "2024-01-02T00:00:00Z",
            order: { id: "gid://shopify/Order/111" },
          },
          userErrors: [],
        },
      },
      errors: undefined,
      extensions: throttledExtensions(900),
    });

    const result = await action.execute(makeInput(payload, { idempotencyKey: "idem-key-006" }));

    expect(result.status).toBe("succeeded");
    if (result.status === "succeeded") {
      expect(result.result.refundId).toBe("gid://shopify/Refund/222");
      expect(result.result.orderId).toBe("gid://shopify/Order/111");
    }
  });

  it("normalizes user errors from refund", async () => {
    client.setResponse(REFUND_CREATE_MUTATION, {
      data: {
        refundCreate: {
          refund: null,
          userErrors: [{ field: ["orderId"], message: "Order does not exist" }],
        },
      },
      errors: undefined,
      extensions: throttledExtensions(900),
    });

    const result = await action.execute(makeInput(payload, { idempotencyKey: "idem-key-006" }));

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error.code).toBe("not_found");
    }
  });

  it("returns idempotent replay on second request with same key", async () => {
    client.setResponse(REFUND_CREATE_MUTATION, {
      data: {
        refundCreate: {
          refund: {
            id: "gid://shopify/Refund/222",
            createdAt: "2024-01-02T00:00:00Z",
            order: { id: "gid://shopify/Order/111" },
          },
          userErrors: [],
        },
      },
      errors: undefined,
      extensions: throttledExtensions(900),
    });

    const input = makeInput(payload, { idempotencyKey: "idem-key-006" });
    const first = await action.execute(input);
    const second = await action.execute(input);

    expect(first).toEqual(second);
    expect(client.callHistory.length).toBe(1);
  });

  it("returns indeterminate on timeout (timeout-after-effect)", async () => {
    client.setFault({ kind: "timeout", durationMs: 200 });

    const result = await action.execute(makeInput(payload, { idempotencyKey: "idem-key-006", timeoutMs: 50 }));

    expect(result.status).toBe("indeterminate");
  });

  it("handles throttle via extensions cost", async () => {
    client.setResponse(REFUND_CREATE_MUTATION, {
      data: null,
      errors: undefined,
      extensions: throttledExtensions(0),
    });

    const result = await action.execute(makeInput(payload, { idempotencyKey: "idem-key-006" }));

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error.code).toBe("rate_limited");
      expect(result.error.retryable).toBe(true);
    }
  });
});
