/**
 * Merchant-facing side of the refund RELAY: list pending requests, and
 * approve/deny them.
 *
 * The OTHER half — filing a request — lives in apps/agent-runtime/src/
 * real-handlers.ts's createRefundHandler, which only INSERTs a 'pending'
 * runtime.refund_requests row (migration 0014) and never calls Razorpay.
 * This file is where the actual Razorpay refund call now happens — the ONE
 * place, not duplicated: the immediate-refund code that used to live inline
 * in agent-runtime's createRefundHandler was fully replaced by approve()
 * below, not copied.
 *
 * WHY A RELAY: for a merchant using CounterX's own Razorpay integration,
 * CounterX could technically call the refund API directly. But for a
 * merchant on their own separate payment gateway (parallel work, not yet
 * built), CounterX has no ability to reverse a charge it never processed —
 * relay is the ONLY option there. Rather than run two different refund
 * workflows, every merchant gets the same one: request captured, merchant
 * decides (manually here, or later via their own configured auto-approve
 * threshold — the `autoApproved` field exists in the schema for that, but
 * no auto-approve logic is implemented yet), executed only on approval.
 *
 * Same direct-SQL trust boundary as recurring-mandate-store.ts and
 * wallet-user-store.ts (see those files' headers for the full rationale):
 * writes go straight through parameterized SQL against
 * runtime.refund_requests rather than the RBAC-gated repository layer.
 *
 * CONCURRENCY: approve() first atomically claims the row (pending ->
 * approved, via an UPDATE ... WHERE status = 'pending') before calling
 * Razorpay, so two concurrent approve calls for the same request cannot
 * both reach the provider. If the provider call or the step-ledger write
 * fails, the claim is reverted back to 'pending' — never left stuck in
 * 'approved' with no actual effect, and never silently marked 'executed'
 * without a durable Razorpay reference (see CLAUDE.md's "no silent
 * consequential failure").
 */
import type { Environment, Instant, IsoCurrencyCode } from "@counter/domain";
import {
  PostgresOutboxRepository,
  PostgresStepLedger,
  type TransactionalDatabase,
} from "@counter/data";
import type { PaymentOperationResult, RefundCommand } from "@counter/payment-sdk";

/** Same step name the (now superseded) immediate-refund path recorded — see transaction-read-model.ts / transaction-store-postgres.ts, which both derive "refunded" status from this. */
const STEP_REFUND = "shopify.refund";
const RECEIPT_EVENT_TYPE = "transaction.receipt.v1";

export interface RefundRequestSummary {
  readonly id: string;
  readonly transactionId: string;
  readonly merchantId: string;
  readonly requestedAmountMinor: string;
  readonly currency: string;
  readonly reason: string;
  readonly status: "pending" | "approved" | "denied" | "executed";
  readonly autoApproved: boolean;
  readonly providerReference: string | null;
  readonly requestedAt: string;
  readonly decidedAt: string | null;
  readonly decidedBy: string | null;
}

/**
 * Structural interface for the subset of RazorpayTestProvider's surface
 * this store actually calls — lets tests inject a fake instead of
 * requiring live Razorpay credentials, matching RazorpayRecurringMandateProviderLike's
 * existing separation in this app.
 */
export interface RazorpayRefundProviderLike {
  refund(command: RefundCommand): Promise<PaymentOperationResult>;
}

export interface RefundRequestStoreLike {
  list(merchantId: string): Promise<readonly RefundRequestSummary[]>;
  approve(
    merchantId: string,
    refundRequestId: string,
    decidedBy: string,
  ): Promise<RefundRequestSummary>;
  deny(
    merchantId: string,
    refundRequestId: string,
    decidedBy: string,
  ): Promise<RefundRequestSummary>;
}

export class RefundRequestNotFoundError extends Error {
  constructor(refundRequestId: string) {
    super(`No pending refund request: ${refundRequestId}`);
    this.name = "RefundRequestNotFoundError";
  }
}

