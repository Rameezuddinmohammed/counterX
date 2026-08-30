/**
 * Independent receipt verifier (dependency-light).
 *
 * This module can verify a signed receipt envelope given only:
 *   - The receipt envelope (JSON)
 *   - A set of trusted Counter public keys
 *
 * Dependencies: @noble/ed25519, json-canonicalize, node:crypto
 *
 * It does NOT need database access, HTTP calls, or heavy platform packages.
 * Returns a simple {valid, error?} result rather than the domain Result type.
 */

import * as ed from "@noble/ed25519";
import { createHash } from "node:crypto";
import { canonicalize } from "json-canonicalize";

// ---------------------------------------------------------------------------
// Public Key Record (minimal, for verification only)
// ---------------------------------------------------------------------------

export interface TrustedPublicKey {
  readonly kid: string;
  readonly publicKey: string; // base64url-encoded Ed25519 public key
}

// ---------------------------------------------------------------------------
// Verification Result
// ---------------------------------------------------------------------------

export interface ReceiptVerificationResult {
  readonly valid: boolean;
  readonly error?: string;
}

// ---------------------------------------------------------------------------
// Verification Options
// ---------------------------------------------------------------------------

export interface ReceiptVerifyOptions {
  /** Set of trusted Counter public keys. */
  readonly trustedKeys: readonly TrustedPublicKey[];
  /** Expected audience URI (optional). */
  readonly expectedAudience?: string;
  /** Current time ISO string (optional, for validity window check). */
  readonly currentTime?: string;
  /** Predecessor envelope for supersession chain validation (optional). */
  readonly predecessorEnvelope?: unknown;
}

// ---------------------------------------------------------------------------
// Core Verification Function
// ---------------------------------------------------------------------------

/**
 * Verifies a signed receipt envelope independently.
 *
 * Checks:
 * 1. Valid CTP envelope structure
 * 2. Ed25519 signature against a known trusted key
 * 3. Audience matches expected (if provided)
 * 4. Canonical commitment digest integrity (payload_digest)
 * 5. Supersession chain (predecessor reference, if applicable)
 * 6. Timestamps are reasonable (if currentTime provided)
 */
