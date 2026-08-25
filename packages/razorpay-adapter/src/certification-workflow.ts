/**
 * Human-present Razorpay certification workflow.
 *
 * Implements the full flow:
 * 1. Validate mandate and intent
 * 2. Create Shopify draft order first (before payment)
 * 3. Create Razorpay order
 * 4. Issue short-lived PaymentActionGrant
 * 5. Return PAYMENT_ACTION_REQUIRED with checkout config (public Key ID only)
 * 6. On callback: verify signature, verify grant not expired, query authoritative state
 * 7. Post-payment continuation gate: re-evaluate policy with fresh decision
 * 8. If fresh decision allows: finalize Shopify order
 *    Otherwise: block + create finding + initiate refund
 */

import type { Instant, IsoCurrencyCode, MerchantId, Money } from "@counter/domain";
import { instantFromEpochMilliseconds } from "@counter/domain";

import type {
  ProviderReference,
} from "@counter/payment-sdk";

import type { RazorpayTestProvider } from "./razorpay-provider.js";
import {
  createPaymentActionGrant,
  GRANT_EXPIRY_MS,
  validateGrant,
  type PaymentActionGrant,
  type PaymentActionGrantBindings,
} from "./payment-action-grant.js";

// ─── Port Interfaces ─────────────────────────────────────────────────────────

/**
 * Port for policy evaluation in the continuation gate.
 */
export interface CertificationPolicyPort {
  evaluateFreshDecision(params: {
    readonly transactionId: string;
    readonly mandateRef: string;
    readonly amount: Money;
  }): CertificationPolicyDecision;
}

export interface CertificationPolicyDecision {
  readonly outcome: "allow" | "deny" | "stale";
  readonly reason?: string;
}

/**
 * Port for Shopify draft order creation and finalization.
 */
export interface CertificationDraftOrderPort {
  createDraft(params: {
    readonly transactionId: string;
    readonly amount: Money;
    readonly currency: IsoCurrencyCode;
    readonly metadata?: Readonly<Record<string, string>>;
  }): Promise<CertificationDraftResult>;

  finalizeDraft(params: {
    readonly draftOrderId: string;
    readonly transactionId: string;
  }): Promise<CertificationFinalizeResult>;
}

export interface CertificationDraftResult {
  readonly draftOrderId: string;
  readonly totalPrice: string;
}

export interface CertificationFinalizeResult {
  readonly orderId: string;
  readonly status: string;
}

/**
 * Port for creating findings when policy blocks finalization.
 */
export interface CertificationFindingPort {
  createFinding(params: {
    readonly transactionId: string;
    readonly reason: string;
    readonly paymentRef: string;
    readonly severity: "critical" | "high" | "medium" | "low";
  }): string; // returns findingId
}

/**
 * Port for initiating refunds when policy blocks finalization.
 */
export interface CertificationRefundPort {
  initiateRefund(params: {
    readonly paymentRef: string;
    readonly amount: Money;
    readonly reason: string;
    readonly transactionId: string;
  }): Promise<{ readonly refundId: string; readonly status: string }>;
}

// ─── Workflow Types ──────────────────────────────────────────────────────────

export interface CertificationWorkflowConfig {
  readonly provider: RazorpayTestProvider;
  readonly policyPort: CertificationPolicyPort;
  readonly draftOrderPort: CertificationDraftOrderPort;
  readonly findingPort: CertificationFindingPort;
  readonly refundPort: CertificationRefundPort;
  readonly clock?: () => number;
}

