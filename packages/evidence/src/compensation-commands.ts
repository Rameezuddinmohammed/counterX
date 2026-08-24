/**
 * Typed compensation commands and executor port.
 *
 * Defines specific compensation command types for actionable findings:
 * - RefundCompensation: issue a refund for amount mismatch
 * - VoidCompensation: void an authorization for unauthorized charges
 * - CancelCompensation: cancel an order that is stale or orphaned
 * - ManualReviewCompensation: escalate to human review
 *
 * The CompensationExecutor port allows pluggable execution backends.
 * InMemoryCompensationExecutor is provided for testing.
 */

import type { CounterId, Instant, Money } from "@counter/domain";
import type { CompensationType, FindingRecord } from "./types.js";

// ---------------------------------------------------------------------------
// Compensation Command Types
// ---------------------------------------------------------------------------

interface BaseCompensationCommand {
  readonly id: string;
  readonly type: CompensationType;
  readonly findingId: CounterId<"finding">;
  readonly transactionId: CounterId<"transaction">;
  readonly idempotencyKey: string;
  readonly createdAt: Instant;
}

export interface RefundCompensation extends BaseCompensationCommand {
  readonly type: "refund";
  readonly amount: Money;
  readonly reason: string;
  readonly providerPaymentId: string;
}

export interface VoidCompensation extends BaseCompensationCommand {
  readonly type: "void";
  readonly authorizationId: string;
  readonly reason: string;
}

export interface CancelCompensation extends BaseCompensationCommand {
  readonly type: "cancel_order";
  readonly orderId: string;
  readonly reason: string;
}

export interface ManualReviewCompensation extends BaseCompensationCommand {
  readonly type: "escalate_human";
  readonly assignee: string;
  readonly severity: string;
  readonly description: string;
}

export type CompensationCommand =
  | RefundCompensation
  | VoidCompensation
  | CancelCompensation
  | ManualReviewCompensation;

// ---------------------------------------------------------------------------
// Compensation Execution Result
// ---------------------------------------------------------------------------

export interface CompensationExecutionResult {
  readonly commandId: string;
  readonly status: "executed" | "failed" | "queued";
  readonly detail: string;
  readonly executedAt: Instant;
}

// ---------------------------------------------------------------------------
// CompensationExecutor Port Interface
// ---------------------------------------------------------------------------

/**
 * Port interface for executing compensation commands.
 * Implementations must be idempotent (same idempotencyKey = same result).
 */
export interface CompensationExecutor {
  execute(command: CompensationCommand): Promise<CompensationExecutionResult>;
}

// ---------------------------------------------------------------------------
// InMemoryCompensationExecutor (for testing)
// ---------------------------------------------------------------------------

export class InMemoryCompensationExecutor implements CompensationExecutor {
  readonly #executed: CompensationCommand[] = [];
  readonly #results: CompensationExecutionResult[] = [];
  readonly #seenKeys: Map<string, CompensationExecutionResult> = new Map();
  #shouldFail = false;

  /**
   * Configure the executor to fail on next execution (for testing error paths).
   */
  public setFailMode(fail: boolean): void {
    this.#shouldFail = fail;
  }

  public async execute(command: CompensationCommand): Promise<CompensationExecutionResult> {
    // Idempotency check
    const existing = this.#seenKeys.get(command.idempotencyKey);
    if (existing !== undefined) {
      return existing;
    }

    if (this.#shouldFail) {
      const failResult: CompensationExecutionResult = Object.freeze({
        commandId: command.id,
        status: "failed" as const,
        detail: `Compensation '${command.type}' failed: simulated failure`,
        executedAt: command.createdAt,
      });
      this.#seenKeys.set(command.idempotencyKey, failResult);
      this.#results.push(failResult);
      return failResult;
    }

    this.#executed.push(command);
    const result: CompensationExecutionResult = Object.freeze({
      commandId: command.id,
      status: "executed" as const,
      detail: `Compensation '${command.type}' executed successfully`,
      executedAt: command.createdAt,
    });
    this.#seenKeys.set(command.idempotencyKey, result);
    this.#results.push(result);
    return result;
  }

  /**
   * Returns all successfully executed commands for assertions.
   */
  public getExecuted(): readonly CompensationCommand[] {
    return [...this.#executed];
  }

  /**
   * Returns all execution results for assertions.
   */
  public getResults(): readonly CompensationExecutionResult[] {
    return [...this.#results];
  }

  /**
   * Resets internal state.
   */
  public reset(): void {
    this.#executed.length = 0;
    this.#results.length = 0;
    this.#seenKeys.clear();
    this.#shouldFail = false;
  }
}

// ---------------------------------------------------------------------------
// Command Factories
// ---------------------------------------------------------------------------

export interface CommandFactoryContext {
  readonly transactionId: CounterId<"transaction">;
  readonly now: Instant;
  readonly commandIdGenerator: () => string;
}

/**
 * Creates a RefundCompensation command from a price_mismatch finding.
 */
export function createRefundCommand(
  finding: FindingRecord,
  amount: Money,
  providerPaymentId: string,
  reason: string,
  context: CommandFactoryContext,
): RefundCompensation {
  return Object.freeze({
    id: context.commandIdGenerator(),
    type: "refund" as const,
    findingId: finding.id,
    transactionId: context.transactionId,
    idempotencyKey: `refund-${finding.id}-${providerPaymentId}`,
    createdAt: context.now,
    amount,
    reason,
    providerPaymentId,
  });
}

/**
 * Creates a VoidCompensation command from an orphaned_authorization finding.
 */
export function createVoidCommand(
  finding: FindingRecord,
  authorizationId: string,
  reason: string,
  context: CommandFactoryContext,
): VoidCompensation {
  return Object.freeze({
    id: context.commandIdGenerator(),
    type: "void" as const,
    findingId: finding.id,
    transactionId: context.transactionId,
    idempotencyKey: `void-${finding.id}-${authorizationId}`,
    createdAt: context.now,
    authorizationId,
    reason,
  });
}

/**
 * Creates a CancelCompensation command for stale/orphaned orders.
 */
export function createCancelCommand(
  finding: FindingRecord,
  orderId: string,
  reason: string,
  context: CommandFactoryContext,
): CancelCompensation {
  return Object.freeze({
    id: context.commandIdGenerator(),
    type: "cancel_order" as const,
    findingId: finding.id,
    transactionId: context.transactionId,
    idempotencyKey: `cancel-${finding.id}-${orderId}`,
    createdAt: context.now,
    orderId,
    reason,
  });
}

/**
 * Creates a ManualReviewCompensation command for non-automated findings.
 */
export function createManualReviewCommand(
  finding: FindingRecord,
  assignee: string,
  description: string,
  context: CommandFactoryContext,
): ManualReviewCompensation {
  return Object.freeze({
    id: context.commandIdGenerator(),
    type: "escalate_human" as const,
    findingId: finding.id,
    transactionId: context.transactionId,
    idempotencyKey: `manual-review-${finding.id}`,
    createdAt: context.now,
    assignee,
    severity: finding.severity,
    description,
  });
}
