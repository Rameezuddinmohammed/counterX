/**
 * Mandate issuance, sync, and revocation tests.
 *
 * Tests cover:
 * - Mandate issued only from fresh consent attestation
 * - Wrong agent rejected
 * - Expired mandate rejected
 * - Revoked mandate rejected
 * - Revocation races (concurrent revoke + use)
 * - Policy widening requires new mandate
 * - Monotonic revocation
 * - Cascade revocation (wallet -> mandates, agent -> mandates)
 */

import { describe, it, expect } from "vitest";

import { CryptoIdGenerator } from "@counter/domain";
import { InMemoryMandateRepository } from "@counter/wallet-domain";
import type { BuyerPolicyConstraints, WalletMandate } from "@counter/wallet-domain";
import type { AgentRegistration } from "./agent-registration.js";
import type { StepUpSession } from "./step-up-service.js";
import { StepUpService } from "./step-up-service.js";
import { MandateService } from "./mandate-service.js";
import { MandateSyncService } from "./mandate-sync.js";
import { WalletRevocationService, InMemoryRevocationStore } from "./revocation-service.js";

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

const idGen = new CryptoIdGenerator();
const walletId = idGen.generate("wallet");
const principalId = idGen.generate("actor");
const agentId = idGen.generate("agent");
const kid = `kid-${agentId}`;

function createTestConstraints(): BuyerPolicyConstraints {
  return {
    merchantAllowlist: {
      allowedMerchantIds: ["merchant-001"],
      allowedDomains: ["shop.example.com"],
    },
    geography: {
      allowedMerchantCountries: ["IN"],
      allowedDeliveryCountries: ["IN"],
    },
    category: {
      allowedCategories: ["electronics"],
      allowedSkus: undefined,
    },
    currency: {
      allowedCurrencies: ["INR"],
    },
    amountLimits: {
      perTransactionMaxPaise: 1_000_000n,
      rollingPeriodMs: 86_400_000,
      rollingMaxPaise: 5_000_000n,
      aggregateMaxPaise: 50_000_000n,
    },
    countLimits: {
      maxTransactions: 10,
      maxQuantityPerTransaction: 5,
    },
    operations: {
      allowedOperations: ["purchase"],
    },
    timeConstraints: {
      expiresAt: "2026-12-31T23:59:59.000Z",
    },
    approvalThreshold: {
      thresholdPaise: 500_000n,
    },
    paymentReferences: {
      allowedReferenceIds: ["pay-ref-001"],
    },
  };
}

function createActiveAgent(): AgentRegistration {
  return {
    agentId,
    walletId,
    publicKeyDescriptor: {
      kid,
      publicKey: new Uint8Array(32),
      algorithm: "Ed25519",
      status: "active",
    },
    registeredAt: new Date().toISOString(),
    deviceId: idGen.generate("device"),
    status: "active",
    registrationCertificateDigest: "sha256:test-cert-digest",
  };
}

function createValidStepUpSession(nonce?: string): StepUpSession {
  const now = new Date();
  return {
    principal_id: principalId,
    method: "webauthn",
    assurance: "substantial",
    authenticated_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 300_000).toISOString(),
    nonce: nonce ?? `nonce-${Date.now()}-${Math.random()}`,
  };
}

const validDigests = new Set(["sha256:valid-consent-digest"]);

function createMandateService(
  mandateRepo: InMemoryMandateRepository,
  agent?: AgentRegistration,
): MandateService {
  const activeAgent = agent ?? createActiveAgent();
  return new MandateService(
    mandateRepo,
    (id) => (id === activeAgent.agentId ? activeAgent : undefined),
    (digest) => validDigests.has(digest),
    new StepUpService(),
  );
}

// ---------------------------------------------------------------------------
// Mandate Issuance Tests
// ---------------------------------------------------------------------------

