/**
 * Durable, cross-instance rolling-spend ledger (Postgres).
 *
 * The production authorization policy enforces a rolling 24-hour spend total
 * and attempt-count ceiling per wallet. A per-process in-memory ledger cannot
 * enforce that across multiple worker instances: two workers could each pass
 * their own check and together exceed the cap.
 *
 * This ledger performs an ATOMIC check-and-reserve inside a single database
 * transaction. It locks the wallet's windowed rows FOR UPDATE, sums the
 * committed spend + attempt count in the rolling window, rejects if the new
 * amount would breach the per-transaction ceiling, the attempt ceiling, or the
 * rolling total, and otherwise INSERTs the reservation — all before the lock is
 * released. Two concurrent reservations serialize on the lock, so the second
 * observes the first's committed row and is correctly rejected. The guarantee
 * is enforced by Postgres, not by application control flow.
 *
 * Idempotency: the reference is UNIQUE per (environment, wallet); a retry of the
 * same transaction reference is a no-op (ON CONFLICT DO NOTHING) and returns the
 * already-reserved outcome without double-counting.
 *
 * SECURITY: reads/writes only scope ids, an integer minor-unit amount, a
 * currency code, and timestamps. No credentials or secrets are ever touched.
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
import type { TransactionalDatabase } from "./database.js";

// ─── Config ──────────────────────────────────────────────────────────────────

export interface SpendLimitConfig {
  /** Per-transaction ceiling in minor units. */
  readonly maxTransactionAmountMinor: bigint;
  /** Rolling-window total ceiling in minor units. */
  readonly maxRolling24hTotalMinor: bigint;
  /** Maximum reservations (attempts) per wallet per window. */
  readonly maxAttemptsPerWindow: number;
  /** Rolling window duration in milliseconds. */
  readonly windowMs: number;
  /** ISO-4217 currency the limits are denominated in. */
  readonly currency: string;
}

export const DEFAULT_SPEND_LIMIT_CONFIG: SpendLimitConfig = Object.freeze({
  maxTransactionAmountMinor: 500_000n,
  maxRolling24hTotalMinor: 1_000_000n,
  maxAttemptsPerWindow: 5,
  windowMs: 24 * 60 * 60 * 1000,
  currency: "INR",
});

// ─── Reserve request / result ──────────────────────────────────────────────────

export interface ReserveSpendRequest {
  readonly walletId: string;
  /** Stable per-transaction reference; makes the reserve idempotent. */
  readonly reference: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  /** Current time as epoch milliseconds (injectable for deterministic tests). */
  readonly nowMs: number;
}

export type ReserveDenyCode =
  | "UNSUPPORTED_CURRENCY"
  | "AMOUNT_LIMIT_EXCEEDED"
  | "ATTEMPT_LIMIT_EXCEEDED"
  | "ROLLING_TOTAL_EXCEEDED";

export type ReserveSpendOutcome =
  | { readonly allowed: true; readonly alreadyReserved: boolean }
  | { readonly allowed: false; readonly code: ReserveDenyCode; readonly reason: string };

interface WindowAggRow extends QueryResultRow {
  readonly attempt_count: string;
  readonly total_minor: string | null;
}

interface ExistingRow extends QueryResultRow {
  readonly reference: string;
}

// ─── Postgres spend ledger ──────────────────────────────────────────────────────

export class PostgresSpendLedger {
  readonly #config: SpendLimitConfig;

  constructor(
    private readonly database: TransactionalDatabase,
    private readonly environment: Environment,
    config: SpendLimitConfig = DEFAULT_SPEND_LIMIT_CONFIG,
  ) {
    this.#config = config;
  }

