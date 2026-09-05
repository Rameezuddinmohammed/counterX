import "./crypto-setup.js";
/**
 * CTP envelope verification.
 *
 * Implements the verification checks from TRUST-PROTOCOL.md section 5 rule 2:
 * - Schema/version/type validation
 * - Signature/key status verification
 * - Issuer, subject, audience, environment validation
 * - Validity window (not_before, expires_at)
 * - Payload digest integrity
 * - Nonce validation
 * - Algorithm downgrade rejection ("none" and non-EdDSA)
 * - Critical extension fail-closed behavior (unknown fields)
 */

import * as ed from "@noble/ed25519";
import { type Result, ok, err, createCanonicalError, type CanonicalError } from "@counter/domain";
import { canonicalBytesForVerification, computePayloadDigest } from "./canonicalize.js";
import { base64UrlToBytes } from "./base64url.js";
import type { KeyRecord, KeyRegistry } from "./keys.js";
import { validateKeyForVerification } from "./keys.js";
import type { CtpEnvelope } from "./types.js";
import {
  CTP_SIGNATURE_ALGORITHM,
  CTP_VERSION,
  isCtpEnvironment,
  isCtpObjectType,
} from "./types.js";

// ---------------------------------------------------------------------------
// Verification Options
// ---------------------------------------------------------------------------

export interface VerifyOptions {
  /** Key registry to resolve kid -> public key. */
  readonly keyRegistry: KeyRegistry;
  /** Current time in ISO 8601 UTC (for validity checks). */
  readonly currentTime: string;
  /** Expected audience (at least one must match). */
  readonly expectedAudience?: string;
  /** Expected environment. */
  readonly expectedEnvironment?: string;
  /** Expected issuer. */
  readonly expectedIssuer?: string;
  /** Expected subject. */
  readonly expectedSubject?: string;
  /** Set of known envelope field names. Unknown fields cause fail-closed. */
  readonly knownFields?: ReadonlySet<string>;
  /** Nonce store for replay detection. If provided, nonces are checked/recorded. */
  readonly nonceStore?: NonceStore;
}

// ---------------------------------------------------------------------------
// Nonce Store Port (for replay protection)
// ---------------------------------------------------------------------------

/**
 * Port for nonce-based replay detection.
 * Returns true if the nonce was successfully recorded (not seen before).
 * Returns false if the nonce was already used (replay).
 */
export interface NonceStore {
  /** Check and record a nonce. Returns true if new, false if replay. */
  checkAndRecord(nonce: string, envelopeId: string): Promise<boolean>;
}

/**
 * In-memory nonce store for testing.
 */
export class InMemoryNonceStore implements NonceStore {
  readonly #seen: Set<string> = new Set();

  public async checkAndRecord(nonce: string, _envelopeId: string): Promise<boolean> {
    if (this.#seen.has(nonce)) {
      return false;
    }
    this.#seen.add(nonce);
    return true;
  }

  public clear(): void {
    this.#seen.clear();
  }
}

// ---------------------------------------------------------------------------
// Known envelope fields (for critical extension behavior)
// ---------------------------------------------------------------------------

export const KNOWN_ENVELOPE_FIELDS: ReadonlySet<string> = new Set([
  "ctp_version",
  "type",
  "id",
  "issuer",
  "subject",
  "audience",
  "environment",
  "issued_at",
  "not_before",
  "expires_at",
  "nonce",
  "correlation_id",
  "payload_digest",
  "payload",
  "evidence_refs",
  "signature",
]);

// ---------------------------------------------------------------------------
// Verify Error (enriched canonical error with diagnostic detail)
// ---------------------------------------------------------------------------

/**
 * Error type returned by verifyEnvelope. Carries the stable machine-readable
 * CanonicalError fields PLUS a `detail` string with the specific diagnostic
 * reason — e.g. "Envelope has expired: current time is after expires_at".
 *
 * `createCanonicalError` intentionally discards custom messages to prevent
 * internal diagnostics from leaking through public API boundaries. But
 * verifyEnvelope is a domain-internal function whose callers (mandate binding
 * stores) need the specific reason to surface a useful error to the UI.
 * VerifyError bridges that gap: callers use `detail` for human-readable output
 * and `code`/`category` for machine-readable routing.
 */
