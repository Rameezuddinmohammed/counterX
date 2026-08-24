/**
 * Audit entry creation and integrity checkpoints.
 *
 * Uses SHA-256 digests from @counter/domain to build an integrity chain
 * over audit entries. If entries between two checkpoints are tampered with,
 * the computed digest will not match the stored entriesDigest.
 */

import type { Instant, Sha256Digest } from "@counter/domain";
import {
  createCanonicalError,
  err,
  ok,
  sha256Digest,
  sha256DigestsEqual,
} from "@counter/domain";
import type { Result } from "@counter/domain";
import type { AuditEntry, IntegrityCheckpoint } from "./types.js";

export interface CreateAuditEntryParams {
  readonly id: string;
  readonly actorId: string;
  readonly actorKind: AuditEntry["actorKind"];
  readonly action: AuditEntry["action"];
  readonly targetType: string;
  readonly targetId: string;
  readonly environment: AuditEntry["environment"];
  readonly scope: string;
  readonly correlationId: string;
  readonly timestamp: Instant;
  readonly evidenceRefs: readonly AuditEntry["evidenceRefs"][number][];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export function createAuditEntry(params: CreateAuditEntryParams): AuditEntry {
  return Object.freeze({
    id: params.id,
    actorId: params.actorId,
    actorKind: params.actorKind,
    action: params.action,
    targetType: params.targetType,
    targetId: params.targetId,
    environment: params.environment,
    scope: params.scope,
    correlationId: params.correlationId,
    timestamp: params.timestamp,
    evidenceRefs: Object.freeze([...params.evidenceRefs]),
    metadata: params.metadata,
  });
}

export function computeEntriesDigest(entries: readonly AuditEntry[]): Sha256Digest {
  const canonical = JSON.stringify(
    entries.map((e) => ({
      id: e.id,
      actorId: e.actorId,
      actorKind: e.actorKind,
      action: e.action,
      targetType: e.targetType,
      targetId: e.targetId,
      environment: e.environment,
      scope: e.scope,
      correlationId: e.correlationId,
      timestamp: e.timestamp,
      evidenceRefs: e.evidenceRefs,
      metadata: e.metadata,
    })),
  );
  return sha256Digest(new TextEncoder().encode(canonical));
}

export class AuditLog {
  readonly #entries: AuditEntry[] = [];
  readonly #checkpoints: IntegrityCheckpoint[] = [];
  /** Tracks how many entries were in the log when each checkpoint was created. */
  readonly #entryCountsAtCheckpoint: number[] = [];

  public append(entry: AuditEntry): void {
    this.#entries.push(entry);
  }

  public getEntries(): readonly AuditEntry[] {
    return this.#entries;
  }

  public getEntriesMutable(): AuditEntry[] {
    return this.#entries;
  }

  public getCheckpoints(): readonly IntegrityCheckpoint[] {
    return this.#checkpoints;
  }

  public createCheckpoint(id: string, now: Instant): IntegrityCheckpoint {
    const lastCheckpointIndex = this.#checkpoints.length - 1;
    const entriesStart =
      lastCheckpointIndex >= 0
        ? (this.#entryCountsAtCheckpoint[lastCheckpointIndex] ?? 0)
        : 0;

    const entriesSinceLastCheckpoint = this.#entries.slice(entriesStart);
    const entriesDigest = computeEntriesDigest(entriesSinceLastCheckpoint);

    const lastCheckpoint =
      lastCheckpointIndex >= 0
        ? this.#checkpoints[lastCheckpointIndex]
        : undefined;

    const checkpoint: IntegrityCheckpoint = Object.freeze({
      id,
      sequenceNumber: lastCheckpoint
        ? lastCheckpoint.sequenceNumber + 1
        : 0,
      previousCheckpointDigest: lastCheckpoint
        ? lastCheckpoint.entriesDigest
        : undefined,
      entriesDigest,
      createdAt: now,
    });

    this.#checkpoints.push(checkpoint);
    this.#entryCountsAtCheckpoint.push(this.#entries.length);

    return checkpoint;
  }

  public verifyIntegrity(
    from: IntegrityCheckpoint,
    to: IntegrityCheckpoint,
  ): Result<boolean> {
    const fromIdx = this.#checkpoints.findIndex((cp) => cp.id === from.id);
    const toIdx = this.#checkpoints.findIndex((cp) => cp.id === to.id);

    if (fromIdx < 0 || toIdx < 0 || toIdx <= fromIdx) {
      return err(
        createCanonicalError({
          category: "validation",
          code: "INVALID_FORMAT",
          message: "Invalid checkpoint range for integrity verification",
        }),
      );
    }

    const entriesStart = this.#entryCountsAtCheckpoint[fromIdx] ?? 0;
    const entriesEnd = this.#entryCountsAtCheckpoint[toIdx] ?? this.#entries.length;

    const entriesBetween = this.#entries.slice(entriesStart, entriesEnd);
    const computedDigest = computeEntriesDigest(entriesBetween);

    if (!sha256DigestsEqual(computedDigest, to.entriesDigest)) {
      return err(
        createCanonicalError({
          category: "validation",
          code: "INVALID_FORMAT",
          message:
            "Integrity check failed: entries digest does not match checkpoint",
        }),
      );
    }

    return ok(true);
  }
}
