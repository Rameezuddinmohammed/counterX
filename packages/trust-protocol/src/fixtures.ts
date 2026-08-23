import "./crypto-setup.js";
/**
 * Deterministic test fixtures for CTP signing/verification.
 *
 * TEST-ONLY MODULE. Contains fixed Ed25519 keypairs for reproducible test
 * vectors. These keys are publicly known test keys and MUST NOT be used in
 * any environment other than automated tests.
 *
 * ADR-0003 allows deterministic test generators.
 * ADR-0006 prohibits private keys in production envelopes/logs/fixtures,
 * but test fixtures with known test keys are specifically allowed for
 * invariant verification.
 */

import * as ed from "@noble/ed25519";
import type { KeyRecord } from "./keys.js";
import type { CtpEnvironment, Nonce, UnsignedCtpEnvelope } from "./types.js";
import { CTP_SIGNATURE_ALGORITHM, CTP_VERSION } from "./types.js";
import { computePayloadDigest } from "./canonicalize.js";
import { InMemorySigner } from "./sign.js";

// ---------------------------------------------------------------------------
// Fixed Test Keys (deterministic, publicly known - NEVER use in production)
// ---------------------------------------------------------------------------

/**
 * Fixed 32-byte seed for test key A.
 * This is a well-known test value, not a secret.
 */
const TEST_KEY_A_SEED = new Uint8Array([
  0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10,
  0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18,
  0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f, 0x20,
]);

/**
 * Fixed 32-byte seed for test key B (different from A).
 */
const TEST_KEY_B_SEED = new Uint8Array([
  0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28,
  0x29, 0x2a, 0x2b, 0x2c, 0x2d, 0x2e, 0x2f, 0x30,
  0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38,
  0x39, 0x3a, 0x3b, 0x3c, 0x3d, 0x3e, 0x3f, 0x40,
]);

// Derive public keys from seeds
const TEST_KEY_A_PUBLIC = ed.getPublicKey(TEST_KEY_A_SEED);
const TEST_KEY_B_PUBLIC = ed.getPublicKey(TEST_KEY_B_SEED);

// ---------------------------------------------------------------------------
// Test Key Records
// ---------------------------------------------------------------------------

export const TEST_KID_A = "test-key-a-001";
export const TEST_KID_B = "test-key-b-001";

export const TEST_KEY_RECORD_A: KeyRecord = Object.freeze({
  kid: TEST_KID_A,
  use: "sign" as const,
  alg: "EdDSA" as const,
  publicKey: Buffer.from(TEST_KEY_A_PUBLIC).toString("base64url"),
  status: "active" as const,
  validFrom: "2024-01-01T00:00:00.000Z",
  validUntil: "2030-12-31T23:59:59.999Z",
  issuer: "counter://test/issuer-a",
});

export const TEST_KEY_RECORD_B: KeyRecord = Object.freeze({
  kid: TEST_KID_B,
  use: "sign" as const,
  alg: "EdDSA" as const,
  publicKey: Buffer.from(TEST_KEY_B_PUBLIC).toString("base64url"),
  status: "active" as const,
  validFrom: "2024-01-01T00:00:00.000Z",
  validUntil: "2030-12-31T23:59:59.999Z",
  issuer: "counter://test/issuer-b",
});

// ---------------------------------------------------------------------------
// Test Signers
// ---------------------------------------------------------------------------

/**
 * Creates a test signer for key A. TEST-ONLY.
 */
export function createTestSignerA(): InMemorySigner {
  return new InMemorySigner(TEST_KID_A, TEST_KEY_A_SEED);
}

/**
 * Creates a test signer for key B. TEST-ONLY.
 */
export function createTestSignerB(): InMemorySigner {
  return new InMemorySigner(TEST_KID_B, TEST_KEY_B_SEED);
}

// ---------------------------------------------------------------------------
// Fixture Envelope Builder
// ---------------------------------------------------------------------------

export interface FixtureEnvelopeOptions {
  readonly type?: string;
  readonly id?: string;
  readonly issuer?: string;
  readonly subject?: string;
  readonly audience?: readonly string[];
  readonly environment?: CtpEnvironment;
  readonly issuedAt?: string;
  readonly notBefore?: string;
  readonly expiresAt?: string;
  readonly nonce?: string;
  readonly correlationId?: string;
  readonly payload?: Record<string, unknown>;
  readonly evidenceRefs?: readonly { type: string; id: string; digest: string }[];
  readonly kid?: string;
}

/**
 * Creates a deterministic unsigned test envelope with sensible defaults.
 * All values are predictable for snapshot/fixture testing.
 */
export function createTestUnsignedEnvelope(
  options: FixtureEnvelopeOptions = {},
): UnsignedCtpEnvelope {
  const payload = options.payload ?? { test: true, fixture: "deterministic" };
  const payloadDigest = computePayloadDigest(payload);

  return {
    ctp_version: CTP_VERSION,
    type: (options.type ?? "counter.evidence.v1") as UnsignedCtpEnvelope["type"],
    id: options.id ?? "ctr_evidence_test-fixture-id-00001",
    issuer: options.issuer ?? "counter://test/issuer-a",
    subject: options.subject ?? "counter://test/subject-001",
    audience: options.audience ?? ["counter://test/audience-001"],
    environment: options.environment ?? "sandbox",
    issued_at: options.issuedAt ?? "2025-01-15T10:00:00.000Z",
    not_before: options.notBefore ?? "2025-01-15T10:00:00.000Z",
    expires_at: options.expiresAt ?? "2025-01-15T11:00:00.000Z",
    nonce: (options.nonce ?? "dGVzdC1ub25jZS0wMDE") as Nonce,
    correlation_id: options.correlationId ?? "ctr_correlation_test-correlation-001",
    payload_digest: payloadDigest,
    payload,
    evidence_refs: options.evidenceRefs ?? [],
    signature: {
      alg: CTP_SIGNATURE_ALGORITHM,
      kid: options.kid ?? TEST_KID_A,
    },
  };
}

/**
 * Returns the raw test private key bytes for key A.
 * TEST-ONLY: used in test suites that need direct access to verify
 * signing determinism across independent implementations.
 */
export function getTestPrivateKeyA(): Uint8Array {
  return TEST_KEY_A_SEED.slice();
}

/**
 * Returns the raw test private key bytes for key B.
 * TEST-ONLY.
 */
export function getTestPrivateKeyB(): Uint8Array {
  return TEST_KEY_B_SEED.slice();
}

/**
 * Returns the raw test public key bytes for key A.
 */
export function getTestPublicKeyA(): Uint8Array {
  return TEST_KEY_A_PUBLIC.slice();
}

/**
 * Returns the raw test public key bytes for key B.
 */
export function getTestPublicKeyB(): Uint8Array {
  return TEST_KEY_B_PUBLIC.slice();
}
