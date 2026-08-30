/**
 * Shopify order action implementations following the ActionPort pattern.
 *
 * Each action:
 * - Implements ActionPort<TInput, TResult> from @counter/connector-sdk
 * - Propagates Counter correlation metadata
 * - Normalizes errors to ConnectorError
 * - Handles throttle, timeout, and unsupported-state scenarios
 * - Supports idempotent replay via the IdempotencyStore
 */

import type { ActionInput, ActionOutcome, ActionPort } from "@counter/connector-sdk";
import { createConnectorError } from "@counter/connector-sdk";
import type { Instant } from "@counter/domain";
import { instantFromEpochMilliseconds } from "@counter/domain";

import type { ShopifyGraphQLPort, ShopifyGraphQLResponse } from "./graphql-client.js";
import {
  classifyTimeout,
  isThrottled,
  computeRetryAfterMs,
  normalizeGraphQLErrors,
  normalizeUserErrors,
  type ShopifyUserError,
} from "./order-error-normalizer.js";
import {
  createIdempotencyStore,
  computePayloadHash,
  type IdempotencyStore,
} from "./order-idempotency.js";
import {
  DRAFT_ORDER_CREATE_MUTATION,
  DRAFT_ORDER_COMPLETE_MUTATION,
  ORDER_MARK_AS_PAID_MUTATION,
  ORDER_CANCEL_MUTATION,
  REFUND_CREATE_MUTATION,
  DRAFT_ORDER_QUERY,
  ORDER_QUERY,
  buildCustomAttributes,
} from "./order-mutations.js";
import type {
  DraftOrderCreateInput,
  DraftOrderResult,
  OrderFinalizeInput,
  OrderResult,
  PaymentRecordInput,
  PaymentRecordResult,
  OrderCancelInput,
  CancelResult,
  RefundInput,
  RefundResult,
} from "./order-types.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nowInstant(): Instant {
  const result = instantFromEpochMilliseconds(Date.now());
  if (!result.ok) {
    throw new TypeError("System clock produced invalid instant");
  }
  return result.value;
}

function failed(error: ReturnType<typeof createConnectorError>): ActionOutcome<never> {
  return { status: "failed", error };
}

function indeterminate(correlationId: string, lastKnownState?: string): ActionOutcome<never> {
  return { status: "indeterminate", correlationId, lastKnownState };
}

// ─── Response Type Helpers ────────────────────────────────────────────────────

interface DraftOrderCreateResponse {
  readonly draftOrderCreate: {
    readonly draftOrder: {
      readonly id: string;
      readonly name: string;
      readonly status: string;
      readonly totalPrice: string;
      readonly currencyCode: string;
      readonly createdAt: string;
    } | null;
    readonly userErrors: readonly ShopifyUserError[];
  };
}

interface DraftOrderQueryResponse {
  readonly draftOrder: {
    readonly id: string;
    readonly name: string;
    readonly status: string;
    readonly totalPrice: string;
    readonly currencyCode: string;
    readonly createdAt: string;
    readonly customAttributes: readonly { readonly key: string; readonly value: string }[];
  } | null;
}

interface DraftOrderCompleteResponse {
  readonly draftOrderComplete: {
    readonly draftOrder: {
      readonly order: {
        readonly id: string;
        readonly name: string;
        readonly displayFinancialStatus: string;
        readonly totalPriceSet: {
          readonly shopMoney: {
            readonly amount: string;
            readonly currencyCode: string;
          };
        };
        readonly createdAt: string;
      } | null;
    } | null;
    readonly userErrors: readonly ShopifyUserError[];
  };
}

interface OrderMarkAsPaidResponse {
  readonly orderMarkAsPaid: {
    readonly order: {
      readonly id: string;
      readonly displayFinancialStatus: string;
      readonly processedAt: string;
    } | null;
    readonly userErrors: readonly ShopifyUserError[];
  };
}

interface OrderCancelResponse {
  readonly orderCancel: {
    readonly orderCancelUserErrors: readonly ShopifyUserError[];
  };
}

interface RefundCreateResponse {
  readonly refundCreate: {
    readonly refund: {
      readonly id: string;
      readonly createdAt: string;
      readonly order: {
        readonly id: string;
      };
    } | null;
    readonly userErrors: readonly ShopifyUserError[];
  };
}

