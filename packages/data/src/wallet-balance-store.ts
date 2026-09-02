/**
 * Durable, cross-instance prepaid wallet balance (Postgres).
 *
 * See migration 0021's header for the full rationale. In short: a human funds
 * a wallet with ONE real Razorpay TEST MODE one-time payment (topUp), and
 * every subsequent agent purchase draws down that already-collected balance
 * (debit) under Counter's own real policy checks — no further
 * payment-provider round trip per purchase.
 *
 * Both operations are ATOMIC check-and-mutate inside a single database
 * transaction, mirroring PostgresSpendLedger's concurrency pattern: debit()
 * locks the wallet's balance row FOR UPDATE, so two concurrent debits
 * serialize and the second observes the first's committed decrement — the
 * guarantee is enforced by Postgres, not application control flow. Both
 * operations are idempotent by (environment, wallet_id, reference): a retry
 * of the same reference is a no-op, never double-credits or double-debits.
 *
 * SECURITY: reads/writes only scope ids, integer minor-unit amounts, a
 * currency code, timestamps, and a provider payment id (a reference, never a
 * credential). No raw payment credentials or secrets are ever touched.
 */

import {
  createCanonicalError,
  err,
  ok,
  type CanonicalError,
  type Environment,
  type Result,
} from "@counter/domain";
import type { QueryResultRow } from "pg";
import type { DatabaseSession, TransactionalDatabase } from "./database.js";

// ─── Requests / outcomes ────────────────────────────────────────────────────

export interface TopUpRequest {
  readonly walletId: string;
  /** Idempotency key — the real Razorpay payment id that funded this topup. */
  readonly reference: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  /** The same value as `reference` today (real Razorpay payment id); kept as
   *  a separate field so a future funding path (a different provider) can
   *  supply a distinct provider reference without changing the idempotency key. */
  readonly providerPaymentId: string;
}

export interface TopUpOutcome {
  readonly alreadyApplied: boolean;
  readonly balanceMinor: bigint;
}

export type DebitDenyCode = "INSUFFICIENT_BALANCE" | "UNSUPPORTED_CURRENCY";

export type DebitOutcome =
  | { readonly allowed: true; readonly alreadyDebited: boolean; readonly balanceMinor: bigint }
  | { readonly allowed: false; readonly code: DebitDenyCode; readonly reason: string };

export interface DebitRequest {
  readonly walletId: string;
  /** Idempotency key — the transaction's own idempotencyKey. */
  readonly reference: string;
  readonly amountMinor: bigint;
  readonly currency: string;
}

interface BalanceRow extends QueryResultRow {
  readonly balance_minor: string;
  readonly currency: string;
}

interface ExistingEventRow extends QueryResultRow {
  readonly reference: string;
}

// ─── Postgres wallet balance store ──────────────────────────────────────────

export class PostgresWalletBalanceStore {
  constructor(
    private readonly database: TransactionalDatabase,
    private readonly environment: Environment,
  ) {}

  /**
   * Credits the wallet by amountMinor, funded by a real, already-verified
   * captured Razorpay payment (the caller MUST have confirmed this via
   * RazorpayTestProvider.query()/GET /v1/payments/:id BEFORE calling this —
   * this method trusts its inputs, it does not itself verify anything with
   * Razorpay). Idempotent by (environment, wallet_id, reference): a retry
   * with the same reference (e.g. a webhook redelivery) is a no-op.
   */
  async topUp(request: TopUpRequest): Promise<Result<TopUpOutcome, CanonicalError>> {
    if (request.amountMinor <= 0n) {
      return err(
        createCanonicalError({
          category: "validation",
          code: "OUT_OF_RANGE",
          message: "Top-up amount must be positive",
        }),
      );
    }

    return this.database.transaction(async (session) => {
      // Atomically claim this reference FIRST: the INSERT's own PRIMARY KEY
      // (environment, wallet_id, reference) is the atomic gate, not a
      // preceding SELECT. A plain "SELECT then branch" here would leave a
      // window where two concurrent calls for the SAME reference both see
      // "not yet applied" and both credit the balance — Postgres serializes
      // concurrent INSERTs on the same unique key (the second blocks until
      // the first commits, then re-checks the conflict), so whichever call
      // loses this INSERT is guaranteed to observe the winner's committed
      // credit, never a stale read. Same technique as this codebase's
      // step-ledger .claim() (apps/worker/src/real-lifecycle.ts).
      const claimed = await session.query(
        `INSERT INTO wallet.balance_events
           (environment, wallet_id, reference, event_type, amount_minor, currency, provider_payment_id)
         VALUES ($1, $2, $3, 'topup', $4, $5, $6)
         ON CONFLICT (environment, wallet_id, reference) DO NOTHING`,
        [
          this.environment,
          request.walletId,
          request.reference,
          request.amountMinor.toString(),
          request.currency,
          request.providerPaymentId,
        ],
      );

      if (claimed.rowCount === 0) {
        // Lost the claim: another call (this one or a genuine race) already
        // applied this exact reference. Read the CURRENT balance, which by
        // now reflects the winner's committed credit — never double-apply.
        const current = await this.#lockedBalance(session, request.walletId);
        return ok(
          Object.freeze({ alreadyApplied: true as const, balanceMinor: current.balanceMinor }),
        );
      }

      await session.query(
        `INSERT INTO wallet.balances (environment, wallet_id, balance_minor, currency, updated_at)
         VALUES ($1, $2, $3, $4, clock_timestamp())
         ON CONFLICT (environment, wallet_id)
         DO UPDATE SET balance_minor = wallet.balances.balance_minor + EXCLUDED.balance_minor,
                        updated_at = clock_timestamp()`,
        [this.environment, request.walletId, request.amountMinor.toString(), request.currency],
      );

      const updated = await session.query<BalanceRow>(
        `SELECT balance_minor, currency FROM wallet.balances
          WHERE environment = $1 AND wallet_id = $2`,
        [this.environment, request.walletId],
      );
      const balanceMinor = BigInt(updated.rows[0]?.balance_minor ?? "0");
      return ok(Object.freeze({ alreadyApplied: false as const, balanceMinor }));
    });
  }