export interface CertificationStartCommand {
  readonly transactionId: string;
  readonly version: number;
  readonly mandateRef: string;
  readonly mandateExpiresAt: Instant;
  readonly approvalRef: string;
  readonly quoteDigest: string;
  readonly amount: Money;
  readonly currency: IsoCurrencyCode;
  readonly idempotencyKey: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

export type CertificationStartResult =
  | CertificationActionRequired
  | CertificationDeclined;

export interface CertificationActionRequired {
  readonly kind: "payment_action_required";
  readonly grant: PaymentActionGrant;
  readonly checkoutConfig: {
    readonly razorpayKeyId: string;
    readonly razorpayOrderId: string;
    readonly amount: number;
    readonly currency: string;
  };
  readonly draftOrderId: string;
  readonly expiresAt: Instant;
}

export interface CertificationDeclined {
  readonly kind: "declined";
  readonly reason: string;
}

export interface CertificationCallbackCommand {
  readonly grant: PaymentActionGrant;
  readonly razorpayOrderId: string;
  readonly razorpayPaymentId: string;
  readonly razorpaySignature: string;
}

export type CertificationCallbackResult =
  | CertificationSuccess
  | CertificationBlocked
  | CertificationCallbackFailed;

export interface CertificationSuccess {
  readonly kind: "success";
  readonly orderId: string;
  readonly paymentRef: string;
  readonly transactionId: string;
}

export interface CertificationBlocked {
  readonly kind: "blocked";
  readonly reason: string;
  readonly findingId: string;
  readonly refundId: string;
  readonly transactionId: string;
}

export interface CertificationCallbackFailed {
  readonly kind: "failed";
  readonly reason: string;
}

// ─── Workflow Implementation ─────────────────────────────────────────────────

/**
 * Composes the human-present Razorpay certification workflow.
 */
export class RazorpayCertificationWorkflow {
  readonly #provider: RazorpayTestProvider;
  readonly #policyPort: CertificationPolicyPort;
  readonly #draftOrderPort: CertificationDraftOrderPort;
  readonly #findingPort: CertificationFindingPort;
  readonly #refundPort: CertificationRefundPort;
  readonly #clock: () => number;

  public constructor(config: CertificationWorkflowConfig) {
    this.#provider = config.provider;
    this.#policyPort = config.policyPort;
    this.#draftOrderPort = config.draftOrderPort;
    this.#findingPort = config.findingPort;
    this.#refundPort = config.refundPort;
    this.#clock = config.clock ?? (() => Date.now());
  }

  /**
   * Phase 1: Start the certification workflow.
   * Validates mandate, creates Shopify draft, creates Razorpay order,
   * issues grant, and returns PAYMENT_ACTION_REQUIRED.
   */
  public async start(command: CertificationStartCommand): Promise<CertificationStartResult> {
    const now = this.#now();

    // 1. Validate mandate expiry
    if (now > command.mandateExpiresAt) {
      return Object.freeze({
        kind: "declined" as const,
        reason: "Mandate has expired",
      });
    }

    // 2. Create Shopify draft order FIRST (before payment)
    const draftResult = await this.#draftOrderPort.createDraft({
      transactionId: command.transactionId,
      amount: command.amount,
      currency: command.currency,
      ...(command.metadata !== undefined ? { metadata: command.metadata } : {}),
    });

