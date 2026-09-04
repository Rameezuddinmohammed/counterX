/**
 * Read model for the agent-runtime transactionStatus/receipt/cancel/refund
 * handlers.
 *
 * Reads the SAME durable spine the worker writes for real: runtime.
 * workflow_intents (status + authority context, written pre-effect by
 * PostgresTransactionProjectionStore) and runtime.lifecycle_steps (the
 * per-step outcome ledger). Mirrors apps/control-plane-api's
 * transaction-store-postgres.ts read pattern, adapted to this app's
 * TransactionStatusResult status vocabulary.
 *
 * Environment-parameterized like every other durable repository in this
 * codebase — see packages/data's PostgresStepLedger et al.
 */
import type { TransactionalDatabase } from "@counter/data";
import type { Environment } from "@counter/domain";

type SqlRow = Record<string, unknown>;

interface IntentRow extends SqlRow {
  readonly transaction_id: string;
  readonly scope_id: string;
  readonly status: string;
  readonly authority_context: unknown;
  readonly created_at: Date;
}

interface StepRow extends SqlRow {
  readonly step: string;
  readonly status: string;
  readonly reference: string | null;
  readonly completed_at: Date | null;
  readonly created_at: Date;
}

const STEP_DRAFT = "shopify.draft";
const STEP_FINALIZE = "shopify.finalize";
const STEP_MARK_PAID = "shopify.markPaid";
const STEP_REFUND = "shopify.refund";
const STEP_CANCEL = "shopify.cancel";

export type MerchantTransactionStatus =
  | "pending"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "refunded";

export interface TransactionRecord {
  readonly transactionId: string;
  readonly merchantId: string;
  readonly amountMinor: number;
  readonly currency: "INR";
  readonly status: MerchantTransactionStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

function toIso(value: Date): string {
  return value.toISOString();
}

function readAuthorityAmount(authorityContext: unknown): number | undefined {
  if (authorityContext === null || typeof authorityContext !== "object") {
    return undefined;
  }
  const value = (authorityContext as Record<string, unknown>)["amountMinor"];
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

/**
 * The buyer wallet id bound to this transaction at creation time (see
 * `walletId: buyerWalletId ?? ctx.merchantId` in transactionCreate's job
 * payload — a transaction created without a real signed buyer envelope has
 * no genuine buyer wallet and falls back to the merchant id, which can
 * never match a real caller's wallet id).
 */
function readAuthorityWalletId(authorityContext: unknown): string | undefined {
  if (authorityContext === null || typeof authorityContext !== "object") {
    return undefined;
  }
  const value = (authorityContext as Record<string, unknown>)["walletId"];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Derives the merchant-facing status from the intent status plus the
 * per-step outcomes. A declined step or a failed intent both surface as
 * "cancelled" — this handler contract has no distinct "failed" status; see
 * the caller for that known interface gap.
 */
function deriveStatus(intentStatus: string, steps: readonly StepRow[]): MerchantTransactionStatus {
  const completed = new Set(steps.filter((s) => s.status === "completed").map((s) => s.step));
  const declined = steps.some((s) => s.status === "declined");

  if (completed.has(STEP_REFUND)) {
    return "refunded";
  }
  if (completed.has(STEP_CANCEL)) {
    return "cancelled";
  }
  if (intentStatus === "failed" || declined) {
    return "cancelled";
  }
  if (completed.has(STEP_MARK_PAID)) {
    return "completed";
  }
  if (completed.has(STEP_FINALIZE) || completed.has(STEP_DRAFT)) {
    return "confirmed";
  }
  return "pending";
}

export class TransactionReadModel {
  constructor(
    private readonly database: TransactionalDatabase,
    private readonly environment: Environment,
  ) {}

  private async loadSteps(transactionId: string): Promise<StepRow[]> {
    const result = await this.database.query<StepRow>(
      `SELECT step, status, reference, completed_at, created_at
         FROM runtime.lifecycle_steps
        WHERE environment = $1 AND idempotency_key = $2
        ORDER BY created_at ASC`,
      [this.environment, transactionId],
    );
    return result.rows;
  }

  /**
   * `callerWalletId`, when provided (i.e. the request is from a
   * wallet-scoped buyer, not a merchant/platform caller), must match the
   * transaction's own bound buyer wallet id or this returns `undefined` —
   * identical to a genuinely nonexistent transaction. This is what stops
   * one buyer from reading or acting on another buyer's transaction merely
   * by knowing/guessing its id, now that `verifyTenantAccess` lets any
   * wallet call a merchant's transaction routes.
   */
  async get(
    transactionId: string,
    merchantId: string,
    callerWalletId?: string,
  ): Promise<TransactionRecord | undefined> {
    const intents = await this.database.query<IntentRow>(
      `SELECT transaction_id, scope_id, status, authority_context, created_at
         FROM runtime.workflow_intents
        WHERE environment = $1 AND scope_kind = 'merchant' AND scope_id = $2 AND transaction_id = $3
        ORDER BY created_at DESC
        LIMIT 1`,
      [this.environment, merchantId, transactionId],
    );
    const intent = intents.rows[0];
    if (intent === undefined) {
      return undefined;
    }
    if (
      callerWalletId !== undefined &&
      readAuthorityWalletId(intent.authority_context) !== callerWalletId
    ) {
      return undefined;
    }
    const steps = await this.loadSteps(transactionId);
    const latestActivity = steps.reduce<Date>((latest, step) => {
      const candidate = step.completed_at ?? step.created_at;
      return candidate > latest ? candidate : latest;
    }, intent.created_at);

    return Object.freeze({
      transactionId: intent.transaction_id,
      merchantId: intent.scope_id,
      amountMinor: readAuthorityAmount(intent.authority_context) ?? 0,
      currency: "INR" as const,
      status: deriveStatus(intent.status, steps),
      createdAt: toIso(intent.created_at),
      updatedAt: toIso(latestActivity),
    });
  }

  /** The provider reference recorded for a specific step (e.g. Shopify order id from markPaid). */
  async stepReference(transactionId: string, step: string): Promise<string | undefined> {
    const result = await this.database.query<{ reference: string | null }>(
      `SELECT reference FROM runtime.lifecycle_steps
        WHERE environment = $1 AND idempotency_key = $2 AND step = $3`,
      [this.environment, transactionId, step],
    );
    return result.rows[0]?.reference ?? undefined;
  }
}

export { STEP_DRAFT, STEP_FINALIZE, STEP_MARK_PAID, STEP_REFUND, STEP_CANCEL };
