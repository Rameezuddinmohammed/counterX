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
} from "./index.js";
import type { CounterId } from "@counter/domain";

describe("@counter/wallet-application", () => {
  it("exposes its package identity", () => {
    expect(PACKAGE_NAME).toBe("@counter/wallet-application");
  });
});

describe("Wallet Application Port Types", () => {
  it("WalletAccountRepository interface is implementable", async () => {
    const mock: WalletAccountRepository = {
      findById: async (_walletId) => undefined,
      findByPrincipal: async (_principalId) => [],
      save: async (_account) => undefined,
    };
    const result = await mock.findById("ctr_wallet_test" as CounterId<"wallet">);
    expect(result).toBeUndefined();
    const accounts = await mock.findByPrincipal("ctr_actor_test" as CounterId<"actor">);
    expect(accounts).toHaveLength(0);
  });

  it("WalletPrincipalRepository interface is implementable", async () => {
    const mock: WalletPrincipalRepository = {
      findById: async (_principalId) => undefined,
      findByAuthSubject: async (_provider, _subject) => undefined,
      save: async (_principal) => undefined,
    };
    const result = await mock.findById("ctr_actor_test" as CounterId<"actor">);
    expect(result).toBeUndefined();
    const byAuth = await mock.findByAuthSubject("google", "sub-123");
    expect(byAuth).toBeUndefined();
  });

  it("WalletInvitationRepository interface is implementable", async () => {
    const mock: WalletInvitationRepository = {
      findById: async (_invitationId) => undefined,
      findByWallet: async (_walletId) => [],
      save: async (_invitation) => undefined,
    };
    const result = await mock.findById("inv-001");
    expect(result).toBeUndefined();
    const invitations = await mock.findByWallet("ctr_wallet_test" as CounterId<"wallet">);
    expect(invitations).toHaveLength(0);
  });

  it("WalletLifecycleService interface is implementable", async () => {
    const mock: WalletLifecycleService = {
      create: async (_request) => ({
        wallet_id: "ctr_wallet_test" as CounterId<"wallet">,
        state: "INVITED",
        created_at: "2025-01-15T10:00:00.000Z",
      }),
      status: async (_walletId) => ({
        wallet_id: "ctr_wallet_test" as CounterId<"wallet">,
        principal_id: "ctr_actor_test" as CounterId<"actor">,
        state: "ACTIVE",
        created_at: "2025-01-15T10:00:00.000Z",
        updated_at: "2025-01-15T10:00:00.000Z",
      }),
      suspend: async (_request) => ({
        wallet_id: "ctr_wallet_test" as CounterId<"wallet">,
        state: "SUSPENDED",
        suspended_at: "2025-01-15T10:00:00.000Z",
      }),
      close: async (_request) => ({
        wallet_id: "ctr_wallet_test" as CounterId<"wallet">,
        state: "CLOSED",
        closed_at: "2025-01-15T10:00:00.000Z",
      }),
    };
    const created = await mock.create({ principal_id: "ctr_actor_test" as CounterId<"actor"> });
    expect(created.state).toBe("INVITED");
    const status = await mock.status("ctr_wallet_test" as CounterId<"wallet">);
    expect(status.state).toBe("ACTIVE");
  });

  it("WalletInvitationService interface is implementable", async () => {
    const mock: WalletInvitationService = {
      invite: async (_request) => ({
        invitation_id: "inv-001",
        wallet_id: "ctr_wallet_test" as CounterId<"wallet">,
        expires_at: "2025-01-22T10:00:00.000Z",
        status: "PENDING",
      }),
      enroll: async (_request) => ({
        wallet_id: "ctr_wallet_test" as CounterId<"wallet">,
        principal_id: "ctr_actor_test" as CounterId<"actor">,
        state: "ENROLLED",
        enrolled_at: "2025-01-15T10:00:00.000Z",
      }),
      verify: async (_request) => ({
        wallet_id: "ctr_wallet_test" as CounterId<"wallet">,
        state: "VERIFIED",
        verified_at: "2025-01-15T10:00:00.000Z",
      }),
    };
    const invited = await mock.invite({
      wallet_id: "ctr_wallet_test" as CounterId<"wallet">,
      inviter_id: "ctr_actor_test" as CounterId<"actor">,
      invitee_email: "user@example.com",
    });
    expect(invited.status).toBe("PENDING");
  });

  it("ConsentAttestationService interface is implementable", async () => {
    const mock: ConsentAttestationService = {
      createAttestation: async (_params) => ({
        attestation_id: "att-001",
        issued_at: "2025-01-15T10:00:00.000Z",
        expires_at: "2025-01-15T11:00:00.000Z",
      }),
      validateAttestation: async (_attestationId) => ({
        valid: true,
        expired: false,
        revoked: false,
      }),
    };
    const result = await mock.createAttestation({
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
    });
    expect(result.attestation_id).toBe("att-001");
    const validation = await mock.validateAttestation("att-001");
    expect(validation.valid).toBe(true);
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
    expect(params.nonce).toBe("nonce-abc");
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