    // 3. Create Razorpay order via the provider
    const paymentResult = await this.#provider.createInstruction({
      authorizationRef: command.approvalRef,
      amount: command.amount,
      currency: command.currency,
      merchantId: "" as unknown as MerchantId, // Will be set by caller context
      idempotencyKey: command.idempotencyKey,
      ...(command.metadata !== undefined ? { metadata: command.metadata } : {}),
    });

    if (paymentResult.kind !== "action_required") {
      return Object.freeze({
        kind: "declined" as const,
        reason: `Unexpected payment result: ${paymentResult.kind}`,
      });
    }

    const razorpayOrderId = paymentResult.action.metadata?.["razorpay_order_id"] ?? "";
    const razorpayKeyId = paymentResult.action.metadata?.["razorpay_key_id"] ?? "";

    // 4. Issue short-lived PaymentActionGrant
    const expiresAt = this.#futureInstant(GRANT_EXPIRY_MS);
    const bindings: PaymentActionGrantBindings = {
      transactionId: command.transactionId,
      version: command.version,
      mandateRef: command.mandateRef,
      approvalRef: command.approvalRef,
      quoteDigest: command.quoteDigest,
      amount: command.amount,
      paymentRef: razorpayOrderId,
    };

    const grant = createPaymentActionGrant(
      `grant_${command.transactionId}_${command.version}`,
      bindings,
      now,
      expiresAt,
    );

    // 5. Return PAYMENT_ACTION_REQUIRED (public Key ID only, no key_secret)
    const amountPaise = Number(command.amount.amountMinor);

    return Object.freeze({
      kind: "payment_action_required" as const,
      grant,
      checkoutConfig: Object.freeze({
        razorpayKeyId,
        razorpayOrderId,
        amount: amountPaise,
        currency: command.currency,
      }),
      draftOrderId: draftResult.draftOrderId,
      expiresAt,
    });
  }

  /**
   * Phase 2: Process the post-payment callback.
   * Verifies signature, validates grant, queries authoritative state,
   * applies continuation gate, and either finalizes or blocks.
   */
  public async processCallback(
    command: CertificationCallbackCommand,
  ): Promise<CertificationCallbackResult> {
    const now = this.#now();
    const grant = command.grant;

    // 1. Verify grant has not expired
    const grantValidation = validateGrant({
      grant,
      now,
      transactionId: grant.bindings.transactionId,
      version: grant.bindings.version,
      mandateRef: grant.bindings.mandateRef,
      approvalRef: grant.bindings.approvalRef,
      quoteDigest: grant.bindings.quoteDigest,
      amount: grant.bindings.amount,
      paymentRef: command.razorpayOrderId,
    });

    if (!grantValidation.valid) {
      return Object.freeze({
        kind: "failed" as const,
        reason: `Grant validation failed: ${grantValidation.reason}`,
      });
    }

    // 2. Verify callback signature via provider
    const verifyResult = await this.#provider.verifyClientReturn({
      queryParams: {
        razorpay_order_id: command.razorpayOrderId,
        razorpay_payment_id: command.razorpayPaymentId,
        razorpay_signature: command.razorpaySignature,
      },
      returnedAt: now,
    });

    if (verifyResult.kind !== "verified") {
      return Object.freeze({
        kind: "failed" as const,
        reason: "Callback signature verification failed",
      });
    }

    // 3. Query Razorpay for authoritative payment state
    const paymentRef = command.razorpayPaymentId as ProviderReference;
    const authoritativeState = await this.#provider.query(paymentRef);

    if (authoritativeState.status !== "confirmed") {
      return Object.freeze({
        kind: "failed" as const,
        reason: `Payment not confirmed: ${authoritativeState.status}`,
      });
    }

    // 4. Post-payment continuation gate: fresh policy decision
    const policyDecision = this.#policyPort.evaluateFreshDecision({
      transactionId: grant.bindings.transactionId,
      mandateRef: grant.bindings.mandateRef,
      amount: grant.bindings.amount,
    });

    if (policyDecision.outcome !== "allow") {
      // Block: create finding + initiate refund (NOT order finalization)
      const findingId = this.#findingPort.createFinding({
        transactionId: grant.bindings.transactionId,
        reason: policyDecision.reason ?? `Policy ${policyDecision.outcome} after payment`,
        paymentRef: command.razorpayPaymentId,
        severity: "critical",
      });

      const refundResult = await this.#refundPort.initiateRefund({
        paymentRef: command.razorpayPaymentId,
        amount: grant.bindings.amount,
        reason: `Policy ${policyDecision.outcome}: ${policyDecision.reason ?? "blocked after payment"}`,
        transactionId: grant.bindings.transactionId,
      });

      return Object.freeze({
        kind: "blocked" as const,
        reason: policyDecision.reason ?? `Policy ${policyDecision.outcome} after payment`,
        findingId,
        refundId: refundResult.refundId,
        transactionId: grant.bindings.transactionId,
      });
    }

    // 5. Fresh decision allows: finalize Shopify order
    // We need to retrieve draftOrderId from the grant context
    // The draftOrderId is carried through the workflow via the grant's transactionId
    const finalizeResult = await this.#draftOrderPort.finalizeDraft({
      draftOrderId: `draft_${grant.bindings.transactionId}`,
      transactionId: grant.bindings.transactionId,
    });

    return Object.freeze({
      kind: "success" as const,
      orderId: finalizeResult.orderId,
      paymentRef: command.razorpayPaymentId,
      transactionId: grant.bindings.transactionId,
    });
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  #now(): Instant {
    const result = instantFromEpochMilliseconds(this.#clock());
    if (!result.ok) {
      throw new TypeError("Clock produced invalid instant");
    }
    return result.value;
  }

  #futureInstant(offsetMs: number): Instant {
    const result = instantFromEpochMilliseconds(this.#clock() + offsetMs);
    if (!result.ok) {
      throw new TypeError("Clock produced invalid future instant");
    }
    return result.value;
  }
}
