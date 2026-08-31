/**
 * Durable, append-only store for CTP-signed transaction receipts.
 *
 * Backs @counter/evidence's ReceiptStore interface for the worker's real
 * receipt-issuance seam. Receipts are IMMUTABLE (no update/delete method
 * exists here, matching InMemoryReceiptStore's contract) - a corrected
 * receipt is a NEW row referencing its predecessor, never a mutation of an
 * existing one. Lives in runtime.receipts, scoped by the same Environment
 * partition as every other durable repository in this package.
 *
 * SECURITY: rows carry a signed CTP envelope and commitment digest only -
 * no payment credentials, PAN, CVV, UPI PIN, or private keys.
 */

import {
  type CanonicalError,
  type CounterId,
  type Environment,
  type Instant,
  type Result,
  createCanonicalError,
  err,
  instantFromEpochMilliseconds,
  ok,
  parseSha256Digest,
} from "@counter/domain";
import type { ReceiptAudience, ReceiptRecord, ReceiptStore } from "@counter/evidence";
import type { CtpEnvelope, TransactionReceiptPayload } from "@counter/trust-protocol";
import type { TransactionalDatabase } from "./database.js";

interface ReceiptRow {
  id: string;
  transaction_id: string;
  audience: string;
  version: number;
  canonical_commitment_digest: string;
  receipt_envelope: CtpEnvelope<TransactionReceiptPayload>;
  predecessor_receipt_id: string | null;
  issued_at: Date;
  signing_key_id: string;
}

function instantFromDate(value: Date): Instant {
  const result = instantFromEpochMilliseconds(value.getTime());
  if (!result.ok) {
    throw new Error("Persisted receipt record contains an invalid issued_at timestamp");
  }
  return result.value;
}

function rowToReceipt(row: ReceiptRow): ReceiptRecord {
  const digestResult = parseSha256Digest(row.canonical_commitment_digest);
  if (!digestResult.ok) {
    throw new Error("Persisted receipt record contains an invalid commitment digest");
  }
  return Object.freeze({
    id: row.id as CounterId<"receipt">,
    transactionId: row.transaction_id as CounterId<"transaction">,
    audience: row.audience as ReceiptAudience,
    version: row.version,
    canonicalCommitmentDigest: digestResult.value,
    receiptEnvelope: row.receipt_envelope,
    predecessorReceiptId: (row.predecessor_receipt_id as CounterId<"receipt"> | null) ?? undefined,
    issuedAt: instantFromDate(row.issued_at),
    signingKeyId: row.signing_key_id,
  });
}

const RECEIPT_COLUMNS = `id, transaction_id, audience, version, canonical_commitment_digest,
       receipt_envelope, predecessor_receipt_id, issued_at, signing_key_id`;

export class PostgresReceiptStore implements ReceiptStore {
  constructor(
    private readonly database: TransactionalDatabase,
    private readonly environment: Environment,
  ) {}

  async append(record: ReceiptRecord): Promise<Result<ReceiptRecord, CanonicalError>> {
    const result = await this.database.query<ReceiptRow>(
      `INSERT INTO runtime.receipts (
         id, environment, transaction_id, audience, version,
         canonical_commitment_digest, receipt_envelope, predecessor_receipt_id,
         issued_at, signing_key_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO NOTHING
       RETURNING ${RECEIPT_COLUMNS}`,
      [
        record.id,
        this.environment,
        record.transactionId,
        record.audience,
        record.version,
        record.canonicalCommitmentDigest,
        JSON.stringify(record.receiptEnvelope),
        record.predecessorReceiptId ?? null,
        new Date(record.issuedAt).toISOString(),
        record.signingKeyId,
      ],
    );

    if ((result.rowCount ?? 0) === 0) {
      return err(
        createCanonicalError({
          category: "conflict",
          code: "CONFLICT",
          message: "Receipt record with this id already exists",
        }),
      );
    }

    return ok(rowToReceipt(result.rows[0]!));
  }

  async getById(id: CounterId<"receipt">): Promise<ReceiptRecord | undefined> {
    const result = await this.database.query<ReceiptRow>(
      `SELECT ${RECEIPT_COLUMNS}
         FROM runtime.receipts
        WHERE environment = $1 AND id = $2`,
      [this.environment, id],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : rowToReceipt(row);
  }

  async getByTransaction(
    transactionId: CounterId<"transaction">,
  ): Promise<readonly ReceiptRecord[]> {
    const result = await this.database.query<ReceiptRow>(
      `SELECT ${RECEIPT_COLUMNS}
         FROM runtime.receipts
        WHERE environment = $1 AND transaction_id = $2
        ORDER BY audience, version`,
      [this.environment, transactionId],
    );
    return result.rows.map(rowToReceipt);
  }

  async getByTransactionAndAudience(
    transactionId: CounterId<"transaction">,
    audience: ReceiptAudience,
  ): Promise<readonly ReceiptRecord[]> {
    const result = await this.database.query<ReceiptRow>(
      `SELECT ${RECEIPT_COLUMNS}
         FROM runtime.receipts
        WHERE environment = $1 AND transaction_id = $2 AND audience = $3
        ORDER BY version`,
      [this.environment, transactionId, audience],
    );
    return result.rows.map(rowToReceipt);
  }

  async getLatestByTransactionAndAudience(
    transactionId: CounterId<"transaction">,
    audience: ReceiptAudience,
  ): Promise<ReceiptRecord | undefined> {
    const result = await this.database.query<ReceiptRow>(
      `SELECT ${RECEIPT_COLUMNS}
         FROM runtime.receipts
        WHERE environment = $1 AND transaction_id = $2 AND audience = $3
        ORDER BY version DESC
        LIMIT 1`,
      [this.environment, transactionId, audience],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : rowToReceipt(row);
  }
}
