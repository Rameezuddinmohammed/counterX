/**
 * AuthorityVerifier port interface.
 *
 * Verifies that a CTP mandate/authority is valid by checking signature,
 * issuer/subject binding, audience, environment, validity window,
 * nonce/replay, revocation status, and key status.
 */

import type { Instant, Result } from "@counter/domain";
import type { CtpEnvelope, CtpEnvironment, MandatePayload } from "@counter/trust-protocol";
import type { CtpAssuranceLevel } from "./assurance-policy.js";

// ---------------------------------------------------------------------------
// Authority Failure Reason Codes
// ---------------------------------------------------------------------------

export const AUTHORITY_FAILURE_REASONS = [
  "signature_invalid",
  "key_revoked",
  "key_expired",
  "key_not_found",
  "mandate_revoked",
  "mandate_expired",
  "nonce_replay",
  "environment_mismatch",
  "audience_mismatch",
  "agent_not_found",
  "agent_revoked",
  "assurance_insufficient",
  "binding_mismatch",
  "validity_window",
] as const;

export type AuthorityFailureReason = (typeof AUTHORITY_FAILURE_REASONS)[number];

// ---------------------------------------------------------------------------
// AuthorityInput
// ---------------------------------------------------------------------------

export interface AuthorityInput {
  /** The signed mandate envelope to verify. */
  readonly envelope: CtpEnvelope<MandatePayload>;
  /** The agent identity making the request. */
  readonly agentId: string;
  /** The kid used to sign the request. */
  readonly kid: string;
  /** The merchant context for audience verification. */
  readonly merchantId: string;
  /** Expected environment. */
  readonly environment: CtpEnvironment;
  /** Current time for validity checks. */
  readonly currentTime: Instant;
  /** The nonce from the current request (for replay detection). */
  readonly nonce: string;
  /** Required assurance level for the operation. */
  readonly requiredAssurance?: CtpAssuranceLevel;
}

// ---------------------------------------------------------------------------
// VerifiedAuthority
// ---------------------------------------------------------------------------

export interface VerifiedAuthority {
  readonly mandateId: string;
  readonly agentId: string;
  readonly kid: string;
  readonly merchantId: string;
  readonly environment: CtpEnvironment;
  readonly assuranceLevel: CtpAssuranceLevel;
  readonly allowedOperations: readonly string[];
  readonly allowedMerchants: readonly string[];
  readonly currencies: readonly string[];
  readonly perTransactionLimit: { readonly amount: number | string; readonly currency: string };
  readonly validUntil: Instant;
}

// ---------------------------------------------------------------------------
// AuthorityFailure
// ---------------------------------------------------------------------------

export interface AuthorityFailure {
  readonly reason: AuthorityFailureReason;
  readonly message: string;
}

// ---------------------------------------------------------------------------
// AuthorityVerifier Port
// ---------------------------------------------------------------------------

/**
 * Port for verifying CTP mandate authority.
 * Performs the full verification pipeline including signature, key,
 * nonce, revocation, binding, environment, audience, and assurance checks.
 */
export interface AuthorityVerifier {
  verify(input: AuthorityInput): Promise<Result<VerifiedAuthority, AuthorityFailure>>;
}
