/**
 * Local time-trigger scheduler.
 *
 * Triggers are created only through explicit Wallet Console actions
 * (not MCP tools). Each trigger is bound to:
 * - policyVersionId
 * - mandateRef
 * - template (purchase spec)
 * - schedule (cron-like or interval)
 *
 * Execution uses occurrence-level idempotency (hash of triggerRef + scheduledTime).
 * Before each execution: fresh policy precheck, mandate validity check,
 * kill-switch check. Restricted to Counter test provider only
 * (rejects non-test merchants).
 */

import { createHash } from "node:crypto";
import type { MerchantId, WalletId } from "@counter/domain";
import type { PrecheckResult } from "./policy-precheck.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Test provider merchant ID prefix. */
const TEST_PROVIDER_PREFIX = "ctr_merchant_test";

// ---------------------------------------------------------------------------
// Schedule Types
// ---------------------------------------------------------------------------

export interface CronSchedule {
  readonly type: "cron";
  readonly expression: string;
}

export interface IntervalSchedule {
  readonly type: "interval";
  readonly intervalMs: number;
}

export type TriggerSchedule = CronSchedule | IntervalSchedule;

// ---------------------------------------------------------------------------
// Purchase Template
// ---------------------------------------------------------------------------

export interface PurchaseTemplate {
  readonly merchantId: MerchantId;
  readonly lineItems: readonly {
    readonly title: string;
    readonly quantity: number;
    readonly unitPricePaise: bigint;
  }[];
  readonly currency: "INR";
  readonly category?: string | undefined;
}

// ---------------------------------------------------------------------------
// Trigger Record
// ---------------------------------------------------------------------------

export interface TimeTrigger {
  readonly triggerRef: string;
  readonly walletId: WalletId;
  readonly policyVersionId: string;
  readonly mandateRef: string;
  readonly template: PurchaseTemplate;
  readonly schedule: TriggerSchedule;
  readonly createdAt: string;
  readonly active: boolean;
}

// ---------------------------------------------------------------------------
// Execution Record
// ---------------------------------------------------------------------------

export interface TriggerExecutionRecord {
  readonly occurrenceKey: string;
  readonly triggerRef: string;
  readonly scheduledTime: string;
  readonly executedAt: string;
  readonly outcome: "executed" | "precheck_denied" | "mandate_expired" | "kill_switch_blocked";
  readonly reason?: string | undefined;
}

// ---------------------------------------------------------------------------
// Trigger Creation Input
// ---------------------------------------------------------------------------

export interface CreateTriggerParams {
  readonly triggerRef: string;
  readonly walletId: WalletId;
  readonly policyVersionId: string;
  readonly mandateRef: string;
  readonly template: PurchaseTemplate;
  readonly schedule: TriggerSchedule;
}

// ---------------------------------------------------------------------------
// Trigger Creation Result
// ---------------------------------------------------------------------------

export type TriggerCreationResult =
  | { readonly ok: true; readonly value: TimeTrigger }
  | { readonly ok: false; readonly error: TriggerCreationError };

export interface TriggerCreationError {
  readonly kind: "trigger_creation_error";
  readonly reason: string;
}

// ---------------------------------------------------------------------------
// Trigger Execution Result
// ---------------------------------------------------------------------------

export type TriggerExecutionResult =
  | { readonly ok: true; readonly value: TriggerExecutionRecord }
  | { readonly ok: false; readonly error: TriggerExecutionError };

export interface TriggerExecutionError {
  readonly kind: "trigger_execution_error";
  readonly reason: string;
}

// ---------------------------------------------------------------------------
// Execution Dependencies (ports)
// ---------------------------------------------------------------------------

export interface TriggerExecutionDeps {
  readonly freshPolicyPrecheck: (
    walletId: WalletId,
    policyVersionId: string,
    merchantId: MerchantId,
  ) => PrecheckResult;
  readonly isMandateValid: (mandateRef: string) => boolean;
  readonly isKillSwitchActive: (walletId: WalletId, merchantId: MerchantId) => boolean;
  readonly onExecute: (trigger: TimeTrigger, scheduledTime: string) => void;
}

// ---------------------------------------------------------------------------
// Time Trigger Scheduler
// ---------------------------------------------------------------------------

/**
 * TimeTriggerScheduler manages creation and execution of time-based triggers.
 * Restricted to Counter test provider only.
 */
export class TimeTriggerScheduler {
  readonly #triggers: Map<string, TimeTrigger>;
  readonly #executions: Map<string, TriggerExecutionRecord>;
  readonly #deps: TriggerExecutionDeps;
  readonly #clock: () => number;

  constructor(deps: TriggerExecutionDeps, clock?: () => number) {
    this.#triggers = new Map();
    this.#executions = new Map();
    this.#deps = deps;
    this.#clock = clock ?? (() => Date.now());
  }

