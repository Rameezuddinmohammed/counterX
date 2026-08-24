/**
 * Comprehensive tests for registry, nonce/replay, revocation, and assurance services.
 *
 * Covers:
 * (a) Proof of possession during registration
 * (b) Key rotation (old key stops working)
 * (c) Revocation races (concurrent revocation + usage)
 * (d) Replay under concurrency (same nonce used twice concurrently)
 * (e) Historical evidence (revoked key was valid before revocation time)
 * (f) Assurance non-inflation
 * (g) End-to-end authority verification happy path and failure cases
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { Instant } from "@counter/domain";
import {
  type CtpEnvelope,
  type MandatePayload,
  type AgentRegistrationPayload,
  createTestSignerA,
  createTestSignerB,
  signEnvelope,
  buildUnsignedEnvelope,
  generateNonce,
  TEST_KID_A,
  TEST_KID_B,
  TEST_KEY_RECORD_A,
  TEST_KEY_RECORD_B,
  InMemoryConcurrentNonceStore,
} from "@counter/trust-protocol";
import { randomBytes } from "node:crypto";
import { CounterTestAgentRegistry } from "./counter-test-agent-registry.js";
import { InMemoryRevocationStore } from "./revocation-service.js";
import { CTPAuthorityVerifier } from "./ctp-authority-verifier.js";
import {
  meetsAssuranceRequirement,
  isCtpAssuranceLevel,
  CTP_ASSURANCE_LEVELS,
} from "./assurance-policy.js";

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

const TEST_AGENT_ID = "counter://test/agent-001";
const TEST_PRINCIPAL_ID = "counter://test/principal-001";
const TEST_WALLET_ID = "counter://test/wallet-001";
const TEST_AGENT_URI = "counter://test/agent-uri-001";
const TEST_MERCHANT_ID = "counter://test/merchant-001";
const TEST_AUDIENCE = "counter://test/verifier";
const TEST_ENVIRONMENT = "sandbox";

function instantOf(isoString: string): Instant {
  return Date.parse(isoString) as Instant;
}

async function createRegistrationEnvelope(
  kid: string,
  signer: { readonly kid: string; sign(msg: Uint8Array): Promise<Uint8Array> },
): Promise<CtpEnvelope<AgentRegistrationPayload>> {
  const payload: AgentRegistrationPayload = {
    principal_id: TEST_PRINCIPAL_ID,
    wallet_id: TEST_WALLET_ID,
    agent_uri: TEST_AGENT_URI,
    public_key: kid === TEST_KID_A ? TEST_KEY_RECORD_A.publicKey : TEST_KEY_RECORD_B.publicKey,
    kid,
    proof_of_possession: "self-signed",
    validity_start: "2025-01-01T00:00:00.000Z",
    validity_end: "2026-01-01T00:00:00.000Z",
    assurance_level: "direct_principal",
  };

  const unsignedResult = buildUnsignedEnvelope({
    type: "counter.agent-registration.v1",
    id: `ctr_registration_${kid}`,
    issuer: TEST_AGENT_ID,
    subject: TEST_AGENT_ID,
    audience: [TEST_AUDIENCE],
    environment: TEST_ENVIRONMENT,
    issued_at: "2024-01-01T00:00:00.000Z",
    not_before: "2024-01-01T00:00:00.000Z",
    expires_at: "2026-01-15T11:00:00.000Z",
    nonce: generateNonce((len) => randomBytes(len)),
    correlation_id: `ctr_correlation_reg-${kid}`,
    payload,
    kid,
  });

  if (!unsignedResult.ok) {
    throw new Error(`Failed to build unsigned envelope: ${unsignedResult.error.message}`);
  }

  const signedResult = await signEnvelope(unsignedResult.value, signer);
  if (!signedResult.ok) {
    throw new Error(`Failed to sign envelope: ${signedResult.error.message}`);
  }

  return signedResult.value;
}

async function createMandateEnvelope(
  kid: string,
  signer: { readonly kid: string; sign(msg: Uint8Array): Promise<Uint8Array> },
  options: {
    nonce?: string;
    mandateId?: string;
    merchantId?: string;
    audience?: string;
    environment?: "sandbox" | "pilot" | "production";
    validityStart?: string;
    validityEnd?: string;
    notBefore?: string;
    expiresAt?: string;
  } = {},
): Promise<CtpEnvelope<MandatePayload>> {
  const payload: MandatePayload = {
    mandate_id: options.mandateId ?? "mandate-001",
    principal_id: TEST_PRINCIPAL_ID,
    wallet_id: TEST_WALLET_ID,
    agent_id: TEST_AGENT_ID,
    kid,
    allowed_merchants: [options.merchantId ?? TEST_MERCHANT_ID],
    currencies: ["USD"],
    per_transaction_limit: { amount: 1000, currency: "USD" },
    allowed_operations: ["purchase", "refund"],
    payment_authorization_ref: "par-001",
    validity_start: options.validityStart ?? "2025-01-01T00:00:00.000Z",
    validity_end: options.validityEnd ?? "2026-01-01T00:00:00.000Z",
    policy_version: "1.0",
    policy_digest: "sha256:abc123",
  };

  const unsignedResult = buildUnsignedEnvelope({
    type: "counter.mandate.v1",
    id: `ctr_mandate_${options.mandateId ?? "mandate-001"}`,
    issuer: TEST_AGENT_ID,
    subject: TEST_AGENT_ID,
    audience: [options.audience ?? TEST_AUDIENCE],
    environment: options.environment ?? TEST_ENVIRONMENT,
    issued_at: "2025-01-15T10:00:00.000Z",
    not_before: options.notBefore ?? "2025-01-15T10:00:00.000Z",
    expires_at: options.expiresAt ?? "2025-01-15T11:00:00.000Z",
    nonce: (options.nonce ?? generateNonce((len) => randomBytes(len))),
    correlation_id: "ctr_correlation_mandate-001",
    payload,
    kid,
  });

  if (!unsignedResult.ok) {
    throw new Error(`Failed to build mandate envelope: ${unsignedResult.error.message}`);
  }

  const signedResult = await signEnvelope(unsignedResult.value, signer);
  if (!signedResult.ok) {
    throw new Error(`Failed to sign mandate envelope: ${signedResult.error.message}`);
  }

  return signedResult.value;
}

// ---------------------------------------------------------------------------
// (a) Proof of Possession During Registration
// ---------------------------------------------------------------------------

describe("CounterTestAgentRegistry - Proof of Possession", () => {
  let registry: CounterTestAgentRegistry;

  beforeEach(() => {
    registry = new CounterTestAgentRegistry();
  });

  it("registers an agent with valid proof of possession", async () => {
    const signerA = createTestSignerA();
    const pop = await createRegistrationEnvelope(TEST_KID_A, signerA);

    const result = await registry.register({
      agentId: TEST_AGENT_ID,
      principalId: TEST_PRINCIPAL_ID,
      walletId: TEST_WALLET_ID,
      agentUri: TEST_AGENT_URI,
      kid: TEST_KID_A,
      publicKey: TEST_KEY_RECORD_A.publicKey,
      environment: TEST_ENVIRONMENT,
      assuranceLevel: "direct_principal",
      registeredAt: instantOf("2025-01-15T10:00:00.000Z"),
      proofOfPossession: pop,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.agentId).toBe(TEST_AGENT_ID);
      expect(result.value.currentKid).toBe(TEST_KID_A);
      expect(result.value.status).toBe("active");
      expect(result.value.keyHistory).toHaveLength(1);
    }
  });

  it("rejects registration with invalid proof of possession (wrong key)", async () => {
    // Sign with key B but claim to register with key A
    const signerB = createTestSignerB();
    const pop = await createRegistrationEnvelope(TEST_KID_B, signerB);

    const result = await registry.register({
      agentId: TEST_AGENT_ID,
      principalId: TEST_PRINCIPAL_ID,
      walletId: TEST_WALLET_ID,
      agentUri: TEST_AGENT_URI,
      kid: TEST_KID_A, // Claiming key A
      publicKey: TEST_KEY_RECORD_A.publicKey,
      environment: TEST_ENVIRONMENT,
      assuranceLevel: "direct_principal",
      registeredAt: instantOf("2025-01-15T10:00:00.000Z"),
      proofOfPossession: pop, // But signed with key B
    });

    expect(result.ok).toBe(false);
  });

  it("rejects duplicate registration for the same agent", async () => {
    const signerA = createTestSignerA();
    const pop1 = await createRegistrationEnvelope(TEST_KID_A, signerA);

    await registry.register({
      agentId: TEST_AGENT_ID,
      principalId: TEST_PRINCIPAL_ID,
      walletId: TEST_WALLET_ID,
      agentUri: TEST_AGENT_URI,
      kid: TEST_KID_A,
      publicKey: TEST_KEY_RECORD_A.publicKey,
      environment: TEST_ENVIRONMENT,
      assuranceLevel: "direct_principal",
      registeredAt: instantOf("2025-01-15T10:00:00.000Z"),
      proofOfPossession: pop1,
    });

    const pop2 = await createRegistrationEnvelope(TEST_KID_A, signerA);
    const result = await registry.register({
      agentId: TEST_AGENT_ID,
      principalId: TEST_PRINCIPAL_ID,
      walletId: TEST_WALLET_ID,
      agentUri: TEST_AGENT_URI,
      kid: TEST_KID_A,
      publicKey: TEST_KEY_RECORD_A.publicKey,
      environment: TEST_ENVIRONMENT,
      assuranceLevel: "direct_principal",
      registeredAt: instantOf("2025-01-15T10:00:00.000Z"),
      proofOfPossession: pop2,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("CONFLICT");
    }
  });
});

// ---------------------------------------------------------------------------
// (b) Key Rotation
// ---------------------------------------------------------------------------

describe("CounterTestAgentRegistry - Key Rotation", () => {
  let registry: CounterTestAgentRegistry;

  beforeEach(async () => {
    registry = new CounterTestAgentRegistry();
    const signerA = createTestSignerA();
    const pop = await createRegistrationEnvelope(TEST_KID_A, signerA);

    await registry.register({
      agentId: TEST_AGENT_ID,
      principalId: TEST_PRINCIPAL_ID,
      walletId: TEST_WALLET_ID,
      agentUri: TEST_AGENT_URI,
      kid: TEST_KID_A,
      publicKey: TEST_KEY_RECORD_A.publicKey,
      environment: TEST_ENVIRONMENT,
      assuranceLevel: "direct_principal",
      registeredAt: instantOf("2025-01-15T10:00:00.000Z"),
      proofOfPossession: pop,
    });
  });

  it("rotates key successfully with valid PoP for new key", async () => {
    const signerB = createTestSignerB();
    const pop = await createRegistrationEnvelope(TEST_KID_B, signerB);

    const result = await registry.rotateKey({
      agentId: TEST_AGENT_ID,
      newKid: TEST_KID_B,
      newPublicKey: TEST_KEY_RECORD_B.publicKey,
      environment: TEST_ENVIRONMENT,
      rotatedAt: instantOf("2025-02-01T10:00:00.000Z"),
      proofOfPossession: pop,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.currentKid).toBe(TEST_KID_B);
      expect(result.value.keyHistory).toHaveLength(2);
    }
  });

  it("after rotation, old key is inactive for current time queries", async () => {
    const signerB = createTestSignerB();
    const pop = await createRegistrationEnvelope(TEST_KID_B, signerB);

    await registry.rotateKey({
      agentId: TEST_AGENT_ID,
      newKid: TEST_KID_B,
      newPublicKey: TEST_KEY_RECORD_B.publicKey,
      environment: TEST_ENVIRONMENT,
      rotatedAt: instantOf("2025-02-01T10:00:00.000Z"),
      proofOfPossession: pop,
    });

    // Old key should be inactive after rotation time
    const oldKeyActive = await registry.isKeyActive(
      TEST_AGENT_ID,
      TEST_KID_A,
      instantOf("2025-02-02T10:00:00.000Z"),
    );
    expect(oldKeyActive).toBe(false);

    // New key should be active
    const newKeyActive = await registry.isKeyActive(
      TEST_AGENT_ID,
      TEST_KID_B,
      instantOf("2025-02-02T10:00:00.000Z"),
    );
    expect(newKeyActive).toBe(true);
  });

  it("old key was still active before the rotation time", async () => {
    const signerB = createTestSignerB();
    const pop = await createRegistrationEnvelope(TEST_KID_B, signerB);

    await registry.rotateKey({
      agentId: TEST_AGENT_ID,
      newKid: TEST_KID_B,
      newPublicKey: TEST_KEY_RECORD_B.publicKey,
      environment: TEST_ENVIRONMENT,
      rotatedAt: instantOf("2025-02-01T10:00:00.000Z"),
      proofOfPossession: pop,
    });

    // Old key should be active before rotation
    const oldKeyActive = await registry.isKeyActive(
      TEST_AGENT_ID,
      TEST_KID_A,
      instantOf("2025-01-31T10:00:00.000Z"),
    );
    expect(oldKeyActive).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (c) Revocation Races
// ---------------------------------------------------------------------------

describe("RevocationStore - Revocation Races", () => {
  let revocationStore: InMemoryRevocationStore;

  beforeEach(() => {
    revocationStore = new InMemoryRevocationStore();
  });

  it("concurrent revocation and usage: revocation wins", async () => {
    const revokeTime = instantOf("2025-01-15T10:00:00.000Z");
    const usageTime = instantOf("2025-01-15T10:00:01.000Z");

    // Simulate concurrent revocation + check
    await Promise.all([
      revocationStore.revoke({
        scopeType: "key",
        scopeId: "kid-001",
        effectiveTime: revokeTime,
        reason: "compromised",
      }),
      revocationStore.isRevoked("key", "kid-001", usageTime),
    ]);

    // After the revocation, subsequent check must see the revocation
    const isRevokedAfter = await revocationStore.isRevoked("key", "kid-001", usageTime);
    expect(isRevokedAfter).toBe(true);
  });

  it("monotonic revocation: earlier effective time takes precedence", async () => {
    const laterTime = instantOf("2025-02-01T10:00:00.000Z");
    const earlierTime = instantOf("2025-01-01T10:00:00.000Z");

    await revocationStore.revoke({
      scopeType: "mandate",
      scopeId: "mandate-001",
      effectiveTime: laterTime,
    });

    await revocationStore.revoke({
      scopeType: "mandate",
      scopeId: "mandate-001",
      effectiveTime: earlierTime,
    });

    const revokedTime = await revocationStore.getRevocationTime("mandate", "mandate-001");
    expect(revokedTime).toBe(earlierTime);

    // Should be revoked at a time between the two
    const revokedBetween = await revocationStore.isRevoked(
      "mandate",
      "mandate-001",
      instantOf("2025-01-15T10:00:00.000Z"),
    );
    expect(revokedBetween).toBe(true);
  });

  it("once revoked at T, always revoked for times >= T", async () => {
    const revokeTime = instantOf("2025-01-15T10:00:00.000Z");

    await revocationStore.revoke({
      scopeType: "agent",
      scopeId: "agent-001",
      effectiveTime: revokeTime,
    });

    // Before revocation time: not revoked
    const beforeRevoke = await revocationStore.isRevoked(
      "agent",
      "agent-001",
      instantOf("2025-01-14T10:00:00.000Z"),
    );
    expect(beforeRevoke).toBe(false);

    // At revocation time: revoked
    const atRevoke = await revocationStore.isRevoked("agent", "agent-001", revokeTime);
    expect(atRevoke).toBe(true);

    // After revocation time: revoked
    const afterRevoke = await revocationStore.isRevoked(
      "agent",
      "agent-001",
      instantOf("2025-01-16T10:00:00.000Z"),
    );
    expect(afterRevoke).toBe(true);
  });

  it("revocation is idempotent", async () => {
    const revokeTime = instantOf("2025-01-15T10:00:00.000Z");

    const r1 = await revocationStore.revoke({
      scopeType: "key",
      scopeId: "kid-001",
      effectiveTime: revokeTime,
    });
    const r2 = await revocationStore.revoke({
      scopeType: "key",
      scopeId: "kid-001",
      effectiveTime: revokeTime,
    });

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(revocationStore.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// (d) Replay Under Concurrency
// ---------------------------------------------------------------------------

describe("InMemoryConcurrentNonceStore - Replay Under Concurrency", () => {
  let nonceStore: InMemoryConcurrentNonceStore;

  beforeEach(() => {
    nonceStore = new InMemoryConcurrentNonceStore();
  });

  it("same nonce used concurrently: only one succeeds", async () => {
    const nonce = "test-nonce-concurrent";
    const results = await Promise.all([
      nonceStore.checkAndRecord(nonce, "envelope-1"),
      nonceStore.checkAndRecord(nonce, "envelope-2"),
    ]);

    // Exactly one should succeed
    const successes = results.filter((r) => r === true);
    const failures = results.filter((r) => r === false);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
  });

  it("different nonces can both succeed", async () => {
    const [r1, r2] = await Promise.all([
      nonceStore.checkAndRecord("nonce-a", "env-1"),
      nonceStore.checkAndRecord("nonce-b", "env-2"),
    ]);

    expect(r1).toBe(true);
    expect(r2).toBe(true);
    expect(nonceStore.size).toBe(2);
  });

  it("sequential replay attempt is rejected", async () => {
    const nonce = "test-nonce-seq";
    const first = await nonceStore.checkAndRecord(nonce, "envelope-1");
    const second = await nonceStore.checkAndRecord(nonce, "envelope-2");

    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it("tracks which envelope consumed the nonce", async () => {
    const nonce = "tracked-nonce";
    await nonceStore.checkAndRecord(nonce, "envelope-abc");

    expect(nonceStore.getConsumer(nonce)).toBe("envelope-abc");
  });
});

// ---------------------------------------------------------------------------
// (e) Historical Evidence
// ---------------------------------------------------------------------------

describe("CounterTestAgentRegistry - Historical Evidence", () => {
  it("revoked key was valid before revocation time", async () => {
    const registry = new CounterTestAgentRegistry();
    const signerA = createTestSignerA();
    const pop = await createRegistrationEnvelope(TEST_KID_A, signerA);

    await registry.register({
      agentId: TEST_AGENT_ID,
      principalId: TEST_PRINCIPAL_ID,
      walletId: TEST_WALLET_ID,
      agentUri: TEST_AGENT_URI,
      kid: TEST_KID_A,
      publicKey: TEST_KEY_RECORD_A.publicKey,
      environment: TEST_ENVIRONMENT,
      assuranceLevel: "direct_principal",
      registeredAt: instantOf("2025-01-01T10:00:00.000Z"),
      proofOfPossession: pop,
    });

    // Revoke the key at a specific time
    await registry.revokeKey(
      TEST_AGENT_ID,
      TEST_KID_A,
      TEST_ENVIRONMENT,
      instantOf("2025-02-01T10:00:00.000Z"),
    );

    // Before revocation: key should be active
    const activeBeforeRevocation = await registry.isKeyActive(
      TEST_AGENT_ID,
      TEST_KID_A,
      instantOf("2025-01-15T10:00:00.000Z"),
    );
    expect(activeBeforeRevocation).toBe(true);

    // After revocation: key should be inactive
    const activeAfterRevocation = await registry.isKeyActive(
      TEST_AGENT_ID,
      TEST_KID_A,
      instantOf("2025-02-01T10:00:00.000Z"),
    );
    expect(activeAfterRevocation).toBe(false);
  });

  it("agent revocation makes all keys inactive after revocation time", async () => {
    const registry = new CounterTestAgentRegistry();
    const signerA = createTestSignerA();
    const pop = await createRegistrationEnvelope(TEST_KID_A, signerA);

    await registry.register({
      agentId: TEST_AGENT_ID,
      principalId: TEST_PRINCIPAL_ID,
      walletId: TEST_WALLET_ID,
      agentUri: TEST_AGENT_URI,
      kid: TEST_KID_A,
      publicKey: TEST_KEY_RECORD_A.publicKey,
      environment: TEST_ENVIRONMENT,
      assuranceLevel: "direct_principal",
      registeredAt: instantOf("2025-01-01T10:00:00.000Z"),
      proofOfPossession: pop,
    });

    await registry.revokeAgent(
      TEST_AGENT_ID,
      TEST_ENVIRONMENT,
      instantOf("2025-02-01T10:00:00.000Z"),
    );

    // Key active before agent revocation
    const activeBefore = await registry.isKeyActive(
      TEST_AGENT_ID,
      TEST_KID_A,
      instantOf("2025-01-15T10:00:00.000Z"),
    );
    expect(activeBefore).toBe(true);

    // Key inactive after agent revocation
    const activeAfter = await registry.isKeyActive(
      TEST_AGENT_ID,
      TEST_KID_A,
      instantOf("2025-02-02T10:00:00.000Z"),
    );
    expect(activeAfter).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (f) Assurance Non-Inflation
// ---------------------------------------------------------------------------

describe("Assurance Non-Inflation Policy", () => {
  it("service_witnessed CANNOT satisfy direct_principal", () => {
    expect(meetsAssuranceRequirement("service_witnessed", "direct_principal")).toBe(false);
  });

  it("service_witnessed CANNOT satisfy webauthn", () => {
    expect(meetsAssuranceRequirement("service_witnessed", "webauthn")).toBe(false);
  });

  it("service_witnessed CANNOT satisfy external_protocol", () => {
    expect(meetsAssuranceRequirement("service_witnessed", "external_protocol")).toBe(false);
  });

  it("agent_proof CANNOT satisfy direct_principal", () => {
    expect(meetsAssuranceRequirement("agent_proof", "direct_principal")).toBe(false);
  });

  it("agent_proof CANNOT satisfy webauthn", () => {
    expect(meetsAssuranceRequirement("agent_proof", "webauthn")).toBe(false);
  });

  it("agent_proof CANNOT satisfy external_protocol", () => {
    expect(meetsAssuranceRequirement("agent_proof", "external_protocol")).toBe(false);
  });

  it("direct_principal satisfies all requirements", () => {
    for (const level of CTP_ASSURANCE_LEVELS) {
      expect(meetsAssuranceRequirement("direct_principal", level)).toBe(true);
    }
  });

  it("webauthn satisfies webauthn and below", () => {
    expect(meetsAssuranceRequirement("webauthn", "webauthn")).toBe(true);
    expect(meetsAssuranceRequirement("webauthn", "external_protocol")).toBe(true);
    expect(meetsAssuranceRequirement("webauthn", "service_witnessed")).toBe(true);
    expect(meetsAssuranceRequirement("webauthn", "agent_proof")).toBe(true);
  });

  it("webauthn does NOT satisfy direct_principal", () => {
    expect(meetsAssuranceRequirement("webauthn", "direct_principal")).toBe(false);
  });

  it("service_witnessed satisfies itself and agent_proof", () => {
    expect(meetsAssuranceRequirement("service_witnessed", "service_witnessed")).toBe(true);
    expect(meetsAssuranceRequirement("service_witnessed", "agent_proof")).toBe(true);
  });

  it("isCtpAssuranceLevel validates correctly", () => {
    for (const level of CTP_ASSURANCE_LEVELS) {
      expect(isCtpAssuranceLevel(level)).toBe(true);
    }
    expect(isCtpAssuranceLevel("unknown")).toBe(false);
    expect(isCtpAssuranceLevel(42)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (g) End-to-End Authority Verification
// ---------------------------------------------------------------------------

describe("CTPAuthorityVerifier - End-to-End", () => {
  let registry: CounterTestAgentRegistry;
  let nonceStore: InMemoryConcurrentNonceStore;
  let revocationStore: InMemoryRevocationStore;
  let verifier: CTPAuthorityVerifier;

  beforeEach(async () => {
    registry = new CounterTestAgentRegistry();
    nonceStore = new InMemoryConcurrentNonceStore();
    revocationStore = new InMemoryRevocationStore();
    verifier = new CTPAuthorityVerifier({
      agentRegistry: registry,
      nonceStore,
      revocationStore,
      expectedAudience: TEST_AUDIENCE,
    });

    // Register the agent
    const signerA = createTestSignerA();
    const pop = await createRegistrationEnvelope(TEST_KID_A, signerA);
    await registry.register({
      agentId: TEST_AGENT_ID,
      principalId: TEST_PRINCIPAL_ID,
      walletId: TEST_WALLET_ID,
      agentUri: TEST_AGENT_URI,
      kid: TEST_KID_A,
      publicKey: TEST_KEY_RECORD_A.publicKey,
      environment: TEST_ENVIRONMENT,
      assuranceLevel: "direct_principal",
      registeredAt: instantOf("2025-01-01T00:00:00.000Z"),
      proofOfPossession: pop,
    });
  });

  it("happy path: valid mandate is verified successfully", async () => {
    const signerA = createTestSignerA();
    const mandateEnvelope = await createMandateEnvelope(TEST_KID_A, signerA);

    const result = await verifier.verify({
      envelope: mandateEnvelope,
      agentId: TEST_AGENT_ID,
      kid: TEST_KID_A,
      merchantId: TEST_MERCHANT_ID,
      environment: TEST_ENVIRONMENT,
      currentTime: instantOf("2025-01-15T10:30:00.000Z"),
      nonce: generateNonce((len) => randomBytes(len)),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.mandateId).toBe("mandate-001");
      expect(result.value.agentId).toBe(TEST_AGENT_ID);
      expect(result.value.kid).toBe(TEST_KID_A);
      expect(result.value.merchantId).toBe(TEST_MERCHANT_ID);
      expect(result.value.environment).toBe(TEST_ENVIRONMENT);
      expect(result.value.assuranceLevel).toBe("direct_principal");
      expect(result.value.allowedOperations).toContain("purchase");
      expect(result.value.allowedOperations).toContain("refund");
    }
  });

  it("fails when agent is not found", async () => {
    const signerA = createTestSignerA();
    const mandateEnvelope = await createMandateEnvelope(TEST_KID_A, signerA);

    const result = await verifier.verify({
      envelope: mandateEnvelope,
      agentId: "counter://test/nonexistent-agent",
      kid: TEST_KID_A,
      merchantId: TEST_MERCHANT_ID,
      environment: TEST_ENVIRONMENT,
      currentTime: instantOf("2025-01-15T10:30:00.000Z"),
      nonce: generateNonce((len) => randomBytes(len)),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("agent_not_found");
    }
  });

  it("fails when key is revoked", async () => {
    // Revoke the key
    await registry.revokeKey(
      TEST_AGENT_ID,
      TEST_KID_A,
      TEST_ENVIRONMENT,
      instantOf("2025-01-14T10:00:00.000Z"),
    );

    const signerA = createTestSignerA();
    const mandateEnvelope = await createMandateEnvelope(TEST_KID_A, signerA);

    const result = await verifier.verify({
      envelope: mandateEnvelope,
      agentId: TEST_AGENT_ID,
      kid: TEST_KID_A,
      merchantId: TEST_MERCHANT_ID,
      environment: TEST_ENVIRONMENT,
      currentTime: instantOf("2025-01-15T10:30:00.000Z"),
      nonce: generateNonce((len) => randomBytes(len)),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("key_revoked");
    }
  });

  it("fails when nonce is replayed", async () => {
    const signerA = createTestSignerA();
    const mandateEnvelope = await createMandateEnvelope(TEST_KID_A, signerA);
    const fixedNonce = "fixed-nonce-for-replay-test";

    // First usage succeeds
    const result1 = await verifier.verify({
      envelope: mandateEnvelope,
      agentId: TEST_AGENT_ID,
      kid: TEST_KID_A,
      merchantId: TEST_MERCHANT_ID,
      environment: TEST_ENVIRONMENT,
      currentTime: instantOf("2025-01-15T10:30:00.000Z"),
      nonce: fixedNonce,
    });
    expect(result1.ok).toBe(true);

    // Second usage with same nonce fails
    const mandateEnvelope2 = await createMandateEnvelope(TEST_KID_A, signerA, {
      mandateId: "mandate-002",
    });
    const result2 = await verifier.verify({
      envelope: mandateEnvelope2,
      agentId: TEST_AGENT_ID,
      kid: TEST_KID_A,
      merchantId: TEST_MERCHANT_ID,
      environment: TEST_ENVIRONMENT,
      currentTime: instantOf("2025-01-15T10:30:00.000Z"),
      nonce: fixedNonce,
    });
    expect(result2.ok).toBe(false);
    if (!result2.ok) {
      expect(result2.error.reason).toBe("nonce_replay");
    }
  });

  it("fails when mandate is revoked", async () => {
    // Revoke the mandate
    await revocationStore.revoke({
      scopeType: "mandate",
      scopeId: "mandate-001",
      effectiveTime: instantOf("2025-01-14T00:00:00.000Z"),
    });

    const signerA = createTestSignerA();
    const mandateEnvelope = await createMandateEnvelope(TEST_KID_A, signerA);

    const result = await verifier.verify({
      envelope: mandateEnvelope,
      agentId: TEST_AGENT_ID,
      kid: TEST_KID_A,
      merchantId: TEST_MERCHANT_ID,
      environment: TEST_ENVIRONMENT,
      currentTime: instantOf("2025-01-15T10:30:00.000Z"),
      nonce: generateNonce((len) => randomBytes(len)),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("mandate_revoked");
    }
  });

  it("fails when assurance is insufficient", async () => {
    // Re-register with service_witnessed assurance
    const registry2 = new CounterTestAgentRegistry();
    const nonceStore2 = new InMemoryConcurrentNonceStore();
    const revocationStore2 = new InMemoryRevocationStore();
    const verifier2 = new CTPAuthorityVerifier({
      agentRegistry: registry2,
      nonceStore: nonceStore2,
      revocationStore: revocationStore2,
      expectedAudience: TEST_AUDIENCE,
    });

    const signerA = createTestSignerA();
    const pop = await createRegistrationEnvelope(TEST_KID_A, signerA);
    await registry2.register({
      agentId: TEST_AGENT_ID,
      principalId: TEST_PRINCIPAL_ID,
      walletId: TEST_WALLET_ID,
      agentUri: TEST_AGENT_URI,
      kid: TEST_KID_A,
      publicKey: TEST_KEY_RECORD_A.publicKey,
      environment: TEST_ENVIRONMENT,
      assuranceLevel: "service_witnessed",
      registeredAt: instantOf("2025-01-01T00:00:00.000Z"),
      proofOfPossession: pop,
    });

    const mandateEnvelope = await createMandateEnvelope(TEST_KID_A, signerA);

    const result = await verifier2.verify({
      envelope: mandateEnvelope,
      agentId: TEST_AGENT_ID,
      kid: TEST_KID_A,
      merchantId: TEST_MERCHANT_ID,
      environment: TEST_ENVIRONMENT,
      currentTime: instantOf("2025-01-15T10:30:00.000Z"),
      nonce: generateNonce((len) => randomBytes(len)),
      requiredAssurance: "direct_principal",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("assurance_insufficient");
    }
  });

  it("fails when agent is revoked", async () => {
    await registry.revokeAgent(
      TEST_AGENT_ID,
      TEST_ENVIRONMENT,
      instantOf("2025-01-14T00:00:00.000Z"),
    );

    const signerA = createTestSignerA();
    const mandateEnvelope = await createMandateEnvelope(TEST_KID_A, signerA);

    const result = await verifier.verify({
      envelope: mandateEnvelope,
      agentId: TEST_AGENT_ID,
      kid: TEST_KID_A,
      merchantId: TEST_MERCHANT_ID,
      environment: TEST_ENVIRONMENT,
      currentTime: instantOf("2025-01-15T10:30:00.000Z"),
      nonce: generateNonce((len) => randomBytes(len)),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("agent_revoked");
    }
  });

  it("fails when environment does not match", async () => {
    const signerA = createTestSignerA();
    // Create envelope for production but verify in sandbox context
    const mandateEnvelope = await createMandateEnvelope(TEST_KID_A, signerA, {
      environment: "production",
    });

    const result = await verifier.verify({
      envelope: mandateEnvelope,
      agentId: TEST_AGENT_ID,
      kid: TEST_KID_A,
      merchantId: TEST_MERCHANT_ID,
      environment: TEST_ENVIRONMENT, // sandbox
      currentTime: instantOf("2025-01-15T10:30:00.000Z"),
      nonce: generateNonce((len) => randomBytes(len)),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("environment_mismatch");
    }
  });
});
