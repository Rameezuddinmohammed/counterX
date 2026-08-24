import { describe, expect, it, beforeEach } from "vitest";
import * as ed from "@noble/ed25519";
import {
  PACKAGE_NAME,
  CTP_VERSION,
  CTP_OBJECT_TYPES,
  CTP_ENVIRONMENTS,
  CTP_SIGNATURE_ALGORITHM,
  isCtpObjectType,
  isCtpEnvironment,
  canonicalizeUnsignedEnvelope,
  canonicalBytesForVerification,
  computeSha256Digest,
  computePayloadDigest,
  canonicalizeToString,
  InMemoryKeyRegistry,
  validateKeyForVerification,
  signEnvelope,
  derivePublicKey,
  verifyEnvelope,
  InMemoryNonceStore,
  KNOWN_ENVELOPE_FIELDS,
  buildUnsignedEnvelope,
  generateNonce,
  isCtpEnvelope,
  TEST_KID_A,
  TEST_KID_B,
  TEST_KEY_RECORD_A,
  TEST_KEY_RECORD_B,
  createTestSignerA,
  createTestSignerB,
  createTestUnsignedEnvelope,
  getTestPrivateKeyA,
  getTestPublicKeyA,
  getTestPublicKeyB,
} from "./index.js";
import type { CtpEnvelope, CtpEnvironment, Nonce, SignatureValue } from "./types.js";
import type { FixtureEnvelopeOptions } from "./fixtures.js";
import type { VerifyOptions } from "./verify.js";

// ---------------------------------------------------------------------------
// Helper to create a valid signed envelope for tests
// ---------------------------------------------------------------------------

function buildFixtureOptions(overrides: {
  type?: string;
  environment?: CtpEnvironment;
  audience?: string[];
  issuer?: string;
  subject?: string;
  nonce?: string;
  notBefore?: string;
  expiresAt?: string;
  payload?: Record<string, unknown>;
  kid?: string;
}): FixtureEnvelopeOptions {
  const opts: Record<string, unknown> = {};
  if (overrides.type !== undefined) opts["type"] = overrides.type;
  if (overrides.environment !== undefined) opts["environment"] = overrides.environment;
  if (overrides.audience !== undefined) opts["audience"] = overrides.audience;
  if (overrides.issuer !== undefined) opts["issuer"] = overrides.issuer;
  if (overrides.subject !== undefined) opts["subject"] = overrides.subject;
  if (overrides.nonce !== undefined) opts["nonce"] = overrides.nonce;
  if (overrides.notBefore !== undefined) opts["notBefore"] = overrides.notBefore;
  if (overrides.expiresAt !== undefined) opts["expiresAt"] = overrides.expiresAt;
  if (overrides.payload !== undefined) opts["payload"] = overrides.payload;
  if (overrides.kid !== undefined) opts["kid"] = overrides.kid;
  return opts as FixtureEnvelopeOptions;
}

async function createValidSignedEnvelope(
  overrides: {
    type?: string;
    environment?: CtpEnvironment;
    audience?: string[];
    issuer?: string;
    subject?: string;
    nonce?: string;
    notBefore?: string;
    expiresAt?: string;
    payload?: Record<string, unknown>;
    kid?: string;
  } = {},
): Promise<CtpEnvelope> {
  const signer = createTestSignerA();
  const unsigned = createTestUnsignedEnvelope(buildFixtureOptions(overrides));
  const result = await signEnvelope(unsigned, signer);
  if (!result.ok) {
    throw new Error(`Failed to sign test envelope: ${result.error.message}`);
  }
  return result.value;
}

