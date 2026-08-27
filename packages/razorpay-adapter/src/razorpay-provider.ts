/**
 * Razorpay test payment provider implementing the PaymentProvider interface.
 *
 * Handles:
 * - Order creation via the Razorpay Orders API (/v1/orders)
 * - Standard Checkout configuration (public Key ID only, never key_secret)
 * - Callback signature verification using HMAC_SHA256(order_id|payment_id, key_secret)
 * - Webhook signature verification using HMAC_SHA256(body, webhook_secret)
 * - Payment query for authoritative state
 * - Refund creation and query
 *
 * All objects returned are immutable (Object.freeze).
 */

import { createHmac } from "node:crypto";

import type { Instant, IsoCurrencyCode } from "@counter/domain";
import { createCanonicalError, instantFromEpochMilliseconds } from "@counter/domain";

import type {
  AuthorizePayment,
  CapturePayment,
  CreatePaymentInstruction,
  PaymentOperationResult,
  ProviderCapabilities,
  ProviderContext,
  ProviderPaymentEvidence,
  ProviderReference,
  ProviderRefundEvidence,
  ProviderRefundReference,
  RawClientReturn,
  RawWebhook,
  RefundCommand,
  UntrustedOrVerifiedReturn,
  VerifiedProviderEvent,
  VoidPayment,
} from "@counter/payment-sdk";
import type { PaymentProvider } from "@counter/payment-sdk";

import type { RazorpayHttpPort } from "./http-client.js";
import type {
  RazorpayOrder,
  RazorpayPayment,
  RazorpayRefund,
  RazorpayWebhookEvent,
} from "./types.js";
import { amountToPaise, paiseToAmount } from "./types.js";
import type { RazorpayTestAdapterConfig } from "./adapter-config.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const GRANT_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const RETRY_AFTER_MS = 30 * 1000; // re-query window for an indeterminate order

// ─── Helper ──────────────────────────────────────────────────────────────────

function nowInstant(clock: () => number): Instant {
  const result = instantFromEpochMilliseconds(clock());
  if (!result.ok) {
    throw new TypeError("Clock produced invalid instant");
  }
  return result.value;
}

function futureInstant(clock: () => number, offsetMs: number): Instant {
  const result = instantFromEpochMilliseconds(clock() + offsetMs);
  if (!result.ok) {
    throw new TypeError("Clock produced invalid future instant");
  }
  return result.value;
}

/**
 * Computes HMAC_SHA256 hex signature.
 */
function hmacSha256(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("hex");
}

/**
 * Extracts the transport-failure `reason` marker the real HTTP client attaches
 * to a synthetic non-200 response body ({ error: { reason: "timeout"|"network" } }).
 * Returns `undefined` for a genuine Razorpay API error body (no such marker), so
 * only transport failures are reclassified and real API errors still throw.
 */
function extractTransportReason(body: unknown): "timeout" | "network" | undefined {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const reason = (error as { reason?: unknown }).reason;
  return reason === "timeout" || reason === "network" ? reason : undefined;
}

/**
 * Maps Razorpay payment status to our ProviderPaymentEvidence status.
 */
function mapPaymentStatus(status: string): "confirmed" | "declined" | "pending" {
  switch (status) {
    case "captured":
    case "authorized":
      return "confirmed";
    case "failed":
      return "declined";
    default:
      return "pending";
  }
}

/**
 * Maps Razorpay refund status to our ProviderRefundEvidence status.
 */
function mapRefundStatus(status: string): "confirmed" | "pending" | "declined" {
  switch (status) {
    case "processed":
      return "confirmed";
    case "failed":
      return "declined";
    default:
      return "pending";
  }
}

// ─── RazorpayTestProvider ────────────────────────────────────────────────────

export interface RazorpayProviderConfig {
  readonly config: RazorpayTestAdapterConfig;
  readonly httpClient: RazorpayHttpPort;
  readonly clock?: () => number;
}

/**
 * Full PaymentProvider implementation for Razorpay Standard Checkout.
 * Bound to test environments only. Uses the RazorpayHttpPort for all
 * external communication.
 */
export class RazorpayTestProvider implements PaymentProvider {
  readonly #config: RazorpayTestAdapterConfig;
  readonly #http: RazorpayHttpPort;
  readonly #clock: () => number;
  readonly #orderMap: Map<string, string>; // idempotencyKey -> orderId

  public constructor(opts: RazorpayProviderConfig) {
    if (opts.config.environment !== "test") {
      throw createCanonicalError({
        code: "ENVIRONMENT_MISMATCH",
        category: "validation",
        message: "RazorpayTestProvider requires environment = 'test'",
      });
    }
    this.#config = opts.config;
    this.#http = opts.httpClient;
    this.#clock = opts.clock ?? (() => Date.now());
    this.#orderMap = new Map();
  }

  public async capabilities(_context: ProviderContext): Promise<ProviderCapabilities> {
    return Object.freeze({
      methods: Object.freeze(["card", "upi", "netbanking", "wallet"]),
      currencies: Object.freeze(["INR" as IsoCurrencyCode]),
      lifecycleType: "direct_capture" as const,
      idempotency: true,
      webhookVerification: true,
      refundSupported: true,
    });
  }

