import { describe, expect, it } from "vitest";
import type { CounterId } from "@counter/domain";
import type { BuyerPolicyConstraints } from "@counter/wallet-domain";
import { InMemoryMandateRepository } from "@counter/wallet-domain";
import {
  MandateService,
  buildMandateEnvelope,
  type MandateEnvelopeParams,
} from "./mandate-service.js";
import type { AgentRegistration } from "./agent-registration.js";
import type { StepUpSession } from "./step-up-service.js";

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

const WALLET_ID = "ctr_wallet_AAAAAAAAAAAAAAAAAAAAAA" as CounterId<"wallet">;
const PRINCIPAL_ID = "ctr_actor_AAAAAAAAAAAAAAAAAAAAAA" as CounterId<"actor">;
const AGENT_ID = "ctr_agent_AAAAAAAAAAAAAAAAAAAAAAA" as CounterId<"agent">;
const KID = "test-key-a-001";

function createTestConstraints(
  overrides?: Partial<BuyerPolicyConstraints>,
): BuyerPolicyConstraints {
  return {
    merchantAllowlist: { allowedMerchantIds: ["merchant-001"], allowedDomains: [] },
    geography: { allowedMerchantCountries: ["IN"], allowedDeliveryCountries: ["IN"] },
    category: { allowedCategories: [] },
    currency: { allowedCurrencies: ["INR"] },
    amountLimits: { perTransactionMaxPaise: 100_000n },
    countLimits: {},
    operations: { allowedOperations: ["purchase"] },
    timeConstraints: {},
    approvalThreshold: { thresholdPaise: 50_000n },
    paymentReferences: { allowedReferenceIds: ["ref-001"] },
    ...overrides,
  };
}

function baseEnvelopeParams(overrides?: Partial<MandateEnvelopeParams>): MandateEnvelopeParams {
  return {
    walletId: WALLET_ID,
    principalId: PRINCIPAL_ID,
    agentId: AGENT_ID,
    kid: KID,
    constraints: createTestConstraints(),
    paymentReferenceId: "ref-001",
    validFrom: "2025-06-01T00:00:00.000Z",
    validUntil: "2026-06-01T00:00:00.000Z",
    consentAttestationDigest: "sha256:consent-digest",
    policyVersionId: "policy-v1",
    correlationId: "corr-001",
    mandateId: "ctr_mandate_AAAAAAAAAAAAAAAAAAAA",
    issuedAt: "2025-06-01T00:00:00.000Z",
    ...overrides,
  };
}

function activeAgent(overrides?: Partial<AgentRegistration>): AgentRegistration {
  return {
    agentId: AGENT_ID,
    walletId: WALLET_ID,
    publicKeyDescriptor: {
      kid: KID,
      publicKey: new Uint8Array(32),
      algorithm: "Ed25519",
      status: "active",
    },
    registeredAt: "2025-01-01T00:00:00.000Z",
    deviceId: "ctr_device_AAAAAAAAAAAAAAAAAAAAA" as CounterId<"device">,
    status: "active",
    registrationCertificateDigest: "sha256:cert-digest",
    ...overrides,
  };
}