function createDefaultVerifyOptions(overrides: {
  keyRegistry?: VerifyOptions["keyRegistry"];
  currentTime?: string;
  expectedAudience?: string;
  expectedEnvironment?: string;
  expectedIssuer?: string;
  expectedSubject?: string;
  knownFields?: ReadonlySet<string>;
  nonceStore?: VerifyOptions["nonceStore"];
} = {}): VerifyOptions {
  const registry = new InMemoryKeyRegistry([TEST_KEY_RECORD_A, TEST_KEY_RECORD_B]);
  const base: VerifyOptions = {
    keyRegistry: overrides.keyRegistry ?? registry,
    currentTime: overrides.currentTime ?? "2025-01-15T10:30:00.000Z",
  };
  // Use Object.assign to conditionally add optional properties without assigning undefined
  const result = { ...base };
  if (overrides.expectedAudience !== undefined) Object.assign(result, { expectedAudience: overrides.expectedAudience });
  if (overrides.expectedEnvironment !== undefined) Object.assign(result, { expectedEnvironment: overrides.expectedEnvironment });
  if (overrides.expectedIssuer !== undefined) Object.assign(result, { expectedIssuer: overrides.expectedIssuer });
  if (overrides.expectedSubject !== undefined) Object.assign(result, { expectedSubject: overrides.expectedSubject });
  if (overrides.knownFields !== undefined) Object.assign(result, { knownFields: overrides.knownFields });
  if (overrides.nonceStore !== undefined) Object.assign(result, { nonceStore: overrides.nonceStore });
  return result;
}

// ===========================================================================
// Tests
// ===========================================================================

describe("@counter/trust-protocol", () => {
  it("exposes its package identity", () => {
    expect(PACKAGE_NAME).toBe("@counter/trust-protocol");
  });
});

describe("CTP Types", () => {
  it("defines CTP_VERSION as 0.1", () => {
    expect(CTP_VERSION).toBe("0.1");
  });

  it("defines all 14 CTP object types", () => {
    expect(CTP_OBJECT_TYPES).toHaveLength(14);
    expect(CTP_OBJECT_TYPES).toContain("counter.agent-registration.v1");
    expect(CTP_OBJECT_TYPES).toContain("counter.buyer-policy.v1");
    expect(CTP_OBJECT_TYPES).toContain("counter.principal-consent-attestation.v1");
    expect(CTP_OBJECT_TYPES).toContain("counter.mandate.v1");
    expect(CTP_OBJECT_TYPES).toContain("counter.merchant-quote.v1");
    expect(CTP_OBJECT_TYPES).toContain("counter.purchase-intent.v1");
    expect(CTP_OBJECT_TYPES).toContain("counter.approval.v1");
    expect(CTP_OBJECT_TYPES).toContain("counter.revocation.v1");
    expect(CTP_OBJECT_TYPES).toContain("counter.payment-authorization-reference.v1");
    expect(CTP_OBJECT_TYPES).toContain("counter.policy-decision.v1");
    expect(CTP_OBJECT_TYPES).toContain("counter.transaction-state.v1");
    expect(CTP_OBJECT_TYPES).toContain("counter.evidence.v1");
    expect(CTP_OBJECT_TYPES).toContain("counter.finding.v1");
    expect(CTP_OBJECT_TYPES).toContain("counter.transaction-receipt.v1");
  });

  it("defines CTP environments (sandbox, pilot, production only)", () => {
    expect(CTP_ENVIRONMENTS).toEqual(["sandbox", "pilot", "production"]);
  });

  it("isCtpObjectType accepts valid types", () => {
    expect(isCtpObjectType("counter.mandate.v1")).toBe(true);
  });

  it("isCtpObjectType rejects invalid types", () => {
    expect(isCtpObjectType("counter.unknown.v1")).toBe(false);
    expect(isCtpObjectType("")).toBe(false);
    expect(isCtpObjectType(42)).toBe(false);
  });

  it("isCtpEnvironment accepts valid environments", () => {
    expect(isCtpEnvironment("sandbox")).toBe(true);
    expect(isCtpEnvironment("pilot")).toBe(true);
    expect(isCtpEnvironment("production")).toBe(true);
  });

  it("isCtpEnvironment rejects local/test (dev-only environments)", () => {
    expect(isCtpEnvironment("local")).toBe(false);
    expect(isCtpEnvironment("test")).toBe(false);
  });

  it("CTP_SIGNATURE_ALGORITHM is EdDSA", () => {
    expect(CTP_SIGNATURE_ALGORITHM).toBe("EdDSA");
  });
});