export interface VerifyError {
  readonly kind: "canonical_error";
  readonly code: CanonicalError["code"];
  readonly category: CanonicalError["category"];
  /** The specific diagnostic reason for this failure. Use this for user-facing messages. */
  readonly detail: string;
  /** Canonical retry directive. */
  readonly retry: CanonicalError["retry"];
  /** The stable canonical message for this code (generic, code-derived). */
  readonly message: CanonicalError["message"];
}

function verifyErr(canonical: CanonicalError, detail: string): Result<CtpEnvelope, VerifyError> {
  return err({
    kind: "canonical_error",
    code: canonical.code,
    category: canonical.category,
    detail,
    retry: canonical.retry,
    message: canonical.message,
  });
}

/**
 * Verifies a CTP envelope against all normative rules.
 * Returns Result<CtpEnvelope, VerifyError> on success or a descriptive error on failure.
 * The VerifyError carries both the stable canonical code and a human-readable `detail`
 * string — use `detail` for user-facing messages, `code` for machine-readable routing.
 */
export async function verifyEnvelope(
  envelope: CtpEnvelope,
  options: VerifyOptions,
): Promise<Result<CtpEnvelope, VerifyError>> {
  // 1. Critical extension check - unknown fields fail closed
  const knownFields = options.knownFields ?? KNOWN_ENVELOPE_FIELDS;
  const envelopeKeys = Object.keys(envelope);
  for (const key of envelopeKeys) {
    if (!knownFields.has(key)) {
      return verifyErr(
        createCanonicalError("UNSUPPORTED_VALUE"),
        `Unknown critical field '${key}' in envelope; rejecting per fail-closed policy`,
      );
    }
  }

  // 2. Schema/version validation
  if (envelope.ctp_version !== CTP_VERSION) {
    return verifyErr(
      createCanonicalError("UNSUPPORTED_VALUE"),
      `Unsupported CTP version '${envelope.ctp_version}', expected '${CTP_VERSION}'`,
    );
  }

  // 3. Type validation
  if (!isCtpObjectType(envelope.type)) {
    return verifyErr(
      createCanonicalError("UNSUPPORTED_VALUE"),
      `Unknown CTP object type '${envelope.type}'`,
    );
  }

  // 4. Algorithm validation - reject "none" and non-EdDSA
  if (envelope.signature.alg !== CTP_SIGNATURE_ALGORITHM) {
    return verifyErr(
      createCanonicalError("UNAUTHENTICATED"),
      `Algorithm '${envelope.signature.alg}' is not supported; only '${CTP_SIGNATURE_ALGORITHM}' is allowed`,
    );
  }

  // 5. Environment validation
  if (!isCtpEnvironment(envelope.environment)) {
    return verifyErr(
      createCanonicalError("UNSUPPORTED_VALUE"),
      `Invalid CTP environment '${envelope.environment}'`,
    );
  }

  if (
    options.expectedEnvironment !== undefined &&
    envelope.environment !== options.expectedEnvironment
  ) {
    return verifyErr(
      createCanonicalError("ENVIRONMENT_MISMATCH"),
      `Envelope environment '${envelope.environment}' does not match expected '${options.expectedEnvironment}'`,
    );
  }

  // 6. Issuer validation
  if (options.expectedIssuer !== undefined && envelope.issuer !== options.expectedIssuer) {
    return verifyErr(
      createCanonicalError("UNAUTHENTICATED"),
      `Envelope issuer '${envelope.issuer}' does not match expected issuer`,
    );
  }

  // 7. Subject validation
  if (options.expectedSubject !== undefined && envelope.subject !== options.expectedSubject) {
    return verifyErr(
      createCanonicalError("UNSUPPORTED_VALUE"),
      `Envelope subject does not match expected subject`,
    );
  }

  // 8. Audience validation
  if (options.expectedAudience !== undefined) {
    if (!envelope.audience.includes(options.expectedAudience)) {
      return verifyErr(
        createCanonicalError("UNAUTHORIZED"),
        `Verifier is not in the envelope audience`,
      );
    }
  }

  // 9. Validity window checks
  const currentMs = Date.parse(options.currentTime);
  const notBeforeMs = Date.parse(envelope.not_before);
  const expiresAtMs = Date.parse(envelope.expires_at);

  if (Number.isNaN(currentMs) || Number.isNaN(notBeforeMs) || Number.isNaN(expiresAtMs)) {
    return verifyErr(
      createCanonicalError("INVALID_FORMAT"),
      "Envelope time fields must be valid RFC 3339 timestamps",
    );
  }

  if (currentMs < notBeforeMs) {
    return verifyErr(
      createCanonicalError("INVALID_FORMAT"),
      "Envelope is not yet valid: current time is before not_before",
    );
  }

  if (currentMs > expiresAtMs) {
    return verifyErr(
      createCanonicalError("INVALID_FORMAT"),
      "Envelope has expired: current time is after expires_at",
    );
  }

  // 10. Nonce validation and replay protection
  if (typeof envelope.nonce !== "string" || envelope.nonce.length === 0) {
    return verifyErr(
      createCanonicalError("INVALID_FORMAT"),
      "Envelope nonce must be a non-empty string",
    );
  }

  if (options.nonceStore !== undefined) {
    const isNew = await options.nonceStore.checkAndRecord(envelope.nonce, envelope.id);
    if (!isNew) {
      return verifyErr(
        createCanonicalError("CONFLICT"),
        "Nonce has already been used (replay detected)",
      );
    }
  }

  // 11. Payload digest validation
  const computedDigest = computePayloadDigest(envelope.payload);
  if (computedDigest !== envelope.payload_digest) {
    return verifyErr(
      createCanonicalError("INVALID_FORMAT"),
      "Payload digest does not match computed digest (payload may have been altered)",
    );
  }

  // 12. Key resolution and validation
  const keyRecord = await options.keyRegistry.resolve(envelope.signature.kid);
  if (keyRecord === undefined) {
    return verifyErr(
      createCanonicalError("UNAUTHENTICATED"),
      `Key '${envelope.signature.kid}' not found in registry`,
    );
  }

  const keyValidation = validateKeyForVerification(keyRecord, options.currentTime);
  if (!keyValidation.ok) {
    return verifyErr(keyValidation.error, keyValidation.error.message);
  }

  // 13. Ed25519 signature verification
  const canonicalBytes = canonicalBytesForVerification(envelope);
  const signatureBytes = base64UrlToBytes(envelope.signature.value);
  const publicKeyBytes = base64UrlToBytes(keyRecord.publicKey);

  const valid = await verifyEd25519Signature(signatureBytes, canonicalBytes, publicKeyBytes);
  if (!valid) {
    return verifyErr(
      createCanonicalError("UNAUTHENTICATED"),
      "Ed25519 signature verification failed",
    );
  }

  return ok(envelope);
}