  /**
   * Atomically checks the per-transaction / attempt / rolling-total ceilings for
   * the wallet's window and, if all pass, reserves the spend. Concurrent callers
   * serialize inside the DB transaction so their combined spend cannot exceed
   * the rolling cap. Idempotent by (environment, wallet, reference).
   */
  async reserveSpend(
    request: ReserveSpendRequest,
  ): Promise<Result<ReserveSpendOutcome, CanonicalError>> {
    const cfg = this.#config;

    if (request.amountMinor <= 0n) {
      return err(
        createCanonicalError({
          category: "validation",
          code: "OUT_OF_RANGE",
          message: "Reserved amount must be positive",
        }),
      );
    }

    // Currency + per-transaction ceiling are pure predicates; evaluate first.
    if (request.currency !== cfg.currency) {
      return ok(
        Object.freeze({
          allowed: false as const,
          code: "UNSUPPORTED_CURRENCY" as const,
          reason: `Currency ${request.currency} not supported; limits are defined for ${cfg.currency}`,
        }),
      );
    }
    if (request.amountMinor > cfg.maxTransactionAmountMinor) {
      return ok(
        Object.freeze({
          allowed: false as const,
          code: "AMOUNT_LIMIT_EXCEEDED" as const,
          reason: `Transaction amount ${request.amountMinor} exceeds per-transaction limit of ${cfg.maxTransactionAmountMinor}`,
        }),
      );
    }

    const windowStartIso = new Date(request.nowMs - cfg.windowMs).toISOString();

    return this.database.transaction(async (session) => {
      // Idempotency: if this reference is already reserved for the wallet, treat
      // it as an allowed no-op (do NOT re-count it against the window).
      const existing = await session.query<ExistingRow>(
        `SELECT reference FROM runtime.spend_ledger
         WHERE environment = $1 AND wallet_id = $2 AND reference = $3`,
        [this.environment, request.walletId, request.reference],
      );
      if (existing.rows.length > 0) {
        return ok(Object.freeze({ allowed: true as const, alreadyReserved: true }));
      }

      // Lock the wallet's windowed rows so a concurrent reserve for the same
      // wallet serializes behind this transaction and observes our INSERT.
      const agg = await session.query<WindowAggRow>(
        `SELECT count(*)::text AS attempt_count, sum(amount_minor)::text AS total_minor
           FROM (
             SELECT amount_minor FROM runtime.spend_ledger
              WHERE environment = $1
                AND wallet_id = $2
                AND spent_at >= $3::timestamptz
              FOR UPDATE
           ) locked`,
        [this.environment, request.walletId, windowStartIso],
      );
      const row = agg.rows[0];
      const attemptCount = row ? Number.parseInt(row.attempt_count, 10) : 0;
      const rollingTotal = row && row.total_minor !== null ? BigInt(row.total_minor) : 0n;

      if (attemptCount >= cfg.maxAttemptsPerWindow) {
        return ok(
          Object.freeze({
            allowed: false as const,
            code: "ATTEMPT_LIMIT_EXCEEDED" as const,
            reason: `Attempt count ${attemptCount} reached maximum of ${cfg.maxAttemptsPerWindow} per window`,
          }),
        );
      }

      const projected = rollingTotal + request.amountMinor;
      if (projected > cfg.maxRolling24hTotalMinor) {
        return ok(
          Object.freeze({
            allowed: false as const,
            code: "ROLLING_TOTAL_EXCEEDED" as const,
            reason: `Projected rolling total ${projected} exceeds 24h limit of ${cfg.maxRolling24hTotalMinor}`,
          }),
        );
      }

      // All ceilings pass: reserve. ON CONFLICT guards a race on the unique
      // (environment, wallet, reference) index — a concurrent duplicate loses
      // and is treated as an idempotent no-op.
      const spentAtIso = new Date(request.nowMs).toISOString();
      const inserted = await session.query(
        `INSERT INTO runtime.spend_ledger
           (environment, wallet_id, reference, amount_minor, currency, spent_at)
         VALUES ($1, $2, $3, $4, $5, $6::timestamptz)
         ON CONFLICT (environment, wallet_id, reference) DO NOTHING`,
        [
          this.environment,
          request.walletId,
          request.reference,
          request.amountMinor.toString(),
          request.currency,
          spentAtIso,
        ],
      );
      const alreadyReserved = inserted.rowCount === 0;
      return ok(Object.freeze({ allowed: true as const, alreadyReserved }));
    });
  }

  /** Total committed spend in the wallet's current window (minor units). */
  async windowTotalMinor(walletId: string, nowMs: number): Promise<bigint> {
    const windowStartIso = new Date(nowMs - this.#config.windowMs).toISOString();
    const agg = await this.database.query<WindowAggRow>(
      `SELECT count(*)::text AS attempt_count, sum(amount_minor)::text AS total_minor
         FROM runtime.spend_ledger
        WHERE environment = $1 AND wallet_id = $2 AND spent_at >= $3::timestamptz`,
      [this.environment, walletId, windowStartIso],
    );
    const row = agg.rows[0];
    return row && row.total_minor !== null ? BigInt(row.total_minor) : 0n;
  }
}
