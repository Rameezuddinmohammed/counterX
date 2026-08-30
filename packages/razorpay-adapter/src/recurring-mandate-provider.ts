/**
 * Razorpay recurring-payment mandate provider.
 *
 * Wraps Razorpay's Tokens/Recurring-Payments API (customer + token,
 * on-demand variable-amount charges against a registered token) — NOT
 * Razorpay's separate "Subscriptions" product (/v1/plans, /v1/subscriptions),
 * which is fixed-amount, fixed-interval, Razorpay-scheduled billing. That
 * product is the wrong fit here: an agent needs to decide when and how much
 * to charge, on demand, up to a ceiling the wallet owner authorized once —
 * not follow Razorpay's own billing clock. Keep that distinction in mind
 * when touching this file; using the word "subscription" anywhere here
 * would mislead a future reader about which Razorpay product is wired up.
 *
 * Reuses the SAME RazorpayHttpPort transport RazorpayTestProvider uses
 * (idempotency header, explicit non-2xx handling, transport-failure→503
 * synthetic indeterminate handling) — no new HTTP plumbing.
 *
 * SPIKE NEEDED BEFORE REAL CREDENTIALS: the exact field names below are
 * from documented Razorpay behavior, not a fresh spec check against a live
 * test-mode account — verify against Razorpay's current dashboard/docs
 * before wiring this into apps/worker/src/boot.ts for real, especially for
 * UPI Autopay specifically (its API surface has moved more than card
 * recurring has).
 */

import type { Instant } from "@counter/domain";
import { createCanonicalError, instantFromEpochMilliseconds } from "@counter/domain";

import type { PaymentOperationResult, ProviderReference } from "@counter/payment-sdk";

import type { RazorpayHttpPort } from "./http-client.js";
import type {
  RazorpayCustomer,
  RazorpayRecurringPayment,
  RazorpayToken,
} from "./recurring-types.js";
import type { RazorpayTestAdapterConfig } from "./adapter-config.js";
import { hmacSha256, timingSafeEquals } from "./signing.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const REGISTRATION_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes to complete the checkout widget
const RETRY_AFTER_MS = 30 * 1000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

/** Same transport-failure convention as razorpay-provider.ts — see that file's comment for the full rationale. */
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

// ─── Public Types ────────────────────────────────────────────────────────────

export interface CreateCustomerParams {
  readonly name: string;
  readonly contact: string;
  readonly email: string;
}

export interface CreateRegistrationOrderParams {
  readonly customerId: string;
  readonly ceilingPaise: number;
  /** Epoch seconds — Razorpay's token.expire_at is seconds, not milliseconds. */
  readonly validUntilEpochSeconds: number;
  readonly idempotencyKey: string;
}

export interface RegistrationCallbackInput {
  readonly razorpayOrderId: string;
  readonly razorpayPaymentId: string;
  readonly razorpaySignature: string;
}

export type RegistrationCallbackResult =
  | {
      readonly verified: true;
      readonly providerTokenId: string;
      readonly providerPaymentId: string;
    }
  | { readonly verified: false };

export type TokenStatus = "confirmed" | "pending" | "cancelled";

export interface ChargeRecurringParams {
  readonly customerId: string;
  readonly tokenId: string;
  readonly amountPaise: number;
  readonly idempotencyKey: string;
}

// ─── RazorpayRecurringMandateProvider ───────────────────────────────────────

export interface RazorpayRecurringMandateProviderConfig {
  readonly config: RazorpayTestAdapterConfig;
  readonly httpClient: RazorpayHttpPort;
  readonly clock?: () => number;
}

export class RazorpayRecurringMandateProvider {
  readonly #config: RazorpayTestAdapterConfig;
  readonly #http: RazorpayHttpPort;
  readonly #clock: () => number;

  public constructor(opts: RazorpayRecurringMandateProviderConfig) {
    if (opts.config.environment !== "test") {
      throw createCanonicalError({
        code: "ENVIRONMENT_MISMATCH",
        category: "validation",
        message: "RazorpayRecurringMandateProvider requires environment = 'test'",
      });
    }
    this.#config = opts.config;
    this.#http = opts.httpClient;
    this.#clock = opts.clock ?? (() => Date.now());
  }