  /**
   * Atomically checks the wallet has sufficient balance and, if so, debits
   * it. Concurrent debits for the SAME wallet serialize on the row lock, so
   * the balance can never go negative regardless of how many purchases race.
   * Idempotent by (environment, wallet_id, reference): a retry of the same
   * transaction reference is a no-op (does not double-debit).
   */
  async debit(request: DebitRequest): Promise<Result<DebitOutcome, CanonicalError>> {
    if (request.amountMinor <= 0n) {
      return err(
        createCanonicalError({
          category: "validation",
          code: "OUT_OF_RANGE",
          message: "Debit amount must be positive",
        }),
      );
    }

    return this.database.transaction(async (session) => {
      // Lock the wallet's balance row FIRST — before the idempotency check,
      // not after. A concurrent debit for the SAME reference blocks here
      // until the first transaction commits, so by the time it acquires the
      // lock the first transaction's balance_events INSERT (below) is
      // already visible: the idempotency check that follows is guaranteed
      // to see it and short-circuit, rather than racing a stale "not yet
      // applied" read against an in-flight sibling transaction. (Checking
      // idempotency BEFORE this lock — as an earlier version of this method
      // did — leaves exactly that window: two concurrent debits for the same
      // reference could both observe "not applied" and both debit.)
      const locked = await session.query<BalanceRow>(
        `SELECT balance_minor, currency FROM wallet.balances
          WHERE environment = $1 AND wallet_id = $2
          FOR UPDATE`,
        [this.environment, request.walletId],
      );

      const existing = await session.query<ExistingEventRow>(
        `SELECT reference FROM wallet.balance_events
          WHERE environment = $1 AND wallet_id = $2 AND reference = $3`,
        [this.environment, request.walletId, request.reference],
      );
      if (existing.rows.length > 0) {
        const current = await this.#lockedBalance(session, request.walletId);
        return ok(
          Object.freeze({
            allowed: true as const,
            alreadyDebited: true,
            balanceMinor: current.balanceMinor,
          }),
        );
      }

      const row = locked.rows[0];
      const currentBalance = row !== undefined ? BigInt(row.balance_minor) : 0n;
      const currency = row?.currency ?? request.currency;

      if (currency !== request.currency) {
        return ok(
          Object.freeze({
            allowed: false as const,
            code: "UNSUPPORTED_CURRENCY" as const,
            reason: `Wallet balance is denominated in ${currency}, not ${request.currency}`,
          }),
        );
      }

      if (currentBalance < request.amountMinor) {
        return ok(
          Object.freeze({
            allowed: false as const,
            code: "INSUFFICIENT_BALANCE" as const,
            reason: `Wallet balance ${currentBalance} is insufficient for a debit of ${request.amountMinor}`,
          }),
        );
      }

      const newBalance = currentBalance - request.amountMinor;
      await session.query(
        `UPDATE wallet.balances
            SET balance_minor = $3, updated_at = clock_timestamp()
          WHERE environment = $1 AND wallet_id = $2`,
        [this.environment, request.walletId, newBalance.toString()],
      );

      await session.query(
        `INSERT INTO wallet.balance_events
           (environment, wallet_id, reference, event_type, amount_minor, currency)
         VALUES ($1, $2, $3, 'debit', $4, $5)
         ON CONFLICT (environment, wallet_id, reference) DO NOTHING`,
        [
          this.environment,
          request.walletId,
          request.reference,
          request.amountMinor.toString(),
          request.currency,
        ],
      );

      return ok(
        Object.freeze({ allowed: true as const, alreadyDebited: false, balanceMinor: newBalance }),
      );
    });
  }

  /** Current balance (minor units). Zero for a wallet with no balance row yet. */
  async getBalance(walletId: string): Promise<bigint> {
    const result = await this.database.query<BalanceRow>(
      `SELECT balance_minor, currency FROM wallet.balances
        WHERE environment = $1 AND wallet_id = $2`,
      [this.environment, walletId],
    );
    const row = result.rows[0];
    return row !== undefined ? BigInt(row.balance_minor) : 0n;
  }

  /**
   * Whether this wallet has ever been topped up (a wallet.balances row
   * exists), regardless of current balance. Distinct from getBalance(): a
   * wallet that topped up once and has since spent everything still HAS a
   * prepaid-balance account (balance 0n); a wallet that never topped up
   * does not. Used at mandate-BINDING time to decide "is this wallet
   * eligible for a prepaid-balance-backed mandate at all" — never as a
   * funds-available check, which stays exclusively debit()'s job.
   */
  async hasBalanceAccount(walletId: string): Promise<boolean> {
    const result = await this.database.query(
      `SELECT 1 FROM wallet.balances WHERE environment = $1 AND wallet_id = $2`,
      [this.environment, walletId],
    );
    return result.rows.length > 0;
  }

  async #lockedBalance(
    session: DatabaseSession,
    walletId: string,
  ): Promise<{ readonly balanceMinor: bigint }> {
    const result = await session.query<BalanceRow>(
      `SELECT balance_minor FROM wallet.balances WHERE environment = $1 AND wallet_id = $2`,
      [this.environment, walletId],
    );
    const row = result.rows[0];
    return { balanceMinor: row !== undefined ? BigInt(row.balance_minor) : 0n };
  }
}
