/**
 * Razorpay-specific types for the test adapter.
 *
 * Defines Razorpay API response shapes, callback parameters, and
 * INR/paise conversion helpers.
 */

import type { IsoCurrencyCode, Money } from "@counter/domain";

// ─── INR/Paise Conversion ────────────────────────────────────────────────────

/**
 * Converts a Money amount (in minor units = paise for INR) to paise integer
 * suitable for the Razorpay Orders API.
 *
 * Razorpay expects amount in the smallest currency unit (paise for INR).
 * Since Money.amountMinor is already in minor units, this is a direct conversion.
 */
export function amountToPaise(money: Money): number {
  if (money.currency !== ("INR" as IsoCurrencyCode)) {
    throw new TypeError("Razorpay test adapter only supports INR currency");
  }
  return Number(money.amountMinor);
}

/**
 * Converts paise (integer) back to a Money object in INR minor units.
 */
export function paiseToAmount(paise: number): Money {
  return Object.freeze({
    amountMinor: BigInt(paise),
    currency: "INR" as IsoCurrencyCode,
  });
}

// ─── Razorpay API Types ──────────────────────────────────────────────────────

export interface RazorpayOrder {
  readonly id: string;
  readonly entity: "order";
  readonly amount: number;
  readonly amount_paid: number;
  readonly amount_due: number;
  readonly currency: string;
  readonly receipt: string;
  readonly status: "created" | "attempted" | "paid";
  readonly notes: Readonly<Record<string, string>>;
  readonly created_at: number;
}

export interface RazorpayPayment {
  readonly id: string;
  readonly entity: "payment";
  readonly amount: number;
  readonly currency: string;
  readonly status: "created" | "authorized" | "captured" | "refunded" | "failed";
  readonly order_id: string;
  readonly method: string;
  readonly description: string | null;
  readonly error_code: string | null;
  readonly error_description: string | null;
  readonly created_at: number;
}

export interface RazorpayRefund {
  readonly id: string;
  readonly entity: "refund";
  readonly amount: number;
  readonly currency: string;
  readonly payment_id: string;
  readonly status: "pending" | "processed" | "failed";
  readonly speed_processed: "normal" | "optimum";
  readonly created_at: number;
}

export interface RazorpayWebhookEvent {
  readonly entity: "event";
  readonly account_id: string;
  readonly event: string;
  readonly contains: readonly string[];
  readonly payload: {
    readonly payment?: { readonly entity: RazorpayPayment };
    readonly refund?: { readonly entity: RazorpayRefund };
    readonly order?: { readonly entity: RazorpayOrder };
  };
  readonly created_at: number;
}

/**
 * Parameters returned by Razorpay Standard Checkout after user completes payment.
 */
export interface RazorpayCallbackParams {
  readonly razorpay_order_id: string;
  readonly razorpay_payment_id: string;
  readonly razorpay_signature: string;
}

/**
 * Components used for Razorpay signature verification.
 * Signature = HMAC_SHA256(order_id|payment_id, key_secret)
 */
export interface RazorpaySignatureComponents {
  readonly orderId: string;
  readonly paymentId: string;
  readonly expectedSignature: string;
}
