/**
 * Razorpay recurring-payments API response shapes — the Tokens/Recurring
 * Payments primitive (customer + token + on-demand charge), NOT the
 * separate fixed-amount/fixed-interval Subscriptions product. See
 * recurring-mandate-provider.ts's header for why that distinction matters.
 */

export interface RazorpayCustomer {
  readonly id: string;
  readonly entity: "customer";
  readonly name: string;
  readonly contact: string;
  readonly email: string;
  readonly created_at: number;
}

export interface RazorpayToken {
  readonly id: string;
  readonly entity: "token";
  readonly method: string;
  readonly max_amount: number | null;
  readonly expired_at: number | null;
  readonly recurring: boolean;
  /** "confirmed" once the wallet owner has completed the authorization; "pending" or "cancelled" otherwise. */
  readonly recurring_details?: {
    readonly status: "confirmed" | "pending" | "rejected" | "cancelled";
  };
}

export interface RazorpayRecurringOrder {
  readonly id: string;
  readonly entity: "order";
  readonly amount: number;
  readonly currency: string;
  readonly status: "created" | "attempted" | "paid";
  readonly created_at: number;
}

export interface RazorpayRecurringPayment {
  readonly id: string;
  readonly entity: "payment";
  readonly amount: number;
  readonly currency: string;
  readonly status: "created" | "authorized" | "captured" | "refunded" | "failed";
  readonly order_id: string | null;
  readonly customer_id: string | null;
  readonly token_id: string | null;
  readonly error_code: string | null;
  readonly error_description: string | null;
  readonly created_at: number;
}
