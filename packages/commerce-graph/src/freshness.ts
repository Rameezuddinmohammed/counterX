/**
 * Freshness enforcement for commerce graph entities.
 *
 * Implements freshness assessment locally (same algorithm as connector-sdk)
 * to avoid a circular dependency. The commerce-graph package depends only
 * on @counter/domain.
 */

import type { Instant, Result } from "@counter/domain";
import { createCanonicalError, err, ok } from "@counter/domain";
import type { FreshnessPolicy } from "./types.js";

// ─── Freshness Status ─────────────────────────────────────────────────────────

export const FRESHNESS_STATUSES = ["fresh", "approaching_stale", "stale", "unknown"] as const;
export type FreshnessStatus = (typeof FRESHNESS_STATUSES)[number];

// ─── Freshness Assessment ─────────────────────────────────────────────────────

export interface FreshnessAssessment {
  readonly status: FreshnessStatus;
  readonly lastObservedAt: Instant | null;
  readonly ageMs: number | null;
  readonly budgetMs: number;
  readonly withinBudget: boolean;
}

// ─── Freshness Mode ───────────────────────────────────────────────────────────

export type FreshnessMode = "block" | "degrade";

// ─── Evaluate Freshness ───────────────────────────────────────────────────────

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
    return Object.freeze({
      status: "unknown" as const,
      lastObservedAt: null,
      ageMs: null,
      budgetMs: policy.maxAgeMs,
      withinBudget: false,
    });
  }

  const ageMs = (now as number) - (lastObservedAt as number);

  if (ageMs <= policy.warningThresholdMs) {
    return Object.freeze({
      status: "fresh" as const,
      lastObservedAt,
      ageMs,
      budgetMs: policy.maxAgeMs,
      withinBudget: true,
    });
  }

  if (ageMs <= policy.maxAgeMs) {
    return Object.freeze({
      status: "approaching_stale" as const,
      lastObservedAt,
      ageMs,
      budgetMs: policy.maxAgeMs,
      withinBudget: true,
    });
  }

  return Object.freeze({
    status: "stale" as const,
    lastObservedAt,
    ageMs,
    budgetMs: policy.maxAgeMs,
    withinBudget: false,
  });
}

// ─── Assess Entity Freshness ──────────────────────────────────────────────────

export interface EntityWithObservation {
  readonly observedAt: Instant | null;
}

/**
 * Assesses whether an entity's data is fresh according to the given policy.
 */
export function assessEntityFreshness(
  entity: EntityWithObservation,
  now: Instant,
  policy: FreshnessPolicy,
): FreshnessAssessment {
  return evaluateFreshness(entity.observedAt, now, policy);
}

// ─── Enforce Freshness Policy ─────────────────────────────────────────────────

export interface FreshnessEnforcementResult {
  readonly allowed: boolean;
  readonly assessment: FreshnessAssessment;
  readonly mode: FreshnessMode;
}

/**
 * Enforces a freshness policy on an entity.
 *
 * In "block" mode, stale entities are rejected (allowed=false).
 * In "degrade" mode, stale entities are allowed but flagged.
 */
export function enforceFreshnessPolicy(
  entity: EntityWithObservation,
  now: Instant,
  policy: FreshnessPolicy,
  mode: FreshnessMode,
): Result<FreshnessEnforcementResult> {
  const assessment = evaluateFreshness(entity.observedAt, now, policy);

  if (mode === "block" && !assessment.withinBudget) {
    return err(
      createCanonicalError({
        category: "stale",
        code: "STALE",
        message: "Entity data is stale and freshness policy blocks usage",
      }),
    );
  }

  return ok(
    Object.freeze({
      allowed: assessment.withinBudget || mode === "degrade",
      assessment,
      mode,
    }),
  );
}
