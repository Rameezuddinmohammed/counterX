/**
 * CTP envelope construction utilities.
 *
 * Provides helpers to build unsigned envelopes with proper payload digest
 * computation, ready for the signing pipeline.
 */

import { type Result, ok, err, createCanonicalError } from "@counter/domain";
import { computePayloadDigest } from "./canonicalize.js";
import type {
  CtpEnvelope,
  CtpEnvironment,
  CtpObjectType,
  Nonce,
  UnsignedCtpEnvelope,
} from "./types.js";
import {
  CTP_SIGNATURE_ALGORITHM,
  CTP_VERSION,
  isCtpEnvironment,
  isCtpObjectType,
} from "./types.js";

// ---------------------------------------------------------------------------
// Envelope Builder Input
// ---------------------------------------------------------------------------

export interface EnvelopeInput<Payload> {
  readonly type: CtpObjectType;
  readonly id: string;
  readonly issuer: string;
  readonly subject: string;
  readonly audience: readonly string[];
  readonly environment: CtpEnvironment;
  readonly issued_at: string;
  readonly not_before: string;
  readonly expires_at: string;
  readonly nonce: string;
  readonly correlation_id: string;
  readonly payload: Payload;
  readonly evidence_refs?: readonly { type: string; id: string; digest: string }[];
  readonly kid: string;
}

// ---------------------------------------------------------------------------
// Build Unsigned Envelope
// ---------------------------------------------------------------------------

/**
 * Builds an unsigned CTP envelope from the provided input.
 * Automatically computes the payload_digest from the canonical payload.
 * Validates required fields.
 */
export function buildUnsignedEnvelope<Payload>(
  input: EnvelopeInput<Payload>,
): Result<UnsignedCtpEnvelope<Payload>> {
  // Validate type
  if (!isCtpObjectType(input.type)) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "UNSUPPORTED_VALUE",
        message: `Invalid CTP object type '${input.type}'`,
      }),
    );
  }

  // Validate environment
  if (!isCtpEnvironment(input.environment)) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "UNSUPPORTED_VALUE",
        message: `Invalid CTP environment '${input.environment}'`,
      }),
    );
  }

  // Validate non-empty required strings
  if (
    !input.id ||
    !input.issuer ||
    !input.subject ||
    !input.nonce ||
    !input.correlation_id ||
    !input.kid
  ) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "INVALID_FORMAT",
        message:
          "Envelope id, issuer, subject, nonce, correlation_id, and kid must be non-empty strings",
      }),
    );
  }

  // Validate audience is non-empty
  if (!Array.isArray(input.audience) || input.audience.length === 0) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "INVALID_FORMAT",
        message: "Envelope audience must be a non-empty array",
      }),
    );
  }

  // Compute payload digest
  const payloadDigest = computePayloadDigest(input.payload);

  const envelope: UnsignedCtpEnvelope<Payload> = {
    ctp_version: CTP_VERSION,
    type: input.type,
    id: input.id,
    issuer: input.issuer,
    subject: input.subject,
    audience: input.audience,
    environment: input.environment,
    issued_at: input.issued_at,
    not_before: input.not_before,
    expires_at: input.expires_at,
    nonce: input.nonce as Nonce,
    correlation_id: input.correlation_id,
    payload_digest: payloadDigest,
    payload: input.payload,
    evidence_refs: input.evidence_refs ?? [],
    signature: {
      alg: CTP_SIGNATURE_ALGORITHM,
      kid: input.kid,
    },
  };

  return ok(envelope);
}

/**
 * Generates a cryptographically random nonce (base64url, no padding).
 * Uses 16 bytes (128 bits) of randomness per TRUST-PROTOCOL.md section 4.
 */
export function generateNonce(randomBytes: (length: number) => Uint8Array): Nonce {
  const bytes = randomBytes(16);
  return Buffer.from(bytes).toString("base64url") as Nonce;
}

/**
 * Type guard: checks if a value looks like a signed CTP envelope.
 */
export function isCtpEnvelope(value: unknown): value is CtpEnvelope {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return (
    obj["ctp_version"] === CTP_VERSION &&
    isCtpObjectType(obj["type"]) &&
    typeof obj["id"] === "string" &&
    typeof obj["issuer"] === "string" &&
    typeof obj["subject"] === "string" &&
    Array.isArray(obj["audience"]) &&
    isCtpEnvironment(obj["environment"]) &&
    typeof obj["nonce"] === "string" &&
    obj["signature"] !== null &&
    typeof obj["signature"] === "object" &&
    (obj["signature"] as Record<string, unknown>)["alg"] === CTP_SIGNATURE_ALGORITHM &&
    typeof (obj["signature"] as Record<string, unknown>)["value"] === "string"
  );
}
