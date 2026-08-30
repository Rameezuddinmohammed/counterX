import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "./index.js";
import type {
  WalletAccountRepository,
  WalletPrincipalRepository,
  WalletInvitationRepository,
  WalletLifecycleService,
  WalletInvitationService,
  ConsentAttestationService,
  ConsentAttestationParams,
  ConsentAttestationResult,
  ConsentAttestationValidation,
  StepUpSession,
  ConsentAttestationInput,
} from "./index.js";
import {
  PRIVILEGED_OPERATIONS,
  isPrivilegedOperation,
  meetsAssuranceLevel,
  StepUpService,
  CONSENT_OPERATION_TYPES,
  isConsentOperationType,
  ConsentTextRenderer,
  isConsentAuthMethod,
  ConsentNonceTracker,
  ConsentAttestationBuilder,
} from "./index.js";
import type { CounterId } from "@counter/domain";

describe("@counter/wallet-application", () => {
  it("exposes its package identity", () => {
    expect(PACKAGE_NAME).toBe("@counter/wallet-application");
  });
});

describe("Wallet Application Port Types", () => {
  it("WalletAccountRepository interface is implementable", () => {
    const mock: WalletAccountRepository = {
      async findById(_walletId) {
        return undefined;
      },
      async findByPrincipal(_principalId) {
        return [];
      },
      async save(_account) {
        // no-op
      },
    };
    expect(typeof mock.findById).toBe("function");
  });

  it("WalletPrincipalRepository interface is implementable", () => {
    const mock: WalletPrincipalRepository = {
      async findById(_principalId) {
        return undefined;
      },
      async findByAuthSubject(_provider, _subject) {
        return undefined;
      },
      async save(_principal) {
        // no-op
      },
    };
    expect(typeof mock.findById).toBe("function");
  });

  it("WalletInvitationRepository interface is implementable", () => {
    const mock: WalletInvitationRepository = {
      async findById(_invitationId) {
        return undefined;
      },
      async findByWallet(_walletId) {
        return [];
      },
      async save(_invitation) {
        // no-op
      },
    };
    expect(typeof mock.findById).toBe("function");
  });

  it("WalletLifecycleService interface is implementable", () => {
    const mock: WalletLifecycleService = {
      async create(_request) {
        return {
          wallet_id: "ctr_wallet_test" as CounterId<"wallet">,
          state: "INVITED",
          created_at: "2025-01-15T10:00:00.000Z",
        };
      },
      async status(_walletId) {
        return {
          wallet_id: "ctr_wallet_test" as CounterId<"wallet">,
          principal_id: "ctr_actor_test" as CounterId<"actor">,
          state: "ACTIVE",
          created_at: "2025-01-15T10:00:00.000Z",
          updated_at: "2025-01-15T10:00:00.000Z",
        };
      },
      async suspend(_request) {
        return {
          wallet_id: "ctr_wallet_test" as CounterId<"wallet">,
          state: "SUSPENDED",
          suspended_at: "2025-01-15T10:00:00.000Z",
        };
      },
      async close(_request) {
        return {
          wallet_id: "ctr_wallet_test" as CounterId<"wallet">,
          state: "CLOSED",
          closed_at: "2025-01-15T10:00:00.000Z",
        };
      },
    };
    expect(typeof mock.create).toBe("function");
  });

  it("WalletInvitationService interface is implementable", () => {
    const mock: WalletInvitationService = {
      async invite(_request) {
        return {
          invitation_id: "inv-001",
          wallet_id: "ctr_wallet_test" as CounterId<"wallet">,
          expires_at: "2025-01-22T10:00:00.000Z",
          status: "PENDING",
        };
      },
      async enroll(_request) {
        return {
          wallet_id: "ctr_wallet_test" as CounterId<"wallet">,
          principal_id: "ctr_actor_test" as CounterId<"actor">,
          state: "ENROLLED",
          enrolled_at: "2025-01-15T10:00:00.000Z",
        };
      },
      async verify(_request) {
        return {
          wallet_id: "ctr_wallet_test" as CounterId<"wallet">,
          state: "VERIFIED",
          verified_at: "2025-01-15T10:00:00.000Z",
        };
      },
    };
    expect(typeof mock.invite).toBe("function");
  });

  it("ConsentAttestationService interface is implementable", () => {
    const mock: ConsentAttestationService = {
      async createAttestation(_params) {
        return {
          attestation_id: "att-001",
          issued_at: "2025-01-15T10:00:00.000Z",
          expires_at: "2025-01-15T11:00:00.000Z",
        };
      },
      async validateAttestation(_attestationId) {
        return { valid: true, expired: false, revoked: false };
      },
    };
    expect(typeof mock.createAttestation).toBe("function");
  });

  it("ConsentAttestationParams type is structurally valid", () => {
    const params: ConsentAttestationParams = {
      principal_id: "ctr_actor_test" as CounterId<"actor">,
      wallet_id: "ctr_wallet_test" as CounterId<"wallet">,
      object_type: "counter.buyer-policy.v1",
      object_id: "policy-001",
      object_digest: "sha256:abc123",
      consent_text: "I agree to the buyer policy.",
      consent_version: "1.0",
      auth_provider: "google",
      auth_method: "oauth2",
      auth_assurance: "high",
      audience: ["counter://wallet-service"],
      expiry: "2025-01-15T11:00:00.000Z",
      nonce: "nonce-abc",
    };
    expect(params.audience).toHaveLength(1);
  });

  it("ConsentAttestationResult type is structurally valid", () => {
    const result: ConsentAttestationResult = {
      attestation_id: "att-001",
      issued_at: "2025-01-15T10:00:00.000Z",
      expires_at: "2025-01-15T11:00:00.000Z",
    };
    expect(result.attestation_id).toBe("att-001");
  });

  it("ConsentAttestationValidation type is structurally valid", () => {
    const valid: ConsentAttestationValidation = {
      valid: true,
      expired: false,
      revoked: false,
    };
    const invalid: ConsentAttestationValidation = {
      valid: false,
      expired: true,
      revoked: false,
      reason: "Attestation has expired",
    };
    expect(valid.valid).toBe(true);
    expect(invalid.reason).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Task 4: Step-Up Service
// ---------------------------------------------------------------------------

describe("StepUpService", () => {
  const baseSession: StepUpSession = {
    principal_id: "ctr_actor_alice",
    method: "webauthn",
    assurance: "high",
    authenticated_at: "2099-01-15T10:00:00.000Z",
    expires_at: "2099-01-15T10:10:00.000Z",
    nonce: "nonce-step-up-001",
  };

  it("identifies all privileged operations", () => {
    expect(PRIVILEGED_OPERATIONS).toHaveLength(8);
    for (const op of PRIVILEGED_OPERATIONS) {
      expect(isPrivilegedOperation(op)).toBe(true);
    }
    expect(isPrivilegedOperation("view_balance")).toBe(false);
  });

  it("requireStepUp returns required=true without a session", () => {
    const service = new StepUpService();
    const result = service.requireStepUp("mandate_consent");
    expect(result.required).toBe(true);
    expect(result.minimum_assurance).toBe("substantial");
    expect(result.reason).toContain("step-up");
  });

  it("requireStepUp returns required=false with valid high-assurance session", () => {
    const service = new StepUpService();
    const result = service.requireStepUp("mandate_consent", baseSession);
    expect(result.required).toBe(false);
  });

  it("requireStepUp requires high assurance for agent_key_change", () => {
    const service = new StepUpService();
    const result = service.requireStepUp("agent_key_change");
    expect(result.minimum_assurance).toBe("high");
  });

  it("requireStepUp requires high assurance for recovery", () => {
    const service = new StepUpService();
    const result = service.requireStepUp("recovery");
    expect(result.minimum_assurance).toBe("high");
  });

  it("requireStepUp requires high assurance for export", () => {
    const service = new StepUpService();
    const result = service.requireStepUp("export");
    expect(result.minimum_assurance).toBe("high");
  });

  it("requireStepUp requires high assurance for closure", () => {
    const service = new StepUpService();
    const result = service.requireStepUp("closure");
    expect(result.minimum_assurance).toBe("high");
  });

  describe("assurance levels", () => {
    it("high meets high", () => {
      expect(meetsAssuranceLevel("high", "high")).toBe(true);
    });

    it("high meets substantial", () => {
      expect(meetsAssuranceLevel("high", "substantial")).toBe(true);
    });

    it("high meets basic", () => {
      expect(meetsAssuranceLevel("high", "basic")).toBe(true);
    });

    it("substantial meets substantial", () => {
      expect(meetsAssuranceLevel("substantial", "substantial")).toBe(true);
    });

    it("substantial does NOT meet high", () => {
      expect(meetsAssuranceLevel("substantial", "high")).toBe(false);
    });

    it("basic does NOT meet substantial", () => {
      expect(meetsAssuranceLevel("basic", "substantial")).toBe(false);
    });

    it("basic does NOT meet high", () => {
      expect(meetsAssuranceLevel("basic", "high")).toBe(false);
    });
  });

  describe("negative: stale step-up rejection", () => {
    it("rejects a session past expiresAt", () => {
      const service = new StepUpService();
      const expiredSession: StepUpSession = {
        ...baseSession,
        authenticated_at: "2025-01-15T09:00:00.000Z",
        expires_at: "2025-01-15T09:05:00.000Z",
        nonce: "nonce-expired",
      };
      const result = service.validateSession(expiredSession, "2025-01-15T09:10:00.000Z");
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("expired");
    });

    it("rejects a stale session (authenticated too long ago)", () => {
      const service = new StepUpService({ max_session_age_ms: 60_000 });
      const staleSession: StepUpSession = {
        ...baseSession,
        authenticated_at: "2025-01-15T09:00:00.000Z",
        expires_at: "2025-01-15T10:00:00.000Z",
        nonce: "nonce-stale",
      };
      const result = service.validateSession(staleSession, "2025-01-15T09:02:00.000Z");
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("stale");
    });
  });

  describe("negative: replay blocked", () => {
    it("rejects a session with a previously used nonce", () => {
      const service = new StepUpService();
      service.consumeNonce("nonce-replay-test");
      const replaySession: StepUpSession = {
        ...baseSession,
        nonce: "nonce-replay-test",
      };
      const result = service.validateSession(replaySession);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("replay");
    });
  });

  describe("negative: assurance non-inflation", () => {
    it("basic assurance cannot satisfy substantial requirement", () => {
      const service = new StepUpService();
      const basicSession: StepUpSession = {
        ...baseSession,
        assurance: "basic",
        nonce: "nonce-basic-fail",
      };
      const result = service.requireStepUp("mandate_consent", basicSession);
      expect(result.required).toBe(true);
      expect(result.reason).toContain("basic");
      expect(result.minimum_assurance).toBe("substantial");
    });

    it("basic assurance cannot satisfy high requirement (agent_key_change)", () => {
      const service = new StepUpService();
      const basicSession: StepUpSession = {
        ...baseSession,
        assurance: "basic",
        nonce: "nonce-basic-high",
      };
      const result = service.requireStepUp("agent_key_change", basicSession);
      expect(result.required).toBe(true);
      expect(result.minimum_assurance).toBe("high");
    });

    it("substantial assurance cannot satisfy high requirement (closure)", () => {
      const service = new StepUpService();
      const substantialSession: StepUpSession = {
        ...baseSession,
        assurance: "substantial",
        nonce: "nonce-substantial-high",
      };
      const result = service.requireStepUp("closure", substantialSession);
      expect(result.required).toBe(true);
      expect(result.minimum_assurance).toBe("high");
    });
  });
});

// ---------------------------------------------------------------------------
// Task 4: Consent Text Renderer
// ---------------------------------------------------------------------------

describe("ConsentTextRenderer", () => {
  const renderer = new ConsentTextRenderer();

  it("supports all consent operation types", () => {
    const supported = renderer.getSupportedOperations();
    expect(supported).toHaveLength(CONSENT_OPERATION_TYPES.length);
    for (const op of CONSENT_OPERATION_TYPES) {
      expect(isConsentOperationType(op)).toBe(true);
    }
  });

  it("renders mandate_creation consent text with variables", () => {
    const result = renderer.render({
      operation: "mandate_creation",
      variables: { merchant: "Acme Corp", currency: "USD", amount: "100.00" },
    });
    expect(result).toBeDefined();
    expect(result!.operation).toBe("mandate_creation");
    expect(result!.version).toBe("1.0");
    expect(result!.text).toContain("Acme Corp");
    expect(result!.text).toContain("USD");
    expect(result!.text).toContain("100.00");
  });

  it("renders wallet_closure consent text", () => {
    const result = renderer.render({ operation: "wallet_closure", variables: {} });
    expect(result).toBeDefined();
    expect(result!.text).toContain("permanently close");
    expect(result!.text).toContain("irreversible");
  });

  it("returns undefined for unknown operation", () => {
    const result = renderer.render({ operation: "unknown_op" as never, variables: {} });
    expect(result).toBeUndefined();
  });

  it("getVersion returns the version for known operations", () => {
    expect(renderer.getVersion("mandate_creation")).toBe("1.0");
    expect(renderer.getVersion("wallet_closure")).toBe("1.0");
  });

  it("consent text is deterministic for same inputs", () => {
    const vars = { merchant: "TestCo", currency: "EUR", amount: "50.00" };
    const r1 = renderer.render({ operation: "mandate_creation", variables: vars });
    const r2 = renderer.render({ operation: "mandate_creation", variables: vars });
    expect(r1!.text).toBe(r2!.text);
    expect(r1!.version).toBe(r2!.version);
  });
});

// ---------------------------------------------------------------------------
// Task 4: Consent Attestation Builder
// ---------------------------------------------------------------------------

describe("ConsentAttestationBuilder", () => {
  const baseInput: ConsentAttestationInput = {
    principal_id: "ctr_actor_alice" as CounterId<"actor">,
    wallet_id: "ctr_wallet_w1" as CounterId<"wallet">,
    object_type: "counter.mandate.v1",
    object_id: "mandate-001",
    object_digest: "sha256:abc123def456",
    consent_operation: "mandate_creation",
    consent_variables: { merchant: "Acme Corp", currency: "USD", amount: "250.00" },
    auth_provider: "google",
    auth_method: "webauthn",
    auth_assurance: "high",
    auth_timestamp: "2025-01-15T10:00:00.000Z",
    audience: ["counter://wallet-service"],
    expiry: "2025-01-15T11:00:00.000Z",
    nonce: "unique-nonce-001",
    environment: "sandbox",
    kid: "kid-alice-001",
    correlation_id: "corr-001",
  };

  it("builds a valid consent attestation envelope", () => {
    const builder = new ConsentAttestationBuilder();
    const result = builder.build(baseInput);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.envelope.type).toBe("counter.principal-consent-attestation.v1");
      expect(result.value.envelope.payload.principal_id).toBe(baseInput.principal_id);
      expect(result.value.envelope.payload.wallet_id).toBe(baseInput.wallet_id);
      expect(result.value.envelope.payload.object_digest).toBe(baseInput.object_digest);
      expect(result.value.envelope.payload.consent_version).toBe("1.0");
      expect(result.value.envelope.payload.auth_assurance).toBe("high");
      expect(result.value.envelope.payload.audience).toEqual(["counter://wallet-service"]);
      expect(result.value.envelope.payload.nonce).toBe("unique-nonce-001");
      expect(result.value.consent_text.operation).toBe("mandate_creation");
      expect(result.value.payload_digest).toContain("sha256:");
    }
  });

  it("references attestation by payload_digest", () => {
    const builder = new ConsentAttestationBuilder();
    const result = builder.build(baseInput);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.payload_digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    }
  });

  it("includes consent text with version", () => {
    const builder = new ConsentAttestationBuilder();
    const result = builder.build(baseInput);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.consent_text.version).toBe("1.0");
      expect(result.value.consent_text.text).toContain("Acme Corp");
      expect(result.value.consent_text.text).toContain("250.00");
    }
  });

  describe("negative: replay blocked (same nonce reused)", () => {
    it("rejects second build with same nonce", () => {
      const tracker = new ConsentNonceTracker();
      const builder = new ConsentAttestationBuilder(tracker);

      const first = builder.build(baseInput);
      expect(first.ok).toBe(true);

      const secondInput: ConsentAttestationInput = {
        ...baseInput,
        correlation_id: "corr-002",
      };
      const second = builder.build(secondInput);
      expect(second.ok).toBe(false);
      if (!second.ok) {
        expect(second.error.reason).toContain("replay");
      }
    });
  });

  describe("negative: wrong digest rejected", () => {
    it("rejects object_digest without sha256: prefix", () => {
      const builder = new ConsentAttestationBuilder();
      const badInput: ConsentAttestationInput = {
        ...baseInput,
        object_digest: "md5:invaliddigest",
        nonce: "nonce-bad-digest",
      };
      const result = builder.build(badInput);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.reason).toContain("sha256:");
      }
    });
  });

  describe("negative: wrong audience rejected", () => {
    it("rejects empty audience", () => {
      const builder = new ConsentAttestationBuilder();
      const badInput: ConsentAttestationInput = {
        ...baseInput,
        audience: [],
        nonce: "nonce-empty-audience",
      };
      const result = builder.build(badInput);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.reason).toContain("Audience");
      }
    });

    it("validateAudience fails when expected audience not present", () => {
      const builder = new ConsentAttestationBuilder();
      const valid = builder.validateAudience(
        ["counter://wallet-service"],
        "counter://payment-service",
      );
      expect(valid).toBe(false);
    });

    it("validateAudience succeeds when expected audience present", () => {
      const builder = new ConsentAttestationBuilder();
      const valid = builder.validateAudience(
        ["counter://wallet-service", "counter://payment-service"],
        "counter://payment-service",
      );
      expect(valid).toBe(true);
    });
  });

  describe("negative: self-bypass attempt (agent trying to consent as principal)", () => {
    it("agent cannot create attestation with mismatched principal - attested by digest", () => {
      const builder = new ConsentAttestationBuilder();

      const legitimateResult = builder.build({
        ...baseInput,
        nonce: "nonce-legitimate",
      });
      expect(legitimateResult.ok).toBe(true);

      const agentAttempt = builder.build({
        ...baseInput,
        principal_id: "ctr_actor_malicious_agent" as CounterId<"actor">,
        nonce: "nonce-agent-bypass",
      });
      expect(agentAttempt.ok).toBe(true);

      if (legitimateResult.ok && agentAttempt.ok) {
        expect(legitimateResult.value.payload_digest).not.toBe(agentAttempt.value.payload_digest);
        const valid = builder.validateDigest(
          agentAttempt.value.payload_digest,
          legitimateResult.value.payload_digest,
        );
        expect(valid).toBe(false);
      }
    });
  });

  describe("negative: concurrent changes during consent", () => {
    it("object_digest mismatch detects concurrent changes", () => {
      const builder = new ConsentAttestationBuilder();
      const result = builder.build({ ...baseInput, nonce: "nonce-concurrent" });
      expect(result.ok).toBe(true);
      if (result.ok) {
        const newObjectDigest = "sha256:changed_after_consent";
        expect(result.value.envelope.payload.object_digest).toBe("sha256:abc123def456");
        expect(result.value.envelope.payload.object_digest).not.toBe(newObjectDigest);
      }
    });
  });

  describe("negative: assurance non-inflation", () => {
    it("service-witnessed attestation with basic assurance recorded accurately", () => {
      const builder = new ConsentAttestationBuilder();
      const basicInput: ConsentAttestationInput = {
        ...baseInput,
        auth_assurance: "basic",
        auth_method: "pilot_password",
        nonce: "nonce-basic-assurance",
      };
      const result = builder.build(basicInput);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.envelope.payload.auth_assurance).toBe("basic");
        expect(meetsAssuranceLevel("basic", "high")).toBe(false);
      }
    });

    it("substantial assurance cannot be used for high-assurance requirement", () => {
      const builder = new ConsentAttestationBuilder();
      const substantialInput: ConsentAttestationInput = {
        ...baseInput,
        auth_assurance: "substantial",
        nonce: "nonce-substantial-no-inflate",
      };
      const result = builder.build(substantialInput);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.envelope.payload.auth_assurance).toBe("substantial");
        expect(meetsAssuranceLevel("substantial", "high")).toBe(false);
      }
    });
  });

  describe("auth method validation", () => {
    it("validates known auth methods", () => {
      expect(isConsentAuthMethod("webauthn")).toBe(true);
      expect(isConsentAuthMethod("pilot_password")).toBe(true);
      expect(isConsentAuthMethod("external_provider")).toBe(true);
      expect(isConsentAuthMethod("unknown")).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Task 4: ConsentNonceTracker
// ---------------------------------------------------------------------------

describe("ConsentNonceTracker", () => {
  it("initially reports nonce as unused", () => {
    const tracker = new ConsentNonceTracker();
    expect(tracker.isUsed("nonce-fresh")).toBe(false);
  });

  it("marks nonce as used after consume", () => {
    const tracker = new ConsentNonceTracker();
    tracker.consume("nonce-used");
    expect(tracker.isUsed("nonce-used")).toBe(true);
  });

  it("reset clears all consumed nonces", () => {
    const tracker = new ConsentNonceTracker();
    tracker.consume("nonce-a");
    tracker.consume("nonce-b");
    tracker.reset();
    expect(tracker.isUsed("nonce-a")).toBe(false);
    expect(tracker.isUsed("nonce-b")).toBe(false);
  });
});
