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
  SETTLED_STATE,
  SETTLEMENT_SCAN_CAP,
  type OrderedStep,
  type OwnedTransaction,
  type SettlementSummary,
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

/**
 * Aggregated spend-ledger amount for one transaction reference.
 *
 * `row_count` is carried separately because SUM over zero rows COALESCEs to 0,
 * which is indistinguishable from a genuine zero total — and those two cases
 * need different handling (fall back to the durable intent's own amount vs.
 * report zero).
 */
interface AmountSumRow extends SqlRow {
  readonly amount_minor: string;
  readonly row_count: number;
}

/**
 * One intent row per transaction_id — the newest.
 *
 * `runtime.workflow_intents` has no uniqueness guarantee on transaction_id, and
 * the worker can legitimately write more than one intent row for a single
 * transaction (a retry after an indeterminate outcome, for instance). Selecting
 * from the table directly therefore emitted the SAME transaction twice in a
 * list, and would double-count it in any total. DISTINCT ON keeps the latest.
 *
 * Expects $1 = environment and $2 = merchantId. Callers supply their own outer
 * ORDER BY, because DISTINCT ON forces its own leading sort key
 * (transaction_id) that is not the order any caller actually wants.
 */
const DEDUPED_INTENTS_CTE = `
  WITH latest_intents AS (
    SELECT DISTINCT ON (transaction_id)
           transaction_id, scope_id, status, created_at, authority_context
      FROM runtime.workflow_intents
     WHERE environment = $1 AND scope_kind = 'merchant' AND scope_id = $2
     ORDER BY transaction_id, created_at DESC
  )`;

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

/** Minor units straight from the durable intent — no float round-trip. */
function readAuthorityAmountMinor(authorityContext: unknown): bigint | undefined {
  if (authorityContext === null || typeof authorityContext !== "object") {
    return undefined;
  }
  const context = authorityContext as Record<string, unknown>;
  const amountMinor = context["amountMinor"];
  const currency = context["currency"];
  if (
    typeof amountMinor !== "number" ||
    !Number.isSafeInteger(amountMinor) ||
    amountMinor <= 0 ||
    currency !== "INR"
  ) {
    return undefined;
  }
  return BigInt(amountMinor);
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

  /**
   * Total reserved spend for one transaction, in INTEGER minor units.
   *
   * Aggregates rather than picking a row. The previous version was
   * `ORDER BY id ASC LIMIT 1`, which silently returned only ONE reservation
   * when a single transaction reference had several spend_ledger rows (the
   * ledger is keyed `(environment, wallet, reference)`, so a multi-wallet
   * reference legitimately produces more than one) — under-reporting the
   * amount, and picking arbitrarily among equals. Summing is both deterministic
   * and correct for the single-row case that is normal today.
   */
  async function loadAmountMinor(
    transactionId: string,
    environment: string,
    authorityContext: unknown,
  ): Promise<bigint> {
    const result = await database.query<AmountSumRow>(
      `SELECT COALESCE(SUM(amount_minor), 0)::text AS amount_minor,
              COUNT(*)::int AS row_count
         FROM runtime.spend_ledger
        WHERE environment = $1 AND reference = $2`,
      [environment, transactionId],
    );
    const row = result.rows[0];
    if (row === undefined || row.row_count === 0) {
      // The worker writes the intended amount into the durable transaction
      // spine before it calls a provider. This preserves an honest amount for
      // an in-flight/indeterminate transaction when the spend reservation is
      // absent or has not been committed yet.
      return readAuthorityAmountMinor(authorityContext) ?? 0n;
    }
    return BigInt(row.amount_minor);
  }

  async function assemble(intent: IntentRow, environment: string): Promise<Transaction> {
    const orderedSteps = await loadSteps(intent.transaction_id, environment);
    const amountMinor = await loadAmountMinor(
      intent.transaction_id,
      environment,
      intent.authority_context,
    );
    // The front-end type pins currency to 'INR'; the runtime limits are also
    // denominated in INR. We surface INR regardless of the stored code.
    const amount = minorToMajor(amountMinor);
    const currency = "INR" as const;
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
        `${DEDUPED_INTENTS_CTE}
         SELECT transaction_id, scope_id, status, created_at, authority_context
           FROM latest_intents
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

    /**
     * See {@link SettlementSummary}. Derived on every call; nothing is stored.
     *
     * The `settled` test deliberately reuses deriveTransactionState rather than
     * re-expressing "has a completed markPaid, no declined step, intent not
     * failed" as a SQL predicate. Two copies of that rule in two languages is
     * exactly how a money total drifts away from the state the UI shows for the
     * same transaction. The cost is the same N+1 query shape list() already has,
     * bounded by SETTLEMENT_SCAN_CAP.
     *
     * Totals accumulate in bigint minor units — never a float.
     */
    async settlementSummary(merchantId: string, environment: string): Promise<SettlementSummary> {
      const env = environment.length > 0 ? environment : storeEnvironment;
      // Fetch one more than the cap purely to detect truncation honestly.
      const intents = await database.query<IntentRow>(
        `${DEDUPED_INTENTS_CTE}
         SELECT transaction_id, scope_id, status, created_at, authority_context
           FROM latest_intents
          ORDER BY created_at DESC
          LIMIT $3`,
        [env, merchantId, SETTLEMENT_SCAN_CAP + 1],
      );

      const truncated = intents.rows.length > SETTLEMENT_SCAN_CAP;
      const scanned = truncated ? intents.rows.slice(0, SETTLEMENT_SCAN_CAP) : intents.rows;

      let pendingMinor = 0n;
      let orderCount = 0;
      for (const intent of scanned) {
        const orderedSteps = await loadSteps(intent.transaction_id, env);
        if (deriveTransactionState(intent.status, orderedSteps) !== SETTLED_STATE) {
          continue;
        }
        pendingMinor += await loadAmountMinor(intent.transaction_id, env, intent.authority_context);
        orderCount += 1;
      }

      return {
        pendingMinor: pendingMinor.toString(),
        currency: "INR",
        orderCount,
        truncated,
      };
    },
  };
}