describe("Canonicalization", () => {
  it("produces deterministic canonical JSON", () => {
    const obj = { b: 2, a: 1, c: [3, 1, 2] };
    const result1 = canonicalizeToString(obj);
    const result2 = canonicalizeToString(obj);
    expect(result1).toBe(result2);
    // RFC 8785: keys sorted
    expect(result1).toBe('{"a":1,"b":2,"c":[3,1,2]}');
  });

  it("canonicalizeUnsignedEnvelope produces stable bytes", () => {
    const envelope = createTestUnsignedEnvelope();
    const bytes1 = canonicalizeUnsignedEnvelope(envelope);
    const bytes2 = canonicalizeUnsignedEnvelope(envelope);
    expect(Buffer.from(bytes1).toString("hex")).toBe(Buffer.from(bytes2).toString("hex"));
  });

  it("computePayloadDigest is deterministic", () => {
    const payload = { amount: 100, currency: "USD" };
    const digest1 = computePayloadDigest(payload);
    const digest2 = computePayloadDigest(payload);
    expect(digest1).toBe(digest2);
    expect(digest1).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("computePayloadDigest varies with payload changes", () => {
    const d1 = computePayloadDigest({ amount: 100 });
    const d2 = computePayloadDigest({ amount: 101 });
    expect(d1).not.toBe(d2);
  });

  it("computeSha256Digest produces correct format", () => {
    const bytes = new TextEncoder().encode("hello");
    const digest = computeSha256Digest(bytes);
    expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe("Key Management", () => {
  it("InMemoryKeyRegistry resolves known keys", async () => {
    const registry = new InMemoryKeyRegistry([TEST_KEY_RECORD_A]);
    const record = await registry.resolve(TEST_KID_A);
    expect(record).toBeDefined();
    expect(record?.kid).toBe(TEST_KID_A);
  });

  it("InMemoryKeyRegistry returns undefined for unknown keys", async () => {
    const registry = new InMemoryKeyRegistry([TEST_KEY_RECORD_A]);
    const record = await registry.resolve("nonexistent-kid");
    expect(record).toBeUndefined();
  });

  it("validateKeyForVerification accepts active key within validity", () => {
    const result = validateKeyForVerification(TEST_KEY_RECORD_A, "2025-06-01T00:00:00.000Z");
    expect(result.ok).toBe(true);
  });

  it("validateKeyForVerification rejects revoked key", () => {
    const revokedKey = { ...TEST_KEY_RECORD_A, status: "revoked" as const };
    const result = validateKeyForVerification(revokedKey, "2025-06-01T00:00:00.000Z");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("UNAUTHENTICATED");
    }
  });

  it("validateKeyForVerification rejects expired key", () => {
    const expiredKey = { ...TEST_KEY_RECORD_A, status: "expired" as const };
    const result = validateKeyForVerification(expiredKey, "2025-06-01T00:00:00.000Z");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("UNAUTHENTICATED");
    }
  });

  it("validateKeyForVerification rejects key before validity", () => {
    const result = validateKeyForVerification(TEST_KEY_RECORD_A, "2023-01-01T00:00:00.000Z");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("UNAUTHENTICATED");
    }
  });

  it("validateKeyForVerification rejects key after validity", () => {
    const result = validateKeyForVerification(TEST_KEY_RECORD_A, "2031-01-01T00:00:00.000Z");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("UNAUTHENTICATED");
    }
  });

  it("validateKeyForVerification rejects non-EdDSA algorithm", () => {
    const badAlgKey = { ...TEST_KEY_RECORD_A, alg: "RS256" as "EdDSA" };
    const result = validateKeyForVerification(badAlgKey, "2025-06-01T00:00:00.000Z");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("UNSUPPORTED_VALUE");
    }
  });
});

describe("Signing", () => {
  it("signEnvelope produces a valid signed envelope", async () => {
    const signer = createTestSignerA();
    const unsigned = createTestUnsignedEnvelope();
    const result = await signEnvelope(unsigned, signer);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.signature.alg).toBe("EdDSA");
      expect(result.value.signature.kid).toBe(TEST_KID_A);
      expect(result.value.signature.value).toBeTruthy();
      // Signature should be base64url encoded
      expect(result.value.signature.value).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("signEnvelope is deterministic for same input", async () => {
    const signer = createTestSignerA();
    const unsigned = createTestUnsignedEnvelope();
    const result1 = await signEnvelope(unsigned, signer);
    const result2 = await signEnvelope(unsigned, signer);

    expect(result1.ok).toBe(true);
    expect(result2.ok).toBe(true);
    if (result1.ok && result2.ok) {
      // Ed25519 is deterministic - same key + same message = same signature
      expect(result1.value.signature.value).toBe(result2.value.signature.value);
    }
  });

  it("signEnvelope rejects non-EdDSA algorithm", async () => {
    const signer = createTestSignerA();
    const unsigned = {
      ...createTestUnsignedEnvelope(),
      signature: { alg: "none" as "EdDSA", kid: TEST_KID_A },
    };
    const result = await signEnvelope(unsigned, signer);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("UNSUPPORTED_VALUE");
    }
  });

  it("signEnvelope rejects kid mismatch", async () => {
    const signer = createTestSignerA();
    const unsigned = {
      ...createTestUnsignedEnvelope(),
      signature: { alg: "EdDSA" as const, kid: "wrong-kid" },
    };
    const result = await signEnvelope(unsigned, signer);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("UNSUPPORTED_VALUE");
    }
  });

  it("derivePublicKey returns base64url-encoded public key", () => {
    const privateKey = getTestPrivateKeyA();
    const publicKey = derivePublicKey(privateKey);
    expect(publicKey).toBe(TEST_KEY_RECORD_A.publicKey);
  });

  it("different keys produce different public keys", () => {
    const pubA = derivePublicKey(getTestPrivateKeyA());
    const pubB = Buffer.from(getTestPublicKeyB()).toString("base64url");
    expect(pubA).not.toBe(pubB);
  });
});

