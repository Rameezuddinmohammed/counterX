/**
 * Append-only receipt store.
 *
 * Receipts are IMMUTABLE. Corrections create a new receipt that references
 * the predecessor. No update or delete methods exist.
 */

import type { CounterId } from "@counter/domain";
import { createCanonicalError, err, ok } from "@counter/domain";
import type { Result } from "@counter/domain";
import type { ReceiptAudience, ReceiptRecord } from "./receipt-types.js";

export interface ReceiptStore {
  append(record: ReceiptRecord): Result<ReceiptRecord>;
  getById(id: CounterId<"receipt">): ReceiptRecord | undefined;
  getByTransaction(transactionId: CounterId<"transaction">): readonly ReceiptRecord[];
  getByTransactionAndAudience(
    transactionId: CounterId<"transaction">,
    audience: ReceiptAudience,
  ): readonly ReceiptRecord[];
  getLatestByTransactionAndAudience(
    transactionId: CounterId<"transaction">,
    audience: ReceiptAudience,
  ): ReceiptRecord | undefined;
}

export class InMemoryReceiptStore implements ReceiptStore {
  readonly #records: Map<CounterId<"receipt">, ReceiptRecord> = new Map();
  readonly #byTransaction: Map<CounterId<"transaction">, ReceiptRecord[]> = new Map();

  public append(record: ReceiptRecord): Result<ReceiptRecord> {
    if (this.#records.has(record.id)) {
      return err(
        createCanonicalError({
          category: "conflict",
          code: "CONFLICT",
          message: "Receipt record with this id already exists",
        }),
      );
    }

    const frozen = Object.freeze({ ...record });
    this.#records.set(frozen.id, frozen);

    const existing = this.#byTransaction.get(record.transactionId);
    if (existing !== undefined) {
      existing.push(frozen);
    } else {
      this.#byTransaction.set(record.transactionId, [frozen]);
    }

    return ok(frozen);
  }

  public getById(id: CounterId<"receipt">): ReceiptRecord | undefined {
    return this.#records.get(id);
  }

  public getByTransaction(transactionId: CounterId<"transaction">): readonly ReceiptRecord[] {
    return this.#byTransaction.get(transactionId) ?? [];
  }

  public getByTransactionAndAudience(
    transactionId: CounterId<"transaction">,
    audience: ReceiptAudience,
  ): readonly ReceiptRecord[] {
    const all = this.getByTransaction(transactionId);
    return all.filter((r) => r.audience === audience);
  }

  public getLatestByTransactionAndAudience(
    transactionId: CounterId<"transaction">,
    audience: ReceiptAudience,
  ): ReceiptRecord | undefined {
    const records = this.getByTransactionAndAudience(transactionId, audience);
    if (records.length === 0) {
      return undefined;
    }
    // Latest is the one with the highest version
    let latest = records[0]!;
    for (let i = 1; i < records.length; i++) {
      if (records[i]!.version > latest.version) {
        latest = records[i]!;
      }
    }
    return latest;
  }
}
