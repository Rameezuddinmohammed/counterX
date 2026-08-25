/**
 * Readiness engine for merchant activation evaluation.
 *
 * Evaluates typed readiness checks with worst-of semantics: any Blocking check
 * means the merchant is not ready. Binds connector/mapping/policy/payment/protocol
 * versions. Does not add capabilities, only evaluates existing state.
 */

import type { CounterId, Instant, Clock } from "@counter/domain";
import type {
  ReadinessCheck,
  ReadinessCheckResult,
  ReadinessResult,
  ReadinessStatus,
} from "./readiness-types.js";

// ─── Status Severity (lower = worse) ───────────────────────────────────────

const STATUS_SEVERITY: Readonly<Record<ReadinessStatus, number>> = {
  Blocking: 0,
  AcceptedLimitation: 1,
  Advisory: 2,
  Expiring: 3,
};

function worstStatus(a: ReadinessStatus, b: ReadinessStatus): ReadinessStatus {
  return STATUS_SEVERITY[a] <= STATUS_SEVERITY[b] ? a : b;
}

// ─── Readiness Engine ───────────────────────────────────────────────────────

export class ReadinessEngine {
  readonly #clock: Clock;

  public constructor(clock: Clock) {
    this.#clock = clock;
  }

  /**
   * Evaluates all checks and computes the overall readiness status.
   * Uses worst-of semantics: if any check is Blocking, the merchant is not ready.
   */
  public evaluateAll(
    merchantId: CounterId<"merchant">,
    checks: readonly ReadinessCheck[],
  ): ReadinessResult {
    const now = this.#clock.now();
    const checkResults: ReadinessCheckResult[] = [];

    for (const check of checks) {
      checkResults.push(this.#evaluateCheck(check, now));
    }

    const expiringItems = checkResults.filter((r) => r.status === "Expiring");

    let overallStatus: ReadinessStatus = "Expiring";
    for (const result of checkResults) {
      overallStatus = worstStatus(overallStatus, result.status);
    }

    // If there are no checks at all, treat as Blocking (nothing verified)
    if (checkResults.length === 0) {
      overallStatus = "Blocking";
    }

    return Object.freeze({
      merchantId,
      overallStatus,
      checkResults: Object.freeze(checkResults),
      expiringItems: Object.freeze(expiringItems),
      isReady: overallStatus !== "Blocking",
    });
  }

  #evaluateCheck(check: ReadinessCheck, now: Instant): ReadinessCheckResult {
    // Check if evidence has expired
    if (check.expiresAt !== null && check.expiresAt < now) {
      return Object.freeze({
        checkKind: check.checkKind,
        status: "Blocking" as const,
        reason: `Check ${check.checkKind} has expired`,
        timeToExpiryMs: check.expiresAt - now,
      });
    }

    // Evidence_valid kind has its own expiresAt in evidence
    if (check.evidence.kind === "evidence_valid") {
      if (check.evidence.expiresAt < now) {
        return Object.freeze({
          checkKind: check.checkKind,
          status: "Blocking" as const,
          reason: "Evidence has expired",
          timeToExpiryMs: check.evidence.expiresAt - now,
        });
      }
    }

    // If there is an accepted limitation, status is AcceptedLimitation
    if (check.acceptedLimitation !== null) {
      const timeToExpiryMs = check.expiresAt !== null ? check.expiresAt - now : null;
      return Object.freeze({
        checkKind: check.checkKind,
        status: "AcceptedLimitation" as const,
        reason: `Limitation accepted: ${check.acceptedLimitation}`,
        timeToExpiryMs,
      });
    }

    // If expiring soon (within 24 hours), mark as Expiring
    const EXPIRY_WARNING_MS = 24 * 60 * 60 * 1000;
    if (check.expiresAt !== null) {
      const timeToExpiryMs = check.expiresAt - now;
      if (timeToExpiryMs <= EXPIRY_WARNING_MS) {
        return Object.freeze({
          checkKind: check.checkKind,
          status: "Expiring" as const,
          reason: `Check ${check.checkKind} is expiring soon`,
          timeToExpiryMs,
        });
      }
    }

    // Otherwise, advisory (healthy but informational)
    const timeToExpiryMs = check.expiresAt !== null ? check.expiresAt - now : null;
    return Object.freeze({
      checkKind: check.checkKind,
      status: "Advisory" as const,
      reason: `Check ${check.checkKind} is healthy`,
      timeToExpiryMs,
    });
  }
}
