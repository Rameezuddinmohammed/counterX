/**
 * Razorpay human-action wallet flow.
 *
 * PaymentActionService renders a hosted payment action (Razorpay flow)
 * with merchant info, line items, INR total, and expiry derived from
 * a PaymentActionGrant. Supports:
 * - Poll/subscribe pattern for server state updates
 * - Distinguishes provider-confirmed from order-confirmed
 * - Continuation denial (re-checks policy/kill-switch before finalization)
 * - Refund-pending state
 * - Human-remediation outcomes (expired grant, user abort)
 */

import type { Instant, Money, MerchantId, WalletId } from "@counter/domain";
import type { PrecheckResult } from "./policy-precheck.js";

// ---------------------------------------------------------------------------
// Payment Action State Machine
// ---------------------------------------------------------------------------

export const PAYMENT_ACTION_STATES = [
  "rendering",
  "awaiting_user",
  "provider_confirmed",
  "order_confirmed",
  "continuation_denied",
  "refund_pending",
  "human_remediation",
  "completed",
  "expired",
  "aborted",
] as const;

export type PaymentActionState = (typeof PAYMENT_ACTION_STATES)[number];

const paymentActionStateSet: ReadonlySet<string> = new Set(PAYMENT_ACTION_STATES);

export function isPaymentActionState(value: unknown): value is PaymentActionState {
  return typeof value === "string" && paymentActionStateSet.has(value);
}

// ---------------------------------------------------------------------------
// Line Item
// ---------------------------------------------------------------------------

export interface PaymentLineItem {
  readonly title: string;
  readonly quantity: number;
  readonly unitPricePaise: bigint;
}

// ---------------------------------------------------------------------------
// Merchant Info
// ---------------------------------------------------------------------------

export interface MerchantInfo {
  readonly merchantId: MerchantId;
  readonly merchantName: string;
  readonly merchantCountry: string;
}

// ---------------------------------------------------------------------------
// Grant Binding (minimal subset from PaymentActionGrant for rendering)
// ---------------------------------------------------------------------------

export interface GrantBinding {
  readonly grantId: string;
  readonly transactionId: string;
  readonly mandateRef: string;
  readonly approvalRef: string;
  readonly quoteDigest: string;
  readonly amount: Money;
  readonly paymentRef: string;
  readonly issuedAt: Instant;
  readonly expiresAt: Instant;
}

// ---------------------------------------------------------------------------
// Hosted Payment Action (the renderable view)
// ---------------------------------------------------------------------------

export interface HostedPaymentAction {
  readonly actionId: string;
  readonly walletId: WalletId;
  readonly state: PaymentActionState;
  readonly merchant: MerchantInfo;
  readonly lineItems: readonly PaymentLineItem[];
  readonly totalAmountPaise: bigint;
  readonly currency: "INR";
  readonly expiresAt: Instant;
  readonly grantBinding: GrantBinding;
  readonly createdAt: string;
}

// ---------------------------------------------------------------------------
// State Update Event
// ---------------------------------------------------------------------------

export interface PaymentActionEvent {
  readonly actionId: string;
  readonly previousState: PaymentActionState;
  readonly newState: PaymentActionState;
  readonly timestamp: string;
  readonly reason?: string | undefined;
}

// ---------------------------------------------------------------------------
// Continuation Check Deps
// ---------------------------------------------------------------------------

export interface ContinuationCheckDeps {
  readonly policyPrecheck: (actionId: string) => PrecheckResult;
  readonly killSwitchActive: (walletId: WalletId, merchantId: MerchantId) => boolean;
}

// ---------------------------------------------------------------------------
// Subscriber Callback
// ---------------------------------------------------------------------------

export type PaymentActionSubscriber = (event: PaymentActionEvent) => void;

// ---------------------------------------------------------------------------
// Payment Action Service
// ---------------------------------------------------------------------------

/**
 * PaymentActionService manages the lifecycle of a Razorpay human-action
 * payment flow. It renders the hosted payment action, supports polling
 * and subscription for state changes, and handles continuation denial,
 * refund-pending, and human-remediation outcomes.
 */
export class PaymentActionService {
  readonly #actions: Map<string, HostedPaymentAction>;
  readonly #subscribers: Map<string, PaymentActionSubscriber[]>;
  readonly #continuationDeps: ContinuationCheckDeps;
  readonly #clock: () => number;

  constructor(deps: ContinuationCheckDeps, clock?: () => number) {
    this.#actions = new Map();
    this.#subscribers = new Map();
    this.#continuationDeps = deps;
    this.#clock = clock ?? (() => Date.now());
  }

