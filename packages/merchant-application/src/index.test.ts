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
});
