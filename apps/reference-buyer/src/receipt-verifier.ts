/**
 * Independent receipt verification for the reference buyer.
 *
 * Verifies CTP signature + commitment digest independently.
 * Does NOT use internal service shortcuts - uses only the published
 * receipt-verifier from @counter/evidence.
 */

import type { ReceiptVerifyOptions, TrustedPublicKey } from "@counter/evidence";
import { verifyReceipt } from "@counter/evidence";
import { TEST_KEY_RECORD_A, TEST_KEY_RECORD_B } from "@counter/trust-protocol";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IndependentVerificationOptions {
  /** The signed receipt envelope to verify. */
  readonly envelope: unknown;
  /** Additional trusted keys beyond the default test keys (optional). */
  readonly additionalTrustedKeys?: readonly TrustedPublicKey[];
  /** Expected audience URI (optional). */
  readonly expectedAudience?: string;
  /** Current time for validity window check (optional). */
  readonly currentTime?: string;
  /** Predecessor envelope for supersession chain check (optional). */
  readonly predecessorEnvelope?: unknown;
}

export interface IndependentVerificationResult {
  readonly valid: boolean;
  readonly error?: string;
}

// ---------------------------------------------------------------------------
// Default Trusted Keys (test keys only)
// ---------------------------------------------------------------------------

const DEFAULT_TRUSTED_KEYS: readonly TrustedPublicKey[] = Object.freeze([
  Object.freeze({ kid: TEST_KEY_RECORD_A.kid, publicKey: TEST_KEY_RECORD_A.publicKey }),
  Object.freeze({ kid: TEST_KEY_RECORD_B.kid, publicKey: TEST_KEY_RECORD_B.publicKey }),
]);

// ---------------------------------------------------------------------------
// Independent Verification
// ---------------------------------------------------------------------------

/**
 * Verifies a receipt independently using only CTP envelope verification.
 *
 * This function:
 * 1. Verifies the Ed25519 signature against trusted test keys
 * 2. Verifies the canonical commitment digest (payload_digest) integrity
 * 3. Optionally validates audience, timestamps, and supersession chain
 *
 * It does NOT call any internal services or use database access.
 */
export async function verifyReceiptIndependent(
  options: IndependentVerificationOptions,
): Promise<IndependentVerificationResult> {
  const trustedKeys =
    options.additionalTrustedKeys !== undefined
      ? [...DEFAULT_TRUSTED_KEYS, ...options.additionalTrustedKeys]
      : [...DEFAULT_TRUSTED_KEYS];

  const verifyOptions: ReceiptVerifyOptions = {
    trustedKeys,
    ...(options.expectedAudience !== undefined
      ? { expectedAudience: options.expectedAudience }
      : {}),
    ...(options.currentTime !== undefined ? { currentTime: options.currentTime } : {}),
    ...(options.predecessorEnvelope !== undefined
      ? { predecessorEnvelope: options.predecessorEnvelope }
      : {}),
  };

  const result = await verifyReceipt(options.envelope, verifyOptions);

  if (result.error !== undefined) {
    return Object.freeze({
      valid: result.valid,
      error: result.error,
    });
  }

  return Object.freeze({
    valid: result.valid,
  });
}
