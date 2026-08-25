/**
 * Suspension and reactivation module.
 *
 * Provides the domain model for suspending merchants (voluntary, kill-switch,
 * or policy-driven) and requesting reactivation with review.
 */

import type { ActorReference, CounterId, Instant, Sha256Digest, Result } from "@counter/domain";
import { createCanonicalError, ok, err } from "@counter/domain";

// ─── Suspension Kinds ───────────────────────────────────────────────────────

export const SUSPENSION_KINDS = ["voluntary", "kill_switch", "policy"] as const;

export type SuspensionKind = (typeof SUSPENSION_KINDS)[number];

const suspensionKindSet: ReadonlySet<string> = new Set(SUSPENSION_KINDS);

export function isSuspensionKind(value: unknown): value is SuspensionKind {
  return typeof value === "string" && suspensionKindSet.has(value);
}

// ─── Reactivation Request Statuses ──────────────────────────────────────────

export const REACTIVATION_STATUSES = ["pending", "approved", "denied"] as const;

export type ReactivationStatus = (typeof REACTIVATION_STATUSES)[number];

// ─── Suspension Record ──────────────────────────────────────────────────────

export interface SuspensionRecord {
  readonly merchantId: CounterId<"merchant">;
  readonly kind: SuspensionKind;
  readonly reason: string;
  readonly suspendedBy: ActorReference;
  readonly suspendedAt: Instant;
  readonly evidenceDigest?: Sha256Digest;
}

// ─── Reactivation Request ───────────────────────────────────────────────────

export interface ReactivationRequest {
  readonly merchantId: CounterId<"merchant">;
  readonly requestedBy: ActorReference;
  readonly requestedAt: Instant;
  readonly reviewNotes: string;
  readonly status: ReactivationStatus;
}

// ─── Suspend Merchant ───────────────────────────────────────────────────────

export interface SuspendMerchantParams {
  readonly merchantId: CounterId<"merchant">;
  readonly kind: SuspensionKind;
  readonly reason: string;
  readonly actor: ActorReference;
  readonly now: Instant;
  readonly evidenceDigest?: Sha256Digest;
}

export function suspendMerchant(params: SuspendMerchantParams): Result<SuspensionRecord> {
  const { merchantId, kind, reason, actor, now, evidenceDigest } = params;

  if (reason.trim().length === 0) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "INVALID_FORMAT",
        message: "Suspension reason must not be empty",
      }),
    );
  }

  const record: SuspensionRecord = Object.freeze({
    merchantId,
    kind,
    reason,
    suspendedBy: actor,
    suspendedAt: now,
    ...(evidenceDigest !== undefined ? { evidenceDigest } : {}),
  });

  return ok(record);
}

// ─── Request Reactivation ───────────────────────────────────────────────────

export interface RequestReactivationParams {
  readonly merchantId: CounterId<"merchant">;
  readonly actor: ActorReference;
  readonly notes: string;
  readonly now: Instant;
}

export function requestReactivation(
  params: RequestReactivationParams,
): Result<ReactivationRequest> {
  const { merchantId, actor, notes, now } = params;

  if (notes.trim().length === 0) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "INVALID_FORMAT",
        message: "Reactivation review notes must not be empty",
      }),
    );
  }

  const request: ReactivationRequest = Object.freeze({
    merchantId,
    requestedBy: actor,
    requestedAt: now,
    reviewNotes: notes,
    status: "pending" as const,
  });

  return ok(request);
}
