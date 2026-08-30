import { describe, expect, it } from "vitest";
import {
  PACKAGE_NAME,
  MERCHANT_APP_CONFIG_KEYS,
  MERCHANT_LIFECYCLE_STATES,
  LIFECYCLE_TRANSITIONS,
  INVITATION_STATUSES,
  SUSPENSION_KINDS,
  TENANT_STATUSES,
  isMerchantLifecycleState,
  isTerminalState,
  isMerchantSuspended,
  isInvitationValid,
  isSuspensionKind,
  isTenantStatus,
  isInvitationStatus,
  // Verification exports
  VERIFICATION_TARGET_TYPES,
  VERIFICATION_METHOD_NAMES,
  VERIFICATION_RESULT_TYPES,
  isVerificationTargetType,
  isVerificationMethodName,
  isVerificationResultType,
  METHOD_EXPIRY_DURATIONS,
  createVerificationRecord,
  isVerificationExpired,
  isVerificationBlocking,
  checkAllVerificationsComplete,
  revalidateVerification,
  InMemoryVerificationRepository,
} from "./index.js";
import type {
  MerchantLifecycleState,
  MerchantOrganization,
  MerchantTenantEnvironment,
  AllowlistInvitation,
  ActivationSnapshot,
  SuspensionRecord,
  ReactivationRequest,
  ConfigKeyDescriptor,
  MerchantOrganizationRepository,
  MerchantLifecycleRepository,
  InvitationRepository,
  ActivationSnapshotRepository,
  MerchantOwnershipVerification,
  VerificationTargetType,
  VerificationMethodName,
  VerificationResultType,
  VerificationRepository,
} from "./index.js";

