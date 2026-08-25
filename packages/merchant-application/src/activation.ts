/**
 * Activation snapshot module.
 *
 * An activation snapshot captures the immutable state of a merchant at the
 * moment they are activated in a given environment. It records all verification
 * digests, timing, limitations, and connector configuration.
 */

import type { CounterId, Environment, Instant, Sha256Digest, Result } from "@counter/domain";
import { createCanonicalError, ok, err } from "@counter/domain";

// ─── Activation Snapshot ────────────────────────────────────────────────────

export interface ActivationSnapshot {
  readonly merchantId: CounterId<"merchant">;
  readonly environment: Environment;
  readonly verificationDigests: readonly Sha256Digest[];
  readonly observedTimes: readonly Instant[];
  readonly expiryTimes: readonly Instant[];
  readonly acceptedLimitations: readonly string[];
  readonly connectorIds: readonly string[];
  readonly capabilityManifestVersion: string;
  readonly activatedAt: Instant;
  readonly activatedBy: CounterId<"operator">;
}

// ─── Create Activation Snapshot ─────────────────────────────────────────────

export interface CreateActivationSnapshotInput {
  readonly merchantId: CounterId<"merchant">;
  readonly environment: Environment;
  readonly verificationDigests: readonly Sha256Digest[];
  readonly observedTimes: readonly Instant[];
  readonly expiryTimes: readonly Instant[];
  readonly acceptedLimitations: readonly string[];
  readonly connectorIds: readonly string[];
  readonly capabilityManifestVersion: string;
  readonly activatedAt: Instant;
  readonly activatedBy: CounterId<"operator">;
}

/**
 * Creates an immutable activation snapshot. Validates that at least one
 * verification digest is present (all verifications must be complete).
 */
export function createActivationSnapshot(
  input: CreateActivationSnapshotInput,
): Result<ActivationSnapshot> {
  if (input.verificationDigests.length === 0) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "INVALID_FORMAT",
        message: "Activation requires at least one completed verification digest",
      }),
    );
  }

  if (input.connectorIds.length === 0) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "INVALID_FORMAT",
        message: "Activation requires at least one connector",
      }),
    );
  }

  if (input.capabilityManifestVersion.trim().length === 0) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "INVALID_FORMAT",
        message: "Capability manifest version must not be empty",
      }),
    );
  }

  const snapshot: ActivationSnapshot = Object.freeze({
    merchantId: input.merchantId,
    environment: input.environment,
    verificationDigests: Object.freeze([...input.verificationDigests]),
    observedTimes: Object.freeze([...input.observedTimes]),
    expiryTimes: Object.freeze([...input.expiryTimes]),
    acceptedLimitations: Object.freeze([...input.acceptedLimitations]),
    connectorIds: Object.freeze([...input.connectorIds]),
    capabilityManifestVersion: input.capabilityManifestVersion,
    activatedAt: input.activatedAt,
    activatedBy: input.activatedBy,
  });

  return ok(snapshot);
}
