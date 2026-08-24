/**
 * Source priority resolution for multi-source commerce graph entities.
 *
 * When multiple sources provide data for the same entity, priority determines
 * which observation wins. When priorities are equal, newer observedAt wins.
 */

import type { Instant, Result } from "@counter/domain";
import { ok } from "@counter/domain";
import type { ConflictRecord, ConflictType, SourcePriority, SourceReference } from "./index.js";

// ─── Observation for Conflict Resolution ──────────────────────────────────────

export interface SourcedObservation {
  readonly source: SourceReference;
  readonly observedAt: Instant;
  readonly data: unknown;
}

// ─── Conflict Resolution Result ───────────────────────────────────────────────

export interface ResolutionResult {
  readonly winner: SourcedObservation;
  readonly resolution: "source_priority" | "newer_wins";
  readonly conflict: ConflictRecord | null;
}

// ─── Resolve Conflict ─────────────────────────────────────────────────────────

/**
 * Resolves a conflict between observations from multiple sources.
 * Returns the winning observation based on configured priority.
 *
 * - Higher priority number = higher priority source
 * - When same priority, newer observedAt wins
 * - When conflict cannot be resolved cleanly, creates a ConflictRecord
 */
export function resolveConflict(
  observations: readonly SourcedObservation[],
  priorities: readonly SourcePriority[],
  entityId: string,
  entityType: string,
): Result<ResolutionResult> {
  if (observations.length === 0) {
    return ok({
      winner: { source: {} as SourceReference, observedAt: 0 as Instant, data: null },
      resolution: "newer_wins",
      conflict: null,
    });
  }

  if (observations.length === 1) {
    return ok({
      winner: observations[0]!,
      resolution: "source_priority",
      conflict: null,
    });
  }

  const priorityMap = new Map<string, number>();
  for (const p of priorities) {
    priorityMap.set(p.source, p.priority);
  }

  // Sort by priority descending, then by observedAt descending
  const sorted = [...observations].sort((a, b) => {
    const aPriority = priorityMap.get(a.source.platform) ?? 0;
    const bPriority = priorityMap.get(b.source.platform) ?? 0;

    if (aPriority !== bPriority) {
      return bPriority - aPriority;
    }

    return (b.observedAt as number) - (a.observedAt as number);
  });

  const winner = sorted[0]!;
  const winnerPriority = priorityMap.get(winner.source.platform) ?? 0;
  const runnerUp = sorted[1]!;
  const runnerUpPriority = priorityMap.get(runnerUp.source.platform) ?? 0;

  const resolution: "source_priority" | "newer_wins" =
    winnerPriority !== runnerUpPriority ? "source_priority" : "newer_wins";

  // Determine if we need to record a conflict
  const hasValueMismatch =
    JSON.stringify(winner.data) !== JSON.stringify(runnerUp.data);

  let conflict: ConflictRecord | null = null;
  if (hasValueMismatch && resolution === "newer_wins") {
    const conflictType: ConflictType = "value_mismatch";
    conflict = Object.freeze({
      id: `conflict-${entityId}-${Date.now()}`,
      entityId,
      entityType,
      sources: Object.freeze(observations.map((o) => o.source)),
      conflictType,
      resolvedAt: null,
      resolution: null,
      createdAt: winner.observedAt,
    });
  }

  return ok(Object.freeze({ winner, resolution, conflict }));
}

// ─── Stale Override Detection ─────────────────────────────────────────────────

export interface StaleOverrideResult {
  readonly isStale: boolean;
  readonly existingObservedAt: Instant;
  readonly newObservedAt: Instant;
}

/**
 * Determines if a new observation is actually older than the existing one
 * (out-of-order) and should be rejected from updating the "latest" view.
 */
export function detectStaleOverride(
  existingObservedAt: Instant,
  newObservedAt: Instant,
): Result<StaleOverrideResult> {
  const isStale = (newObservedAt as number) <= (existingObservedAt as number);
  return ok(
    Object.freeze({
      isStale,
      existingObservedAt,
      newObservedAt,
    }),
  );
}