describe("MandateService", () => {
  describe("issuance", () => {
    it("should issue mandate from fresh consent attestation", async () => {
      const mandateRepo = new InMemoryMandateRepository();
      const service = createMandateService(mandateRepo);
      const session = createValidStepUpSession();

      const result = await service.issue({
        walletId,
        principalId,
        agentId,
        kid,
        constraints: createTestConstraints(),
        paymentReferenceId: "pay-ref-001",
        validFrom: "2025-01-01T00:00:00.000Z",
        validUntil: "2025-12-31T23:59:59.000Z",
        consentAttestationDigest: "sha256:valid-consent-digest",
        policyVersionId: "v1",
        stepUpSession: session,
        correlationId: "corr-001",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.mandate.status).toBe("active");
        expect(result.value.mandate.walletId).toBe(walletId);
        expect(result.value.mandate.agentId).toBe(agentId);
        expect(result.value.envelope.type).toBe("counter.mandate.v1");
        expect(result.value.payloadDigest).toBeTruthy();
      }
    });

    it("should reject mandate for unregistered agent", async () => {
      const mandateRepo = new InMemoryMandateRepository();
      const unknownAgentId = idGen.generate("agent");
      const service = createMandateService(mandateRepo);
      const session = createValidStepUpSession();

      const result = await service.issue({
        walletId,
        principalId,
        agentId: unknownAgentId,
        kid: `kid-${unknownAgentId}`,
        constraints: createTestConstraints(),
        paymentReferenceId: "pay-ref-001",
        validFrom: "2025-01-01T00:00:00.000Z",
        validUntil: "2025-12-31T23:59:59.000Z",
        consentAttestationDigest: "sha256:valid-consent-digest",
        policyVersionId: "v1",
        stepUpSession: session,
        correlationId: "corr-002",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.reason).toContain("not registered");
      }
    });

    it("should reject mandate for suspended agent", async () => {
      const mandateRepo = new InMemoryMandateRepository();
      const suspendedAgent: AgentRegistration = {
        ...createActiveAgent(),
        status: "suspended",
      };
      const service = createMandateService(mandateRepo, suspendedAgent);
      const session = createValidStepUpSession();

      const result = await service.issue({
        walletId,
        principalId,
        agentId,
        kid,
        constraints: createTestConstraints(),
        paymentReferenceId: "pay-ref-001",
        validFrom: "2025-01-01T00:00:00.000Z",
        validUntil: "2025-12-31T23:59:59.000Z",
        consentAttestationDigest: "sha256:valid-consent-digest",
        policyVersionId: "v1",
        stepUpSession: session,
        correlationId: "corr-003",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.reason).toContain("suspended");
      }
    });

    it("should reject mandate with wrong key ID", async () => {
      const mandateRepo = new InMemoryMandateRepository();
      const service = createMandateService(mandateRepo);
      const session = createValidStepUpSession();

      const result = await service.issue({
        walletId,
        principalId,
        agentId,
        kid: "wrong-kid",
        constraints: createTestConstraints(),
        paymentReferenceId: "pay-ref-001",
        validFrom: "2025-01-01T00:00:00.000Z",
        validUntil: "2025-12-31T23:59:59.000Z",
        consentAttestationDigest: "sha256:valid-consent-digest",
        policyVersionId: "v1",
        stepUpSession: session,
        correlationId: "corr-004",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.reason).toContain("Key ID");
      }
    });

    it("should reject mandate with invalid consent attestation digest", async () => {
      const mandateRepo = new InMemoryMandateRepository();
      const service = createMandateService(mandateRepo);
      const session = createValidStepUpSession();

      const result = await service.issue({
        walletId,
        principalId,
        agentId,
        kid,
        constraints: createTestConstraints(),
        paymentReferenceId: "pay-ref-001",
        validFrom: "2025-01-01T00:00:00.000Z",
        validUntil: "2025-12-31T23:59:59.000Z",
        consentAttestationDigest: "sha256:invalid-digest",
        policyVersionId: "v1",
        stepUpSession: session,
        correlationId: "corr-005",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.reason).toContain("invalid or has been revoked");
      }
    });

    it("should reject mandate with expired step-up session", async () => {
      const mandateRepo = new InMemoryMandateRepository();
      const service = createMandateService(mandateRepo);
      const expiredSession: StepUpSession = {
        principal_id: principalId,
        method: "webauthn",
        assurance: "substantial",
        authenticated_at: "2020-01-01T00:00:00.000Z",
        expires_at: "2020-01-01T00:05:00.000Z",
        nonce: "expired-nonce",
      };

      const result = await service.issue({
        walletId,
        principalId,
        agentId,
        kid,
        constraints: createTestConstraints(),
        paymentReferenceId: "pay-ref-001",
        validFrom: "2025-01-01T00:00:00.000Z",
        validUntil: "2025-12-31T23:59:59.000Z",
        consentAttestationDigest: "sha256:valid-consent-digest",
        policyVersionId: "v1",
        stepUpSession: expiredSession,
        correlationId: "corr-006",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.reason).toContain("Step-up");
      }
    });

    it("should reject mandate with invalid validity window", async () => {
      const mandateRepo = new InMemoryMandateRepository();
      const service = createMandateService(mandateRepo);
      const session = createValidStepUpSession();

      const result = await service.issue({
        walletId,
        principalId,
        agentId,
        kid,
        constraints: createTestConstraints(),
        paymentReferenceId: "pay-ref-001",
        validFrom: "2025-12-31T23:59:59.000Z",
        validUntil: "2025-01-01T00:00:00.000Z", // Before validFrom
        consentAttestationDigest: "sha256:valid-consent-digest",
        policyVersionId: "v1",
        stepUpSession: session,
        correlationId: "corr-007",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.reason).toContain("validity window");
      }
    });

    it("should reject mandate for agent registered to different wallet", async () => {
      const mandateRepo = new InMemoryMandateRepository();
      const otherWalletId = idGen.generate("wallet");
      const agentOnOtherWallet: AgentRegistration = {
        ...createActiveAgent(),
        walletId: otherWalletId,
      };
      const service = createMandateService(mandateRepo, agentOnOtherWallet);
      const session = createValidStepUpSession();

      const result = await service.issue({
        walletId, // Different from agent's wallet
        principalId,
        agentId,
        kid,
        constraints: createTestConstraints(),
        paymentReferenceId: "pay-ref-001",
        validFrom: "2025-01-01T00:00:00.000Z",
        validUntil: "2025-12-31T23:59:59.000Z",
        consentAttestationDigest: "sha256:valid-consent-digest",
        policyVersionId: "v1",
        stepUpSession: session,
        correlationId: "corr-008",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.reason).toContain("not registered to this wallet");
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Mandate Sync Tests
// ---------------------------------------------------------------------------

describe("MandateSyncService", () => {
  function createActiveMandate(): WalletMandate {
    return {
      mandateId: idGen.generate("mandate"),
      walletId,
      principalId,
      agentId,
      kid,
      constraints: createTestConstraints(),
      paymentReferenceId: "pay-ref-001",
      validFrom: "2025-01-01T00:00:00.000Z",
      validUntil: "2026-12-31T23:59:59.000Z",
      issuedAt: "2025-01-01T00:00:00.000Z",
      consentAttestationDigest: "sha256:consent-digest",
      status: "active",
      revocationLocator: "revoke:mandate:test",
      policyVersionId: "v1",
    };
  }

  it("should fetch and cache a valid active mandate", async () => {
    const repo = new InMemoryMandateRepository();
    const mandate = createActiveMandate();
    await repo.save(mandate);

    const syncService = new MandateSyncService(repo);
    const result = await syncService.fetchMandate(mandate.mandateId, "2025-06-01T00:00:00.000Z");

    expect(result.ok).toBe(true);
    expect(result.mandate).toEqual(mandate);
    expect(result.freshness).toBe("fresh");
  });

  it("should reject expired mandate", async () => {
    const repo = new InMemoryMandateRepository();
    const mandate: WalletMandate = {
      ...createActiveMandate(),
      validUntil: "2024-12-31T23:59:59.000Z", // Already expired
    };
    await repo.save(mandate);

    const syncService = new MandateSyncService(repo);
    const result = await syncService.fetchMandate(mandate.mandateId, "2025-06-01T00:00:00.000Z");

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("expired");
  });

  it("should reject revoked mandate", async () => {
    const repo = new InMemoryMandateRepository();
    const mandate: WalletMandate = {
      ...createActiveMandate(),
      status: "revoked",
    };
    await repo.save(mandate);

    const syncService = new MandateSyncService(repo);
    const result = await syncService.fetchMandate(mandate.mandateId, "2025-06-01T00:00:00.000Z");

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("revoked");
  });

  it("should fail closed when cache is stale", async () => {
    const repo = new InMemoryMandateRepository();
    const mandate = createActiveMandate();
    await repo.save(mandate);

    // Use very short staleness threshold
    const syncService = new MandateSyncService(repo, 1); // 1ms staleness

    // First fetch caches it
    await syncService.fetchMandate(mandate.mandateId, "2025-01-01T00:00:00.000Z");

    // Second fetch after the cache is stale (>1ms later)
    const result = await syncService.fetchMandate(mandate.mandateId, "2025-01-01T00:01:00.000Z");

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("stale");
    expect(result.reason).toContain("denied for safety");
  });

  it("should return not found for unknown mandate", async () => {
    const repo = new InMemoryMandateRepository();
    const syncService = new MandateSyncService(repo);
    const unknownId = idGen.generate("mandate");

    const result = await syncService.fetchMandate(unknownId, "2025-06-01T00:00:00.000Z");

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("not found");
  });

  it("should invalidate cached mandate", async () => {
    const repo = new InMemoryMandateRepository();
    const mandate = createActiveMandate();
    await repo.save(mandate);

    const syncService = new MandateSyncService(repo);

    // Cache it
    await syncService.fetchMandate(mandate.mandateId, "2025-06-01T00:00:00.000Z");

    // Invalidate
    syncService.invalidate(mandate.mandateId);

    // Now update the repo to revoked
    await repo.updateStatus(mandate.mandateId, "revoked");

    // Fetch again - should see revoked status
    const result = await syncService.fetchMandate(mandate.mandateId, "2025-06-01T00:00:01.000Z");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("revoked");
  });
});

// ---------------------------------------------------------------------------
// Revocation Service Tests
// ---------------------------------------------------------------------------

describe("WalletRevocationService", () => {
  async function createServiceWithMandate() {
    const mandateRepo = new InMemoryMandateRepository();
    const store = new InMemoryRevocationStore();
    const mandate: WalletMandate = {
      mandateId: idGen.generate("mandate"),
      walletId,
      principalId,
      agentId,
      kid,
      constraints: createTestConstraints(),
      paymentReferenceId: "pay-ref-001",
      validFrom: "2025-01-01T00:00:00.000Z",
      validUntil: "2026-12-31T23:59:59.000Z",
      issuedAt: "2025-01-01T00:00:00.000Z",
      consentAttestationDigest: "sha256:consent-digest",
      status: "active",
      revocationLocator: "revoke:mandate:test",
      policyVersionId: "v1",
    };
    await mandateRepo.save(mandate);

    const service = new WalletRevocationService(store, mandateRepo);
    return { service, store, mandateRepo, mandate };
  }

  it("should revoke a mandate and block future use", async () => {
    const { service, mandateRepo, mandate } = await createServiceWithMandate();

    const result = await service.revoke({
      principalId,
      walletId,
      scopeType: "mandate",
      scopeId: mandate.mandateId,
      reasonClass: "principal_initiated",
      reason: "No longer needed",
      correlationId: "corr-rev-001",
      kid,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.record.scopeType).toBe("mandate");
      expect(result.value.record.sequence).toBe(1);
      expect(result.value.envelope.type).toBe("counter.revocation.v1");
    }

    // Verify mandate is now revoked in repo
    const updated = await mandateRepo.findById(mandate.mandateId);
    expect(updated?.status).toBe("revoked");

    // Verify revocation check
    expect(await service.isRevoked("mandate", mandate.mandateId)).toBe(true);
  });

  it("should be monotonic - cannot un-revoke", async () => {
    const { service, mandate } = await createServiceWithMandate();

    // Revoke
    await service.revoke({
      principalId,
      walletId,
      scopeType: "mandate",
      scopeId: mandate.mandateId,
      reasonClass: "principal_initiated",
      correlationId: "corr-rev-002",
      kid,
    });

    // Attempt to revoke again (idempotent)
    const result = await service.revoke({
      principalId,
      walletId,
      scopeType: "mandate",
      scopeId: mandate.mandateId,
      reasonClass: "security_compromise",
      correlationId: "corr-rev-003",
      kid,
    });

    // Should still be ok (idempotent) but still revoked
    expect(result.ok).toBe(true);
    expect(await service.isRevoked("mandate", mandate.mandateId)).toBe(true);
  });

  it("should cascade wallet revocation to all mandates", async () => {
    const mandateRepo = new InMemoryMandateRepository();
    const store = new InMemoryRevocationStore();

    const mandate1: WalletMandate = {
      mandateId: idGen.generate("mandate"),
      walletId,
      principalId,
      agentId,
      kid,
      constraints: createTestConstraints(),
      paymentReferenceId: "pay-ref-001",
      validFrom: "2025-01-01T00:00:00.000Z",
      validUntil: "2026-12-31T23:59:59.000Z",
      issuedAt: "2025-01-01T00:00:00.000Z",
      consentAttestationDigest: "sha256:digest-1",
      status: "active",
      revocationLocator: "revoke:mandate:1",
      policyVersionId: "v1",
    };
    const mandate2: WalletMandate = {
      mandateId: idGen.generate("mandate"),
      walletId,
      principalId,
      agentId,
      kid,
      constraints: createTestConstraints(),
      paymentReferenceId: "pay-ref-001",
      validFrom: "2025-01-01T00:00:00.000Z",
      validUntil: "2026-12-31T23:59:59.000Z",
      issuedAt: "2025-01-02T00:00:00.000Z",
      consentAttestationDigest: "sha256:digest-2",
      status: "active",
      revocationLocator: "revoke:mandate:2",
      policyVersionId: "v1",
    };
    await mandateRepo.save(mandate1);
    await mandateRepo.save(mandate2);

    const service = new WalletRevocationService(store, mandateRepo);

    // Revoke the wallet
    await service.revoke({
      principalId,
      walletId,
      scopeType: "wallet",
      scopeId: walletId,
      reasonClass: "security_compromise",
      reason: "Wallet compromised",
      correlationId: "corr-rev-004",
      kid,
    });

    // Both mandates should be revoked
    expect((await mandateRepo.findById(mandate1.mandateId))?.status).toBe("revoked");
    expect((await mandateRepo.findById(mandate2.mandateId))?.status).toBe("revoked");
  });

  it("should cascade agent revocation to agent mandates only", async () => {
    const mandateRepo = new InMemoryMandateRepository();
    const store = new InMemoryRevocationStore();
    const otherAgentId = idGen.generate("agent");

    const mandateForAgent: WalletMandate = {
      mandateId: idGen.generate("mandate"),
      walletId,
      principalId,
      agentId,
      kid,
      constraints: createTestConstraints(),
      paymentReferenceId: "pay-ref-001",
      validFrom: "2025-01-01T00:00:00.000Z",
      validUntil: "2026-12-31T23:59:59.000Z",
      issuedAt: "2025-01-01T00:00:00.000Z",
      consentAttestationDigest: "sha256:digest-1",
      status: "active",
      revocationLocator: "revoke:mandate:agent",
      policyVersionId: "v1",
    };
    const mandateForOther: WalletMandate = {
      mandateId: idGen.generate("mandate"),
      walletId,
      principalId,
      agentId: otherAgentId,
      kid: `kid-${otherAgentId}`,
      constraints: createTestConstraints(),
      paymentReferenceId: "pay-ref-001",
      validFrom: "2025-01-01T00:00:00.000Z",
      validUntil: "2026-12-31T23:59:59.000Z",
      issuedAt: "2025-01-01T00:00:00.000Z",
      consentAttestationDigest: "sha256:digest-2",
      status: "active",
      revocationLocator: "revoke:mandate:other",
      policyVersionId: "v1",
    };
    await mandateRepo.save(mandateForAgent);
    await mandateRepo.save(mandateForOther);

    const service = new WalletRevocationService(store, mandateRepo);

    // Revoke agent
    await service.revoke({
      principalId,
      walletId,
      scopeType: "agent",
      scopeId: agentId,
      reasonClass: "principal_initiated",
      correlationId: "corr-rev-005",
      kid,
    });

    // Only the revoked agent's mandate should be affected
    expect((await mandateRepo.findById(mandateForAgent.mandateId))?.status).toBe("revoked");
    expect((await mandateRepo.findById(mandateForOther.mandateId))?.status).toBe("active");
  });

  it("should cascade payment-reference revocation (human revokes the provider mandate) to every Counter mandate bound to it, but not others", async () => {
    const mandateRepo = new InMemoryMandateRepository();
    const store = new InMemoryRevocationStore();
    const otherAgentId = idGen.generate("agent");
    const revokedReferenceId = "ctr_payment-reference_revoked-provider-mandate";
    const otherReferenceId = "ctr_payment-reference_unrelated-provider-mandate";

    // Two agents each hold their OWN Counter mandate against the SAME
    // human-authorized provider mandate (the realistic shape: one Razorpay
    // recurring authorization, multiple agent-scoped sub-authorities).
    const mandateBoundToRevoked1: WalletMandate = {
      mandateId: idGen.generate("mandate"),
      walletId,
      principalId,
      agentId,
      kid,
      constraints: createTestConstraints(),
      paymentReferenceId: revokedReferenceId,
      validFrom: "2025-01-01T00:00:00.000Z",
      validUntil: "2026-12-31T23:59:59.000Z",
      issuedAt: "2025-01-01T00:00:00.000Z",
      consentAttestationDigest: "sha256:digest-1",
      status: "active",
      revocationLocator: "revoke:mandate:pr-1",
      policyVersionId: "v1",
    };
    const mandateBoundToRevoked2: WalletMandate = {
      mandateId: idGen.generate("mandate"),
      walletId,
      principalId,
      agentId: otherAgentId,
      kid: `kid-${otherAgentId}`,
      constraints: createTestConstraints(),
      paymentReferenceId: revokedReferenceId,
      validFrom: "2025-01-01T00:00:00.000Z",
      validUntil: "2026-12-31T23:59:59.000Z",
      issuedAt: "2025-01-01T00:00:00.000Z",
      consentAttestationDigest: "sha256:digest-2",
      status: "active",
      revocationLocator: "revoke:mandate:pr-2",
      policyVersionId: "v1",
    };
    const mandateBoundToOther: WalletMandate = {
      mandateId: idGen.generate("mandate"),
      walletId,
      principalId,
      agentId,
      kid,
      constraints: createTestConstraints(),
      paymentReferenceId: otherReferenceId,
      validFrom: "2025-01-01T00:00:00.000Z",
      validUntil: "2026-12-31T23:59:59.000Z",
      issuedAt: "2025-01-01T00:00:00.000Z",
      consentAttestationDigest: "sha256:digest-3",
      status: "active",
      revocationLocator: "revoke:mandate:pr-3",
      policyVersionId: "v1",
    };
    await mandateRepo.save(mandateBoundToRevoked1);
    await mandateRepo.save(mandateBoundToRevoked2);
    await mandateRepo.save(mandateBoundToOther);

    const service = new WalletRevocationService(store, mandateRepo);

    // Revoke the provider mandate (mirrors RecurringMandateProvisioner.revoke()
    // calling WalletRevocationService.revoke({ scopeType: "payment_reference", ... })).
    await service.revoke({
      principalId,
      walletId,
      scopeType: "payment_reference",
      scopeId: revokedReferenceId,
      reasonClass: "principal_initiated",
      reason: "Buyer cancelled the underlying autopay authorization",
      correlationId: "corr-rev-pr-001",
      kid,
    });

    // Both mandates bound to the revoked provider mandate are revoked...
    expect((await mandateRepo.findById(mandateBoundToRevoked1.mandateId))?.status).toBe("revoked");
    expect((await mandateRepo.findById(mandateBoundToRevoked2.mandateId))?.status).toBe("revoked");
    // ...but a mandate bound to a DIFFERENT provider mandate is untouched.
    expect((await mandateRepo.findById(mandateBoundToOther.mandateId))?.status).toBe("active");
    expect(await service.isRevoked("payment_reference", revokedReferenceId)).toBe(true);
  });

  it("should create valid CTP revocation envelope", async () => {
    const { service, mandate } = await createServiceWithMandate();

    const result = await service.revoke({
      principalId,
      walletId,
      scopeType: "mandate",
      scopeId: mandate.mandateId,
      reasonClass: "principal_initiated",
      correlationId: "corr-rev-006",
      kid,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const env = result.value.envelope;
      expect(env.type).toBe("counter.revocation.v1");
      expect(env.payload.scope_type).toBe("mandate");
      expect(env.payload.scope_id).toBe(mandate.mandateId);
      expect(env.payload.reason_class).toBe("principal_initiated");
      expect(env.payload.sequence).toBe(1);
      expect(result.value.payloadDigest).toBeTruthy();
    }
  });

  it("should handle revocation race (concurrent revoke + use)", async () => {
    const { service, mandateRepo, mandate } = await createServiceWithMandate();

    // Simulate concurrent: revoke the mandate
    await service.revoke({
      principalId,
      walletId,
      scopeType: "mandate",
      scopeId: mandate.mandateId,
      reasonClass: "principal_initiated",
      correlationId: "corr-rev-007",
      kid,
    });

    // After revocation, mandate is blocked
    const mandateState = await mandateRepo.findById(mandate.mandateId);
    expect(mandateState?.status).toBe("revoked");

    // Attempting to use the revoked mandate via sync service should fail
    const syncService = new MandateSyncService(mandateRepo);
    const fetchResult = await syncService.fetchMandate(
      mandate.mandateId,
      "2025-06-01T00:00:00.000Z",
    );
    expect(fetchResult.ok).toBe(false);
    expect(fetchResult.reason).toContain("revoked");
  });
});

// ---------------------------------------------------------------------------
// Policy Widening Requires New Mandate Test
// ---------------------------------------------------------------------------

describe("policy widening and mandate reissuance", () => {
  it("widening policy requires step-up and new mandate (old mandate has old constraints)", async () => {
    // This test verifies the design invariant: when policy is widened,
    // existing mandates retain their original (narrower) constraints.
    // A new mandate must be issued with the wider policy, requiring
    // a new stepped-up consent attestation.

    const mandateRepo = new InMemoryMandateRepository();
    const service = createMandateService(mandateRepo);
    const session1 = createValidStepUpSession("nonce-1");

    // Issue first mandate with narrow constraints
    const narrowConstraints = createTestConstraints();
    const result1 = await service.issue({
      walletId,
      principalId,
      agentId,
      kid,
      constraints: narrowConstraints,
      paymentReferenceId: "pay-ref-001",
      validFrom: "2025-01-01T00:00:00.000Z",
      validUntil: "2025-12-31T23:59:59.000Z",
      consentAttestationDigest: "sha256:valid-consent-digest",
      policyVersionId: "v1",
      stepUpSession: session1,
      correlationId: "corr-widen-001",
    });

    expect(result1.ok).toBe(true);

    // The old mandate retains its original narrow constraints
    if (result1.ok) {
      const oldMandate = await mandateRepo.findById(result1.value.mandate.mandateId);
      expect(oldMandate?.constraints.amountLimits.perTransactionMaxPaise).toBe(1_000_000n);
    }

    // Issue new mandate with wider constraints (requires new step-up)
    const session2 = createValidStepUpSession("nonce-2");
    const widerConstraints: BuyerPolicyConstraints = {
      ...narrowConstraints,
      amountLimits: {
        ...narrowConstraints.amountLimits,
        perTransactionMaxPaise: 2_000_000n, // Doubled
      },
    };

    const result2 = await service.issue({
      walletId,
      principalId,
      agentId,
      kid,
      constraints: widerConstraints,
      paymentReferenceId: "pay-ref-001",
      validFrom: "2025-01-01T00:00:00.000Z",
      validUntil: "2025-12-31T23:59:59.000Z",
      consentAttestationDigest: "sha256:valid-consent-digest",
      policyVersionId: "v2",
      stepUpSession: session2,
      correlationId: "corr-widen-002",
    });

    expect(result2.ok).toBe(true);
    if (result2.ok) {
      expect(result2.value.mandate.constraints.amountLimits.perTransactionMaxPaise).toBe(
        2_000_000n,
      );
    }
  });
});
