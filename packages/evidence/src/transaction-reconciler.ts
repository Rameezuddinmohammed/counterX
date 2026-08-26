/**
 * Transaction reconciler service.
 *
 * Collects observations from all relevant sources for a transaction,
 * invokes reconcileTransaction() to detect discrepancies, creates
 * typed findings, dispatches compensation commands for actionable
 * findings, and creates human task entries for non-automated findings.
 */

import type { CounterId, Instant } from "@counter/domain";
import { createMoney } from "@counter/domain";
import type { EvidenceRecord, FindingRecord, FindingType } from "./types.js";
import { reconcileTransaction } from "./reconciliation.js";
import type { ReconcileOptions } from "./reconciliation.js";
import type {
  CompensationCommand,
  CompensationExecutionResult,
  CompensationExecutor,
  CommandFactoryContext,
} from "./compensation-commands.js";
import {
  createCancelCommand,
  createRefundCommand,
  createVoidCommand,
} from "./compensation-commands.js";

// ---------------------------------------------------------------------------
// Human Task
// ---------------------------------------------------------------------------

export interface HumanTask {
  readonly id: string;
  readonly findingId: CounterId<"finding">;
  readonly transactionId: CounterId<"transaction">;
  readonly type: string;
  readonly severity: string;
  readonly description: string;
  readonly assignee: string;
  readonly createdAt: Instant;
  readonly status: "pending" | "in_progress" | "completed" | "dismissed";
}

// ---------------------------------------------------------------------------
// Reconciliation Result
// ---------------------------------------------------------------------------

export interface ReconciliationResult {
  readonly transactionId: CounterId<"transaction">;
  readonly findings: readonly FindingRecord[];
  readonly compensationResults: readonly CompensationExecutionResult[];
  readonly humanTasks: readonly HumanTask[];
  readonly reconciledAt: Instant;
}

// ---------------------------------------------------------------------------
// Observation Source Port
// ---------------------------------------------------------------------------

/**
 * Port interface for collecting observations from external sources.
 * Implementations fetch observations from Shopify, Razorpay, TestProvider, etc.
 */
export interface ObservationCollector {
  collectObservations(transactionId: CounterId<"transaction">): Promise<readonly EvidenceRecord[]>;
}

// ---------------------------------------------------------------------------
// Finding Type to Compensation Mapping
// ---------------------------------------------------------------------------

/** Finding types that trigger automated compensation commands. */
const AUTOMATED_FINDING_TYPES: ReadonlySet<FindingType> = new Set([
  "price_mismatch",
  "orphaned_authorization",
  "payment_order_mismatch",
  "stale_evidence",
]);

/** Finding types that require human review. */
const HUMAN_REVIEW_FINDING_TYPES: ReadonlySet<FindingType> = new Set([
  "intent_authority_mismatch",
  "integrity_failure",
  "refund_mismatch",
  "duplicate_effect",
  "fulfillment_mismatch",
  "resolved_indeterminate",
]);

/** Assignees for different finding types. */
const FINDING_ASSIGNEES: Readonly<Record<string, string>> = Object.freeze({
  intent_authority_mismatch: "trust-team",
  integrity_failure: "security-oncall",
  refund_mismatch: "disputes-team",
  duplicate_effect: "payments-oncall",
  fulfillment_mismatch: "logistics-team",
  resolved_indeterminate: "operations-team",
});

// ---------------------------------------------------------------------------
// TransactionReconciler
// ---------------------------------------------------------------------------

export interface TransactionReconcilerConfig {
  readonly findingIdGenerator: () => CounterId<"finding">;
  readonly commandIdGenerator: () => string;
  readonly humanTaskIdGenerator: () => string;
  readonly staleThresholdMs?: number;
}

export class TransactionReconciler {
  readonly #executor: CompensationExecutor;
  readonly #config: TransactionReconcilerConfig;

  constructor(executor: CompensationExecutor, config: TransactionReconcilerConfig) {
    this.#executor = executor;
    this.#config = config;
  }

  /**
   * Reconciles a transaction by collecting observations, detecting
   * discrepancies, dispatching compensation, and creating human tasks.
   */
  public async reconcile(
    observations: readonly EvidenceRecord[],
    now: Instant,
  ): Promise<ReconciliationResult> {
    if (observations.length === 0) {
      const transactionId = "ctr_transaction_AAAAAAAAAAAAAAAAAAAAAA" as CounterId<"transaction">;
      return Object.freeze({
        transactionId,
        findings: Object.freeze([]),
        compensationResults: Object.freeze([]),
        humanTasks: Object.freeze([]),
        reconciledAt: now,
      });
    }

    const firstRecord = observations[0]!;
    const transactionId = firstRecord.transactionId;

    // Step 1: Run reconciliation to detect findings
    const reconcileOptions: ReconcileOptions = this.#config.staleThresholdMs !== undefined
      ? {
          findingIdGenerator: this.#config.findingIdGenerator,
          now,
          staleThresholdMs: this.#config.staleThresholdMs,
        }
      : {
          findingIdGenerator: this.#config.findingIdGenerator,
          now,
        };

    const findings = reconcileTransaction(observations, reconcileOptions);

    // Step 2: Dispatch compensation for actionable findings
    const compensationResults: CompensationExecutionResult[] = [];
    const humanTasks: HumanTask[] = [];

    const commandContext: CommandFactoryContext = {
      transactionId,
      now,
      commandIdGenerator: this.#config.commandIdGenerator,
    };

    for (const finding of findings) {
      if (AUTOMATED_FINDING_TYPES.has(finding.type)) {
        const command = this.#buildCompensationCommand(finding, observations, commandContext);
        if (command !== undefined) {
          const result = await this.#executor.execute(command);
          compensationResults.push(result);
        }
      }

      if (HUMAN_REVIEW_FINDING_TYPES.has(finding.type)) {
        const task = this.#createHumanTask(finding, transactionId, now);
        humanTasks.push(task);
      }
    }

    return Object.freeze({
      transactionId,
      findings,
      compensationResults: Object.freeze(compensationResults),
      humanTasks: Object.freeze(humanTasks),
      reconciledAt: now,
    });
  }

