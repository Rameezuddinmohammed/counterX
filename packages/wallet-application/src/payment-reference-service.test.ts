/**
 * Tests for PaymentReferenceService.
 *
 * Validates:
 * - Step-up required for reference changes (create, update, revoke)
 * - Affected mandates invalidated on reference change
 * - Reference binding enforced (wallet/principal/merchant/operation)
 * - Test references rejected by environment mismatch check
 */

import { describe, expect, it, beforeEach } from "vitest";
import type { CounterId } from "@counter/domain";
import {
  InMemoryMandateRepository,
  InMemoryPaymentReferenceRepository,
} from "@counter/wallet-domain";
import type { WalletMandate } from "@counter/wallet-domain";
import type { StepUpSession } from "./step-up-service.js";
import { StepUpService } from "./step-up-service.js";
import { PaymentReferenceService } from "./payment-reference-service.js";

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

const TEST_WALLET_ID = "ctr_wallet_AAAAAAAAAAAAAAAAAAAAAA" as CounterId<"wallet">;
const TEST_PRINCIPAL_ID = "ctr_actor_BBBBBBBBBBBBBBBBBBBBBB" as CounterId<"actor">;
const TEST_AGENT_ID = "ctr_agent_CCCCCCCCCCCCCCCCCCCCCC" as CounterId<"agent">;
const TEST_MANDATE_ID = "ctr_mandate_DDDDDDDDDDDDDDDDDDDD" as CounterId<"mandate">;

function createValidStepUpSession(overrides?: Partial<StepUpSession>): StepUpSession {
  const now = new Date();
  return {
    principal_id: TEST_PRINCIPAL_ID,
    method: "webauthn",
    assurance: "substantial",
    authenticated_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 300_000).toISOString(),
    nonce: `nonce-${Math.random().toString(36).slice(2)}`,
    ...overrides,
  };
}

function createFullConstraints(overrides?: {
  merchantAllowlist?: { allowedMerchantIds: readonly string[]; allowedDomains: readonly string[] };
  operations?: { allowedOperations: readonly string[] };
}) {
  return {
    merchantAllowlist: overrides?.merchantAllowlist ?? { allowedMerchantIds: ["merchant-a", "merchant-b"], allowedDomains: [] },
    geography: { allowedMerchantCountries: ["IN"], allowedDeliveryCountries: ["IN"] },
    category: { allowedCategories: ["*"] },
    currency: { allowedCurrencies: ["INR"] },
    amountLimits: { perTransactionMaxPaise: 100_000n },
    countLimits: {},
    operations: overrides?.operations ?? { allowedOperations: ["purchase", "refund"] },
    timeConstraints: {},
    approvalThreshold: { thresholdPaise: 50_000n },
    paymentReferences: { allowedReferenceIds: ["ref-001"] },
  };
}

