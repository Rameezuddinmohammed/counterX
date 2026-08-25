/**
 * Runtime health evaluator for merchant operations.
 *
 * Pure evaluation of merchant health from the current readiness state. Does not
 * mutate any state. Determines whether a merchant should be considered Healthy,
 * Degraded, or Suspended based on their readiness check results.
 */

import type { ReadinessResult, ReadinessCheckKind } from "./readiness-types.js";
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

// ─── Capability-to-Check Mapping ────────────────────────────────────────────

/**
 * Maps pilot capabilities to the readiness check kinds that must be present
 * for the capability to function correctly. If a manifest declares a capability
 * but the readiness result lacks the corresponding check, the merchant is
 * considered Degraded (gap in discovery/runtime consistency).
 */
const CAPABILITY_REQUIRED_CHECKS: Readonly<Record<string, readonly ReadinessCheckKind[]>> = {
  "quote.create": ["connector_health", "mapping_freshness", "policy_compiled"],
  "quote.accept": ["connector_health", "mapping_freshness", "policy_compiled"],
  "payment.initiate": ["connector_health", "payment_configured", "protocol_version"],
  "payment.confirm": ["connector_health", "payment_configured", "protocol_version"],
  "refund.initiate": ["connector_health", "payment_configured"],
};

// ─── Health Evaluator ───────────────────────────────────────────────────────

/**
 * Evaluates the runtime health of a merchant based on readiness state.
 *
 * - Suspended: Any Blocking check fails at runtime
 * - Degraded: Advisory or Expiring issues present, or manifest declares
 *   capabilities without corresponding readiness checks
 * - Healthy: All checks pass with no issues
 *
 * The manifest parameter enforces consistency between what the manifest
 * declares and what the readiness engine reports.
 */
export function evaluateHealth(
  readiness: ReadinessResult,
  manifest: CapabilityManifest,
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

  // Cross-check: manifest capabilities must have corresponding readiness checks
  const presentCheckKinds = new Set(readiness.checkResults.map((r) => r.checkKind));
  for (const capability of manifest.capabilities) {
    const requiredChecks = CAPABILITY_REQUIRED_CHECKS[capability];
    if (requiredChecks === undefined) continue;
    for (const requiredCheck of requiredChecks) {
      if (!presentCheckKinds.has(requiredCheck) && !degradedChecks.includes(requiredCheck)) {
        degradedChecks.push(requiredCheck);
      }
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
