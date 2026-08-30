/**
 * Append-only evidence store.
 *
 * Evidence is NEVER mutated. Corrections add new evidence records with a
 * supersedes relationship to prior records. No update or delete methods exist.
 */

import type { CounterId } from "@counter/domain";
import { createCanonicalError, err, ok } from "@counter/domain";
import type { Result } from "@counter/domain";
import type { EvidenceRecord, EvidenceSource } from "./types.js";

export interface EvidenceStore {
  append(record: EvidenceRecord): Result<EvidenceRecord>;
  getById(id: CounterId<"evidence">): EvidenceRecord | undefined;
  getByTransaction(transactionId: CounterId<"transaction">): readonly EvidenceRecord[];
  getBySource(
    transactionId: CounterId<"transaction">,
    source: EvidenceSource,
  ): readonly EvidenceRecord[];
}

export class InMemoryEvidenceStore implements EvidenceStore {
  readonly #records: Map<CounterId<"evidence">, EvidenceRecord> = new Map();
  readonly #byTransaction: Map<CounterId<"transaction">, EvidenceRecord[]> = new Map();

  public append(record: EvidenceRecord): Result<EvidenceRecord> {
    if (this.#records.has(record.id)) {
      return err(
        createCanonicalError({
          category: "conflict",
          code: "CONFLICT",
          message: "Evidence record with this id already exists",
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

  public getById(id: CounterId<"evidence">): EvidenceRecord | undefined {
    return this.#records.get(id);
  }

  public getByTransaction(transactionId: CounterId<"transaction">): readonly EvidenceRecord[] {
    return this.#byTransaction.get(transactionId) ?? [];
  }

  public getBySource(
    transactionId: CounterId<"transaction">,
    source: EvidenceSource,
  ): readonly EvidenceRecord[] {
    const all = this.getByTransaction(transactionId);
    return all.filter((r) => r.source === source);
  }
}
