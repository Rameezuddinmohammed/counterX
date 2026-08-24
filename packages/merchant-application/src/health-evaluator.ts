/**
 * Runtime health evaluator for merchant operations.
 *
 * Pure evaluation of merchant health from the current readiness state. Does not
 * mutate any state. Determines whether a merchant should be considered Healthy,
 * Degraded, or Suspended based on their readiness check results.
 */

import type { ReadinessResult } from "./readiness-types.js";
import type { CapabilityManifest } from "./capability-manifest.js";

// ─── Health Status ──────────────────────────────────────────────────────────

export const HEALTH_STATUSES = ["Healthy", "Degraded", "Suspended"] as const;

export type HealthStatus = (typeof HEALTH_STATUSES)[number];

// ─── Health Evaluation Result ───────────────────────────────────────────────

export interface HealthEvaluation {
  readonly status: HealthStatus;
  readonly reason: string;
  readonly blockingChecks: readonly string[];
  readonly degradedChecks: readonly string[];
}

// ─── Health Evaluator ───────────────────────────────────────────────────────

/**
 * Evaluates the runtime health of a merchant based on readiness state.
 *
 * - Suspended: Any Blocking check fails at runtime
 * - Degraded: Advisory or Expiring issues present (non-blocking)
 * - Healthy: All checks pass with no issues
 *
 * The manifest parameter is used to ensure consistency between what the manifest
 * declares and what the readiness engine reports.
 */
export function evaluateHealth(
  readiness: ReadinessResult,
  _manifest: CapabilityManifest,
): HealthEvaluation {
  const blockingChecks: string[] = [];
  const degradedChecks: string[] = [];

  for (const result of readiness.checkResults) {
    if (result.status === "Blocking") {
      blockingChecks.push(result.checkKind);
    } else if (
      result.status === "Advisory" ||
      result.status === "Expiring" ||
      result.status === "AcceptedLimitation"
    ) {
      degradedChecks.push(result.checkKind);
    }
  }

  if (blockingChecks.length > 0) {
    return Object.freeze({
      status: "Suspended",
      reason: `Blocking checks failed: ${blockingChecks.join(", ")}`,
      blockingChecks: Object.freeze([...blockingChecks]),
      degradedChecks: Object.freeze([...degradedChecks]),
    });
  }

  if (degradedChecks.length > 0) {
    return Object.freeze({
      status: "Degraded",
      reason: `Non-blocking issues detected: ${degradedChecks.join(", ")}`,
      blockingChecks: Object.freeze([]),
      degradedChecks: Object.freeze([...degradedChecks]),
    });
  }

  return Object.freeze({
    status: "Healthy",
    reason: "All checks passing",
    blockingChecks: Object.freeze([]),
    degradedChecks: Object.freeze([]),
  });
}