interface OrderQueryResponse {
  readonly order: {
    readonly id: string;
    readonly name: string;
    readonly displayFinancialStatus: string;
    readonly cancelledAt: string | null;
    readonly totalPriceSet: {
      readonly shopMoney: {
        readonly amount: string;
        readonly currencyCode: string;
      };
    };
    readonly createdAt: string;
    readonly customAttributes: readonly { readonly key: string; readonly value: string }[];
  } | null;
}

// ─── Generic Mutation Execution ───────────────────────────────────────────────

async function executeMutation<TResponse>(
  client: ShopifyGraphQLPort,
  mutation: string,
  variables: Record<string, unknown>,
  timeoutMs: number,
): Promise<{ readonly response: ShopifyGraphQLResponse<TResponse>; readonly timedOut: boolean }> {
  try {
    const response = await Promise.race([
      client.mutate<TResponse>(mutation, variables),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("__TIMEOUT__")), timeoutMs),
      ),
    ]);
    return { response, timedOut: false };
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "__TIMEOUT__") {
      return {
        response: { data: null, errors: undefined, extensions: undefined },
        timedOut: true,
      };
    }
    throw error;
  }
}

// ─── Draft Order Create Action ────────────────────────────────────────────────

export class DraftOrderCreateAction implements ActionPort<DraftOrderCreateInput, DraftOrderResult> {
  readonly #client: ShopifyGraphQLPort;
  readonly #idempotencyStore: IdempotencyStore<DraftOrderResult>;

  public constructor(client: ShopifyGraphQLPort) {
    this.#client = client;
    this.#idempotencyStore = createIdempotencyStore<DraftOrderResult>();
  }

  public async execute(
    input: ActionInput<DraftOrderCreateInput>,
  ): Promise<ActionOutcome<DraftOrderResult>> {
    const payloadHash = computePayloadHash(input.payload);
    const lookup = this.#idempotencyStore.lookup(input.idempotencyKey, payloadHash);

    if (lookup.status === "divergent") {
      return failed(
        createConnectorError({
          code: "conflict",
          message: "Divergent duplicate: same idempotency key with different payload",
          retryable: false,
          source: "shopify",
        }),
      );
    }
    if (lookup.status === "cached" && lookup.cachedOutcome) {
      return lookup.cachedOutcome;
    }

    const customAttributes = buildCustomAttributes(input.correlationId, input.idempotencyKey);
    const variables = {
      input: {
        lineItems: input.payload.lineItems.map((li) => ({
          variantId: li.variantId,
          quantity: li.quantity,
        })),
        customerId: input.payload.customerId ?? undefined,
        note: input.payload.note ?? undefined,
        tags: [...input.payload.tags],
        customAttributes,
      },
    };

    let result: { response: ShopifyGraphQLResponse<DraftOrderCreateResponse>; timedOut: boolean };
    try {
      result = await executeMutation<DraftOrderCreateResponse>(
        this.#client,
        DRAFT_ORDER_CREATE_MUTATION,
        variables,
        input.timeoutMs,
      );
    } catch {
      // Network/unexpected error before any effect
      return failed(classifyTimeout(false));
    }

    if (result.timedOut) {
      return indeterminate(input.correlationId, "timeout_before_response");
    }

    const { response } = result;

    // Throttle check
    if (isThrottled(response)) {
      const retryAfterMs = computeRetryAfterMs(response.extensions?.cost?.throttleStatus);
      return failed(
        createConnectorError({
          code: "rate_limited",
          message: "Shopify API throttled",
          retryable: true,
          retryAfterMs,
          source: "shopify",
        }),
      );
    }

    // GraphQL-level errors
    if (response.errors && response.errors.length > 0) {
      return failed(normalizeGraphQLErrors(response.errors, response));
    }

    const payload = response.data?.draftOrderCreate;
    if (!payload) {
      return failed(
        createConnectorError({
          code: "unavailable",
          message: "No data returned from draftOrderCreate",
          retryable: true,
          source: "shopify",
        }),
      );
    }

    // User errors
    if (payload.userErrors.length > 0) {
      return failed(normalizeUserErrors(payload.userErrors));
    }

    if (!payload.draftOrder) {
      return failed(
        createConnectorError({
          code: "unavailable",
          message: "Draft order was not created",
          retryable: true,
          source: "shopify",
        }),
      );
    }

    const outcome: ActionOutcome<DraftOrderResult> = {
      status: "succeeded",
      result: Object.freeze({
        draftOrderId: payload.draftOrder.id,
        name: payload.draftOrder.name,
        status: payload.draftOrder.status,
        totalPrice: payload.draftOrder.totalPrice,
        currencyCode: payload.draftOrder.currencyCode,
        createdAt: payload.draftOrder.createdAt,
      }),
      effectTime: nowInstant(),
      sourceReference: Object.freeze({ source: "shopify", value: payload.draftOrder.id }),
    };

    this.#idempotencyStore.record(input.idempotencyKey, payloadHash, outcome);
    return outcome;
  }

