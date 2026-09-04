import "./crypto-setup.js";
/**
 * CTP Ed25519 signing pipeline.
 *
 * Pipeline (per ADR-0002):
 * 1. Schema validation (caller responsibility)
 * 2. Canonical unsigned bytes (RFC 8785)
 * 3. SHA-256 digest
 * 4. Ed25519 signing via @noble/ed25519
 * 5. Immutable serialized artifact
 *
 * ADR-0006: Private keys are held behind the Signer port interface.
 * They never appear in envelopes, logs, or production fixtures.
 */

import * as ed from "@noble/ed25519";
import { type Result, ok, err, createCanonicalError } from "@counter/domain";
import { canonicalizeUnsignedEnvelope } from "./canonicalize.js";
import { bytesToBase64Url } from "./base64url.js";
import type { CtpEnvelope, SignatureValue, UnsignedCtpEnvelope } from "./types.js";
import { CTP_SIGNATURE_ALGORITHM } from "./types.js";

// ---------------------------------------------------------------------------
// Signer Port (ADR-0006: private keys behind this interface)
// ---------------------------------------------------------------------------

/**
 * Abstraction over signing operations. Production implementations use
 * KMS/HSM; test implementations use in-memory keys.
 */
export interface Signer {
  /** The kid associated with this signer's key. */
  readonly kid: string;
  /** Sign arbitrary bytes and return the Ed25519 signature. */
  sign(message: Uint8Array): Promise<Uint8Array>;
}

// ---------------------------------------------------------------------------
// In-Memory Signer (test-only - holds private key directly)
// ---------------------------------------------------------------------------

/**
 * Test-only signer that holds an Ed25519 private key in memory.
 * This MUST NOT be used in production (ADR-0006).
 */
export class InMemorySigner implements Signer {
  readonly kid: string;
  readonly #privateKey: Uint8Array;

  public constructor(kid: string, privateKey: Uint8Array) {
    this.kid = kid;
    this.#privateKey = privateKey;
  }

  public async sign(message: Uint8Array): Promise<Uint8Array> {
    return ed.signAsync(message, this.#privateKey);
  }
}

// ---------------------------------------------------------------------------
// Signing function
// ---------------------------------------------------------------------------

/**
 * Signs an unsigned CTP envelope using the provided signer.
 * Returns the complete signed envelope.
 *
 * Validates that the unsigned envelope's signature.alg is EdDSA and
 * that the kid matches the signer's kid.
 */
export async function signEnvelope<Payload>(
  unsigned: UnsignedCtpEnvelope<Payload>,
  signer: Signer,
): Promise<Result<CtpEnvelope<Payload>>> {
  // Validate algorithm
  if (unsigned.signature.alg !== CTP_SIGNATURE_ALGORITHM) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "UNSUPPORTED_VALUE",
        message: `Signature algorithm must be '${CTP_SIGNATURE_ALGORITHM}', got '${unsigned.signature.alg}'`,
      }),
    );
  }

  // Validate kid matches signer
  if (unsigned.signature.kid !== signer.kid) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "UNSUPPORTED_VALUE",
        message: "Envelope kid does not match signer kid",
      }),
    );
  }

  // Step 2: Canonical unsigned bytes
  const canonicalBytes = canonicalizeUnsignedEnvelope(unsigned);

  // Step 4: Ed25519 signing
  const signatureBytes = await signer.sign(canonicalBytes);

  // Encode signature as base64url without padding
  const signatureValue = bytesToBase64Url(signatureBytes) as SignatureValue;

  // Step 5: Immutable signed artifact
  const signed: CtpEnvelope<Payload> = {
    ...unsigned,
    signature: {
      alg: unsigned.signature.alg,
      kid: unsigned.signature.kid,
      value: signatureValue,
    },
  };

  return ok(Object.freeze(signed) as CtpEnvelope<Payload>);
}

/**
 * Derives the Ed25519 public key from a private key.
 * Returns base64url-encoded (no padding) public key.
 */
export function derivePublicKey(privateKey: Uint8Array): string {
  const publicKeyBytes = ed.getPublicKey(privateKey);
  return bytesToBase64Url(publicKeyBytes);
}
