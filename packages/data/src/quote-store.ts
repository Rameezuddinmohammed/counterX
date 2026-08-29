/**
 * Durable, cross-instance quote store for the agent-runtime merchant API.
 *
 * POST /quotes returns only a quoteId to the caller; a later POST /transactions
 * receives that quoteId alone. A per-process in-memory cache would strand a
 * quote on the machine that created it, so this persists the CTP-digest-signed
 * quote content in runtime.quotes, scoped by the same Environment partition as
 * every other durable repository.
 *
 * markConsumed() prevents a single priced quote from being spent against more
 * than one transaction (a distinct concern from the per-request idempotency
 * wrapper, which only dedupes retries of the identical HTTP request).
 *
 * SECURITY: rows carry only variant/price/quantity/currency and a content
 * digest. No payment credentials, PAN, CVV, UPI PIN, or private keys.
 */

import { type CanonicalError, type Environment, type Result, ok } from "@counter/domain";
import type { TransactionalDatabase } from "./database.js";

export interface QuoteRecord {
  readonly id: string;
  readonly merchantId: string;
  readonly variantId: string;
  readonly quantity: number;
  readonly unitPriceMinor: bigint;
  readonly totalPriceMinor: bigint;
  readonly currency: string;
  readonly ctpDigest: string;
  /** Full signed quote content (for receipt/audit use), stored verbatim. */
  readonly quoteContent: unknown;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

export interface StoredQuote extends QuoteRecord {
  readonly consumedAt: Date | undefined;
}

/** JSON.stringify replacer for quote content, which carries bigint minor-unit fields. */
function bigintSafeReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

interface QuoteRow {
  id: string;
  merchant_id: string;
  variant_id: string;
  quantity: number;
  unit_price_minor: string;
  total_price_minor: string;
  currency: string;
  ctp_digest: string;
  quote_content: unknown;
  created_at: Date;
  expires_at: Date;
  consumed_at: Date | null;
}

function rowToQuote(row: QuoteRow): StoredQuote {
  return Object.freeze({
    id: row.id,
    merchantId: row.merchant_id,
    variantId: row.variant_id,
    quantity: row.quantity,
    unitPriceMinor: BigInt(row.unit_price_minor),
    totalPriceMinor: BigInt(row.total_price_minor),
    currency: row.currency,
    ctpDigest: row.ctp_digest,
    quoteContent: row.quote_content,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at ?? undefined,
  });
}

export class PostgresQuoteStore {
  constructor(
    private readonly database: TransactionalDatabase,
    private readonly environment: Environment,
  ) {}

  async save(record: QuoteRecord): Promise<Result<void, CanonicalError>> {
    await this.database.query(
      `INSERT INTO runtime.quotes (
         id, environment, merchant_id, variant_id, quantity, unit_price_minor,
         total_price_minor, currency, ctp_digest, quote_content, created_at, expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        record.id,
        this.environment,
        record.merchantId,
        record.variantId,
        record.quantity,
        record.unitPriceMinor.toString(),
        record.totalPriceMinor.toString(),
        record.currency,
        record.ctpDigest,
        JSON.stringify(record.quoteContent, bigintSafeReplacer),
        record.createdAt.toISOString(),
        record.expiresAt.toISOString(),
      ],
    );
    return ok(undefined);
  }

  async get(quoteId: string): Promise<Result<StoredQuote | undefined, CanonicalError>> {
    const result = await this.database.query<QuoteRow>(
      `SELECT id, merchant_id, variant_id, quantity, unit_price_minor, total_price_minor,
              currency, ctp_digest, quote_content, created_at, expires_at, consumed_at
         FROM runtime.quotes
        WHERE environment = $1 AND id = $2`,
      [this.environment, quoteId],
    );
    const row = result.rows[0];
    return ok(row === undefined ? undefined : rowToQuote(row));
  }

  /**
   * Atomically marks a quote consumed, but only if it is not already consumed.
   * Returns {consumed:false} when the quote was already spent by an earlier
   * transaction (a reuse attempt), so the caller can refuse it.
   */
  async markConsumed(
    quoteId: string,
  ): Promise<Result<{ readonly consumed: boolean }, CanonicalError>> {
    const result = await this.database.query(
      `UPDATE runtime.quotes
          SET consumed_at = clock_timestamp()
        WHERE environment = $1 AND id = $2 AND consumed_at IS NULL`,
      [this.environment, quoteId],
    );
    return ok({ consumed: (result.rowCount ?? 0) === 1 });
  }
}