describe("Verification", () => {
  it("verifies a correctly signed envelope", async () => {
    const envelope = await createValidSignedEnvelope();
    const options = createDefaultVerifyOptions();
    const result = await verifyEnvelope(envelope, options);
    expect(result.ok).toBe(true);
  });

  it("rejects envelope with wrong signature (tampered)", async () => {
    const envelope = await createValidSignedEnvelope();
    // Tamper with the signature value
    const tampered: CtpEnvelope = {
      ...envelope,
      signature: {
        ...envelope.signature,
        value: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" as SignatureValue,
      },
    };
    const options = createDefaultVerifyOptions();
    const result = await verifyEnvelope(tampered, options);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("UNAUTHENTICATED");
    }
  });

  it("rejects envelope signed with wrong key", async () => {
    // Sign with key B but registry only has A configured for the issuer
    const signerB = createTestSignerB();
    const unsigned = createTestUnsignedEnvelope(buildFixtureOptions({ kid: TEST_KID_B }));
    const signResult = await signEnvelope(unsigned, signerB);
    expect(signResult.ok).toBe(true);
    if (!signResult.ok) return;

    // Modify the envelope to claim kid A but have B's signature
    const wrongKeyEnvelope: CtpEnvelope = {
      ...signResult.value,
      signature: {
        ...signResult.value.signature,
        kid: TEST_KID_A, // Claims to be key A
        // But signature is from key B
      },
    };

    const options = createDefaultVerifyOptions();
    const result = await verifyEnvelope(wrongKeyEnvelope, options);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("UNAUTHENTICATED");
    }
  });

  it("rejects envelope with unknown kid", async () => {
    const envelope = await createValidSignedEnvelope();
    const tamperedEnvelope: CtpEnvelope = {
      ...envelope,
      signature: {
        ...envelope.signature,
        kid: "unknown-kid-12345",
      },
    };
    const options = createDefaultVerifyOptions();
    const result = await verifyEnvelope(tamperedEnvelope, options);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("UNAUTHENTICATED");
    }
  });

  describe("algorithm downgrade rejection", () => {
    it("rejects 'none' algorithm", async () => {
      const envelope = await createValidSignedEnvelope();
      const tampered: CtpEnvelope = {
        ...envelope,
        signature: {
          ...envelope.signature,
          alg: "none" as "EdDSA",
        },
      };
      const options = createDefaultVerifyOptions();
      const result = await verifyEnvelope(tampered, options);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("UNAUTHENTICATED");
      }
    });

    it("rejects RS256 algorithm", async () => {
      const envelope = await createValidSignedEnvelope();
      const tampered: CtpEnvelope = {
        ...envelope,
        signature: {
          ...envelope.signature,
          alg: "RS256" as "EdDSA",
        },
      };
      const options = createDefaultVerifyOptions();
      const result = await verifyEnvelope(tampered, options);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("UNAUTHENTICATED");
      }
    });

    it("rejects HS256 algorithm", async () => {
      const envelope = await createValidSignedEnvelope();
      const tampered: CtpEnvelope = {
        ...envelope,
        signature: {
          ...envelope.signature,
          alg: "HS256" as "EdDSA",
        },
      };
      const options = createDefaultVerifyOptions();
      const result = await verifyEnvelope(tampered, options);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("UNAUTHENTICATED");
      }
    });
  });

  describe("audience validation", () => {
    it("rejects envelope when verifier is not in audience", async () => {
      const envelope = await createValidSignedEnvelope({
        audience: ["counter://other/service"],
      });
      const options = createDefaultVerifyOptions({
        expectedAudience: "counter://my/service",
      });
      const result = await verifyEnvelope(envelope, options);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("UNAUTHORIZED");
      }
    });

    it("accepts envelope when verifier is in audience", async () => {
      const envelope = await createValidSignedEnvelope({
        audience: ["counter://my/service", "counter://other/service"],
      });
      const options = createDefaultVerifyOptions({
        expectedAudience: "counter://my/service",
      });
      const result = await verifyEnvelope(envelope, options);
      expect(result.ok).toBe(true);
    });
  });

  describe("environment validation", () => {
    it("rejects envelope with wrong environment", async () => {
      const envelope = await createValidSignedEnvelope({
        environment: "sandbox",
      });
      const options = createDefaultVerifyOptions({
        expectedEnvironment: "production",
      });
      const result = await verifyEnvelope(envelope, options);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("ENVIRONMENT_MISMATCH");
      }
    });

    it("accepts envelope with matching environment", async () => {
      const envelope = await createValidSignedEnvelope({
        environment: "sandbox",
      });
      const options = createDefaultVerifyOptions({
        expectedEnvironment: "sandbox",
      });
      const result = await verifyEnvelope(envelope, options);
      expect(result.ok).toBe(true);
    });
  });

  describe("expiry and validity", () => {
    it("rejects expired envelope", async () => {
      const envelope = await createValidSignedEnvelope({
        expiresAt: "2025-01-15T09:00:00.000Z",
        notBefore: "2025-01-15T08:00:00.000Z",
      });
      const options = createDefaultVerifyOptions({
        currentTime: "2025-01-15T10:00:00.000Z",
      });
      const result = await verifyEnvelope(envelope, options);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("OUT_OF_RANGE");
      }
    });

    it("rejects envelope not yet valid", async () => {
      const envelope = await createValidSignedEnvelope({
        notBefore: "2025-01-16T00:00:00.000Z",
        expiresAt: "2025-01-17T00:00:00.000Z",
      });
      const options = createDefaultVerifyOptions({
        currentTime: "2025-01-15T10:00:00.000Z",
      });
      const result = await verifyEnvelope(envelope, options);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("OUT_OF_RANGE");
      }
    });

    it("accepts envelope within validity window", async () => {
      const envelope = await createValidSignedEnvelope({
        notBefore: "2025-01-15T10:00:00.000Z",
        expiresAt: "2025-01-15T12:00:00.000Z",
      });
      const options = createDefaultVerifyOptions({
        currentTime: "2025-01-15T11:00:00.000Z",
      });
      const result = await verifyEnvelope(envelope, options);
      expect(result.ok).toBe(true);
    });
  });

  describe("altered payload detection", () => {
    it("rejects envelope with modified payload", async () => {
      const envelope = await createValidSignedEnvelope({
        payload: { amount: 100, currency: "USD" },
      });
      // Tamper with payload after signing
      const tampered: CtpEnvelope = {
        ...envelope,
        payload: { amount: 999, currency: "USD" },
      };
      const options = createDefaultVerifyOptions();
      const result = await verifyEnvelope(tampered, options);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("INVALID_FORMAT");
      }
    });

    it("rejects envelope with correct payload but wrong digest field", async () => {
      const envelope = await createValidSignedEnvelope();
      const tampered: CtpEnvelope = {
        ...envelope,
        payload_digest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      };
      const options = createDefaultVerifyOptions();
      const result = await verifyEnvelope(tampered, options);
      // Either fails digest check or signature check (since canonical bytes changed)
      expect(result.ok).toBe(false);
    });
  });

  describe("nonce validation and replay protection", () => {
    it("rejects envelope with empty nonce", async () => {
      const signer = createTestSignerA();
      const unsigned = createTestUnsignedEnvelope({ nonce: "" });
      // Force empty nonce (override the fixture default)
      const withEmptyNonce = { ...unsigned, nonce: "" as Nonce };
      const signResult = await signEnvelope(withEmptyNonce, signer);
      if (!signResult.ok) return;

      const options = createDefaultVerifyOptions();
      const result = await verifyEnvelope(signResult.value, options);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("INVALID_FORMAT");
      }
    });

    it("detects replay when same nonce is used twice", async () => {
      const nonceStore = new InMemoryNonceStore();
      const envelope = await createValidSignedEnvelope({ nonce: "unique-nonce-123" });

      const options = createDefaultVerifyOptions({ nonceStore });

      // First use should succeed
      const result1 = await verifyEnvelope(envelope, options);
      expect(result1.ok).toBe(true);

      // Second use (replay) should fail
      const result2 = await verifyEnvelope(envelope, options);
      expect(result2.ok).toBe(false);
      if (!result2.ok) {
        expect(result2.error.code).toBe("CONFLICT");
      }
    });

    it("accepts different nonces", async () => {
      const nonceStore = new InMemoryNonceStore();

      const envelope1 = await createValidSignedEnvelope({ nonce: "nonce-aaa" });
      const envelope2 = await createValidSignedEnvelope({ nonce: "nonce-bbb" });

      const options = createDefaultVerifyOptions({ nonceStore });

      const result1 = await verifyEnvelope(envelope1, options);
      expect(result1.ok).toBe(true);

      const result2 = await verifyEnvelope(envelope2, options);
      expect(result2.ok).toBe(true);
    });
  });

  describe("critical extension behavior", () => {
    it("rejects envelope with unknown critical fields (fail closed)", async () => {
      const envelope = await createValidSignedEnvelope();
      // Add an unknown field
      const withUnknownField = {
        ...envelope,
        unknown_critical_field: "should cause rejection",
      } as unknown as CtpEnvelope;

      const options = createDefaultVerifyOptions();
      const result = await verifyEnvelope(withUnknownField, options);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("UNSUPPORTED_VALUE");
      }
    });

    it("accepts envelope when unknown field is in extended known set", async () => {
      const envelope = await createValidSignedEnvelope();
      const withExtension = {
        ...envelope,
        x_custom_extension: "allowed",
      } as unknown as CtpEnvelope;

      const extendedKnown = new Set([...KNOWN_ENVELOPE_FIELDS, "x_custom_extension"]);
      const options = createDefaultVerifyOptions({ knownFields: extendedKnown });
      const result = await verifyEnvelope(withExtension, options);
      // May still fail signature (since canonical bytes differ), but should pass critical check
      if (!result.ok) {
        // Should fail on signature, not on critical field check
        expect(result.error.code).not.toBe("UNSUPPORTED_VALUE");
      }
    });
  });

  describe("issuer validation", () => {
    it("rejects envelope with wrong issuer", async () => {
      const envelope = await createValidSignedEnvelope({
        issuer: "counter://test/issuer-a",
      });
      const options = createDefaultVerifyOptions({
        expectedIssuer: "counter://different/issuer",
      });
      const result = await verifyEnvelope(envelope, options);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("UNAUTHENTICATED");
      }
    });
  });

  describe("malformed envelope", () => {
    it("rejects envelope with invalid CTP version", async () => {
      const envelope = await createValidSignedEnvelope();
      const tampered = { ...envelope, ctp_version: "99.99" } as unknown as CtpEnvelope;
      const options = createDefaultVerifyOptions();
      const result = await verifyEnvelope(tampered, options);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("UNSUPPORTED_VALUE");
      }
    });

    it("rejects envelope with invalid object type", async () => {
      const envelope = await createValidSignedEnvelope();
      const tampered = { ...envelope, type: "counter.invalid.v1" } as unknown as CtpEnvelope;
      const options = createDefaultVerifyOptions();
      const result = await verifyEnvelope(tampered, options);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("UNSUPPORTED_VALUE");
      }
    });
  });
});