/**
 * Verifies an Ed25519 signature.
 * Wraps @noble/ed25519 verify for consistent error handling.
 */
async function verifyEd25519Signature(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array,
): Promise<boolean> {
  try {
    return await ed.verifyAsync(signature, message, publicKey);
  } catch {
    return false;
  }
}

/**
 * Validates only the structural schema of an envelope without cryptographic checks.
 * Useful for quick pre-validation before expensive crypto operations.
 */
export function validateEnvelopeSchema(value: unknown): Result<KeyRecord> {
  if (value === null || typeof value !== "object") {
    return err(
      createCanonicalError({
        category: "validation",
        code: "INVALID_TYPE",
        message: "Envelope must be a non-null object",
      }),
    );
  }

  const envelope = value as Record<string, unknown>;

  if (envelope["ctp_version"] !== CTP_VERSION) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "UNSUPPORTED_VALUE",
        message: `Unsupported CTP version`,
      }),
    );
  }

  if (!isCtpObjectType(envelope["type"])) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "UNSUPPORTED_VALUE",
        message: `Unknown CTP object type`,
      }),
    );
  }

  // Basic signature block validation
  const sig = envelope["signature"];
  if (sig === null || typeof sig !== "object") {
    return err(
      createCanonicalError({
        category: "validation",
        code: "INVALID_TYPE",
        message: "Signature block must be a non-null object",
      }),
    );
  }

  const sigObj = sig as Record<string, unknown>;
  if (sigObj["alg"] !== CTP_SIGNATURE_ALGORITHM) {
    return err(
      createCanonicalError({
        category: "authentication",
        code: "UNAUTHENTICATED",
        message: `Only EdDSA algorithm is supported`,
      }),
    );
  }

  // Return a dummy OK - this function is for schema validation only
  return ok(undefined as unknown as KeyRecord);
}