  /**
   * Creates a new time trigger. Rejects non-Counter-test-provider merchants.
   */
  create(params: CreateTriggerParams): TriggerCreationResult {
    // Reject non-test merchants
    if (!this.#isTestProvider(params.template.merchantId)) {
      return {
        ok: false,
        error: {
          kind: "trigger_creation_error",
          reason: "Only Counter test provider merchants are supported",
        },
      };
    }

    const trigger: TimeTrigger = Object.freeze({
      triggerRef: params.triggerRef,
      walletId: params.walletId,
      policyVersionId: params.policyVersionId,
      mandateRef: params.mandateRef,
      template: Object.freeze({ ...params.template }),
      schedule: Object.freeze({ ...params.schedule }),
      createdAt: new Date(this.#clock()).toISOString(),
      active: true,
    });

    this.#triggers.set(trigger.triggerRef, trigger);
    return { ok: true, value: trigger };
  }

  /**
   * Gets a trigger by reference.
   */
  get(triggerRef: string): TimeTrigger | undefined {
    return this.#triggers.get(triggerRef);
  }

  /**
   * Executes a trigger for a specific scheduled time.
   * Uses occurrence-level idempotency (hash of triggerRef + scheduledTime).
   * Before execution: fresh policy precheck, mandate validity, kill-switch.
   */
  execute(triggerRef: string, scheduledTime: string): TriggerExecutionResult {
    const trigger = this.#triggers.get(triggerRef);
    if (trigger === undefined) {
      return {
        ok: false,
        error: {
          kind: "trigger_execution_error",
          reason: "Trigger not found",
        },
      };
    }

    if (!trigger.active) {
      return {
        ok: false,
        error: {
          kind: "trigger_execution_error",
          reason: "Trigger is inactive",
        },
      };
    }

    // Occurrence-level idempotency
    const occurrenceKey = this.#computeOccurrenceKey(triggerRef, scheduledTime);
    const existing = this.#executions.get(occurrenceKey);
    if (existing !== undefined) {
      return { ok: true, value: existing };
    }

    const now = new Date(this.#clock()).toISOString();

    // Fresh mandate validity check
    if (!this.#deps.isMandateValid(trigger.mandateRef)) {
      const record = this.#recordExecution(
        occurrenceKey,
        triggerRef,
        scheduledTime,
        now,
        "mandate_expired",
        "Mandate is no longer valid",
      );
      return { ok: true, value: record };
    }

    // Kill-switch check
    if (this.#deps.isKillSwitchActive(trigger.walletId, trigger.template.merchantId)) {
      const record = this.#recordExecution(
        occurrenceKey,
        triggerRef,
        scheduledTime,
        now,
        "kill_switch_blocked",
        "Kill switch is active",
      );
      return { ok: true, value: record };
    }

    // Fresh policy precheck
    const precheck = this.#deps.freshPolicyPrecheck(
      trigger.walletId,
      trigger.policyVersionId,
      trigger.template.merchantId,
    );
    if (precheck.outcome === "denied") {
      const record = this.#recordExecution(
        occurrenceKey,
        triggerRef,
        scheduledTime,
        now,
        "precheck_denied",
        `Policy denied: ${precheck.reasons.join(", ")}`,
      );
      return { ok: true, value: record };
    }

    // Execute the trigger
    this.#deps.onExecute(trigger, scheduledTime);

    const record = this.#recordExecution(occurrenceKey, triggerRef, scheduledTime, now, "executed");
    return { ok: true, value: record };
  }

  /**
   * Deactivates a trigger.
   */
  deactivate(triggerRef: string): boolean {
    const trigger = this.#triggers.get(triggerRef);
    if (trigger === undefined) return false;
    this.#triggers.set(triggerRef, Object.freeze({ ...trigger, active: false }));
    return true;
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────

  #isTestProvider(merchantId: MerchantId): boolean {
    return (merchantId as string).startsWith(TEST_PROVIDER_PREFIX);
  }

  #computeOccurrenceKey(triggerRef: string, scheduledTime: string): string {
    const input = `${triggerRef}:${scheduledTime}`;
    return createHash("sha256").update(input).digest("hex");
  }

  #recordExecution(
    occurrenceKey: string,
    triggerRef: string,
    scheduledTime: string,
    executedAt: string,
    outcome: TriggerExecutionRecord["outcome"],
    reason?: string,
  ): TriggerExecutionRecord {
    const record: TriggerExecutionRecord = Object.freeze({
      occurrenceKey,
      triggerRef,
      scheduledTime,
      executedAt,
      outcome,
      reason,
    });
    this.#executions.set(occurrenceKey, record);
    return record;
  }
}
