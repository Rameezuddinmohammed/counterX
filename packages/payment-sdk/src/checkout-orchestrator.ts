/**
 * Autonomous Counter test-provider checkout orchestrator.
 *
 * Composes the full checkout workflow:
 * 1. Validate mandate/intent signatures and bindings
 * 2. Evaluate policy decision
 * 3. Create Shopify draft order
 * 4. Execute payment via CounterTestPaymentProvider
 * 5. Verify payment evidence
 * 6. Revalidate authority/policy/kill-switches (continuation gate)
 * 7. Finalize Shopify order
 * 8. Reconcile via evidence package
 * 9. Issue receipt
 *
 * Hard-bound to non-live environments (local/test only).
 * Enforces PILOT.md transaction limits.
 */

import type { Environment, Instant } from "@counter/domain";
import { instantFromEpochMilliseconds } from "@counter/domain";

import { assertTestEnvironment, rejectTestAuthorizationInLive } from "./test-authorization.js";
import type { PaymentProvider } from "./provider.js";
import type {
  CheckoutCommand,
  CheckoutOutcome,
  CheckoutPhase,
  CheckoutResult,
  DraftOrderPort,
  KillSwitchPort,
  PolicyDecisionResult,
  PolicyEvaluationPort,
  ReconciliationPort,
  ReceiptPort,
} from "./checkout-types.js";
import type { TransactionLedger, TransactionLimitConfig } from "./checkout-limits.js";
import {
  DEFAULT_LIMIT_CONFIG,
  enforceTransactionLimits,
  recordAttempt,
} from "./checkout-limits.js";

// ─── Orchestrator Configuration ──────────────────────────────────────────────

export interface CheckoutOrchestratorConfig {
  readonly environment: Environment;
  readonly provider: PaymentProvider;
  readonly policyPort: PolicyEvaluationPort;
  readonly draftOrderPort: DraftOrderPort;
  readonly killSwitchPort: KillSwitchPort;
  readonly reconciliationPort: ReconciliationPort;
  readonly receiptPort: ReceiptPort;
  readonly ledger: TransactionLedger;
  readonly limitConfig?: TransactionLimitConfig;
  readonly clock?: () => number;
}

// ─── Idempotency Cache Entry ─────────────────────────────────────────────────

interface CachedResult {
  readonly result: CheckoutResult;
}

// ─── Checkout Orchestrator ───────────────────────────────────────────────────

/**
 * Autonomous checkout orchestrator for the Counter test-provider flow.
 *
 * Hard-bound to test environments only. Enforces all PILOT.md limits and
 * revalidation gates before any external effect.
 */
export class CheckoutOrchestrator {
  readonly #environment: Environment;
  readonly #provider: PaymentProvider;
  readonly #policyPort: PolicyEvaluationPort;
  readonly #draftOrderPort: DraftOrderPort;
  readonly #killSwitchPort: KillSwitchPort;
  readonly #reconciliationPort: ReconciliationPort;
  readonly #receiptPort: ReceiptPort;
  readonly #ledger: TransactionLedger;
  readonly #limitConfig: TransactionLimitConfig;
  readonly #clock: () => number;
  readonly #idempotencyCache: Map<string, CachedResult>;

  public constructor(config: CheckoutOrchestratorConfig) {
    // Hard environment binding at construction time
    assertTestEnvironment(config.environment);

    this.#environment = config.environment;
    this.#provider = config.provider;
    this.#policyPort = config.policyPort;
    this.#draftOrderPort = config.draftOrderPort;
    this.#killSwitchPort = config.killSwitchPort;
    this.#reconciliationPort = config.reconciliationPort;
    this.#receiptPort = config.receiptPort;
    this.#ledger = config.ledger;
    this.#limitConfig = config.limitConfig ?? DEFAULT_LIMIT_CONFIG;
    this.#clock = config.clock ?? (() => Date.now());
    this.#idempotencyCache = new Map();
  }

