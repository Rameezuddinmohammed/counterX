/**
 * Freshness tracking types and evaluation.
 *
 * Freshness assessment is deterministic given inputs: last observation time,
 * current time, and policy budget.
 */

import type { Instant } from "@counter/domain";

// ─── Status ───────────────────────────────────────────────────────────────────

export const FRESHNESS_STATUSES = ["fresh", "approaching_stale", "stale", "unknown"] as const;
export type FreshnessStatus = (typeof FRESHNESS_STATUSES)[number];

const freshnessStatusSet: ReadonlySet<string> = new Set(FRESHNESS_STATUSES);

export function isFreshnessStatus(value: unknown): value is FreshnessStatus {
  return typeof value === "string" && freshnessStatusSet.has(value);
}

// ─── Policy ───────────────────────────────────────────────────────────────────

export interface FreshnessPolicy {
  readonly resourceName: string;
  readonly maxAgeMs: number;
  readonly warningThresholdMs: number;
}

// ─── Assessment ───────────────────────────────────────────────────────────────

export interface FreshnessAssessment {
  readonly status: FreshnessStatus;
  readonly lastObservedAt: Instant | null;
  readonly ageMs: number | null;
  readonly budgetMs: number;
  readonly withinBudget: boolean;
}

// ─── Evaluation ───────────────────────────────────────────────────────────────

/**
 * Evaluates freshness status deterministically based on the last observation
 * time, the current time, and the freshness policy.
 *
 * - If lastObservedAt is null, the status is "unknown".
 * - If ageMs <= warningThresholdMs, the status is "fresh".
 * - If ageMs <= maxAgeMs, the status is "approaching_stale".
 * - Otherwise, the status is "stale".
 */
export function evaluateFreshness(
  lastObservedAt: Instant | null,
  now: Instant,
  policy: FreshnessPolicy,
): FreshnessAssessment {
  if (lastObservedAt === null) {
    return {
      status: "unknown",
      lastObservedAt: null,
      ageMs: null,
      budgetMs: policy.maxAgeMs,
      withinBudget: false,
    };
  }

  const ageMs = (now as number) - (lastObservedAt as number);

  if (ageMs <= policy.warningThresholdMs) {
    return {
      status: "fresh",
      lastObservedAt,
      ageMs,
      budgetMs: policy.maxAgeMs,
      withinBudget: true,
    };
  }

  if (ageMs <= policy.maxAgeMs) {
    return {
      status: "approaching_stale",
      lastObservedAt,
      ageMs,
      budgetMs: policy.maxAgeMs,
      withinBudget: true,
    };
  }

  return {
    status: "stale",
    lastObservedAt,
    ageMs,
    budgetMs: policy.maxAgeMs,
    withinBudget: false,
  };
}