  public async query(correlationId: string): Promise<ActionOutcome<DraftOrderResult> | null> {
    // Query uses correlationId to find the draft order by note attributes
    // In a real implementation, this would search by note attribute
    // For now, return null indicating the query could not locate the resource
    void correlationId;
    return null;
  }
}

// ─── Draft Order Query Action ─────────────────────────────────────────────────

export interface DraftOrderQueryInput {
  readonly draftOrderId: string;
  readonly metadata: { readonly correlationId: string; readonly idempotencyKey: string };
}

export class DraftOrderQueryAction implements ActionPort<DraftOrderQueryInput, DraftOrderResult> {
  readonly #client: ShopifyGraphQLPort;

  public constructor(client: ShopifyGraphQLPort) {
    this.#client = client;
  }

  public async execute(
    input: ActionInput<DraftOrderQueryInput>,
  ): Promise<ActionOutcome<DraftOrderResult>> {
    let result: { response: ShopifyGraphQLResponse<DraftOrderQueryResponse>; timedOut: boolean };
    try {
      result = await executeMutation<DraftOrderQueryResponse>(
        this.#client,
        DRAFT_ORDER_QUERY,
        { id: input.payload.draftOrderId },
        input.timeoutMs,
      );
    } catch {
      return failed(classifyTimeout(false));
    }

    if (result.timedOut) {
      return failed(classifyTimeout(false));
    }

    const { response } = result;

    if (response.errors && response.errors.length > 0) {
      return failed(normalizeGraphQLErrors(response.errors, response));
    }

    const draftOrder = response.data?.draftOrder;
    if (!draftOrder) {
      return failed(
        createConnectorError({
          code: "not_found",
          message: "Draft order not found",
          retryable: false,
          source: "shopify",
        }),
      );
    }

    return {
      status: "succeeded",
      result: Object.freeze({
        draftOrderId: draftOrder.id,
        name: draftOrder.name,
        status: draftOrder.status,
        totalPrice: draftOrder.totalPrice,
        currencyCode: draftOrder.currencyCode,
        createdAt: draftOrder.createdAt,
      }),
      effectTime: nowInstant(),
      sourceReference: Object.freeze({ source: "shopify", value: draftOrder.id }),
    };
  }

  public async query(correlationId: string): Promise<ActionOutcome<DraftOrderResult> | null> {
    void correlationId;
    return null;
  }
}

// ─── Order Finalize Action ────────────────────────────────────────────────────

export class OrderFinalizeAction implements ActionPort<OrderFinalizeInput, OrderResult> {
  readonly #client: ShopifyGraphQLPort;
  readonly #idempotencyStore: IdempotencyStore<OrderResult>;

  public constructor(client: ShopifyGraphQLPort) {
    this.#client = client;
    this.#idempotencyStore = createIdempotencyStore<OrderResult>();
  }