  #buildCompensationCommand(
    finding: FindingRecord,
    observations: readonly EvidenceRecord[],
    context: CommandFactoryContext,
  ): CompensationCommand | undefined {
    switch (finding.type) {
      case "price_mismatch": {
        // Find the conflicting amounts and issue a refund for the difference
        const paymentRecords = observations.filter(
          (r) =>
            r.source === "payment_provider" &&
            (r.canonicalClaim.type === "payment_confirmed" ||
              r.canonicalClaim.type === "payment_pending"),
        );
        const firstPayment = paymentRecords[0];
        if (firstPayment === undefined) return undefined;

        const amounts = paymentRecords
          .map((r) => r.canonicalClaim.details["amount"])
          .filter((a): a is number => typeof a === "number");

        if (amounts.length < 2) return undefined;

        const maxAmount = Math.max(...amounts);
        const minAmount = Math.min(...amounts);
        const difference = maxAmount - minAmount;

        const moneyResult = createMoney(BigInt(difference), "INR");
        if (!moneyResult.ok) return undefined;

        return createRefundCommand(
          finding,
          moneyResult.value,
          String((firstPayment.canonicalClaim.details["paymentId"] as string | undefined) ?? firstPayment.sourceId),
          "Price mismatch detected during reconciliation",
          context,
        );
      }

      case "orphaned_authorization": {
        const authRecord = observations.find(
          (r) =>
            r.source === "payment_provider" &&
            r.canonicalClaim.type === "authorization_created",
        );
        if (authRecord === undefined) return undefined;

        return createVoidCommand(
          finding,
          String((authRecord.canonicalClaim.details["authorizationId"] as string | undefined) ?? authRecord.sourceId),
          "Orphaned authorization detected, no corresponding capture or void",
          context,
        );
      }

      case "payment_order_mismatch": {
        // If payment exists but no order, void the authorization
        const authRecord = observations.find(
          (r) =>
            r.source === "payment_provider" &&
            r.canonicalClaim.type === "authorization_created",
        );
        if (authRecord !== undefined) {
          return createVoidCommand(
            finding,
            String((authRecord.canonicalClaim.details["authorizationId"] as string | undefined) ?? authRecord.sourceId),
            "Payment/order mismatch: payment exists without order commitment",
            context,
          );
        }
        // If order exists but no payment, cancel the order
        const orderRecord = observations.find(
          (r) =>
            r.source === "merchant_connector" &&
            r.canonicalClaim.type === "order_committed",
        );
        if (orderRecord !== undefined) {
          return createCancelCommand(
            finding,
            String((orderRecord.canonicalClaim.details["orderId"] as string | undefined) ?? orderRecord.sourceId),
            "Payment/order mismatch: order exists without payment confirmation",
            context,
          );
        }
        return undefined;
      }

      case "stale_evidence": {
        // Stale evidence triggers a cancel for any associated order
        const orderRecord = observations.find(
          (r) =>
            r.source === "merchant_connector" &&
            (r.canonicalClaim.type === "order_committed" ||
              r.canonicalClaim.type === "order_cancelled"),
        );
        if (orderRecord !== undefined) {
          return createCancelCommand(
            finding,
            String((orderRecord.canonicalClaim.details["orderId"] as string | undefined) ?? orderRecord.sourceId),
            "Stale evidence detected, cancelling associated order",
            context,
          );
        }
        return undefined;
      }

      default:
        return undefined;
    }
  }

  #createHumanTask(
    finding: FindingRecord,
    transactionId: CounterId<"transaction">,
    now: Instant,
  ): HumanTask {
    const assignee = FINDING_ASSIGNEES[finding.type] ?? "operations-team";

    return Object.freeze({
      id: this.#config.humanTaskIdGenerator(),
      findingId: finding.id,
      transactionId,
      type: finding.type,
      severity: finding.severity,
      description: `Finding '${finding.type}' (${finding.severity}) requires human review`,
      assignee,
      createdAt: now,
      status: "pending" as const,
    });
  }
}