describe("@counter/merchant-application", () => {
  it("exposes its package identity", () => {
    expect(PACKAGE_NAME).toBe("@counter/merchant-application");
  });

  it("exports MERCHANT_APP_CONFIG_KEYS describing expected environment variables", () => {
    expect(MERCHANT_APP_CONFIG_KEYS.length).toBeGreaterThan(0);
    for (const key of MERCHANT_APP_CONFIG_KEYS) {
      const descriptor: ConfigKeyDescriptor = key;
      expect(descriptor.name).toBeTruthy();
      expect(descriptor.purpose).toBeTruthy();
      expect(typeof descriptor.required).toBe("boolean");
    }
  });

  describe("lifecycle states", () => {
    it("defines all 11 lifecycle states", () => {
      expect(MERCHANT_LIFECYCLE_STATES).toHaveLength(11);
    });

    it("identifies valid lifecycle states", () => {
      expect(isMerchantLifecycleState("DRAFT")).toBe(true);
      expect(isMerchantLifecycleState("ACTIVE")).toBe(true);
      expect(isMerchantLifecycleState("invalid")).toBe(false);
    });

    it("CLOSED is terminal", () => {
      expect(isTerminalState("CLOSED")).toBe(true);
      expect(isTerminalState("ACTIVE")).toBe(false);
    });

    it("SUSPENDED is detected", () => {
      expect(isMerchantSuspended("SUSPENDED")).toBe(true);
      expect(isMerchantSuspended("ACTIVE")).toBe(false);
    });

    it("CLOSED has no outgoing transitions", () => {
      expect(LIFECYCLE_TRANSITIONS["CLOSED"]).toHaveLength(0);
    });

    it("DRAFT transitions to CONNECTING", () => {
      expect(LIFECYCLE_TRANSITIONS["DRAFT"]).toContain("CONNECTING");
    });
  });

  describe("invitation statuses", () => {
    it("defines all 4 invitation statuses", () => {
      expect(INVITATION_STATUSES).toHaveLength(4);
    });

    it("validates invitation status", () => {
      expect(isInvitationStatus("pending")).toBe(true);
      expect(isInvitationStatus("bogus")).toBe(false);
    });
  });

  describe("suspension kinds", () => {
    it("defines all 3 suspension kinds", () => {
      expect(SUSPENSION_KINDS).toHaveLength(3);
    });

    it("validates suspension kind", () => {
      expect(isSuspensionKind("kill_switch")).toBe(true);
      expect(isSuspensionKind("invalid")).toBe(false);
    });
  });

  describe("tenant statuses", () => {
    it("defines all 3 tenant statuses", () => {
      expect(TENANT_STATUSES).toHaveLength(3);
    });

    it("validates tenant status", () => {
      expect(isTenantStatus("active")).toBe(true);
      expect(isTenantStatus("bogus")).toBe(false);
    });
  });

  describe("type assertions", () => {
    it("MerchantLifecycleState accepts valid values", () => {
      const state: MerchantLifecycleState = "ACTIVE";
      expect(state).toBe("ACTIVE");
    });

    it("MerchantOrganization type is structurally correct", () => {
      const org: MerchantOrganization = {
        organizationId: "org-1" as never,
        legalName: "Test Inc.",
        displayName: "Test",
        contactEmail: "test@example.com",
        createdAt: 1_700_000_000_000 as never,
        updatedAt: 1_700_000_000_000 as never,
      };
      expect(org.legalName).toBe("Test Inc.");
    });

    it("MerchantTenantEnvironment type is structurally correct", () => {
      const tenant: MerchantTenantEnvironment = {
        merchantId: "ctr_merchant_test" as never,
        organizationId: "org-1" as never,
        environment: "sandbox",
        status: "active",
        createdAt: 1_700_000_000_000 as never,
        updatedAt: 1_700_000_000_000 as never,
      };
      expect(tenant.environment).toBe("sandbox");
    });

    it("AllowlistInvitation type is structurally correct", () => {
      const inv: AllowlistInvitation = {
        invitationId: "inv-1",
        merchantLegalEntity: "Test Corp",
        targetEmail: "user@example.com",
        invitedBy: "ctr_operator_test" as never,
        issuedAt: 1_700_000_000_000 as never,
        expiresAt: 1_700_100_000_000 as never,
        status: "pending",
      };
      expect(inv.status).toBe("pending");
    });

    it("ActivationSnapshot type is structurally correct", () => {
      const snap: ActivationSnapshot = {
        merchantId: "ctr_merchant_test" as never,
        environment: "production",
        verificationDigests: [],
        observedTimes: [],
        expiryTimes: [],
        acceptedLimitations: [],
        connectorIds: ["connector-1"],
        capabilityManifestVersion: "1.0.0",
        activatedAt: 1_700_000_000_000 as never,
        activatedBy: "ctr_operator_test" as never,
      };
      expect(snap.environment).toBe("production");
    });

    it("SuspensionRecord type is structurally correct", () => {
      const record: SuspensionRecord = {
        merchantId: "ctr_merchant_test" as never,
        kind: "kill_switch",
        reason: "Security breach detected",
        suspendedBy: { kind: "operator", id: "ctr_operator_test" as never },
        suspendedAt: 1_700_000_000_000 as never,
      };
      expect(record.kind).toBe("kill_switch");
    });

    it("ReactivationRequest type is structurally correct", () => {
      const req: ReactivationRequest = {
        merchantId: "ctr_merchant_test" as never,
        requestedBy: { kind: "operator", id: "ctr_operator_test" as never },
        requestedAt: 1_700_000_000_000 as never,
        reviewNotes: "Issue resolved",
        status: "pending",
      };
      expect(req.status).toBe("pending");
    });

    it("repository interfaces exist as types", () => {
      // Verify repository types are importable and usable
      const check = (
        _a: MerchantOrganizationRepository,
        _b: MerchantLifecycleRepository,
        _c: InvitationRepository,
        _d: ActivationSnapshotRepository,
      ): boolean => true;
      expect(check).toBeDefined();
    });
  });

  describe("isInvitationValid", () => {
    it("returns true for pending invitation before expiry", () => {
      const invitation: AllowlistInvitation = {
        invitationId: "inv-1",
        merchantLegalEntity: "Test Corp",
        targetEmail: "user@example.com",
        invitedBy: "ctr_operator_test" as never,
        issuedAt: 1_700_000_000_000 as never,
        expiresAt: 1_700_100_000_000 as never,
        status: "pending",
      };
      expect(isInvitationValid(invitation, 1_700_050_000_000 as never)).toBe(true);
    });

    it("returns false for expired invitation", () => {
      const invitation: AllowlistInvitation = {
        invitationId: "inv-1",
        merchantLegalEntity: "Test Corp",
        targetEmail: "user@example.com",
        invitedBy: "ctr_operator_test" as never,
        issuedAt: 1_700_000_000_000 as never,
        expiresAt: 1_700_100_000_000 as never,
        status: "pending",
      };
      expect(isInvitationValid(invitation, 1_700_200_000_000 as never)).toBe(false);
    });

    it("returns false for accepted invitation", () => {
      const invitation: AllowlistInvitation = {
        invitationId: "inv-1",
        merchantLegalEntity: "Test Corp",
        targetEmail: "user@example.com",
        invitedBy: "ctr_operator_test" as never,
        issuedAt: 1_700_000_000_000 as never,
        expiresAt: 1_700_100_000_000 as never,
        status: "accepted",
        acceptedAt: 1_700_050_000_000 as never,
        acceptedBy: "ctr_merchant-user_test" as never,
      };
      expect(isInvitationValid(invitation, 1_700_050_000_000 as never)).toBe(false);
    });
  });

  // ─── Verification Module Tests ──────────────────────────────────────────────

  describe("verification target types", () => {
    it("defines all 4 target types", () => {
      expect(VERIFICATION_TARGET_TYPES).toHaveLength(4);
    });

    it("validates target type", () => {
      expect(isVerificationTargetType("merchant_admin")).toBe(true);
      expect(isVerificationTargetType("domain")).toBe(true);
      expect(isVerificationTargetType("shopify_shop")).toBe(true);
      expect(isVerificationTargetType("razorpay_account")).toBe(true);
      expect(isVerificationTargetType("invalid")).toBe(false);
      expect(isVerificationTargetType(123)).toBe(false);
    });
  });

  describe("verification method names", () => {
    it("defines all 4 method names", () => {
      expect(VERIFICATION_METHOD_NAMES).toHaveLength(4);
    });

    it("validates method name", () => {
      expect(isVerificationMethodName("merchant_administrator_authority")).toBe(true);
      expect(isVerificationMethodName("domain_control_or_dev_store_limitation")).toBe(true);
      expect(isVerificationMethodName("shopify_shop_identity")).toBe(true);
      expect(isVerificationMethodName("razorpay_test_account_ownership")).toBe(true);
      expect(isVerificationMethodName("invalid")).toBe(false);
    });
  });

  describe("verification result types", () => {
    it("defines all 4 result types", () => {
      expect(VERIFICATION_RESULT_TYPES).toHaveLength(4);
    });

    it("validates result type", () => {
      expect(isVerificationResultType("VERIFIED")).toBe(true);
      expect(isVerificationResultType("BLOCKED")).toBe(true);
      expect(isVerificationResultType("EXPIRED")).toBe(true);
      expect(isVerificationResultType("PENDING_REVIEW")).toBe(true);
      expect(isVerificationResultType("invalid")).toBe(false);
    });
  });

  describe("METHOD_EXPIRY_DURATIONS", () => {
    it("merchant_administrator_authority expires in 24 hours", () => {
      expect(METHOD_EXPIRY_DURATIONS.merchant_administrator_authority).toBe(86_400_000);
    });

    it("domain_control_or_dev_store_limitation expires in 90 days", () => {
      expect(METHOD_EXPIRY_DURATIONS.domain_control_or_dev_store_limitation).toBe(7_776_000_000);
    });

    it("shopify_shop_identity expires in 90 days", () => {
      expect(METHOD_EXPIRY_DURATIONS.shopify_shop_identity).toBe(7_776_000_000);
    });

    it("razorpay_test_account_ownership expires in 90 days", () => {
      expect(METHOD_EXPIRY_DURATIONS.razorpay_test_account_ownership).toBe(7_776_000_000);
    });
  });

  describe("createVerificationRecord", () => {
    const validDigest = "sha256:" + "a".repeat(64);
    const validInput = {
      target_type: "merchant_admin",
      target_id: "ctr_merchant_test",
      subject: "admin@test.com",
      method_name: "merchant_administrator_authority",
      verifier_actor: "counter_platform_auth_service",
      evidence_reference: validDigest,
      observed_time: 1_700_000_000_000 as never,
      expiry_time: 1_700_086_400_000 as never,
      result_type: "VERIFIED",
      revalidation_rule: "re_verify_on_each_activation_attempt",
      manual_review_fallback: "Operations team review of principal identity",
    } as const;

    it("creates a frozen record with valid input", () => {
      const result = createVerificationRecord(validInput);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.target_type).toBe("merchant_admin");
        expect(result.value.method_name).toBe("merchant_administrator_authority");
        expect(result.value.result_type).toBe("VERIFIED");
        expect(Object.isFrozen(result.value)).toBe(true);
      }
    });

    it("rejects invalid target_type", () => {
      const result = createVerificationRecord({ ...validInput, target_type: "invalid" });
      expect(result.ok).toBe(false);
    });

    it("rejects empty target_id", () => {
      const result = createVerificationRecord({ ...validInput, target_id: "  " });
      expect(result.ok).toBe(false);
    });

    it("rejects empty subject", () => {
      const result = createVerificationRecord({ ...validInput, subject: "" });
      expect(result.ok).toBe(false);
    });

    it("rejects invalid method_name", () => {
      const result = createVerificationRecord({ ...validInput, method_name: "bogus" });
      expect(result.ok).toBe(false);
    });

    it("rejects invalid evidence_reference", () => {
      const result = createVerificationRecord({
        ...validInput,
        evidence_reference: "not-a-valid-digest",
      });
      expect(result.ok).toBe(false);
    });

    it("rejects expiry_time not after observed_time", () => {
      const result = createVerificationRecord({
        ...validInput,
        expiry_time: validInput.observed_time,
      });
      expect(result.ok).toBe(false);
    });

    it("rejects empty verifier_actor", () => {
      const result = createVerificationRecord({ ...validInput, verifier_actor: "" });
      expect(result.ok).toBe(false);
    });

    it("rejects empty revalidation_rule", () => {
      const result = createVerificationRecord({ ...validInput, revalidation_rule: "" });
      expect(result.ok).toBe(false);
    });

    it("rejects empty manual_review_fallback", () => {
      const result = createVerificationRecord({ ...validInput, manual_review_fallback: "" });
      expect(result.ok).toBe(false);
    });
  });

  describe("isVerificationExpired", () => {
    const record: MerchantOwnershipVerification = Object.freeze({
      target_type: "merchant_admin",
      target_id: "ctr_merchant_test",
      subject: "admin@test.com",
      method_name: "merchant_administrator_authority",
      verifier_actor: "counter_platform_auth_service",
      evidence_reference: ("sha256:" + "a".repeat(64)) as never,
      observed_time: 1_700_000_000_000 as never,
      expiry_time: 1_700_086_400_000 as never,
      result_type: "VERIFIED",
      revalidation_rule: "re_verify_on_each_activation_attempt",
      manual_review_fallback: "Operations team review",
    });

    it("returns false when now is before expiry", () => {
      expect(isVerificationExpired(record, 1_700_050_000_000 as never)).toBe(false);
    });

    it("returns true when now equals expiry", () => {
      expect(isVerificationExpired(record, 1_700_086_400_000 as never)).toBe(true);
    });

    it("returns true when now is after expiry", () => {
      expect(isVerificationExpired(record, 1_700_100_000_000 as never)).toBe(true);
    });
  });

  describe("isVerificationBlocking", () => {
    const makeRecord = (resultType: string): MerchantOwnershipVerification =>
      Object.freeze({
        target_type: "merchant_admin",
        target_id: "ctr_merchant_test",
        subject: "admin@test.com",
        method_name: "merchant_administrator_authority",
        verifier_actor: "counter_platform_auth_service",
        evidence_reference: ("sha256:" + "a".repeat(64)) as never,
        observed_time: 1_700_000_000_000 as never,
        expiry_time: 1_700_086_400_000 as never,
        result_type: resultType as never,
        revalidation_rule: "re_verify_on_each_activation_attempt",
        manual_review_fallback: "Operations team review",
      });

    it("returns true for BLOCKED", () => {
      expect(isVerificationBlocking(makeRecord("BLOCKED"))).toBe(true);
    });

    it("returns true for EXPIRED", () => {
      expect(isVerificationBlocking(makeRecord("EXPIRED"))).toBe(true);
    });

    it("returns false for VERIFIED", () => {
      expect(isVerificationBlocking(makeRecord("VERIFIED"))).toBe(false);
    });

    it("returns false for PENDING_REVIEW", () => {
      expect(isVerificationBlocking(makeRecord("PENDING_REVIEW"))).toBe(false);
    });
  });

  describe("checkAllVerificationsComplete", () => {
    const makeVerifiedRecord = (
      methodName: string,
      targetType: string,
    ): MerchantOwnershipVerification =>
      Object.freeze({
        target_type: targetType as never,
        target_id: "test-target",
        subject: "Test Corp",
        method_name: methodName as never,
        verifier_actor: "counter_platform_auth_service",
        evidence_reference: ("sha256:" + "b".repeat(64)) as never,
        observed_time: 1_700_000_000_000 as never,
        expiry_time: 1_700_100_000_000 as never,
        result_type: "VERIFIED",
        revalidation_rule: "re_verify",
        manual_review_fallback: "manual review",
      });

    const allFourRecords: readonly MerchantOwnershipVerification[] = [
      makeVerifiedRecord("merchant_administrator_authority", "merchant_admin"),
      makeVerifiedRecord("domain_control_or_dev_store_limitation", "domain"),
      makeVerifiedRecord("shopify_shop_identity", "shopify_shop"),
      makeVerifiedRecord("razorpay_test_account_ownership", "razorpay_account"),
    ];

    it("returns ok when all 4 methods have VERIFIED non-expired records", () => {
      const result = checkAllVerificationsComplete(allFourRecords, 1_700_050_000_000 as never);
      expect(result.ok).toBe(true);
    });

    it("returns err when a method is missing", () => {
      const result = checkAllVerificationsComplete(
        allFourRecords.slice(0, 3),
        1_700_050_000_000 as never,
      );
      expect(result.ok).toBe(false);
    });

    it("returns err when all records are expired", () => {
      const result = checkAllVerificationsComplete(allFourRecords, 1_700_200_000_000 as never);
      expect(result.ok).toBe(false);
    });

    it("returns err when a method has BLOCKED result", () => {
      const blockedRecords = [
        ...allFourRecords.slice(0, 3),
        Object.freeze({
          ...allFourRecords[3]!,
          result_type: "BLOCKED" as const,
        }),
      ];
      const result = checkAllVerificationsComplete(blockedRecords, 1_700_050_000_000 as never);
      expect(result.ok).toBe(false);
    });
  });

  describe("revalidateVerification", () => {
    const record: MerchantOwnershipVerification = Object.freeze({
      target_type: "shopify_shop",
      target_id: "store.myshopify.com",
      subject: "Test Corp",
      method_name: "shopify_shop_identity",
      verifier_actor: "counter_shopify_connector",
      evidence_reference: ("sha256:" + "c".repeat(64)) as never,
      observed_time: 1_700_000_000_000 as never,
      expiry_time: 1_700_086_400_000 as never,
      result_type: "VERIFIED",
      revalidation_rule: "re_verify_on_scope_change",
      manual_review_fallback: "Operations review",
    });

    it("creates a new frozen record with updated evidence and times", () => {
      const newDigest = ("sha256:" + "d".repeat(64)) as never;
      const newObserved = 1_700_100_000_000 as never;
      const newExpiry = 1_700_200_000_000 as never;
      const result = revalidateVerification(record, newDigest, newObserved, newExpiry);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.evidence_reference).toBe(newDigest);
        expect(result.value.observed_time).toBe(newObserved);
        expect(result.value.expiry_time).toBe(newExpiry);
        expect(result.value.target_type).toBe("shopify_shop");
        expect(result.value.method_name).toBe("shopify_shop_identity");
        expect(result.value.result_type).toBe("VERIFIED");
        expect(Object.isFrozen(result.value)).toBe(true);
      }
    });

    it("rejects new expiry not after new observed time", () => {
      const newDigest = ("sha256:" + "d".repeat(64)) as never;
      const newObserved = 1_700_100_000_000 as never;
      const result = revalidateVerification(record, newDigest, newObserved, newObserved);
      expect(result.ok).toBe(false);
    });
  });

  describe("InMemoryVerificationRepository", () => {
    const record: MerchantOwnershipVerification = Object.freeze({
      target_type: "domain",
      target_id: "test-merchant-id",
      subject: "Test Corp",
      method_name: "domain_control_or_dev_store_limitation",
      verifier_actor: "counter_domain_verifier",
      evidence_reference: ("sha256:" + "e".repeat(64)) as never,
      observed_time: 1_700_000_000_000 as never,
      expiry_time: 1_700_100_000_000 as never,
      result_type: "VERIFIED",
      revalidation_rule: "re_verify_before_expiry",
      manual_review_fallback: "Operator review",
    });

    it("saves and retrieves by merchant", async () => {
      const repo = new InMemoryVerificationRepository();
      const saveResult = await repo.save(record);
      expect(saveResult.ok).toBe(true);

      const findResult = await repo.findByMerchant("test-merchant-id");
      expect(findResult.ok).toBe(true);
      if (findResult.ok) {
        expect(findResult.value).toHaveLength(1);
        expect(findResult.value[0]!.target_type).toBe("domain");
      }
    });

    it("retrieves by target type and id", async () => {
      const repo = new InMemoryVerificationRepository();
      await repo.save(record);

      const findResult = await repo.findByTarget("domain", "test-merchant-id");
      expect(findResult.ok).toBe(true);
      if (findResult.ok) {
        expect(findResult.value).toHaveLength(1);
      }
    });

    it("retrieves records expiring before a given time", async () => {
      const repo = new InMemoryVerificationRepository();
      await repo.save(record);

      const findResult = await repo.findExpiring(1_700_200_000_000 as never);
      expect(findResult.ok).toBe(true);
      if (findResult.ok) {
        expect(findResult.value).toHaveLength(1);
      }

      const findNone = await repo.findExpiring(1_699_000_000_000 as never);
      expect(findNone.ok).toBe(true);
      if (findNone.ok) {
        expect(findNone.value).toHaveLength(0);
      }
    });

    it("VerificationRepository interface exists as a type", () => {
      const check = (_v: VerificationRepository): boolean => true;
      expect(check).toBeDefined();
    });
  });

  describe("verification type assertions", () => {
    it("MerchantOwnershipVerification type is structurally correct", () => {
      const record: MerchantOwnershipVerification = {
        target_type: "merchant_admin",
        target_id: "ctr_merchant_test",
        subject: "admin@test.com",
        method_name: "merchant_administrator_authority",
        verifier_actor: "counter_platform_auth_service",
        evidence_reference: ("sha256:" + "a".repeat(64)) as never,
        observed_time: 1_700_000_000_000 as never,
        expiry_time: 1_700_086_400_000 as never,
        result_type: "VERIFIED",
        revalidation_rule: "re_verify_on_each_activation_attempt",
        manual_review_fallback: "Operations team review",
      };
      expect(record.target_type).toBe("merchant_admin");
    });

    it("VerificationTargetType accepts valid values", () => {
      const target: VerificationTargetType = "shopify_shop";
      expect(target).toBe("shopify_shop");
    });

    it("VerificationMethodName accepts valid values", () => {
      const method: VerificationMethodName = "razorpay_test_account_ownership";
      expect(method).toBe("razorpay_test_account_ownership");
    });

    it("VerificationResultType accepts valid values", () => {
      const result: VerificationResultType = "PENDING_REVIEW";
      expect(result).toBe("PENDING_REVIEW");
    });
  });
});