/**
 * Thrown when Razorpay declines/cannot confirm the refund, or the receipt
 * can't be resolved. The request is reverted to 'pending' before this is
 * thrown, so it can be retried — nothing is silently marked
 * approved/executed on a failed attempt.
 */
export class RefundExecutionFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RefundExecutionFailedError";
  }
}

interface RefundRequestRow {
  readonly id: string;
  readonly transaction_id: string;
  readonly merchant_id: string;
  readonly requested_amount_minor: string;
  readonly currency: string;
  readonly reason: string;
  readonly status: "pending" | "approved" | "denied" | "executed";
  readonly auto_approved: boolean;
  readonly provider_reference: string | null;
  readonly requested_at: Date;
  readonly decided_at: Date | null;
  readonly decided_by: string | null;
}

function toSummary(row: RefundRequestRow): RefundRequestSummary {
  return {
    id: row.id,
    transactionId: row.transaction_id,
    merchantId: row.merchant_id,
    requestedAmountMinor: row.requested_amount_minor,
    currency: row.currency,
    reason: row.reason,
    status: row.status,
    autoApproved: row.auto_approved,
    providerReference: row.provider_reference,
    requestedAt: row.requested_at.toISOString(),
    decidedAt: row.decided_at === null ? null : row.decided_at.toISOString(),
    decidedBy: row.decided_by,
  };
}

const SELECT_COLUMNS = `id, transaction_id, merchant_id, requested_amount_minor, currency, reason,
              status, auto_approved, provider_reference, requested_at, decided_at, decided_by`;

export class RefundRequestStore implements RefundRequestStoreLike {
  constructor(
    private readonly database: TransactionalDatabase,
    private readonly environment: Environment,
    private readonly razorpay: RazorpayRefundProviderLike,
  ) {}

  async list(merchantId: string): Promise<readonly RefundRequestSummary[]> {
    const result = await this.database.query<RefundRequestRow>(
      `SELECT ${SELECT_COLUMNS}
         FROM runtime.refund_requests
        WHERE environment = $1 AND merchant_id = $2
        ORDER BY requested_at DESC`,
      [this.environment, merchantId],
    );
    return result.rows.map(toSummary);
  }