export async function verifyReceipt(
  envelope: unknown,
  options: ReceiptVerifyOptions,
): Promise<ReceiptVerificationResult> {
  // 1. Validate envelope structure
  const structureResult = validateEnvelopeStructure(envelope);
  if (!structureResult.valid) {
    return structureResult;
  }

  const env = envelope as Record<string, unknown>;
  const signature = env["signature"] as Record<string, unknown>;
  const kid = signature["kid"] as string;
  const signatureValue = signature["value"] as string;

  // 2. Find trusted key
  const trustedKey = options.trustedKeys.find((k) => k.kid === kid);
  if (trustedKey === undefined) {
    return { valid: false, error: `Key '${kid}' is not in the trusted key set` };
  }

  // 3. Verify Ed25519 signature
  const unsignedForm = buildUnsignedForm(env);
  const canonicalBytes = new TextEncoder().encode(canonicalize(unsignedForm));
  const signatureBytes = base64urlToBytes(signatureValue);
  const publicKeyBytes = base64urlToBytes(trustedKey.publicKey);

  let signatureValid: boolean;
  try {
    signatureValid = await ed.verifyAsync(signatureBytes, canonicalBytes, publicKeyBytes);
  } catch {
    signatureValid = false;
  }

  if (!signatureValid) {
    return { valid: false, error: "Ed25519 signature verification failed" };
  }

  // 4. Verify payload digest integrity
  const payload = env["payload"];
  const declaredDigest = env["payload_digest"] as string;
  const computedDigest = computePayloadDigestLocal(payload);
  if (computedDigest !== declaredDigest) {
    return {
      valid: false,
      error: "Payload digest does not match computed digest (content may be tampered)",
    };
  }

  // 5. Audience check
  if (options.expectedAudience !== undefined) {
    const audience = env["audience"] as string[];
    if (!audience.includes(options.expectedAudience)) {
      return {
        valid: false,
        error: `Expected audience '${options.expectedAudience}' not found in envelope audience`,
      };
    }
  }

  // 6. Timestamp validation
  if (options.currentTime !== undefined) {
    const currentMs = Date.parse(options.currentTime);
    const notBefore = env["not_before"] as string;
    const expiresAt = env["expires_at"] as string;
    const notBeforeMs = Date.parse(notBefore);
    const expiresAtMs = Date.parse(expiresAt);

    if (!Number.isNaN(notBeforeMs) && currentMs < notBeforeMs) {
      return { valid: false, error: "Receipt is not yet valid (before not_before)" };
    }
    if (!Number.isNaN(expiresAtMs) && currentMs > expiresAtMs) {
      return { valid: false, error: "Receipt has expired" };
    }
  }

  // 7. Supersession chain check
  if (options.predecessorEnvelope !== undefined) {
    const chainResult = validateSupersessionChain(env, options.predecessorEnvelope);
    if (!chainResult.valid) {
      return chainResult;
    }
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

function validateEnvelopeStructure(value: unknown): ReceiptVerificationResult {
  if (value === null || typeof value !== "object") {
    return { valid: false, error: "Envelope must be a non-null object" };
  }

  const obj = value as Record<string, unknown>;

  if (obj["ctp_version"] !== "0.1") {
    return { valid: false, error: "Unsupported or missing ctp_version" };
  }

  if (typeof obj["type"] !== "string") {
    return { valid: false, error: "Missing or invalid type field" };
  }

  if (typeof obj["id"] !== "string") {
    return { valid: false, error: "Missing or invalid id field" };
  }

  if (!Array.isArray(obj["audience"])) {
    return { valid: false, error: "Missing or invalid audience field" };
  }

  if (typeof obj["payload_digest"] !== "string") {
    return { valid: false, error: "Missing or invalid payload_digest field" };
  }

  if (obj["payload"] === undefined || obj["payload"] === null) {
    return { valid: false, error: "Missing payload field" };
  }

  const sig = obj["signature"];
  if (sig === null || typeof sig !== "object") {
    return { valid: false, error: "Missing or invalid signature block" };
  }

  const sigObj = sig as Record<string, unknown>;
  if (sigObj["alg"] !== "EdDSA") {
    return { valid: false, error: "Only EdDSA algorithm is supported" };
  }

  if (typeof sigObj["kid"] !== "string" || sigObj["kid"].length === 0) {
    return { valid: false, error: "Missing or invalid signature kid" };
  }

  if (typeof sigObj["value"] !== "string" || sigObj["value"].length === 0) {
    return { valid: false, error: "Missing or invalid signature value" };
  }

  return { valid: true };
}

function buildUnsignedForm(env: Record<string, unknown>): Record<string, unknown> {
  const sig = env["signature"] as Record<string, unknown>;
  // Reconstruct without signature.value (the unsigned form that was signed)
  return {
    ctp_version: env["ctp_version"],
    type: env["type"],
    id: env["id"],
    issuer: env["issuer"],
    subject: env["subject"],
    audience: env["audience"],
    environment: env["environment"],
    issued_at: env["issued_at"],
    not_before: env["not_before"],
    expires_at: env["expires_at"],
    nonce: env["nonce"],
    correlation_id: env["correlation_id"],
    payload_digest: env["payload_digest"],
    payload: env["payload"],
    evidence_refs: env["evidence_refs"],
    signature: {
      alg: sig["alg"],
      kid: sig["kid"],
    },
  };
}

function computePayloadDigestLocal(payload: unknown): string {
  const canonicalPayload = canonicalize(payload);
  const payloadBytes = new TextEncoder().encode(canonicalPayload);
  const hex = createHash("sha256").update(payloadBytes).digest("hex");
  return `sha256:${hex}`;
}

function base64urlToBytes(base64url: string): Uint8Array {
  return Buffer.from(base64url, "base64url");
}

function validateSupersessionChain(
  current: Record<string, unknown>,
  predecessor: unknown,
): ReceiptVerificationResult {
  if (predecessor === null || typeof predecessor !== "object") {
    return { valid: false, error: "Predecessor envelope must be a non-null object" };
  }

  const predEnv = predecessor as Record<string, unknown>;
  const currentPayload = current["payload"] as Record<string, unknown> | undefined;
  const predId = predEnv["id"] as string | undefined;

  if (currentPayload === undefined) {
    return { valid: false, error: "Current envelope missing payload for chain validation" };
  }

  const predecessorRef = currentPayload["predecessor_receipt"] as string | undefined;

  if (predecessorRef === undefined || predecessorRef === null) {
    return {
      valid: false,
      error: "Current receipt does not reference a predecessor but one was provided",
    };
  }

  if (predecessorRef !== predId) {
    return {
      valid: false,
      error: `Predecessor reference '${predecessorRef}' does not match provided predecessor id '${predId}'`,
    };
  }

  // Verify both receipts share the same transaction_id
  const currentTxId = currentPayload["transaction_id"] as string | undefined;
  const predPayload = predEnv["payload"] as Record<string, unknown> | undefined;
  const predTxId = predPayload?.["transaction_id"] as string | undefined;

  if (currentTxId !== predTxId) {
    return {
      valid: false,
      error: "Predecessor and current receipt have different transaction_ids",
    };
  }

  return { valid: true };
}