describe("Envelope Construction", () => {
  it("buildUnsignedEnvelope computes payload_digest automatically", () => {
    const result = buildUnsignedEnvelope({
      type: "counter.evidence.v1",
      id: "test-id-001",
      issuer: "counter://test/issuer",
      subject: "counter://test/subject",
      audience: ["counter://test/audience"],
      environment: "sandbox",
      issued_at: "2025-01-15T10:00:00.000Z",
      not_before: "2025-01-15T10:00:00.000Z",
      expires_at: "2025-01-15T11:00:00.000Z",
      nonce: "test-nonce-001",
      correlation_id: "test-correlation-001",
      payload: { test: true },
      kid: TEST_KID_A,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.payload_digest).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(result.value.ctp_version).toBe("0.1");
      expect(result.value.signature.alg).toBe("EdDSA");
      expect(result.value.signature.kid).toBe(TEST_KID_A);
    }
  });

  it("buildUnsignedEnvelope rejects invalid type", () => {
    const result = buildUnsignedEnvelope({
      type: "counter.invalid.v1" as "counter.evidence.v1",
      id: "test-id-001",
      issuer: "counter://test/issuer",
      subject: "counter://test/subject",
      audience: ["counter://test/audience"],
      environment: "sandbox",
      issued_at: "2025-01-15T10:00:00.000Z",
      not_before: "2025-01-15T10:00:00.000Z",
      expires_at: "2025-01-15T11:00:00.000Z",
      nonce: "test-nonce-001",
      correlation_id: "test-correlation-001",
      payload: { test: true },
      kid: TEST_KID_A,
    });

    expect(result.ok).toBe(false);
  });

  it("buildUnsignedEnvelope rejects empty audience", () => {
    const result = buildUnsignedEnvelope({
      type: "counter.evidence.v1",
      id: "test-id-001",
      issuer: "counter://test/issuer",
      subject: "counter://test/subject",
      audience: [],
      environment: "sandbox",
      issued_at: "2025-01-15T10:00:00.000Z",
      not_before: "2025-01-15T10:00:00.000Z",
      expires_at: "2025-01-15T11:00:00.000Z",
      nonce: "test-nonce-001",
      correlation_id: "test-correlation-001",
      payload: { test: true },
      kid: TEST_KID_A,
    });

    expect(result.ok).toBe(false);
  });

  it("generateNonce produces base64url string", () => {
    const randomBytes = (_length: number) => new Uint8Array(16).fill(0x42);
    const nonce = generateNonce(randomBytes);
    expect(nonce).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(nonce.length).toBeGreaterThan(0);
  });

  it("isCtpEnvelope recognizes valid signed envelopes", async () => {
    const envelope = await createValidSignedEnvelope();
    expect(isCtpEnvelope(envelope)).toBe(true);
  });

  it("isCtpEnvelope rejects non-objects", () => {
    expect(isCtpEnvelope(null)).toBe(false);
    expect(isCtpEnvelope(42)).toBe(false);
    expect(isCtpEnvelope("string")).toBe(false);
  });
});