  /**
   * Renders a hosted payment action from grant binding and merchant info.
   */
  render(params: {
    readonly actionId: string;
    readonly walletId: WalletId;
    readonly merchant: MerchantInfo;
    readonly lineItems: readonly PaymentLineItem[];
    readonly grantBinding: GrantBinding;
  }): HostedPaymentAction {
    const { actionId, walletId, merchant, lineItems, grantBinding } = params;

    const totalAmountPaise = lineItems.reduce(
      (sum, item) => sum + item.unitPricePaise * BigInt(item.quantity),
      0n,
    );

    const action: HostedPaymentAction = Object.freeze({
      actionId,
      walletId,
      state: "rendering" as PaymentActionState,
      merchant,
      lineItems: Object.freeze([...lineItems]),
      totalAmountPaise,
      currency: "INR" as const,
      expiresAt: grantBinding.expiresAt,
      grantBinding,
      createdAt: new Date(this.#clock()).toISOString(),
    });

    this.#actions.set(actionId, action);
    return action;
  }

  /**
   * Polls the current state of a payment action.
   */
  poll(actionId: string): HostedPaymentAction | undefined {
    const action = this.#actions.get(actionId);
    if (action === undefined) return undefined;

    // Check if grant has expired while in a non-terminal state
    const now = this.#clock();
    if (
      now > (action.expiresAt as number) &&
      action.state !== "completed" &&
      action.state !== "expired" &&
      action.state !== "aborted" &&
      action.state !== "refund_pending" &&
      action.state !== "human_remediation"
    ) {
      return this.#transitionState(action, "expired", "Grant expired");
    }

    return action;
  }

  /**
   * Subscribe to state change events for a payment action.
   */
  subscribe(actionId: string, subscriber: PaymentActionSubscriber): void {
    const existing = this.#subscribers.get(actionId) ?? [];
    existing.push(subscriber);
    this.#subscribers.set(actionId, existing);
  }

  /**
   * Marks the action as awaiting user interaction (Razorpay page rendered).
   */
  markAwaitingUser(actionId: string): HostedPaymentAction | undefined {
    const action = this.#actions.get(actionId);
    if (action === undefined) return undefined;
    if (action.state !== "rendering") return action;
    return this.#transitionState(action, "awaiting_user", "Payment page rendered");
  }

  /**
   * Marks provider-confirmed: Razorpay callback verified the payment.
   * This is distinct from order-confirmed (Shopify order complete).
   */
  markProviderConfirmed(actionId: string): HostedPaymentAction | undefined {
    const action = this.#actions.get(actionId);
    if (action === undefined) return undefined;
    if (action.state !== "awaiting_user") return action;
    return this.#transitionState(action, "provider_confirmed", "Razorpay callback verified");
  }

  /**
   * Attempts to finalize the action to order-confirmed.
   * Runs continuation denial check (re-checks policy/kill-switch) first.
   * If denied, transitions to continuation_denied state.
   */
  attemptOrderConfirmation(actionId: string): HostedPaymentAction | undefined {
    const action = this.#actions.get(actionId);
    if (action === undefined) return undefined;
    if (action.state !== "provider_confirmed") return action;

    // Continuation gate: re-check policy and kill-switch
    const precheck = this.#continuationDeps.policyPrecheck(actionId);
    if (precheck.outcome === "denied") {
      return this.#transitionState(
        action,
        "continuation_denied",
        `Policy re-check denied: ${precheck.reasons.join(", ")}`,
      );
    }

    const killSwitchActive = this.#continuationDeps.killSwitchActive(
      action.walletId,
      action.merchant.merchantId,
    );
    if (killSwitchActive) {
      return this.#transitionState(action, "continuation_denied", "Kill switch active");
    }

    return this.#transitionState(action, "order_confirmed", "Shopify order complete");
  }

  /**
   * Marks the action as refund-pending (payment was captured but order
   * could not be finalized).
   */
  markRefundPending(actionId: string, reason?: string): HostedPaymentAction | undefined {
    const action = this.#actions.get(actionId);
    if (action === undefined) return undefined;
    if (action.state !== "continuation_denied" && action.state !== "provider_confirmed") {
      return action;
    }
    return this.#transitionState(action, "refund_pending", reason ?? "Refund initiated");
  }

  /**
   * Marks the action as requiring human remediation.
   * This can happen from expired grants or user aborts.
   */
  markHumanRemediation(actionId: string, reason?: string): HostedPaymentAction | undefined {
    const action = this.#actions.get(actionId);
    if (action === undefined) return undefined;
    // Can transition from various non-terminal states
    if (action.state === "completed" || action.state === "expired" || action.state === "aborted") {
      return action;
    }
    return this.#transitionState(
      action,
      "human_remediation",
      reason ?? "Human remediation required",
    );
  }

  /**
   * User aborted the payment flow.
   */
  markAborted(actionId: string): HostedPaymentAction | undefined {
    const action = this.#actions.get(actionId);
    if (action === undefined) return undefined;
    if (action.state !== "awaiting_user" && action.state !== "rendering") {
      return action;
    }
    return this.#transitionState(action, "aborted", "User aborted");
  }

  /**
   * Marks the action as completed (fully finalized and receipt issued).
   */
  markCompleted(actionId: string): HostedPaymentAction | undefined {
    const action = this.#actions.get(actionId);
    if (action === undefined) return undefined;
    if (action.state !== "order_confirmed") return action;
    return this.#transitionState(action, "completed", "Payment action completed");
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────

  #transitionState(
    action: HostedPaymentAction,
    newState: PaymentActionState,
    reason: string,
  ): HostedPaymentAction {
    const previousState = action.state;
    const updated: HostedPaymentAction = Object.freeze({
      ...action,
      state: newState,
    });

    this.#actions.set(action.actionId, updated);

    const event: PaymentActionEvent = Object.freeze({
      actionId: action.actionId,
      previousState,
      newState,
      timestamp: new Date(this.#clock()).toISOString(),
      reason,
    });

    // Notify subscribers
    const subscribers = this.#subscribers.get(action.actionId);
    if (subscribers !== undefined) {
      for (const sub of subscribers) {
        sub(event);
      }
    }

    return updated;
  }
}
