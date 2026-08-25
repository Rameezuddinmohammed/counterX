/**
 * Allowlist invitation module.
 *
 * Manages the lifecycle of invitations that gate merchant onboarding.
 * Invitations are issued by operators and accepted by merchant representatives.
 */

import type { CounterId, Instant, Result } from "@counter/domain";
import { createCanonicalError, ok, err } from "@counter/domain";

// ─── Invitation Statuses ────────────────────────────────────────────────────

export const INVITATION_STATUSES = ["pending", "accepted", "expired", "revoked"] as const;

export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

const invitationStatusSet: ReadonlySet<string> = new Set(INVITATION_STATUSES);

export function isInvitationStatus(value: unknown): value is InvitationStatus {
  return typeof value === "string" && invitationStatusSet.has(value);
}

// ─── Allowlist Invitation ───────────────────────────────────────────────────

export interface AllowlistInvitation {
  readonly invitationId: string;
  readonly merchantLegalEntity: string;
  readonly targetEmail: string;
  readonly invitedBy: CounterId<"operator">;
  readonly issuedAt: Instant;
  readonly expiresAt: Instant;
  readonly acceptedAt?: Instant;
  readonly status: InvitationStatus;
  readonly acceptedBy?: CounterId<"merchant-user">;
}

// ─── Create Invitation ──────────────────────────────────────────────────────

export interface CreateInvitationInput {
  readonly invitationId: string;
  readonly merchantLegalEntity: string;
  readonly targetEmail: string;
  readonly invitedBy: CounterId<"operator">;
  readonly issuedAt: Instant;
  readonly expiresAt: Instant;
}

export function createInvitation(input: CreateInvitationInput): Result<AllowlistInvitation> {
  const { invitationId, merchantLegalEntity, targetEmail, invitedBy, issuedAt, expiresAt } = input;

  if (merchantLegalEntity.trim().length === 0) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "INVALID_FORMAT",
        message: "Merchant legal entity name must not be empty",
      }),
    );
  }

  if (targetEmail.trim().length === 0) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "INVALID_FORMAT",
        message: "Target email must not be empty",
      }),
    );
  }

  if (expiresAt <= issuedAt) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "OUT_OF_RANGE",
        message: "Expiration time must be after issuance time",
      }),
    );
  }

  const invitation: AllowlistInvitation = Object.freeze({
    invitationId,
    merchantLegalEntity,
    targetEmail,
    invitedBy,
    issuedAt,
    expiresAt,
    status: "pending" as const,
  });

  return ok(invitation);
}

// ─── Accept Invitation ──────────────────────────────────────────────────────

export function acceptInvitation(
  invitation: AllowlistInvitation,
  acceptedBy: CounterId<"merchant-user">,
  now: Instant,
): Result<AllowlistInvitation> {
  if (invitation.status !== "pending") {
    return err(
      createCanonicalError({
        category: "conflict",
        code: "CONFLICT",
        message: "Cannot accept invitation that is not pending",
      }),
    );
  }

  if (!isInvitationValid(invitation, now)) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "OUT_OF_RANGE",
        message: "Invitation has expired",
      }),
    );
  }

  return ok(
    Object.freeze({
      ...invitation,
      status: "accepted" as const,
      acceptedAt: now,
      acceptedBy,
    }),
  );
}

// ─── Revoke Invitation ──────────────────────────────────────────────────────

export function revokeInvitation(
  invitation: AllowlistInvitation,
  _now: Instant,
): Result<AllowlistInvitation> {
  if (invitation.status !== "pending") {
    return err(
      createCanonicalError({
        category: "conflict",
        code: "CONFLICT",
        message: "Cannot revoke invitation that is not pending",
      }),
    );
  }

  return ok(
    Object.freeze({
      ...invitation,
      status: "revoked" as const,
    }),
  );
}

// ─── Validity Check ─────────────────────────────────────────────────────────

export function isInvitationValid(invitation: AllowlistInvitation, now: Instant): boolean {
  return invitation.status === "pending" && now < invitation.expiresAt;
}
