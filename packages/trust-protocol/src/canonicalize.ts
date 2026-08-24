/**
 * Deterministic canonicalization and digest computation for CTP envelopes.
 *
 * Uses RFC 8785 (JSON Canonicalization Scheme) via json-canonicalize@1.1.1
 * and SHA-256 digest via Node.js crypto module (ADR-0002).
 */

import { createHash } from "node:crypto";
import { canonicalize } from "json-canonicalize";
import type { CtpEnvelope, UnsignedCtpEnvelope } from "./types.js";

/**
 * Produces the canonical bytes of an unsigned envelope.
 * The signature is included with alg and kid but WITHOUT the value field.
 * This is the canonical representation that gets signed.
 */
export function canonicalizeUnsignedEnvelope(envelope: UnsignedCtpEnvelope): Uint8Array {
  const canonicalJson = canonicalize(envelope);
  return new TextEncoder().encode(canonicalJson);
}

/**
 * Produces the canonical bytes of a signed envelope (all fields except signature.value).
 * Used by verifiers to reconstruct the signed message.
 */
export function canonicalBytesForVerification(envelope: CtpEnvelope): Uint8Array {
  // Strip signature.value to get the unsigned form that was signed
  const unsigned: UnsignedCtpEnvelope = {
    ctp_version: envelope.ctp_version,
    type: envelope.type,
    id: envelope.id,
    issuer: envelope.issuer,
    subject: envelope.subject,
    audience: envelope.audience,
    environment: envelope.environment,
    issued_at: envelope.issued_at,
    not_before: envelope.not_before,
    expires_at: envelope.expires_at,
    nonce: envelope.nonce,
    correlation_id: envelope.correlation_id,
    payload_digest: envelope.payload_digest,
    payload: envelope.payload,
    evidence_refs: envelope.evidence_refs,
    signature: {
      alg: envelope.signature.alg,
      kid: envelope.signature.kid,
    },
  };
  return canonicalizeUnsignedEnvelope(unsigned);
}

/**
 * Computes the SHA-256 digest of arbitrary bytes.
 * Returns the hex digest string prefixed with "sha256:".
 */
export function computeSha256Digest(bytes: Uint8Array): string {
  const hex = createHash("sha256").update(bytes).digest("hex");
  return `sha256:${hex}`;
}

/**
 * Computes the canonical payload digest for a CTP envelope payload.
 * Canonicalizes the payload object via RFC 8785, then hashes with SHA-256.
 */
export function computePayloadDigest(payload: unknown): string {
  const canonicalPayload = canonicalize(payload);
  const payloadBytes = new TextEncoder().encode(canonicalPayload);
  return computeSha256Digest(payloadBytes);
}

/**
 * Canonicalizes any JSON-serializable value to a deterministic string.
 * Exposed for testing and fixture generation.
 */
export function canonicalizeToString(value: unknown): string {
  return canonicalize(value);
}
