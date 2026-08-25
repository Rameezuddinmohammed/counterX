import { describe, expect, it } from "vitest";
import {
  PACKAGE_NAME,
  WALLET_LIFECYCLE_STATES,
  isWalletLifecycleState,
  validateTransition,
  allowedTransitionsFrom,
  isTerminalState,
  WALLET_INVITATION_STATUSES,
  isWalletInvitationStatus,
} from "./index.js";
import type {
  WalletAccount,
  WalletPrincipal,
  WalletInvitation,
} from "./index.js";
import type { CounterId } from "@counter/domain";

describe("@counter/wallet-domain", () => {
  it("exposes its package identity", () => {
    expect(PACKAGE_NAME).toBe("@counter/wallet-domain");
  });
});

describe("Wallet Lifecycle States", () => {
  it("defines all 8 lifecycle states", () => {
    expect(WALLET_LIFECYCLE_STATES).toHaveLength(8);
    expect(WALLET_LIFECYCLE_STATES).toContain("INVITED");
    expect(WALLET_LIFECYCLE_STATES).toContain("ENROLLED");
    expect(WALLET_LIFECYCLE_STATES).toContain("VERIFIED");
    expect(WALLET_LIFECYCLE_STATES).toContain("ACTIVE");
    expect(WALLET_LIFECYCLE_STATES).toContain("SUSPENDED");
    expect(WALLET_LIFECYCLE_STATES).toContain("RECOVERY_LOCKED");
    expect(WALLET_LIFECYCLE_STATES).toContain("OFFBOARDING");
    expect(WALLET_LIFECYCLE_STATES).toContain("CLOSED");
  });

  it("isWalletLifecycleState accepts valid states", () => {
    expect(isWalletLifecycleState("ACTIVE")).toBe(true);
    expect(isWalletLifecycleState("CLOSED")).toBe(true);
  });

  it("isWalletLifecycleState rejects invalid states", () => {
    expect(isWalletLifecycleState("UNKNOWN")).toBe(false);
    expect(isWalletLifecycleState("")).toBe(false);
    expect(isWalletLifecycleState(42)).toBe(false);
    expect(isWalletLifecycleState(null)).toBe(false);
  });
});

describe("Wallet Lifecycle Transitions", () => {
  it("allows INVITED -> ENROLLED", () => {
    const result = validateTransition("INVITED", "ENROLLED");
    expect(result.valid).toBe(true);
  });

  it("allows ENROLLED -> VERIFIED", () => {
    const result = validateTransition("ENROLLED", "VERIFIED");
    expect(result.valid).toBe(true);
  });

  it("allows VERIFIED -> ACTIVE", () => {
    const result = validateTransition("VERIFIED", "ACTIVE");
    expect(result.valid).toBe(true);
  });

  it("allows ACTIVE -> SUSPENDED", () => {
    const result = validateTransition("ACTIVE", "SUSPENDED");
    expect(result.valid).toBe(true);
  });

  it("allows ACTIVE -> OFFBOARDING", () => {
    const result = validateTransition("ACTIVE", "OFFBOARDING");
    expect(result.valid).toBe(true);
  });

  it("allows SUSPENDED -> ACTIVE (reinstatement)", () => {
    const result = validateTransition("SUSPENDED", "ACTIVE");
    expect(result.valid).toBe(true);
  });

  it("allows SUSPENDED -> RECOVERY_LOCKED", () => {
    const result = validateTransition("SUSPENDED", "RECOVERY_LOCKED");
    expect(result.valid).toBe(true);
  });

  it("allows RECOVERY_LOCKED -> ACTIVE", () => {
    const result = validateTransition("RECOVERY_LOCKED", "ACTIVE");
    expect(result.valid).toBe(true);
  });

  it("allows OFFBOARDING -> CLOSED", () => {
    const result = validateTransition("OFFBOARDING", "CLOSED");
    expect(result.valid).toBe(true);
  });

  it("rejects CLOSED -> any state (terminal)", () => {
    const result = validateTransition("CLOSED", "ACTIVE");
    expect(result.valid).toBe(false);
    expect(result.reason).toBeDefined();
  });

  it("rejects INVITED -> ACTIVE (skip states)", () => {
    const result = validateTransition("INVITED", "ACTIVE");
    expect(result.valid).toBe(false);
  });

  it("rejects ENROLLED -> CLOSED (skip states)", () => {
    const result = validateTransition("ENROLLED", "CLOSED");
    expect(result.valid).toBe(false);
  });

  it("CLOSED is a terminal state", () => {
    expect(isTerminalState("CLOSED")).toBe(true);
  });

  it("ACTIVE is not a terminal state", () => {
    expect(isTerminalState("ACTIVE")).toBe(false);
  });

  it("allowedTransitionsFrom returns valid targets", () => {
    const transitions = allowedTransitionsFrom("ACTIVE");
    expect(transitions).toContain("SUSPENDED");
    expect(transitions).toContain("OFFBOARDING");
    expect(transitions).not.toContain("CLOSED");
  });

  it("allowedTransitionsFrom CLOSED returns empty", () => {
    const transitions = allowedTransitionsFrom("CLOSED");
    expect(transitions).toHaveLength(0);
  });
});

describe("Wallet Invitation Statuses", () => {
  it("defines all invitation statuses", () => {
    expect(WALLET_INVITATION_STATUSES).toHaveLength(4);
    expect(WALLET_INVITATION_STATUSES).toContain("PENDING");
    expect(WALLET_INVITATION_STATUSES).toContain("ACCEPTED");
    expect(WALLET_INVITATION_STATUSES).toContain("EXPIRED");
    expect(WALLET_INVITATION_STATUSES).toContain("REVOKED");
  });

  it("isWalletInvitationStatus accepts valid statuses", () => {
    expect(isWalletInvitationStatus("PENDING")).toBe(true);
    expect(isWalletInvitationStatus("ACCEPTED")).toBe(true);
  });

  it("isWalletInvitationStatus rejects invalid values", () => {
    expect(isWalletInvitationStatus("INVALID")).toBe(false);
    expect(isWalletInvitationStatus(null)).toBe(false);
  });
});

describe("Wallet Value Object Types", () => {
  it("WalletAccount interface is structurally valid", () => {
    const account: WalletAccount = {
      wallet_id: "ctr_wallet_test" as CounterId<"wallet">,
      principal_id: "ctr_actor_test" as CounterId<"actor">,
      state: "ACTIVE",
      created_at: "2025-01-15T10:00:00.000Z",
      updated_at: "2025-01-15T10:00:00.000Z",
    };
    expect(account.state).toBe("ACTIVE");
    expect(account.wallet_id).toBeDefined();
  });

  it("WalletPrincipal interface is structurally valid", () => {
    const principal: WalletPrincipal = {
      principal_id: "ctr_actor_test" as CounterId<"actor">,
      display_name: "Test User",
      auth_provider: "google",
      auth_subject: "sub-12345",
      created_at: "2025-01-15T10:00:00.000Z",
      updated_at: "2025-01-15T10:00:00.000Z",
    };
    expect(principal.display_name).toBe("Test User");
  });

  it("WalletInvitation interface is structurally valid", () => {
    const invitation: WalletInvitation = {
      invitation_id: "inv-001",
      inviter_id: "ctr_actor_test" as CounterId<"actor">,
      invitee_email: "user@example.com",
      wallet_id: "ctr_wallet_test" as CounterId<"wallet">,
      issued_at: "2025-01-15T10:00:00.000Z",
      expires_at: "2025-01-22T10:00:00.000Z",
      status: "PENDING",
    };
    expect(invitation.status).toBe("PENDING");
  });
});
