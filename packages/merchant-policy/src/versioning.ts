/**
 * Policy version management.
 *
 * Provides version stamping, rollback detection, and version comparison.
 * A policy version is a monotonic integer. Rollback means applying a
 * version <= current active version, which must be explicitly flagged.
 */

import type { Result } from "@counter/domain";
import { createCanonicalError, err, ok } from "@counter/domain";

// ---------------------------------------------------------------------------
// Version record
// ---------------------------------------------------------------------------

export interface PolicyVersionRecord {
  readonly version: number;
  readonly activatedAt: number;
  readonly merchantId: string;
}

// ---------------------------------------------------------------------------
// Version comparison
// ---------------------------------------------------------------------------

export type VersionComparison = "newer" | "same" | "rollback";

/**
 * Compares a candidate version against the currently active version.
 */
export function compareVersions(
  currentVersion: number,
  candidateVersion: number,
): VersionComparison {
  if (candidateVersion > currentVersion) {
    return "newer";
  }
  if (candidateVersion === currentVersion) {
    return "same";
  }
  return "rollback";
}

// ---------------------------------------------------------------------------
// Rollback detection
// ---------------------------------------------------------------------------

export interface VersionTransition {
  readonly from: number;
  readonly to: number;
  readonly comparison: VersionComparison;
  readonly isRollback: boolean;
}

/**
 * Detects whether applying a new version constitutes a rollback.
 */
export function detectVersionTransition(
  currentVersion: number,
  candidateVersion: number,
): VersionTransition {
  const comparison = compareVersions(currentVersion, candidateVersion);
  return Object.freeze({
    from: currentVersion,
    to: candidateVersion,
    comparison,
    isRollback: comparison === "rollback",
  });
}

// ---------------------------------------------------------------------------
// Safe version advancement
// ---------------------------------------------------------------------------

/**
 * Advances the policy version, rejecting rollbacks unless explicitly allowed.
 *
 * @param currentVersion - The currently active version
 * @param candidateVersion - The proposed new version
 * @param merchantId - The merchant identifier
 * @param allowRollback - Whether rollback is explicitly permitted
 * @returns Result containing the new version record or an error
 */
export function advanceVersion(
  currentVersion: number,
  candidateVersion: number,
  merchantId: string,
  allowRollback: boolean,
): Result<PolicyVersionRecord> {
  if (candidateVersion <= 0 || !Number.isInteger(candidateVersion)) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "OUT_OF_RANGE",
        message: "Policy version must be a positive integer",
      }),
    );
  }

  const transition = detectVersionTransition(currentVersion, candidateVersion);

  if (transition.isRollback && !allowRollback) {
    return err(
      createCanonicalError({
        category: "conflict",
        code: "CONFLICT",
        message: `Policy version rollback from ${String(currentVersion)} to ${String(candidateVersion)} requires explicit allowRollback flag`,
      }),
    );
  }

  if (transition.comparison === "same") {
    return err(
      createCanonicalError({
        category: "conflict",
        code: "CONFLICT",
        message: `Policy version ${String(candidateVersion)} is already active`,
      }),
    );
  }

  return ok(
    Object.freeze({
      version: candidateVersion,
      activatedAt: Date.now(),
      merchantId,
    }),
  );
}

// ---------------------------------------------------------------------------
// Version history management
// ---------------------------------------------------------------------------

/**
 * Validates a version history is monotonically increasing (no gaps required).
 */
export function isMonotonicHistory(versions: readonly number[]): boolean {
  for (let i = 1; i < versions.length; i++) {
    const current = versions[i];
    const previous = versions[i - 1];
    if (current === undefined || previous === undefined || current <= previous) {
      return false;
    }
  }
  return true;
}