  /**
   * Creates a Razorpay customer to register a recurring-payment token
   * against. Does NOT attempt to detect/reuse an existing duplicate here:
   * verified live 2026-08-30 that Razorpay's "Customer already exists"
   * error carries no id or other identifying metadata to recover it from
   * (confirmed against a real test-mode account, not assumed from docs).
   * Reuse across repeat registrations for the same wallet is therefore the
   * CALLER's responsibility — control-plane-api's RecurringMandateProvisioner
   * looks up a wallet's own previously-stored provider_customer_id before
   * ever calling this method, rather than relying on Razorpay to report a
   * duplicate.
   */
  public async createCustomer(params: CreateCustomerParams): Promise<string> {
    const response = await this.#http.request<RazorpayCustomer>({
      method: "POST",
      path: "/v1/customers",
      body: { name: params.name, contact: params.contact, email: params.email },
    });

    if (response.status === 200) {
      return response.body.id;
    }

    throw createCanonicalError({
      code: "UNAVAILABLE",
      category: "unavailable",
      message: `Razorpay customer creation failed with status ${response.status}`,
    });
  }

  /**
   * Creates the registration order the checkout widget uses to collect the
   * wallet owner's one-time UPI Autopay/e-mandate authorization. Returns
   * the same "public key_id only, never key_secret" action_required shape
   * RazorpayTestProvider.createInstruction returns.
   */
  public async createRegistrationOrder(
    params: CreateRegistrationOrderParams,
  ): Promise<PaymentOperationResult> {
    if (params.ceilingPaise <= 0) {
      throw createCanonicalError({
        code: "OUT_OF_RANGE",
        category: "validation",
        message: "Mandate ceiling must be positive",
      });
    }

    const response = await this.#http.request<{ id: string }>({
      method: "POST",
      path: "/v1/orders",
      body: {
        amount: params.ceilingPaise,
        currency: "INR",
        method: "upi",
        customer_id: params.customerId,
        token: {
          max_amount: params.ceilingPaise,
          expire_at: params.validUntilEpochSeconds,
          // "as_presented" (underscore — verified live 2026-08-30 against
          // Razorpay's real test-mode API; the hyphenated "as-presented"
          // is silently NOT a recognized value and falls through to a
          // validation path demanding a recurring_value/day-of-month,
          // returning 400) is the correct frequency for "the merchant
          // debits whenever it decides to," not a fixed schedule — the
          // right fit for an agent deciding when to charge.
          frequency: "as_presented",
        },
      },
      idempotencyKey: params.idempotencyKey,
    });

    if (response.status !== 200) {
      const transportReason = extractTransportReason(response.body);
      if (transportReason === "timeout") {
        const queryAfter = futureInstant(this.#clock, RETRY_AFTER_MS);
        return Object.freeze({
          kind: "indeterminate" as const,
          reference: params.idempotencyKey as ProviderReference,
          queryAfter,
        });
      }
      throw createCanonicalError({
        code: "UNAVAILABLE",
        category: "unavailable",
        message: `Razorpay recurring registration order creation failed with status ${response.status}`,
      });
    }

    const expiresAt = futureInstant(this.#clock, REGISTRATION_EXPIRY_MS);

    // SECURITY: public key_id only. NEVER expose key_secret to the client.
    return Object.freeze({
      kind: "action_required" as const,
      action: Object.freeze({
        url: `${this.#config.baseUrl}/checkout`,
        method: "POST" as const,
        metadata: Object.freeze({
          razorpay_order_id: response.body.id,
          razorpay_key_id: this.#config.keyId,
          razorpay_customer_id: params.customerId,
          amount: String(params.ceilingPaise),
          currency: "INR",
          recurring: "1",
        }),
      }),
      expiresAt,
    });
  }

  /**
   * Verifies the checkout widget's callback signature
   * (HMAC_SHA256(order_id|payment_id, key_secret), same convention as
   * one-shot orders), then reads back the resulting token id from Razorpay
   * as the authoritative source — the callback itself is never trusted for
   * the token id, only for which payment to look up.
   */
  public async verifyRegistrationCallback(
    input: RegistrationCallbackInput,
  ): Promise<RegistrationCallbackResult> {
    const expectedSignature = hmacSha256(
      `${input.razorpayOrderId}|${input.razorpayPaymentId}`,
      this.#config.keySecret,
    );
    if (!timingSafeEquals(input.razorpaySignature, expectedSignature)) {
      return { verified: false };
    }

    const response = await this.#http.request<RazorpayRecurringPayment>({
      method: "GET",
      path: `/v1/payments/${input.razorpayPaymentId}`,
    });
    if (response.status !== 200 || response.body.token_id === null) {
      return { verified: false };
    }

    return {
      verified: true,
      providerTokenId: response.body.token_id,
      providerPaymentId: response.body.id,
    };
  }

  /** Reads the authoritative status of a registered token — never trust a locally-cached status. */
  public async fetchTokenStatus(customerId: string, tokenId: string): Promise<TokenStatus> {
    const response = await this.#http.request<RazorpayToken>({
      method: "GET",
      path: `/v1/customers/${customerId}/tokens/${tokenId}`,
    });
    if (response.status !== 200) {
      return "pending";
    }
    const status = response.body.recurring_details?.status;
    if (status === "confirmed") {
      return "confirmed";
    }
    if (status === "cancelled" || status === "rejected") {
      return "cancelled";
    }
    return "pending";
  }

  /**
   * Charges a variable, on-demand amount against a confirmed token. Never
   * throws on a non-2xx Razorpay response — maps to the same
   * confirmed/declined/indeterminate outcomes used everywhere else in this
   * package, so callers (the worker's real-lifecycle.ts) branch on outcome
   * kind exactly as they already do for one-shot orders.
   */
  public async chargeRecurring(params: ChargeRecurringParams): Promise<PaymentOperationResult> {
    const response = await this.#http.request<RazorpayRecurringPayment>({
      method: "POST",
      path: "/v1/payments/create/recurring",
      body: {
        amount: params.amountPaise,
        currency: "INR",
        customer_id: params.customerId,
        token: params.tokenId,
        recurring: "1",
      },
      idempotencyKey: params.idempotencyKey,
    });

    if (response.status !== 200) {
      const transportReason = extractTransportReason(response.body);
      if (transportReason === "timeout") {
        const queryAfter = futureInstant(this.#clock, RETRY_AFTER_MS);
        return Object.freeze({
          kind: "indeterminate" as const,
          reference: params.idempotencyKey as ProviderReference,
          queryAfter,
        });
      }
      // A real (non-transport) Razorpay decline for a recurring charge is a
      // normal outcome (e.g. the underlying bank/UPI account has insufficient
      // funds) — surface it as declined, not a thrown error, unlike one-shot
      // order creation where a non-2xx is always a hard provider failure.
      return Object.freeze({
        kind: "declined" as const,
        reason: Object.freeze({
          code: "RAZORPAY_RECURRING_DECLINED",
          reason: `Razorpay recurring charge failed with status ${response.status}`,
          retryable: false,
        }),
      });
    }

    const payment = response.body;
    const status = mapPaymentStatus(payment.status);
    if (status === "declined") {
      return Object.freeze({
        kind: "declined" as const,
        reason: Object.freeze({
          code: payment.error_code ?? "RAZORPAY_RECURRING_DECLINED",
          reason: payment.error_description ?? "Recurring charge declined",
          retryable: false,
        }),
      });
    }
    if (status === "pending") {
      const queryAfter = futureInstant(this.#clock, RETRY_AFTER_MS);
      return Object.freeze({
        kind: "indeterminate" as const,
        reference: payment.id as ProviderReference,
        queryAfter,
      });
    }

    const now = nowInstant(this.#clock);
    return Object.freeze({
      kind: "confirmed" as const,
      evidence: Object.freeze({
        reference: payment.id as ProviderReference,
        status: "confirmed" as const,
        confirmedAt: now,
        providerData: Object.freeze({ customerId: params.customerId, tokenId: params.tokenId }),
      }),
    });
  }

  /** Cancels a registered token — used when the wallet owner revokes their mandate. */
  public async cancelToken(customerId: string, tokenId: string): Promise<void> {
    const response = await this.#http.request<unknown>({
      method: "DELETE",
      path: `/v1/customers/${customerId}/tokens/${tokenId}`,
    });
    if (response.status !== 200) {
      throw createCanonicalError({
        code: "UNAVAILABLE",
        category: "unavailable",
        message: `Razorpay token cancellation failed with status ${response.status}`,
      });
    }
  }
}