function createTestMandate(overrides?: Partial<WalletMandate>): WalletMandate {
  return {
    mandateId: TEST_MANDATE_ID,
    walletId: TEST_WALLET_ID,
    principalId: TEST_PRINCIPAL_ID,
    agentId: TEST_AGENT_ID,
    kid: "kid-001",
    constraints: createFullConstraints(),
    paymentReferenceId: "ref-001",
    validFrom: "2025-01-01T00:00:00Z",
    validUntil: "2025-12-31T23:59:59Z",
    issuedAt: "2025-01-01T00:00:00Z",
    consentAttestationDigest: "digest-001",
    status: "active",
    revocationLocator: "loc-001",
    policyVersionId: "policy-v1",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PaymentReferenceService", () => {
  let referenceRepo: InMemoryPaymentReferenceRepository;
  let mandateRepo: InMemoryMandateRepository;
  let stepUpService: StepUpService;
  let service: PaymentReferenceService;

  beforeEach(() => {
    referenceRepo = new InMemoryPaymentReferenceRepository();
    mandateRepo = new InMemoryMandateRepository();
    stepUpService = new StepUpService();
    service = new PaymentReferenceService(referenceRepo, mandateRepo, stepUpService);
  });

  describe("create", () => {
    it("creates a payment reference with valid step-up", () => {
      const session = createValidStepUpSession();
      const result = service.create(
        {
          referenceId: "ref-001",
          walletId: TEST_WALLET_ID,
          principalId: TEST_PRINCIPAL_ID,
          environment: "sandbox",
          adapter: "counter_test_provider",
          validFrom: "2025-01-01T00:00:00Z",
          validUntil: "2025-12-31T23:59:59Z",
          eligibleMerchants: ["merchant-a"],
          eligibleOperations: ["purchase"],
        },
        session,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.reference.referenceId).toBe("ref-001");
        expect(result.value.reference.status).toBe("active");
        expect(result.value.invalidatedMandateIds).toHaveLength(0);
      }
    });

    it("requires step-up authentication", () => {
      const expiredSession = createValidStepUpSession({
        expires_at: new Date(Date.now() - 1000).toISOString(),
      });

      const result = service.create(
        {
          referenceId: "ref-001",
          walletId: TEST_WALLET_ID,
          principalId: TEST_PRINCIPAL_ID,
          environment: "sandbox",
          adapter: "counter_test_provider",
          validFrom: "2025-01-01T00:00:00Z",
          validUntil: "2025-12-31T23:59:59Z",
          eligibleMerchants: [],
          eligibleOperations: [],
        },
        expiredSession,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("step_up_required");
      }
    });

    it("rejects basic assurance level", () => {
      const basicSession = createValidStepUpSession({ assurance: "basic" });

      const result = service.create(
        {
          referenceId: "ref-001",
          walletId: TEST_WALLET_ID,
          principalId: TEST_PRINCIPAL_ID,
          environment: "sandbox",
          adapter: "counter_test_provider",
          validFrom: "2025-01-01T00:00:00Z",
          validUntil: "2025-12-31T23:59:59Z",
          eligibleMerchants: [],
          eligibleOperations: [],
        },
        basicSession,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("step_up_required");
      }
    });
  });

  describe("update", () => {
    it("updates a reference with valid step-up", () => {
      // First create
      const createSession = createValidStepUpSession();
      service.create(
        {
          referenceId: "ref-001",
          walletId: TEST_WALLET_ID,
          principalId: TEST_PRINCIPAL_ID,
          environment: "sandbox",
          adapter: "counter_test_provider",
          validFrom: "2025-01-01T00:00:00Z",
          validUntil: "2025-12-31T23:59:59Z",
          eligibleMerchants: ["merchant-a", "merchant-b"],
          eligibleOperations: ["purchase", "refund"],
        },
        createSession,
      );

      // Then update
      const updateSession = createValidStepUpSession();
      const result = service.update(
        "ref-001",
        { eligibleMerchants: ["merchant-a"] },
        updateSession,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.reference.eligibleMerchants).toEqual(["merchant-a"]);
      }
    });

    it("requires step-up for update", () => {
      const createSession = createValidStepUpSession();
      service.create(
        {
          referenceId: "ref-001",
          walletId: TEST_WALLET_ID,
          principalId: TEST_PRINCIPAL_ID,
          environment: "sandbox",
          adapter: "counter_test_provider",
          validFrom: "2025-01-01T00:00:00Z",
          validUntil: "2025-12-31T23:59:59Z",
          eligibleMerchants: ["merchant-a"],
          eligibleOperations: ["purchase"],
        },
        createSession,
      );

      const expiredSession = createValidStepUpSession({
        expires_at: new Date(Date.now() - 1000).toISOString(),
      });

      const result = service.update(
        "ref-001",
        { eligibleMerchants: [] },
        expiredSession,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("step_up_required");
      }
    });

    it("returns error for unknown reference", () => {
      const session = createValidStepUpSession();
      const result = service.update("unknown-ref", { eligibleMerchants: [] }, session);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("reference_not_found");
      }
    });

    it("invalidates affected mandates when merchants narrowed", () => {
      // Create reference
      const createSession = createValidStepUpSession();
      service.create(
        {
          referenceId: "ref-001",
          walletId: TEST_WALLET_ID,
          principalId: TEST_PRINCIPAL_ID,
          environment: "sandbox",
          adapter: "counter_test_provider",
          validFrom: "2025-01-01T00:00:00Z",
          validUntil: "2025-12-31T23:59:59Z",
          eligibleMerchants: ["merchant-a", "merchant-b"],
          eligibleOperations: ["purchase", "refund"],
        },
        createSession,
      );

      // Create mandate referencing this reference with merchant-b
      const mandate = createTestMandate();
      mandateRepo.save(mandate);

      // Update reference to only allow merchant-a (mandate references merchant-b)
      const updateSession = createValidStepUpSession();
      const result = service.update(
        "ref-001",
        { eligibleMerchants: ["merchant-a"] },
        updateSession,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.invalidatedMandateIds).toContain(TEST_MANDATE_ID);
      }

      // Verify mandate was revoked
      const updatedMandate = mandateRepo.findById(TEST_MANDATE_ID);
      expect(updatedMandate?.status).toBe("revoked");
    });

    it("does not invalidate unaffected mandates", () => {
      // Create reference
      const createSession = createValidStepUpSession();
      service.create(
        {
          referenceId: "ref-001",
          walletId: TEST_WALLET_ID,
          principalId: TEST_PRINCIPAL_ID,
          environment: "sandbox",
          adapter: "counter_test_provider",
          validFrom: "2025-01-01T00:00:00Z",
          validUntil: "2025-12-31T23:59:59Z",
          eligibleMerchants: ["merchant-a", "merchant-b"],
          eligibleOperations: ["purchase", "refund"],
        },
        createSession,
      );

      // Create mandate that only uses merchant-a
      const mandate = createTestMandate({
        constraints: createFullConstraints({
          merchantAllowlist: { allowedMerchantIds: ["merchant-a"], allowedDomains: [] },
          operations: { allowedOperations: ["purchase"] },
        }),
      });
      mandateRepo.save(mandate);

      // Update reference - still includes merchant-a
      const updateSession = createValidStepUpSession();
      const result = service.update(
        "ref-001",
        { eligibleMerchants: ["merchant-a", "merchant-c"] },
        updateSession,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.invalidatedMandateIds).toHaveLength(0);
      }

      // Mandate still active
      const updatedMandate = mandateRepo.findById(TEST_MANDATE_ID);
      expect(updatedMandate?.status).toBe("active");
    });
  });

  describe("revoke", () => {
    it("revokes a reference with valid step-up", () => {
      const createSession = createValidStepUpSession();
      service.create(
        {
          referenceId: "ref-001",
          walletId: TEST_WALLET_ID,
          principalId: TEST_PRINCIPAL_ID,
          environment: "sandbox",
          adapter: "counter_test_provider",
          validFrom: "2025-01-01T00:00:00Z",
          validUntil: "2025-12-31T23:59:59Z",
          eligibleMerchants: ["merchant-a"],
          eligibleOperations: ["purchase"],
        },
        createSession,
      );

      const revokeSession = createValidStepUpSession();
      const result = service.revoke("ref-001", revokeSession);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.reference.status).toBe("revoked");
      }
    });

    it("requires step-up for revocation", () => {
      const createSession = createValidStepUpSession();
      service.create(
        {
          referenceId: "ref-001",
          walletId: TEST_WALLET_ID,
          principalId: TEST_PRINCIPAL_ID,
          environment: "sandbox",
          adapter: "counter_test_provider",
          validFrom: "2025-01-01T00:00:00Z",
          validUntil: "2025-12-31T23:59:59Z",
          eligibleMerchants: [],
          eligibleOperations: [],
        },
        createSession,
      );

      const expiredSession = createValidStepUpSession({
        expires_at: new Date(Date.now() - 1000).toISOString(),
      });

      const result = service.revoke("ref-001", expiredSession);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("step_up_required");
      }
    });

    it("invalidates all mandates referencing the revoked reference", () => {
      const createSession = createValidStepUpSession();
      service.create(
        {
          referenceId: "ref-001",
          walletId: TEST_WALLET_ID,
          principalId: TEST_PRINCIPAL_ID,
          environment: "sandbox",
          adapter: "counter_test_provider",
          validFrom: "2025-01-01T00:00:00Z",
          validUntil: "2025-12-31T23:59:59Z",
          eligibleMerchants: ["merchant-a"],
          eligibleOperations: ["purchase"],
        },
        createSession,
      );

      // Two mandates referencing this reference
      const mandate1 = createTestMandate();
      const mandate2 = createTestMandate({
        mandateId: "ctr_mandate_EEEEEEEEEEEEEEEEEEEE" as CounterId<"mandate">,
        paymentReferenceId: "ref-001",
      });
      mandateRepo.save(mandate1);
      mandateRepo.save(mandate2);

      const revokeSession = createValidStepUpSession();
      const result = service.revoke("ref-001", revokeSession);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.invalidatedMandateIds).toHaveLength(2);
      }
    });

    it("rejects double revocation", () => {
      const createSession = createValidStepUpSession();
      service.create(
        {
          referenceId: "ref-001",
          walletId: TEST_WALLET_ID,
          principalId: TEST_PRINCIPAL_ID,
          environment: "sandbox",
          adapter: "counter_test_provider",
          validFrom: "2025-01-01T00:00:00Z",
          validUntil: "2025-12-31T23:59:59Z",
          eligibleMerchants: [],
          eligibleOperations: [],
        },
        createSession,
      );

      const revokeSession = createValidStepUpSession();
      service.revoke("ref-001", revokeSession);

      const secondRevokeSession = createValidStepUpSession();
      const result = service.revoke("ref-001", secondRevokeSession);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("already_revoked");
      }
    });
  });

  describe("validateEnvironment", () => {
    it("rejects test reference in pilot environment", () => {
      const createSession = createValidStepUpSession();
      service.create(
        {
          referenceId: "ref-001",
          walletId: TEST_WALLET_ID,
          principalId: TEST_PRINCIPAL_ID,
          environment: "sandbox",
          adapter: "counter_test_provider",
          validFrom: "2025-01-01T00:00:00Z",
          validUntil: "2025-12-31T23:59:59Z",
          eligibleMerchants: [],
          eligibleOperations: [],
        },
        createSession,
      );

      const ref = referenceRepo.findById("ref-001")!;
      const result = service.validateEnvironment(ref, "pilot");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("environment_mismatch");
      }
    });

    it("rejects test reference in production environment", () => {
      const createSession = createValidStepUpSession();
      service.create(
        {
          referenceId: "ref-001",
          walletId: TEST_WALLET_ID,
          principalId: TEST_PRINCIPAL_ID,
          environment: "sandbox",
          adapter: "counter_test_provider",
          validFrom: "2025-01-01T00:00:00Z",
          validUntil: "2025-12-31T23:59:59Z",
          eligibleMerchants: [],
          eligibleOperations: [],
        },
        createSession,
      );

      const ref = referenceRepo.findById("ref-001")!;
      const result = service.validateEnvironment(ref, "production");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("environment_mismatch");
      }
    });

    it("accepts test reference in sandbox environment", () => {
      const createSession = createValidStepUpSession();
      service.create(
        {
          referenceId: "ref-001",
          walletId: TEST_WALLET_ID,
          principalId: TEST_PRINCIPAL_ID,
          environment: "sandbox",
          adapter: "counter_test_provider",
          validFrom: "2025-01-01T00:00:00Z",
          validUntil: "2025-12-31T23:59:59Z",
          eligibleMerchants: [],
          eligibleOperations: [],
        },
        createSession,
      );

      const ref = referenceRepo.findById("ref-001")!;
      const result = service.validateEnvironment(ref, "sandbox");

      expect(result.ok).toBe(true);
    });

    it("rejects production reference in sandbox", () => {
      const createSession = createValidStepUpSession();
      service.create(
        {
          referenceId: "ref-prod-001",
          walletId: TEST_WALLET_ID,
          principalId: TEST_PRINCIPAL_ID,
          environment: "production",
          adapter: "razorpay",
          validFrom: "2025-01-01T00:00:00Z",
          validUntil: "2025-12-31T23:59:59Z",
          eligibleMerchants: [],
          eligibleOperations: [],
        },
        createSession,
      );

      const ref = referenceRepo.findById("ref-prod-001")!;
      const result = service.validateEnvironment(ref, "sandbox");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("environment_mismatch");
      }
    });
  });
});