  async deny(
    merchantId: string,
    refundRequestId: string,
    decidedBy: string,
  ): Promise<RefundRequestSummary> {
    const now = new Date().toISOString();
    const result = await this.database.query<RefundRequestRow>(
      `UPDATE runtime.refund_requests
          SET status = 'denied', decided_at = $1, decided_by = $2, updated_at = $1
        WHERE environment = $3 AND id = $4 AND merchant_id = $5 AND status = 'pending'
      RETURNING ${SELECT_COLUMNS}`,
      [now, decidedBy, this.environment, refundRequestId, merchantId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new RefundRequestNotFoundError(refundRequestId);
    }
    return toSummary(row);
  }

  async approve(
    merchantId: string,
    refundRequestId: string,
    decidedBy: string,
  ): Promise<RefundRequestSummary> {
    // Atomically claim the request (pending -> approved) BEFORE touching
    // Razorpay, so a second concurrent approve() call for the same request
    // finds zero rows and fails fast instead of racing into a second
    // provider call.
    const claimedAt = new Date().toISOString();
    const claimed = await this.database.query<RefundRequestRow>(
      `UPDATE runtime.refund_requests
          SET status = 'approved', decided_at = $1, decided_by = $2, updated_at = $1
        WHERE environment = $3 AND id = $4 AND merchant_id = $5 AND status = 'pending'
      RETURNING ${SELECT_COLUMNS}`,
      [claimedAt, decidedBy, this.environment, refundRequestId, merchantId],
    );
    const row = claimed.rows[0];
    if (row === undefined) {
      throw new RefundRequestNotFoundError(refundRequestId);
    }

    // Phase 1: resolve the receipt and call Razorpay. Nothing external has
    // happened yet, so ANY failure here is safe to revert the claim for.
    let refundReference: string;
    try {
      const outbox = new PostgresOutboxRepository(this.database, this.environment);
      const receipt = await outbox.findByIdempotencyKey(row.transaction_id, RECEIPT_EVENT_TYPE);
      if (!receipt.ok) {
        throw new RefundExecutionFailedError(`Failed to load receipt: ${receipt.error.message}`);
      }
      const providerReference =
        receipt.value !== undefined &&
        typeof receipt.value.payload === "object" &&
        receipt.value.payload !== null
          ? (receipt.value.payload as Record<string, unknown>)["providerReference"]
          : undefined;
      if (typeof providerReference !== "string" || providerReference.length === 0) {
        throw new RefundExecutionFailedError(
          "No captured payment on record for this transaction — nothing to refund",
        );
      }

      const outcome = await this.razorpay.refund({
        reference: providerReference as unknown as RefundCommand["reference"],
        amount: {
          amountMinor: BigInt(row.requested_amount_minor),
          currency: row.currency as IsoCurrencyCode,
        },
        reason: row.reason,
        idempotencyKey: `${row.transaction_id}:refund`,
      });

      if (outcome.kind === "indeterminate") {
        throw new RefundExecutionFailedError(
          "Refund outcome is indeterminate — check the transaction/receipt before retrying",
        );
      }
      if (outcome.kind === "declined") {
        throw new RefundExecutionFailedError(`Razorpay refund declined: ${outcome.reason.reason}`);
      }
      if (outcome.kind !== "confirmed") {
        throw new RefundExecutionFailedError(
          `Unexpected refund outcome '${outcome.kind}' from Razorpay`,
        );
      }
      refundReference = String(outcome.evidence.reference);
    } catch (error) {
      // Nothing was actually refunded — revert the claim so the merchant
      // can retry, rather than leaving the request stuck in 'approved'
      // with no effect and no way to act on it again.
      await this.database.query(
        `UPDATE runtime.refund_requests
            SET status = 'pending', decided_at = NULL, decided_by = NULL, updated_at = $1
          WHERE environment = $2 AND id = $3 AND status = 'approved'`,
        [new Date().toISOString(), this.environment, refundRequestId],
      );
      throw error;
    }

    // Phase 2: Razorpay has CONFIRMED the refund. Money has actually moved —
    // from here on, a failure must NEVER revert to 'pending' (that would
    // invite a second, duplicate refund attempt on retry). It must surface
    // loudly for manual follow-up instead.
    const now = Date.now();
    const stepLedger = new PostgresStepLedger(this.database, this.environment);
    const recorded = await stepLedger.record(
      row.transaction_id,
      {
        step: STEP_REFUND,
        status: "completed",
        reference: refundReference,
        snapshot: { reason: row.reason, refundRequestId: row.id },
      },
      now as Instant,
    );
    if (!recorded.ok) {
      throw new RefundExecutionFailedError(
        `Refund succeeded at Razorpay (ref ${refundReference}) but failed to record the step: ${recorded.error.message}`,
      );
    }

    const executedAt = new Date(now).toISOString();
    const updated = await this.database.query<RefundRequestRow>(
      `UPDATE runtime.refund_requests
          SET status = 'executed', provider_reference = $1, updated_at = $2
        WHERE environment = $3 AND id = $4
      RETURNING ${SELECT_COLUMNS}`,
      [refundReference, executedAt, this.environment, refundRequestId],
    );
    const updatedRow = updated.rows[0];
    if (updatedRow === undefined) {
      // The refund DID happen and IS durably recorded in the step ledger
      // above — only this row's status update failed. Surface loudly
      // rather than fabricate a summary that doesn't match stored state.
      throw new RefundExecutionFailedError(
        `Refund succeeded and was recorded (ref ${refundReference}), but the refund-request row could not be updated`,
      );
    }
    return toSummary(updatedRow);
  }
}
