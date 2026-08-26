/**
 * Transaction limit enforcement for the checkout orchestrator.
 *
 * Implements rolling amount/attempt accounting per PILOT.md:
 * - INR 5,000 maximum per transaction
 * - INR 10,000 rolling 24-hour total per wallet
 * - 5 attempts per wallet per 24 hours
 *
 * All limits are configurable downward but cannot exceed profile ceilings.
 */

import type { Instant, IsoCurrencyCode, Money, WalletId } from "@counter/domain";

// ─── Limit Constants (PILOT.md Profile 0.1 ceilings) ─────────────────────────

/** Maximum amount per single transaction in minor units (INR 5,000 = 500000 paise) */
export const MAX_TRANSACTION_AMOUNT_MINOR = 500_000n;

/** Maximum rolling 24-hour total per wallet in minor units (INR 10,000 = 1000000 paise) */
export const MAX_ROLLING_24H_TOTAL_MINOR = 1_000_000n;

/** Maximum attempts per wallet per 24-hour window */
export const MAX_ATTEMPTS_PER_24H = 5;

/** Rolling window duration in milliseconds (24 hours) */
export const ROLLING_WINDOW_MS = 24 * 60 * 60 * 1000;

// ─── Limit Configuration ─────────────────────────────────────────────────────

export interface TransactionLimitConfig {
  readonly maxTransactionAmountMinor: bigint;
  readonly maxRolling24hTotalMinor: bigint;
  readonly maxAttemptsPerWindow: number;
  readonly windowMs: number;
  readonly currency: IsoCurrencyCode;
}

export const DEFAULT_LIMIT_CONFIG: TransactionLimitConfig = Object.freeze({
  maxTransactionAmountMinor: MAX_TRANSACTION_AMOUNT_MINOR,
  maxRolling24hTotalMinor: MAX_ROLLING_24H_TOTAL_MINOR,
  maxAttemptsPerWindow: MAX_ATTEMPTS_PER_24H,
  windowMs: ROLLING_WINDOW_MS,
  currency: "INR" as IsoCurrencyCode,
});

// ─── Ledger Entry ────────────────────────────────────────────────────────────

export interface LedgerEntry {
  readonly walletId: WalletId;
  readonly amountMinor: bigint;
  readonly timestamp: Instant;
  readonly idempotencyKey: string;
}

// ─── Transaction Ledger Interface ────────────────────────────────────────────

/**
 * Port interface for tracking 24-hour rolling totals per wallet.
 */
export interface TransactionLedger {
  /**
   * Returns all entries for a wallet within the rolling window.
   */
  getWindowEntries(walletId: WalletId, windowStart: Instant): readonly LedgerEntry[];

  /**
   * Records an attempt after payment execution.
   */
  recordAttempt(entry: LedgerEntry): void;

  /**
   * Checks whether an idempotency key has already been recorded.
   */
  hasIdempotencyKey(idempotencyKey: string): boolean;
}

// ─── In-Memory Transaction Ledger ────────────────────────────────────────────

/**
 * In-memory implementation of the TransactionLedger for test environments.
 * Entries are stored per-wallet and pruned on access.
 */
export class InMemoryTransactionLedger implements TransactionLedger {
  readonly #entries: Map<string, LedgerEntry[]>;
  readonly #idempotencyKeys: Map<string, number>;
  readonly #idempotencyTtlMs: number;
  readonly #maxIdempotencyKeys: number;

  public constructor(idempotencyTtlMs = 3_600_000, maxIdempotencyKeys = 10_000) {
    this.#entries = new Map();
    this.#idempotencyKeys = new Map();
    this.#idempotencyTtlMs = idempotencyTtlMs;
    this.#maxIdempotencyKeys = maxIdempotencyKeys;
  }

  public getWindowEntries(walletId: WalletId, windowStart: Instant): readonly LedgerEntry[] {
    const walletEntries = this.#entries.get(walletId);
    if (walletEntries === undefined) {
      return [];
    }

    // Filter entries within the window
    const inWindow = walletEntries.filter((entry) => entry.timestamp >= windowStart);

    // Prune expired entries
    if (inWindow.length < walletEntries.length) {
      if (inWindow.length === 0) {
        this.#entries.delete(walletId);
      } else {
        this.#entries.set(walletId, inWindow);
      }
    }

    return Object.freeze(inWindow);
  }