function freshStepUpSession(overrides?: Partial<StepUpSession>): StepUpSession {
  const now = Date.now();
  return {
    principal_id: PRINCIPAL_ID,
    method: "webauthn",
    assurance: "substantial",
    authenticated_at: new Date(now - 1000).toISOString(),
    expires_at: new Date(now + 300_000).toISOString(),
    nonce: `nonce-${Math.random()}`,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildMandateEnvelope (pure)
// ---------------------------------------------------------------------------

describe("buildMandateEnvelope", () => {
  it("builds a valid unsigned envelope from buyer constraints", () => {
    const result = buildMandateEnvelope(baseEnvelopeParams());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.mandateId).toBe("ctr_mandate_AAAAAAAAAAAAAAAAAAAA");
      expect(result.value.envelope.type).toBe("counter.mandate.v1");
      expect(result.value.envelope.payload.wallet_id).toBe(WALLET_ID);
      expect(result.value.envelope.payload.agent_id).toBe(AGENT_ID);
      expect(result.value.envelope.payload.principal_id).toBe(PRINCIPAL_ID);
      expect(result.value.envelope.payload.kid).toBe(KID);
      expect(result.value.envelope.payload.payment_authorization_ref).toBe("ref-001");
      expect(result.value.envelope.payload.per_transaction_limit).toEqual({
        amount: 100_000,
        currency: "INR",
      });
      expect(result.value.payloadDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(result.value.revocationLocator).toBe(
        "revoke:mandate:ctr_mandate_AAAAAAAAAAAAAAAAAAAA",
      );
    }
  });

  it("is deterministic given the same injected mandateId/issuedAt", () => {
    const a = buildMandateEnvelope(baseEnvelopeParams());
    const b = buildMandateEnvelope(baseEnvelopeParams());
    expect(a).toEqual(b);
  });

  it("generates its own mandateId when none is injected", () => {
    const { mandateId: _unused, ...withoutMandateId } = baseEnvelopeParams();
    const result = buildMandateEnvelope(withoutMandateId);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.mandateId).toMatch(/^ctr_mandate_/);
    }
  });

  it("fails when the payload would be structurally invalid (e.g. empty correlationId)", () => {
    const result = buildMandateEnvelope(baseEnvelopeParams({ correlationId: "" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("mandate_envelope_error");
    }
  });
});

// ---------------------------------------------------------------------------
// MandateService.issue (repository-backed orchestrator)
// ---------------------------------------------------------------------------

describe("MandateService.issue", () => {
  function buildService(agent: AgentRegistration | null) {
    const mandateRepo = new InMemoryMandateRepository();
    const agentLookup = (agentId: CounterId<"agent">) =>
      agent !== null && agentId === agent.agentId ? agent : undefined;
    const consentDigestValidator = (digest: string) => digest === "sha256:consent-digest";
    const service = new MandateService(mandateRepo, agentLookup, consentDigestValidator);
    return { service, mandateRepo };
  }

  it("issues and persists a mandate from a fresh step-up session", async () => {
    const { service, mandateRepo } = buildService(activeAgent());

    const result = await service.issue({
      walletId: WALLET_ID,
      principalId: PRINCIPAL_ID,
      agentId: AGENT_ID,
      kid: KID,
      constraints: createTestConstraints(),
      paymentReferenceId: "ref-001",
      validFrom: "2025-06-01T00:00:00.000Z",
      validUntil: "2026-06-01T00:00:00.000Z",
      consentAttestationDigest: "sha256:consent-digest",
      policyVersionId: "policy-v1",
      stepUpSession: freshStepUpSession(),
      correlationId: "corr-001",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.mandate.walletId).toBe(WALLET_ID);
      expect(result.value.mandate.agentId).toBe(AGENT_ID);
      expect(result.value.mandate.status).toBe("active");
      expect(result.value.envelope.payload.agent_id).toBe(AGENT_ID);
      const persisted = await mandateRepo.findById(result.value.mandate.mandateId);
      expect(persisted).toEqual(result.value.mandate);
    }
  });

  it("rejects an expired step-up session", async () => {
    const { service } = buildService(activeAgent());
    const result = await service.issue({
      walletId: WALLET_ID,
      principalId: PRINCIPAL_ID,
      agentId: AGENT_ID,
      kid: KID,
      constraints: createTestConstraints(),
      paymentReferenceId: "ref-001",
      validFrom: "2025-06-01T00:00:00.000Z",
      validUntil: "2026-06-01T00:00:00.000Z",
      consentAttestationDigest: "sha256:consent-digest",
      policyVersionId: "policy-v1",
      stepUpSession: freshStepUpSession({
        authenticated_at: new Date(Date.now() - 10_000).toISOString(),
        expires_at: new Date(Date.now() - 5_000).toISOString(),
      }),
      correlationId: "corr-001",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toMatch(/Step-up validation failed/);
  });

  it("rejects an unregistered agent", async () => {
    const { service } = buildService(null);
    const result = await service.issue({
      walletId: WALLET_ID,
      principalId: PRINCIPAL_ID,
      agentId: AGENT_ID,
      kid: KID,
      constraints: createTestConstraints(),
      paymentReferenceId: "ref-001",
      validFrom: "2025-06-01T00:00:00.000Z",
      validUntil: "2026-06-01T00:00:00.000Z",
      consentAttestationDigest: "sha256:consent-digest",
      policyVersionId: "policy-v1",
      stepUpSession: freshStepUpSession(),
      correlationId: "corr-001",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe("Agent is not registered");
  });

  it("rejects a kid that does not match the agent's registered key", async () => {
    const { service } = buildService(activeAgent());
    const result = await service.issue({
      walletId: WALLET_ID,
      principalId: PRINCIPAL_ID,
      agentId: AGENT_ID,
      kid: "some-other-kid",
      constraints: createTestConstraints(),
      paymentReferenceId: "ref-001",
      validFrom: "2025-06-01T00:00:00.000Z",
      validUntil: "2026-06-01T00:00:00.000Z",
      consentAttestationDigest: "sha256:consent-digest",
      policyVersionId: "policy-v1",
      stepUpSession: freshStepUpSession(),
      correlationId: "corr-001",
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.reason).toBe("Key ID does not match the agent's registered key");
  });

  it("rejects an invalid/revoked consent attestation digest", async () => {
    const { service } = buildService(activeAgent());
    const result = await service.issue({
      walletId: WALLET_ID,
      principalId: PRINCIPAL_ID,
      agentId: AGENT_ID,
      kid: KID,
      constraints: createTestConstraints(),
      paymentReferenceId: "ref-001",
      validFrom: "2025-06-01T00:00:00.000Z",
      validUntil: "2026-06-01T00:00:00.000Z",
      consentAttestationDigest: "sha256:wrong-digest",
      policyVersionId: "policy-v1",
      stepUpSession: freshStepUpSession(),
      correlationId: "corr-001",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("Consent attestation digest is invalid or has been revoked");
    }
  });

  it("rejects an invalid validity window (validFrom >= validUntil)", async () => {
    const { service } = buildService(activeAgent());
    const result = await service.issue({
      walletId: WALLET_ID,
      principalId: PRINCIPAL_ID,
      agentId: AGENT_ID,
      kid: KID,
      constraints: createTestConstraints(),
      paymentReferenceId: "ref-001",
      validFrom: "2026-06-01T00:00:00.000Z",
      validUntil: "2025-06-01T00:00:00.000Z",
      consentAttestationDigest: "sha256:consent-digest",
      policyVersionId: "policy-v1",
      stepUpSession: freshStepUpSession(),
      correlationId: "corr-001",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe(
        "Mandate validity window is invalid (validFrom must be before validUntil)",
      );
    }
  });
});
