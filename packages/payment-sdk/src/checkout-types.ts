/**
 * Types for the autonomous Counter test-provider checkout orchestrator.
 *
 * Defines the command, result, phases, and port interfaces used by
 * CheckoutOrchestrator to compose the full checkout flow.
 */

import type { Environment, Instant, IsoCurrencyCode, MerchantId, Money, WalletId } from "@counter/domain";
import type { PaymentAuthorization } from "./authorization.js";

// ─── Checkout Phase ──────────────────────────────────────────────────────────

export const CHECKOUT_PHASES = [
  "mandate_validation",
  "policy_check",
  "draft_creation",
  "payment_execution",
  "continuation_gate",
  "finalization",
  "reconciliation",
  "receipt",
] as const;

export type CheckoutPhase = (typeof CHECKOUT_PHASES)[number];

// ─── Checkout Command ────────────────────────────────────────────────────────

export interface CheckoutCommand {
  readonly idempotencyKey: string;
  readonly walletId: WalletId;
  readonly merchantId: MerchantId;
  readonly authorization: PaymentAuthorization;
  readonly amount: Money;
  readonly currency: IsoCurrencyCode;
  readonly environment: Environment;
  readonly mandateRef: string;
  readonly mandateExpiresAt: Instant;
  readonly intentRef: string;
  readonly quoteDigest: string;
  readonly lineItems: readonly CheckoutLineItem[];
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface CheckoutLineItem {
  readonly variantId: string;
  readonly quantity: number;
  readonly title?: string;
}

// ─── Checkout Result ─────────────────────────────────────────────────────────

export type CheckoutOutcome = "success" | "declined" | "review_required" | "indeterminate";

export interface CheckoutResult {
  readonly outcome: CheckoutOutcome;
  readonly phase: CheckoutPhase;
  readonly idempotencyKey: string;
  readonly details: string;
  readonly paymentReference?: string;
  readonly orderReference?: string;
  readonly compensationRequired?: boolean;
}

// ─── Kill Switch Port ────────────────────────────────────────────────────────

export type KillSwitchScope = "global" | "merchant" | "wallet";

export interface KillSwitchStatus {
  readonly active: boolean;
  readonly scope: KillSwitchScope;
  readonly reason?: string;
  readonly activatedAt?: Instant;
}

/**
 * Port interface for evaluating kill switches before finalization.
 * Implementations check merchant, wallet, and global kill switches.
 */
export interface KillSwitchPort {
  evaluate(params: {
    readonly walletId: WalletId;
    readonly merchantId: MerchantId;
    readonly environment: Environment;
  }): KillSwitchStatus;
}

// ─── Policy Decision Port ────────────────────────────────────────────────────

export type PolicyOutcome = "allow" | "deny" | "review_required";

export interface PolicyDecisionResult {
  readonly outcome: PolicyOutcome;
  readonly reason?: string;
  readonly ruleResults?: readonly { readonly ruleId: string; readonly outcome: string }[];
}

/**
 * Port interface for policy evaluation during checkout.
 */
export interface PolicyEvaluationPort {
  evaluate(command: CheckoutCommand): PolicyDecisionResult;
}

// ─── Draft Order Port ────────────────────────────────────────────────────────

export interface DraftOrderResult {
  readonly draftOrderId: string;
  readonly totalPrice: string;
  readonly currencyCode: string;
}

export interface OrderResult {
  readonly orderId: string;
  readonly status: string;
}

/**
 * Port interface for Shopify draft order creation.
 */
export interface DraftOrderPort {
  createDraft(command: CheckoutCommand): Promise<DraftOrderResult>;
  finalizeDraft(draftOrderId: string, idempotencyKey: string): Promise<OrderResult>;
}

// ─── Reconciliation Port ─────────────────────────────────────────────────────

export interface ReconciliationResult {
  readonly findingsCount: number;
  readonly hasCritical: boolean;
}

/**
 * Port interface for post-checkout reconciliation.
 */
export interface ReconciliationPort {
  reconcile(params: {
    readonly transactionId: string;
    readonly paymentReference: string;
    readonly orderReference: string;
    readonly amount: Money;
    readonly environment: Environment;
  }): ReconciliationResult;
}

// ─── Receipt Port ────────────────────────────────────────────────────────────

export interface ReceiptResult {
  readonly receiptId: string;
  readonly issued: boolean;
}

/**
 * Port interface for receipt issuance.
 */
export interface ReceiptPort {
  issue(params: {
    readonly transactionId: string;
    readonly merchantId: MerchantId;
    readonly walletId: WalletId;
    readonly amount: Money;
    readonly paymentReference: string;
    readonly orderReference: string;
    readonly environment: Environment;
  }): Promise<ReceiptResult>;
}