  /**
   * Creates a Razorpay Order and returns action_required with Standard Checkout
   * configuration containing ONLY the public Key ID (never key_secret).
   */
  public async createInstruction(
    command: CreatePaymentInstruction,
  ): Promise<PaymentOperationResult> {
    const amountPaise = amountToPaise(command.amount);
    if (amountPaise <= 0) {
      throw createCanonicalError({
        code: "OUT_OF_RANGE",
        category: "validation",
        message: "Payment amount must be positive",
      });
    }

    const response = await this.#http.request<RazorpayOrder>({
      method: "POST",
      path: "/v1/orders",
      body: {
        amount: amountPaise,
        currency: command.currency,
        receipt: command.idempotencyKey,
        notes: command.metadata ?? {},
        partial_payment: false,
      },
      idempotencyKey: command.idempotencyKey,
    });

    if (response.status !== 200) {
      // Preserve the transport layer's indeterminate-vs-hard-failure distinction.
      // The real HTTP client surfaces a fetch/abort failure as a synthetic 503
      // whose body carries `error.reason`. A `timeout` means the request MAY have
      // reached Razorpay (a possible external effect) so the outcome is
      // INDETERMINATE, never a hard failure. A `network` reason means the request
      // did not leave the transport, so it is provider-unavailable. Any other
      // non-200 (a real 4xx/5xx from Razorpay) remains a thrown UNAVAILABLE so
      // existing error-mapping behavior is unchanged.
      const transportReason = extractTransportReason(response.body);
      if (transportReason === "timeout") {
        const queryAfter = futureInstant(this.#clock, RETRY_AFTER_MS);
        return Object.freeze({
          kind: "indeterminate" as const,
          reference: command.idempotencyKey as ProviderReference,
          queryAfter,
        });
      }
      throw createCanonicalError({
        code: "UNAVAILABLE",
        category: "unavailable",
        message: `Razorpay order creation failed with status ${response.status}`,
      });
    }

    const order = response.body;
    this.#orderMap.set(command.idempotencyKey, order.id);

    const expiresAt = futureInstant(this.#clock, GRANT_EXPIRY_MS);

    // SECURITY: Return ONLY public key_id. NEVER expose key_secret to client.
    return Object.freeze({
      kind: "action_required" as const,
      action: Object.freeze({
        url: `${this.#config.baseUrl}/checkout`,
        method: "POST" as const,
        metadata: Object.freeze({
          razorpay_order_id: order.id,
          razorpay_key_id: this.#config.keyId,
          amount: String(amountPaise),
          currency: command.currency,
        }),
      }),
      expiresAt,
    });
  }

  /**
   * Verifies the Razorpay Standard Checkout callback signature.
   * Signature = HMAC_SHA256(razorpay_order_id|razorpay_payment_id, key_secret)
   */
  public async verifyClientReturn(input: RawClientReturn): Promise<UntrustedOrVerifiedReturn> {
    const orderId = input.queryParams["razorpay_order_id"];
    const paymentId = input.queryParams["razorpay_payment_id"];
    const signature = input.queryParams["razorpay_signature"];

    if (!orderId || !paymentId || !signature) {
      return Object.freeze({
        kind: "untrusted" as const,
        correlationId: orderId ?? "unknown",
      });
    }

    const expectedSignature = hmacSha256(`${orderId}|${paymentId}`, this.#config.keySecret);

    if (!timingSafeEquals(signature, expectedSignature)) {
      return Object.freeze({
        kind: "untrusted" as const,
        correlationId: orderId,
      });
    }

    // Signature valid - query Razorpay for authoritative payment state
    const paymentResponse = await this.#http.request<RazorpayPayment>({
      method: "GET",
      path: `/v1/payments/${paymentId}`,
    });

    if (paymentResponse.status !== 200) {
      return Object.freeze({
        kind: "untrusted" as const,
        correlationId: orderId,
      });
    }

    const payment = paymentResponse.body;
    const status = mapPaymentStatus(payment.status);
    const now = nowInstant(this.#clock);

    const evidence: ProviderPaymentEvidence = Object.freeze({
      reference: paymentId as ProviderReference,
      status,
      ...(status === "confirmed" ? { confirmedAt: now } : {}),
      providerData: Object.freeze({ orderId, method: payment.method }),
    });

    return Object.freeze({
      kind: "verified" as const,
      correlationId: orderId,
      evidence,
    });
  }

  /**
   * Queries Razorpay for the authoritative payment state.
   */
  public async query(reference: ProviderReference): Promise<ProviderPaymentEvidence> {
    const response = await this.#http.request<RazorpayPayment>({
      method: "GET",
      path: `/v1/payments/${reference}`,
    });

    if (response.status !== 200) {
      return Object.freeze({
        reference,
        status: "pending" as const,
      });
    }

    const payment = response.body;
    const status = mapPaymentStatus(payment.status);
    const now = nowInstant(this.#clock);

    return Object.freeze({
      reference,
      status,
      ...(status === "confirmed" ? { confirmedAt: now } : {}),
      providerData: Object.freeze({
        method: payment.method,
        orderId: payment.order_id,
      }),
    });
  }

  /**
   * Creates a refund via Razorpay API.
   */
  public async refund(command: RefundCommand): Promise<PaymentOperationResult> {
    const amountPaise = amountToPaise(command.amount);

    const response = await this.#http.request<RazorpayRefund>({
      method: "POST",
      path: `/v1/payments/${command.reference}/refunds`,
      body: {
        amount: amountPaise,
        ...(command.reason ? { notes: { reason: command.reason } } : {}),
      },
      idempotencyKey: command.idempotencyKey,
    });

    if (response.status !== 200) {
      throw createCanonicalError({
        code: "UNAVAILABLE",
        category: "unavailable",
        message: `Razorpay refund creation failed with status ${response.status}`,
      });
    }

    const refund = response.body;
    const refundRef = refund.id as unknown as ProviderReference;
    const now = nowInstant(this.#clock);

    if (refund.status === "processed") {
      return Object.freeze({
        kind: "confirmed" as const,
        evidence: Object.freeze({
          reference: refundRef,
          status: "confirmed" as const,
          confirmedAt: now,
        }),
      });
    }

    return Object.freeze({
      kind: "pending" as const,
      reference: refundRef,
    });
  }

  /**
   * Queries a refund status.
   */
  public async queryRefund(reference: ProviderRefundReference): Promise<ProviderRefundEvidence> {
    // Extract payment ID from the refund path. In Razorpay, refund queries
    // need the payment_id. We use a convention: refund references store
    // "rfnd_xxx" IDs directly. Query via generic refund endpoint.
    const response = await this.#http.request<RazorpayRefund>({
      method: "GET",
      path: `/v1/refunds/${reference}`,
    });

    if (response.status !== 200) {
      return Object.freeze({
        reference,
        status: "pending" as const,
        amount: Object.freeze({ amountMinor: 0n, currency: "INR" as IsoCurrencyCode }),
      });
    }

    const refund = response.body;
    const status = mapRefundStatus(refund.status);
    const amount = paiseToAmount(refund.amount);
    const now = nowInstant(this.#clock);

    return Object.freeze({
      reference,
      status,
      amount,
      ...(status === "confirmed" ? { processedAt: now } : {}),
    });
  }

  /**
   * Verifies the X-Razorpay-Signature header on incoming webhooks.
   * Signature = HMAC_SHA256(raw_body, webhook_secret)
   */
  public async verifyWebhook(input: RawWebhook): Promise<VerifiedProviderEvent> {
    const signature = input.headers["x-razorpay-signature"];
    if (!signature) {
      throw createCanonicalError({
        code: "UNAUTHENTICATED",
        category: "authentication",
        message: "Missing X-Razorpay-Signature header",
      });
    }

    const bodyString = new TextDecoder().decode(input.body);
    const expectedSignature = hmacSha256(bodyString, this.#config.webhookSecret);

    if (!timingSafeEquals(signature, expectedSignature)) {
      throw createCanonicalError({
        code: "UNAUTHENTICATED",
        category: "authentication",
        message: "Invalid Razorpay webhook signature",
      });
    }

    const event: RazorpayWebhookEvent = JSON.parse(bodyString);
    const payment = event.payload.payment?.entity;

    const reference = (payment?.id ?? "unknown") as ProviderReference;
    const status = payment ? mapPaymentStatus(payment.status) : "pending";
    const now = nowInstant(this.#clock);

    const evidence: ProviderPaymentEvidence = Object.freeze({
      reference,
      status,
      ...(status === "confirmed" ? { confirmedAt: now } : {}),
      providerData: Object.freeze({ event: event.event }),
    });

    return Object.freeze({
      eventType: event.event,
      reference,
      evidence,
      receivedAt: input.receivedAt,
    });
  }

  // authorize/capture/void are not used in direct_capture lifecycle but defined for interface compliance
  public async authorize(_command: AuthorizePayment): Promise<PaymentOperationResult> {
    throw createCanonicalError({
      code: "UNSUPPORTED_VALUE",
      category: "validation",
      message:
        "Razorpay Standard Checkout uses direct_capture lifecycle; authorize is not supported",
    });
  }

  public async capture(_command: CapturePayment): Promise<PaymentOperationResult> {
    throw createCanonicalError({
      code: "UNSUPPORTED_VALUE",
      category: "validation",
      message: "Razorpay Standard Checkout uses direct_capture lifecycle; capture is not supported",
    });
  }

  public async void(_command: VoidPayment): Promise<PaymentOperationResult> {
    throw createCanonicalError({
      code: "UNSUPPORTED_VALUE",
      category: "validation",
      message: "Razorpay Standard Checkout uses direct_capture lifecycle; void is not supported",
    });
  }
}

// ─── Timing-Safe Comparison ──────────────────────────────────────────────────

/**
 * Constant-time string comparison to prevent timing attacks on signature verification.
 */
function timingSafeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  // Use XOR-based comparison
  let result = 0;
  for (let i = 0; i < bufA.length; i++) {
    result |= bufA[i]! ^ bufB[i]!;
  }
  return result === 0;
}