  public async execute(
    input: ActionInput<OrderFinalizeInput>,
  ): Promise<ActionOutcome<OrderResult>> {
    const payloadHash = computePayloadHash(input.payload);
    const lookup = this.#idempotencyStore.lookup(input.idempotencyKey, payloadHash);

    if (lookup.status === "divergent") {
      return failed(
        createConnectorError({
          code: "conflict",
          message: "Divergent duplicate: same idempotency key with different payload",
          retryable: false,
          source: "shopify",
        }),
      );
    }
    if (lookup.status === "cached" && lookup.cachedOutcome) {
      return lookup.cachedOutcome;
    }

    const variables = {
      id: input.payload.draftOrderId,
      paymentPending: input.payload.paymentPending,
    };

    let result: { response: ShopifyGraphQLResponse<DraftOrderCompleteResponse>; timedOut: boolean };
    try {
      result = await executeMutation<DraftOrderCompleteResponse>(
        this.#client,
        DRAFT_ORDER_COMPLETE_MUTATION,
        variables,
        input.timeoutMs,
      );
    } catch {
      return failed(classifyTimeout(false));
    }

    if (result.timedOut) {
      return indeterminate(input.correlationId, "timeout_before_response");
    }

    const { response } = result;

    if (isThrottled(response)) {
      const retryAfterMs = computeRetryAfterMs(response.extensions?.cost?.throttleStatus);
      return failed(
        createConnectorError({
          code: "rate_limited",
          message: "Shopify API throttled",
          retryable: true,
          retryAfterMs,
          source: "shopify",
        }),
      );
    }

    if (response.errors && response.errors.length > 0) {
      return failed(normalizeGraphQLErrors(response.errors, response));
    }

    const payload = response.data?.draftOrderComplete;
    if (!payload) {
      return failed(
        createConnectorError({
          code: "unavailable",
          message: "No data returned from draftOrderComplete",
          retryable: true,
          source: "shopify",
        }),
      );
    }

    if (payload.userErrors.length > 0) {
      return failed(normalizeUserErrors(payload.userErrors));
    }

    const order = payload.draftOrder?.order;
    if (!order) {
      return failed(
        createConnectorError({
          code: "unavailable",
          message: "Order was not created from draft",
          retryable: true,
          source: "shopify",
        }),
      );
    }

    const outcome: ActionOutcome<OrderResult> = {
      status: "succeeded",
      result: Object.freeze({
        orderId: order.id,
        name: order.name,
        status: order.displayFinancialStatus,
        totalPrice: order.totalPriceSet.shopMoney.amount,
        currencyCode: order.totalPriceSet.shopMoney.currencyCode,
        createdAt: order.createdAt,
      }),
      effectTime: nowInstant(),
      sourceReference: Object.freeze({ source: "shopify", value: order.id }),
    };

    this.#idempotencyStore.record(input.idempotencyKey, payloadHash, outcome);
    return outcome;
  }

  public async query(correlationId: string): Promise<ActionOutcome<OrderResult> | null> {
    void correlationId;
    return null;
  }
}

// ─── Payment Record Action ────────────────────────────────────────────────────

export class PaymentRecordAction implements ActionPort<PaymentRecordInput, PaymentRecordResult> {
  readonly #client: ShopifyGraphQLPort;
  readonly #idempotencyStore: IdempotencyStore<PaymentRecordResult>;

  public constructor(client: ShopifyGraphQLPort) {
    this.#client = client;
    this.#idempotencyStore = createIdempotencyStore<PaymentRecordResult>();
  }

  public async execute(
    input: ActionInput<PaymentRecordInput>,
  ): Promise<ActionOutcome<PaymentRecordResult>> {
    const payloadHash = computePayloadHash(input.payload);
    const lookup = this.#idempotencyStore.lookup(input.idempotencyKey, payloadHash);

    if (lookup.status === "divergent") {
      return failed(
        createConnectorError({
          code: "conflict",
          message: "Divergent duplicate: same idempotency key with different payload",
          retryable: false,
          source: "shopify",
        }),
      );
    }
    if (lookup.status === "cached" && lookup.cachedOutcome) {
      return lookup.cachedOutcome;
    }

    const variables = {
      input: {
        id: input.payload.orderId,
      },
    };

    let result: { response: ShopifyGraphQLResponse<OrderMarkAsPaidResponse>; timedOut: boolean };
    try {
      result = await executeMutation<OrderMarkAsPaidResponse>(
        this.#client,
        ORDER_MARK_AS_PAID_MUTATION,
        variables,
        input.timeoutMs,
      );
    } catch {
      return failed(classifyTimeout(false));
    }

    if (result.timedOut) {
      return indeterminate(input.correlationId, "timeout_before_response");
    }

    const { response } = result;

    if (isThrottled(response)) {
      const retryAfterMs = computeRetryAfterMs(response.extensions?.cost?.throttleStatus);
      return failed(
        createConnectorError({
          code: "rate_limited",
          message: "Shopify API throttled",
          retryable: true,
          retryAfterMs,
          source: "shopify",
        }),
      );
    }

    if (response.errors && response.errors.length > 0) {
      return failed(normalizeGraphQLErrors(response.errors, response));
    }

    const data = response.data?.orderMarkAsPaid;
    if (!data) {
      return failed(
        createConnectorError({
          code: "unavailable",
          message: "No data returned from orderMarkAsPaid",
          retryable: true,
          source: "shopify",
        }),
      );
    }

    if (data.userErrors.length > 0) {
      return failed(normalizeUserErrors(data.userErrors));
    }

    if (!data.order) {
      return failed(
        createConnectorError({
          code: "unavailable",
          message: "Order payment was not recorded",
          retryable: true,
          source: "shopify",
        }),
      );
    }

    const outcome: ActionOutcome<PaymentRecordResult> = {
      status: "succeeded",
      result: Object.freeze({
        orderId: data.order.id,
        paymentStatus: data.order.displayFinancialStatus,
        paidAt: data.order.processedAt,
      }),
      effectTime: nowInstant(),
      sourceReference: Object.freeze({ source: "shopify", value: data.order.id }),
    };

    this.#idempotencyStore.record(input.idempotencyKey, payloadHash, outcome);
    return outcome;
  }