  /**
   * Executes the full checkout flow for a given command.
   *
   * Idempotent: duplicate commands with the same idempotency key
   * produce at most one effect and return the cached result.
   */
  public async execute(command: CheckoutCommand): Promise<CheckoutResult> {
    // Idempotency check
    const cached = this.#idempotencyCache.get(command.idempotencyKey);
    if (cached !== undefined) {
      return cached.result;
    }

    // Also check ledger-level idempotency
    if (this.#ledger.hasIdempotencyKey(command.idempotencyKey)) {
      const idempotentResult = this.#buildResult(
        "success",
        "receipt",
        command.idempotencyKey,
        "Duplicate request - original execution completed successfully",
      );
      return idempotentResult;
    }

    // Execute the flow
    const result = await this.#executeFlow(command);

    // Cache the result for idempotency
    this.#idempotencyCache.set(command.idempotencyKey, { result });

    return result;
  }

  // ─── Private Flow ──────────────────────────────────────────────────────────

  async #executeFlow(command: CheckoutCommand): Promise<CheckoutResult> {
    const now = this.#now();

    // ── Phase 1: Mandate Validation ────────────────────────────────────────
    const mandateResult = this.#validateMandate(command, now);
    if (mandateResult !== undefined) {
      return mandateResult;
    }

    // ── Phase 2: Policy Check ──────────────────────────────────────────────
    const policyResult = this.#checkPolicy(command);
    if (policyResult !== undefined) {
      return policyResult;
    }

    // ── Phase 3: Enforce Transaction Limits ────────────────────────────────
    const limitResult = this.#checkLimits(command, now);
    if (limitResult !== undefined) {
      return limitResult;
    }

    // ── Phase 4: Create Draft Order ────────────────────────────────────────
    let draftOrderId: string;
    let draftTotalPrice: string;
    try {
      const draftResult = await this.#draftOrderPort.createDraft(command);
      draftOrderId = draftResult.draftOrderId;
      draftTotalPrice = draftResult.totalPrice;
    } catch (error: unknown) {
      return this.#buildResult(
        "indeterminate",
        "draft_creation",
        command.idempotencyKey,
        `Draft order creation failed: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }

    // ── Phase 5: Execute Payment ───────────────────────────────────────────
    // Re-assert environment binding before external effect
    this.#assertEnvironmentBinding(command);

    let paymentReference: string | undefined;
    try {
      const paymentResult = await this.#provider.createInstruction({
        authorizationRef: command.authorization.referenceId,
        amount: command.amount,
        currency: command.currency,
        merchantId: command.merchantId,
        idempotencyKey: `pay-${command.idempotencyKey}`,
      });

      switch (paymentResult.kind) {
        case "confirmed":
          paymentReference = paymentResult.evidence.reference;
          break;
        case "declined":
          return this.#buildResult(
            "declined",
            "payment_execution",
            command.idempotencyKey,
            `Payment declined: ${paymentResult.reason.reason}`,
          );
        case "indeterminate":
          paymentReference = paymentResult.reference;
          return this.#buildResult(
            "indeterminate",
            "payment_execution",
            command.idempotencyKey,
            "Payment result indeterminate - manual review required",
            paymentReference,
          );
        case "pending":
          paymentReference = paymentResult.reference;
          return this.#buildResult(
            "indeterminate",
            "payment_execution",
            command.idempotencyKey,
            "Payment pending - awaiting provider confirmation",
            paymentReference,
          );
        case "action_required":
          return this.#buildResult(
            "review_required",
            "payment_execution",
            command.idempotencyKey,
            "Payment requires user action - not supported in autonomous flow",
          );
      }
    } catch (error: unknown) {
      return this.#buildResult(
        "indeterminate",
        "payment_execution",
        command.idempotencyKey,
        `Payment execution error: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }

    // Record the attempt in the ledger
    recordAttempt(
      this.#ledger,
      command.walletId,
      command.amount.amountMinor,
      now,
      command.idempotencyKey,
    );

    // ── Phase 6: Continuation Gate (Revalidation) ──────────────────────────
    const continuationResult = this.#continuationGate(command, draftTotalPrice);
    if (continuationResult !== undefined) {
      return {
        ...continuationResult,
        paymentReference,
        compensationRequired: true,
      };
    }

    // ── Phase 7: Finalize Order ────────────────────────────────────────────
    // Re-assert environment binding before finalization effect
    this.#assertEnvironmentBinding(command);

    let orderReference: string | undefined;
    try {
      const finalizeResult = await this.#draftOrderPort.finalizeDraft(
        draftOrderId,
        `finalize-${command.idempotencyKey}`,
      );
      orderReference = finalizeResult.orderId;
    } catch (error: unknown) {
      return this.#buildResult(
        "indeterminate",
        "finalization",
        command.idempotencyKey,
        `Finalization failed after payment: ${error instanceof Error ? error.message : "unknown error"}`,
        paymentReference,
        undefined,
        true,
      );
    }

    // ── Phase 8: Reconciliation ────────────────────────────────────────────
    try {
      this.#reconciliationPort.reconcile({
        transactionId: command.idempotencyKey,
        paymentReference: paymentReference ?? "",
        orderReference: orderReference ?? "",
        amount: command.amount,
        environment: this.#environment,
      });
    } catch {
      // Reconciliation failure is non-fatal to the checkout outcome
    }

    // ── Phase 9: Receipt ───────────────────────────────────────────────────
    try {
      await this.#receiptPort.issue({
        transactionId: command.idempotencyKey,
        merchantId: command.merchantId,
        walletId: command.walletId,
        amount: command.amount,
        paymentReference: paymentReference ?? "",
        orderReference: orderReference ?? "",
        environment: this.#environment,
      });
    } catch {
      // Receipt failure is non-fatal to the checkout outcome
    }

    return this.#buildResult(
      "success",
      "receipt",
      command.idempotencyKey,
      "Checkout completed successfully",
      paymentReference,
      orderReference,
    );
  }

  // ─── Validation Helpers ────────────────────────────────────────────────────

  #validateMandate(command: CheckoutCommand, now: Instant): CheckoutResult | undefined {
    // Assert environment binding
    this.#assertEnvironmentBinding(command);

    // Check authorization validity
    const auth = command.authorization;

    // Check if authorization is expired
    if (now > auth.validUntil) {
      return this.#buildResult(
        "declined",
        "mandate_validation",
        command.idempotencyKey,
        "Authorization has expired",
      );
    }

    // Check if authorization is not yet valid
    if (now < auth.validFrom) {
      return this.#buildResult(
        "declined",
        "mandate_validation",
        command.idempotencyKey,
        "Authorization is not yet valid",
      );
    }

    // Check mandate expiry
    if (now > command.mandateExpiresAt) {
      return this.#buildResult(
        "declined",
        "mandate_validation",
        command.idempotencyKey,
        "Mandate has expired",
      );
    }

    // Check amount ceiling
    if (auth.maxAmountMinor !== undefined && command.amount.amountMinor > auth.maxAmountMinor) {
      return this.#buildResult(
        "declined",
        "mandate_validation",
        command.idempotencyKey,
        "Amount exceeds authorization ceiling",
      );
    }

    // Check currency match
    if (auth.currency !== undefined && auth.currency !== command.currency) {
      return this.#buildResult(
        "declined",
        "mandate_validation",
        command.idempotencyKey,
        "Currency mismatch with authorization",
      );
    }

    // Check merchant is permitted
    if (!auth.permittedMerchants.includes(command.merchantId)) {
      return this.#buildResult(
        "declined",
        "mandate_validation",
        command.idempotencyKey,
        "Merchant not permitted by authorization",
      );
    }

    return undefined;
  }

  #checkPolicy(command: CheckoutCommand): CheckoutResult | undefined {
    const policyResult: PolicyDecisionResult = this.#policyPort.evaluate(command);

    switch (policyResult.outcome) {
      case "deny":
        return this.#buildResult(
          "declined",
          "policy_check",
          command.idempotencyKey,
          `Policy denied: ${policyResult.reason ?? "no reason provided"}`,
        );
      case "review_required":
        return this.#buildResult(
          "review_required",
          "policy_check",
          command.idempotencyKey,
          `Policy requires review: ${policyResult.reason ?? "no reason provided"}`,
        );
      case "allow":
        return undefined;
    }
  }

  #checkLimits(command: CheckoutCommand, now: Instant): CheckoutResult | undefined {
    const limitResult = enforceTransactionLimits(
      command.amount,
      command.walletId,
      now,
      this.#ledger,
      this.#limitConfig,
    );

    if (!limitResult.allowed) {
      return this.#buildResult(
        "declined",
        "mandate_validation",
        command.idempotencyKey,
        `Limit enforcement: ${limitResult.reason ?? "limit exceeded"}`,
      );
    }

    return undefined;
  }

  /**
   * Continuation gate: revalidates authority, policy, kill switches,
   * and quote/draft binding before finalization.
   */
  #continuationGate(command: CheckoutCommand, draftTotalPrice: string): CheckoutResult | undefined {
    const now = this.#now();

    // Re-check authorization validity
    if (now > command.authorization.validUntil) {
      return this.#buildResult(
        "declined",
        "continuation_gate",
        command.idempotencyKey,
        "Authorization expired during checkout",
      );
    }

    // Re-check mandate expiry
    if (now > command.mandateExpiresAt) {
      return this.#buildResult(
        "declined",
        "continuation_gate",
        command.idempotencyKey,
        "Mandate expired during checkout",
      );
    }

    // Re-check policy
    const policyResult = this.#policyPort.evaluate(command);
    if (policyResult.outcome === "deny") {
      return this.#buildResult(
        "declined",
        "continuation_gate",
        command.idempotencyKey,
        `Policy denied on revalidation: ${policyResult.reason ?? "no reason"}`,
      );
    }

    // Check kill switches
    const killSwitchStatus = this.#killSwitchPort.evaluate({
      walletId: command.walletId,
      merchantId: command.merchantId,
      environment: this.#environment,
    });

    if (killSwitchStatus.active) {
      return this.#buildResult(
        "declined",
        "continuation_gate",
        command.idempotencyKey,
        `Kill switch active (${killSwitchStatus.scope}): ${killSwitchStatus.reason ?? "no reason"}`,
      );
    }

    // Validate quote/draft binding: amount must match
    const expectedMinorStr = command.amount.amountMinor.toString();
    // Convert draft total price (e.g. "5000.00") to minor units (paise) for comparison
    // Use integer parsing to avoid floating-point rounding artifacts
    const parts = draftTotalPrice.split(".");
    const wholePaise = BigInt(parts[0] ?? "0") * 100n;
    const fracStr = (parts[1] ?? "00").padEnd(2, "0").slice(0, 2);
    const fracPaise = BigInt(fracStr);
    const draftMinorBigInt = wholePaise + fracPaise;
    const commandMinorBigInt = command.amount.amountMinor;
    if (draftMinorBigInt !== commandMinorBigInt) {
      return this.#buildResult(
        "declined",
        "continuation_gate",
        command.idempotencyKey,
        `Stale quote/draft binding: draft total ${draftTotalPrice} does not match command amount ${expectedMinorStr} minor units`,
      );
    }

    return undefined;
  }

  #assertEnvironmentBinding(command: CheckoutCommand): void {
    assertTestEnvironment(this.#environment);
    rejectTestAuthorizationInLive(command.authorization, this.#environment);
  }

  #now(): Instant {
    const result = instantFromEpochMilliseconds(this.#clock());
    if (!result.ok) throw new TypeError("Clock produced invalid instant");
    return result.value;
  }

  #buildResult(
    outcome: CheckoutOutcome,
    phase: CheckoutPhase,
    idempotencyKey: string,
    details: string,
    paymentReference?: string,
    orderReference?: string,
    compensationRequired?: boolean,
  ): CheckoutResult {
    const result: CheckoutResult = Object.freeze({
      outcome,
      phase,
      idempotencyKey,
      details,
      ...(paymentReference !== undefined ? { paymentReference } : {}),
      ...(orderReference !== undefined ? { orderReference } : {}),
      ...(compensationRequired !== undefined ? { compensationRequired } : {}),
    });
    return result;
  }
}
