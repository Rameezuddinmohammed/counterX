/**
 * Builds approvals for above-threshold transactions.
 *
 * Approvals follow PILOT.md constraints:
 * - 10-minute maximum validity
 * - Required for transactions exceeding the unattended threshold
 */

import type { Instant } from "@counter/domain";
import { instantFromEpochMilliseconds } from "@counter/domain";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TestApproval {
  readonly ref: string;
  readonly intentRef: string;
  readonly approvedAt: Instant;
  readonly validUntil: Instant;
}

export interface BuildApprovalOptions {
  readonly intentRef: string;
  readonly approvedAt?: Instant;
  readonly validityDurationMs?: number;
}

// ---------------------------------------------------------------------------
// Constants (PILOT.md constraints)
// ---------------------------------------------------------------------------

/** Maximum approval validity: 10 minutes */
const MAX_APPROVAL_VALIDITY_MS = 10 * 60 * 1000;

/** Default approval validity: 5 minutes */
const DEFAULT_VALIDITY_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

let approvalCounter = 0;

/**
 * Builds a deterministic test approval with PILOT.md constraints.
 *
 * - Validity capped at 10 minutes
 * - Binds to a specific intent reference
 */
export function buildTestApproval(options: BuildApprovalOptions): TestApproval {
  approvalCounter += 1;
  const ref = `ctr_approval_test-${approvalCounter.toString().padStart(5, "0")}`;

  const now = Date.now();

  const approvedAtResult = options.approvedAt !== undefined
    ? { ok: true as const, value: options.approvedAt }
    : instantFromEpochMilliseconds(now);

  if (!approvedAtResult.ok) {
    throw new TypeError("Failed to compute approvedAt instant");
  }
  const approvedAt = approvedAtResult.value;

  const requestedDuration = options.validityDurationMs ?? DEFAULT_VALIDITY_MS;
  const effectiveDuration = Math.min(requestedDuration, MAX_APPROVAL_VALIDITY_MS);

  const validUntilResult = instantFromEpochMilliseconds(approvedAt + effectiveDuration);
  if (!validUntilResult.ok) {
    throw new TypeError("Failed to compute validUntil instant");
  }
  const validUntil = validUntilResult.value;

  return Object.freeze({
    ref,
    intentRef: options.intentRef,
    approvedAt,
    validUntil,
  });
}

/**
 * Resets the internal approval counter. Use in tests for deterministic output.
 */
export function resetApprovalCounter(): void {
  approvalCounter = 0;
}