  public async query(correlationId: string): Promise<ActionOutcome<PaymentRecordResult> | null> {
    void correlationId;
    return null;
  }
}

// ─── Order Query Action ───────────────────────────────────────────────────────

export interface OrderQueryInput {
  readonly orderId: string;
  readonly metadata: { readonly correlationId: string; readonly idempotencyKey: string };
}

export class OrderQueryAction implements ActionPort<OrderQueryInput, OrderResult> {
  readonly #client: ShopifyGraphQLPort;

  public constructor(client: ShopifyGraphQLPort) {
    this.#client = client;
  }

  public async execute(input: ActionInput<OrderQueryInput>): Promise<ActionOutcome<OrderResult>> {
    let result: { response: ShopifyGraphQLResponse<OrderQueryResponse>; timedOut: boolean };
    try {
      result = await executeMutation<OrderQueryResponse>(
        this.#client,
        ORDER_QUERY,
        { id: input.payload.orderId },
        input.timeoutMs,
      );
    } catch {
      return failed(classifyTimeout(false));
    }

    if (result.timedOut) {
      return failed(classifyTimeout(false));
    }

    const { response } = result;

    if (response.errors && response.errors.length > 0) {
      return failed(normalizeGraphQLErrors(response.errors, response));
    }

    const order = response.data?.order;
    if (!order) {
      return failed(
        createConnectorError({
          code: "not_found",
          message: "Order not found",
          retryable: false,
          source: "shopify",
        }),
      );
    }

    return {
      status: "succeeded",
      result: Object.freeze({
        orderId: order.id,
        name: order.name,
        status: order.displayFinancialStatus,
        totalPrice: order.totalPriceSet.shopMoney.amount,
        currencyCode: order.totalPriceSet.shopMoney.currencyCode,
        createdAt: order.createdAt,
      }),
      effectTime: nowInstant(),
      sourceReference: Object.freeze({ source: "shopify", value: order.id }),
    };
  }

  public async query(correlationId: string): Promise<ActionOutcome<OrderResult> | null> {
    void correlationId;
    return null;
  }
}

// ─── Order Cancel Action ──────────────────────────────────────────────────────

export class OrderCancelAction implements ActionPort<OrderCancelInput, CancelResult> {
  readonly #client: ShopifyGraphQLPort;
  readonly #idempotencyStore: IdempotencyStore<CancelResult>;

  public constructor(client: ShopifyGraphQLPort) {
    this.#client = client;
    this.#idempotencyStore = createIdempotencyStore<CancelResult>();
  }

  public async execute(input: ActionInput<OrderCancelInput>): Promise<ActionOutcome<CancelResult>> {
    const payloadHash = computePayloadHash(input.payload);
    const lookup = this.#idempotencyStore.lookup(input.idempotencyKey, payloadHash);

    if (lookup.status === "divergent") {
      return failed(
        createConnectorError({
          code: "conflict",
          message: "Divergent duplicate: same idempotency key with different payload",
          retryable: false,
          source: "shopify",
        }),
      );
    }
    if (lookup.status === "cached" && lookup.cachedOutcome) {
      return lookup.cachedOutcome;
    }

    const variables = {
      orderId: input.payload.orderId,
      reason: input.payload.reason ?? "OTHER",
      notifyCustomer: false,
      refund: false,
      // Shopify Admin API 2025-07 requires `restock` on orderCancel. Do not
      // restock: the autonomous flow does not manage inventory reservations.
      restock: false,
      staffNote: `Counter correlation: ${input.correlationId}`,
    };

    let result: { response: ShopifyGraphQLResponse<OrderCancelResponse>; timedOut: boolean };
    try {
      result = await executeMutation<OrderCancelResponse>(
        this.#client,
        ORDER_CANCEL_MUTATION,
        variables,
        input.timeoutMs,
      );
    } catch {
      return failed(classifyTimeout(false));
    }

    if (result.timedOut) {
      return indeterminate(input.correlationId, "timeout_before_response");
    }

    const { response } = result;

    if (isThrottled(response)) {
      const retryAfterMs = computeRetryAfterMs(response.extensions?.cost?.throttleStatus);
      return failed(
        createConnectorError({
          code: "rate_limited",
          message: "Shopify API throttled",
          retryable: true,
          retryAfterMs,
          source: "shopify",
        }),
      );
    }

    if (response.errors && response.errors.length > 0) {
      return failed(normalizeGraphQLErrors(response.errors, response));
    }

    const data = response.data?.orderCancel;
    if (!data) {
      return failed(
        createConnectorError({
          code: "unavailable",
          message: "No data returned from orderCancel",
          retryable: true,
          source: "shopify",
        }),
      );
    }

    if (data.orderCancelUserErrors.length > 0) {
      return failed(normalizeUserErrors(data.orderCancelUserErrors));
    }

    const outcome: ActionOutcome<CancelResult> = {
      status: "succeeded",
      result: Object.freeze({
        orderId: input.payload.orderId,
        cancelledAt: new Date().toISOString(),
      }),
      effectTime: nowInstant(),
      sourceReference: Object.freeze({ source: "shopify", value: input.payload.orderId }),
    };

    this.#idempotencyStore.record(input.idempotencyKey, payloadHash, outcome);
    return outcome;
  }