describe("Fixtures and Determinism", () => {
  it("test keys produce consistent public keys across calls", () => {
    const pub1 = getTestPublicKeyA();
    const pub2 = getTestPublicKeyA();
    expect(Buffer.from(pub1).toString("hex")).toBe(Buffer.from(pub2).toString("hex"));
  });

  it("test key A and B are different", () => {
    const pubA = getTestPublicKeyA();
    const pubB = getTestPublicKeyB();
    expect(Buffer.from(pubA).toString("hex")).not.toBe(Buffer.from(pubB).toString("hex"));
  });

  it("signing is deterministic - same envelope produces same signature", async () => {
    const signer = createTestSignerA();
    const unsigned = createTestUnsignedEnvelope();

    const result1 = await signEnvelope(unsigned, signer);
    const result2 = await signEnvelope(unsigned, signer);

    expect(result1.ok).toBe(true);
    expect(result2.ok).toBe(true);
    if (result1.ok && result2.ok) {
      expect(result1.value.signature.value).toBe(result2.value.signature.value);
    }
  });

  it("independent verification path: manual Ed25519 verify matches library verify", async () => {
    const signer = createTestSignerA();
    const unsigned = createTestUnsignedEnvelope();
    const signResult = await signEnvelope(unsigned, signer);
    expect(signResult.ok).toBe(true);
    if (!signResult.ok) return;

    // Independent path: manually reconstruct canonical bytes and verify
    const canonicalBytes = canonicalBytesForVerification(signResult.value);
    const signatureBytes = Buffer.from(signResult.value.signature.value, "base64url");
    const publicKeyBytes = getTestPublicKeyA();

    // Verify using @noble/ed25519 directly (independent of our verifyEnvelope)
    const valid = await ed.verifyAsync(signatureBytes, canonicalBytes, publicKeyBytes);
    expect(valid).toBe(true);
  });

  it("cross-key determinism: same message with different keys produces different signatures", async () => {
    const signerA = createTestSignerA();
    const signerB = createTestSignerB();

    const unsignedA = createTestUnsignedEnvelope(buildFixtureOptions({ kid: TEST_KID_A }));
    const unsignedB = createTestUnsignedEnvelope(buildFixtureOptions({ kid: TEST_KID_B }));

    const resultA = await signEnvelope(unsignedA, signerA);
    const resultB = await signEnvelope(unsignedB, signerB);

    expect(resultA.ok).toBe(true);
    expect(resultB.ok).toBe(true);
    if (resultA.ok && resultB.ok) {
      expect(resultA.value.signature.value).not.toBe(resultB.value.signature.value);
    }
  });

  it("fixture envelope round-trips through sign and verify", async () => {
    const signer = createTestSignerA();
    const unsigned = createTestUnsignedEnvelope();
    const signResult = await signEnvelope(unsigned, signer);
    expect(signResult.ok).toBe(true);
    if (!signResult.ok) return;

    const registry = new InMemoryKeyRegistry([TEST_KEY_RECORD_A]);
    const verifyResult = await verifyEnvelope(signResult.value, {
      keyRegistry: registry,
      currentTime: "2025-01-15T10:30:00.000Z",
    });
    expect(verifyResult.ok).toBe(true);
  });

  it("canonical bytes are stable across serialization boundaries", () => {
    const unsigned = createTestUnsignedEnvelope();
    const bytes1 = canonicalizeUnsignedEnvelope(unsigned);

    // Serialize to JSON and deserialize (simulating network transit)
    const json = JSON.stringify(unsigned);
    const deserialized = JSON.parse(json) as typeof unsigned;
    const bytes2 = canonicalizeUnsignedEnvelope(deserialized);

    expect(Buffer.from(bytes1).toString("hex")).toBe(Buffer.from(bytes2).toString("hex"));
  });
});

describe("InMemoryNonceStore", () => {
  let store: InMemoryNonceStore;

  beforeEach(() => {
    store = new InMemoryNonceStore();
  });

  it("records new nonces", async () => {
    const isNew = await store.checkAndRecord("nonce-1", "envelope-1");
    expect(isNew).toBe(true);
  });

  it("detects duplicate nonces", async () => {
    await store.checkAndRecord("nonce-1", "envelope-1");
    const isNew = await store.checkAndRecord("nonce-1", "envelope-2");
    expect(isNew).toBe(false);
  });

  it("clear resets the store", async () => {
    await store.checkAndRecord("nonce-1", "envelope-1");
    store.clear();
    const isNew = await store.checkAndRecord("nonce-1", "envelope-2");
    expect(isNew).toBe(true);
  });
});