  public recordAttempt(entry: LedgerEntry): void {
    const walletEntries = this.#entries.get(entry.walletId);
    if (walletEntries !== undefined) {
      walletEntries.push(entry);
    } else {
      this.#entries.set(entry.walletId, [entry]);
    }
    this.#idempotencyKeys.set(entry.idempotencyKey, Date.now());
    this.#evictExpiredIdempotencyKeys();
  }

  public hasIdempotencyKey(idempotencyKey: string): boolean {
    const recordedAt = this.#idempotencyKeys.get(idempotencyKey);
    if (recordedAt === undefined) return false;
    if (Date.now() - recordedAt > this.#idempotencyTtlMs) {
      this.#idempotencyKeys.delete(idempotencyKey);
      return false;
    }
    return true;
  }

  #evictExpiredIdempotencyKeys(): void {
    if (this.#idempotencyKeys.size <= this.#maxIdempotencyKeys) return;
    const now = Date.now();
    for (const [key, recordedAt] of this.#idempotencyKeys) {
      if (now - recordedAt > this.#idempotencyTtlMs) {
        this.#idempotencyKeys.delete(key);
      }
    }
    // If still over max after TTL eviction, remove oldest entries
    if (this.#idempotencyKeys.size > this.#maxIdempotencyKeys) {
      const entries = [...this.#idempotencyKeys.entries()].sort((a, b) => a[1] - b[1]);
      const toRemove = entries.slice(0, entries.length - this.#maxIdempotencyKeys);
      for (const [key] of toRemove) {
        this.#idempotencyKeys.delete(key);
      }
    }
  }
}

// ─── Limit Enforcement ───────────────────────────────────────────────────────

export interface LimitCheckResult {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly code?: string;
}

/**
 * Enforces transaction limits per PILOT.md.
 *
 * Checks:
 * 1. Per-transaction amount ceiling (INR 5,000)
 * 2. Rolling 24-hour total ceiling (INR 10,000)
 * 3. Attempt count ceiling (5 per 24h)
 *
 * Returns a structured result indicating whether the transaction is allowed.
 */
export function enforceTransactionLimits(
  amount: Money,
  walletId: WalletId,
  now: Instant,
  ledger: TransactionLedger,
  config: TransactionLimitConfig = DEFAULT_LIMIT_CONFIG,
): LimitCheckResult {
  // 1. Currency must match configured limit currency
  if (amount.currency !== config.currency) {
    return Object.freeze({
      allowed: false,
      reason: `Currency ${amount.currency} not supported; limits are defined for ${config.currency}`,
      code: "UNSUPPORTED_CURRENCY",
    });
  }

  // 2. Per-transaction amount ceiling
  if (amount.amountMinor > config.maxTransactionAmountMinor) {
    return Object.freeze({
      allowed: false,
      reason: `Transaction amount ${amount.amountMinor} exceeds per-transaction limit of ${config.maxTransactionAmountMinor} minor units`,
      code: "AMOUNT_LIMIT_EXCEEDED",
    });
  }

  // 3. Compute rolling window start
  const windowStart = (now - config.windowMs) as Instant;
  const windowEntries = ledger.getWindowEntries(walletId, windowStart);

  // 4. Attempt count ceiling
  if (windowEntries.length >= config.maxAttemptsPerWindow) {
    return Object.freeze({
      allowed: false,
      reason: `Attempt count ${windowEntries.length} reached maximum of ${config.maxAttemptsPerWindow} per ${config.windowMs}ms window`,
      code: "ATTEMPT_LIMIT_EXCEEDED",
    });
  }

  // 5. Rolling total ceiling
  let rollingTotal = 0n;
  for (const entry of windowEntries) {
    rollingTotal += entry.amountMinor;
  }
  const projectedTotal = rollingTotal + amount.amountMinor;
  if (projectedTotal > config.maxRolling24hTotalMinor) {
    return Object.freeze({
      allowed: false,
      reason: `Projected rolling total ${projectedTotal} exceeds 24h limit of ${config.maxRolling24hTotalMinor} minor units`,
      code: "ROLLING_TOTAL_EXCEEDED",
    });
  }

  return Object.freeze({ allowed: true });
}

/**
 * Records a transaction attempt in the ledger after payment execution.
 */
export function recordAttempt(
  ledger: TransactionLedger,
  walletId: WalletId,
  amountMinor: bigint,
  timestamp: Instant,
  idempotencyKey: string,
): void {
  ledger.recordAttempt(
    Object.freeze({ walletId, amountMinor, timestamp, idempotencyKey }),
  );
}