  public async query(correlationId: string): Promise<ActionOutcome<CancelResult> | null> {
    void correlationId;
    return null;
  }
}

// ─── Order Refund Action ──────────────────────────────────────────────────────

export class OrderRefundAction implements ActionPort<RefundInput, RefundResult> {
  readonly #client: ShopifyGraphQLPort;
  readonly #idempotencyStore: IdempotencyStore<RefundResult>;

  public constructor(client: ShopifyGraphQLPort) {
    this.#client = client;
    this.#idempotencyStore = createIdempotencyStore<RefundResult>();
  }

  public async execute(input: ActionInput<RefundInput>): Promise<ActionOutcome<RefundResult>> {
    const payloadHash = computePayloadHash(input.payload);
    const lookup = this.#idempotencyStore.lookup(input.idempotencyKey, payloadHash);

    if (lookup.status === "divergent") {
      return failed(
        createConnectorError({
          code: "conflict",
          message: "Divergent duplicate: same idempotency key with different payload",
          retryable: false,
          source: "shopify",
        }),
      );
    }
    if (lookup.status === "cached" && lookup.cachedOutcome) {
      return lookup.cachedOutcome;
    }

    const variables = {
      input: {
        orderId: input.payload.orderId,
        note: `Counter correlation: ${input.correlationId}`,
      },
    };

    let result: { response: ShopifyGraphQLResponse<RefundCreateResponse>; timedOut: boolean };
    try {
      result = await executeMutation<RefundCreateResponse>(
        this.#client,
        REFUND_CREATE_MUTATION,
        variables,
        input.timeoutMs,
      );
    } catch {
      return failed(classifyTimeout(false));
    }

    if (result.timedOut) {
      return indeterminate(input.correlationId, "timeout_before_response");
    }

    const { response } = result;

    if (isThrottled(response)) {
      const retryAfterMs = computeRetryAfterMs(response.extensions?.cost?.throttleStatus);
      return failed(
        createConnectorError({
          code: "rate_limited",
          message: "Shopify API throttled",
          retryable: true,
          retryAfterMs,
          source: "shopify",
        }),
      );
    }

    if (response.errors && response.errors.length > 0) {
      return failed(normalizeGraphQLErrors(response.errors, response));
    }

    const data = response.data?.refundCreate;
    if (!data) {
      return failed(
        createConnectorError({
          code: "unavailable",
          message: "No data returned from refundCreate",
          retryable: true,
          source: "shopify",
        }),
      );
    }

    if (data.userErrors.length > 0) {
      return failed(normalizeUserErrors(data.userErrors));
    }

    if (!data.refund) {
      return failed(
        createConnectorError({
          code: "unavailable",
          message: "Refund was not created",
          retryable: true,
          source: "shopify",
        }),
      );
    }

    const outcome: ActionOutcome<RefundResult> = {
      status: "succeeded",
      result: Object.freeze({
        refundId: data.refund.id,
        orderId: data.refund.order.id,
        refundedAt: data.refund.createdAt,
      }),
      effectTime: nowInstant(),
      sourceReference: Object.freeze({ source: "shopify", value: data.refund.id }),
    };

    this.#idempotencyStore.record(input.idempotencyKey, payloadHash, outcome);
    return outcome;
  }

  public async query(correlationId: string): Promise<ActionOutcome<RefundResult> | null> {
    void correlationId;
    return null;
  }
}
