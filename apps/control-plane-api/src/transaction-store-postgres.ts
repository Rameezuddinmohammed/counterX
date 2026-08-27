/**
 * Postgres-backed adapter for the control-plane TransactionReadStore.
 *
 * Assembles the front-end Transaction shape from the runtime.* tables using raw
 * SQL via TransactionalDatabase.query. See transaction-routes.ts for the full
 * read-model documentation (spine = workflow_intents; state/transitions =
 * lifecycle_steps; amount = spend_ledger; amount converted MINOR -> MAJOR).
 *
 * ENVIRONMENT: the runtime write paths (PostgresStepLedger, PostgresSpendLedger)
 * hardcode environment='local'; workflow_intents rows carry the real
 * environment. This store is environment-parameterized so integration tests
 * that seed rows under a chosen environment are found, and so it aligns with the
 * environment the server was constructed with (main.ts derives it from NODE_ENV).
 */
import type { TransactionalDatabase } from "@counter/data";
import {
  buildTransitions,
  deriveTransactionState,
  BUYER_REF_UNAVAILABLE,
  METHOD_UNKNOWN,
  type OrderedStep,
  type OwnedTransaction,
  type Transaction,
  type TransactionListOptions,
  type TransactionReadStore,
} from "./transaction-routes.js";

/**
 * Structural stand-in for pg's QueryResultRow (an object with an arbitrary
 * string index). `pg` is a transitive dependency via @counter/data and its
 * types are not resolvable directly from this app package, so we declare the
 * minimal constraint locally rather than adding a new dependency edge.
 */
type SqlRow = Record<string, unknown>;

interface IntentRow extends SqlRow {
  readonly transaction_id: string;
  readonly scope_id: string;
  readonly status: string;
  readonly created_at: Date;
  readonly authority_context: unknown;
}

interface StepRow extends SqlRow {
  readonly step: string;
  readonly status: string;
  readonly reference: string | null;
  readonly created_at: Date;
  readonly completed_at: Date | null;
}

interface AmountRow extends SqlRow {
  readonly amount_minor: string;
  readonly currency: string;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** Minor -> major units (INR has 2 minor digits). */
function minorToMajor(amountMinor: bigint): number {
  return Number(amountMinor) / 100;
}

function readAuthorityString(authorityContext: unknown, key: string): string | undefined {
  if (authorityContext === null || typeof authorityContext !== "object") {
    return undefined;
  }
  const value = (authorityContext as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function createPostgresTransactionStore(
  database: TransactionalDatabase,
  storeEnvironment: string,
): TransactionReadStore {
  async function loadSteps(transactionId: string, environment: string): Promise<OrderedStep[]> {
    const result = await database.query<StepRow>(
      `SELECT step, status, reference, created_at, completed_at
         FROM runtime.lifecycle_steps
        WHERE environment = $1 AND idempotency_key = $2
        ORDER BY created_at ASC, id ASC`,
      [environment, transactionId],
    );
    return result.rows.map((row) => ({
      step: row.step,
      status: row.status,
      reference: row.reference,
      timestamp: toIso(row.completed_at ?? row.created_at),
    }));
  }

  async function loadAmount(
    transactionId: string,
    environment: string,
  ): Promise<{ amount: number; currency: "INR" }> {
    const result = await database.query<AmountRow>(
      `SELECT amount_minor, currency
         FROM runtime.spend_ledger
        WHERE environment = $1 AND reference = $2
        ORDER BY id ASC
        LIMIT 1`,
      [environment, transactionId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      return { amount: 0, currency: "INR" };
    }
    // The front-end type pins currency to 'INR'; the runtime limits are also
    // denominated in INR. We surface INR regardless of the stored code.
    return { amount: minorToMajor(BigInt(row.amount_minor)), currency: "INR" };
  }

  async function assemble(intent: IntentRow, environment: string): Promise<Transaction> {
    const orderedSteps = await loadSteps(intent.transaction_id, environment);
    const { amount, currency } = await loadAmount(intent.transaction_id, environment);
    const createdAt = toIso(intent.created_at);

    const currentState = deriveTransactionState(intent.status, orderedSteps);
    const transitions = buildTransitions(orderedSteps, createdAt);

    const buyerRef =
      readAuthorityString(intent.authority_context, "buyerRef") ?? BUYER_REF_UNAVAILABLE;
    const method = readAuthorityString(intent.authority_context, "method") ?? METHOD_UNKNOWN;

    return {
      transactionId: intent.transaction_id,
      merchantId: intent.scope_id,
      amount,
      currency,
      currentState,
      buyerRef,
      method,
      createdAt,
      transitions,
    };
  }

  return {
    async list(
      merchantId: string,
      options: TransactionListOptions,
      environment: string,
    ): Promise<readonly Transaction[]> {
      const env = environment.length > 0 ? environment : storeEnvironment;
      const intents = await database.query<IntentRow>(
        `SELECT transaction_id, scope_id, status, created_at, authority_context
           FROM runtime.workflow_intents
          WHERE environment = $1 AND scope_kind = 'merchant' AND scope_id = $2
          ORDER BY created_at DESC
          LIMIT $3 OFFSET $4`,
        [env, merchantId, options.limit, options.offset],
      );
      const transactions: Transaction[] = [];
      for (const intent of intents.rows) {
        transactions.push(await assemble(intent, env));
      }
      return transactions;
    },

    async get(transactionId: string, environment: string): Promise<OwnedTransaction | undefined> {
      const env = environment.length > 0 ? environment : storeEnvironment;
      const intents = await database.query<IntentRow>(
        `SELECT transaction_id, scope_id, status, created_at, authority_context
           FROM runtime.workflow_intents
          WHERE environment = $1 AND scope_kind = 'merchant' AND transaction_id = $2
          ORDER BY created_at DESC
          LIMIT 1`,
        [env, transactionId],
      );
      const intent = intents.rows[0];
      if (intent === undefined) {
        return undefined;
      }
      const transaction = await assemble(intent, env);
      return { merchantId: intent.scope_id, transaction };
    },
  };
}
