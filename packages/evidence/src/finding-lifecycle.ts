/**
 * Finding status transitions.
 *
 * Enforces the valid state machine for findings:
 * - open -> investigating
 * - investigating -> compensating, resolved, unresolved, accepted
 * - compensating -> resolved, unresolved
 * - unresolved -> investigating, accepted
 */

import type { CounterId } from "@counter/domain";
import { createCanonicalError, err, ok } from "@counter/domain";
import type { Result } from "@counter/domain";
import type { FindingRecord, FindingStatus } from "./types.js";

export const VALID_FINDING_TRANSITIONS: Readonly<
  Record<FindingStatus, readonly FindingStatus[]>
> = Object.freeze({
  open: Object.freeze(["investigating"] as const),
  investigating: Object.freeze([
    "compensating",
    "resolved",
    "unresolved",
    "accepted",
  ] as const),
  compensating: Object.freeze(["resolved", "unresolved"] as const),
  resolved: Object.freeze([] as const),
  unresolved: Object.freeze(["investigating", "accepted"] as const),
  accepted: Object.freeze([] as const),
});

/**
 * Validates that a finding transition is allowed and returns a new frozen
 * FindingRecord with the updated status.
 */
export function transitionFinding(
  finding: FindingRecord,
  newStatus: FindingStatus,
  resolutionEvidence?: readonly CounterId<"evidence">[],
): Result<FindingRecord> {
  const allowed = VALID_FINDING_TRANSITIONS[finding.status];
  if (!(allowed as readonly string[]).includes(newStatus)) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "UNSUPPORTED_VALUE",
        message: `Cannot transition finding from '${finding.status}' to '${newStatus}'`,
      }),
    );
  }

  const updatedResolution =
    resolutionEvidence !== undefined
      ? Object.freeze([...resolutionEvidence])
      : finding.resolutionEvidence;

  return ok(
    Object.freeze({
      ...finding,
      status: newStatus,
      resolutionEvidence: updatedResolution,
    }),
  );
}
