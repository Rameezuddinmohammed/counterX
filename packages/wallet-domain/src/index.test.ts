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
  validateAndRecordTransition,

  isMutationRejectingState,
  InMemoryWalletRepository,
  InMemoryInvitationRepository,
} from "./index.js";
import type {
  WalletLifecycleState,
  WalletAccount,
  WalletPrincipal,
  WalletInvitation,
  StateTransitionRecord,
  TransitionInput,
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

// ---------------------------------------------------------------------------
// Task 3: State Transition Records
// ---------------------------------------------------------------------------

describe("State Transition Records", () => {
  const walletId = "ctr_wallet_test" as CounterId<"wallet">;
  const actorId = "ctr_actor_admin" as CounterId<"actor">;

  it("validateAndRecordTransition returns a record on valid transition", () => {
    const input: TransitionInput = {
      wallet_id: walletId,
      actor_id: actorId,
      from_state: "INVITED",
      to_state: "ENROLLED",
      reason: "Principal completed enrollment",
      timestamp: "2025-01-15T10:00:00.000Z",
      evidence_ref: "evidence-abc",
    };
    const result = validateAndRecordTransition(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.wallet_id).toBe(walletId);
      expect(result.record.actor_id).toBe(actorId);
      expect(result.record.from_state).toBe("INVITED");
      expect(result.record.to_state).toBe("ENROLLED");
      expect(result.record.reason).toBe("Principal completed enrollment");
      expect(result.record.timestamp).toBe("2025-01-15T10:00:00.000Z");
      expect(result.record.evidence_ref).toBe("evidence-abc");
    }
  });

  it("validateAndRecordTransition returns error on invalid transition", () => {
    const input: TransitionInput = {
      wallet_id: walletId,
      actor_id: actorId,
      from_state: "INVITED",
      to_state: "ACTIVE",
      reason: "Skipping states",
      timestamp: "2025-01-15T10:00:00.000Z",
    };
    const result = validateAndRecordTransition(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("transition_error");
      expect(result.error.from).toBe("INVITED");
      expect(result.error.to).toBe("ACTIVE");
      expect(result.error.reason).toContain("not allowed");
    }
  });

  it("all valid transitions produce records", () => {
    const validPairs: [WalletLifecycleState, WalletLifecycleState][] = [
      ["INVITED", "ENROLLED"],
      ["ENROLLED", "VERIFIED"],
      ["VERIFIED", "ACTIVE"],
      ["ACTIVE", "SUSPENDED"],
      ["ACTIVE", "OFFBOARDING"],
      ["SUSPENDED", "ACTIVE"],
      ["SUSPENDED", "RECOVERY_LOCKED"],
      ["SUSPENDED", "OFFBOARDING"],
      ["RECOVERY_LOCKED", "ACTIVE"],
      ["RECOVERY_LOCKED", "OFFBOARDING"],
      ["OFFBOARDING", "CLOSED"],
    ];

    for (const [from, to] of validPairs) {
      const result = validateAndRecordTransition({
        wallet_id: walletId,
        actor_id: actorId,
        from_state: from,
        to_state: to,
        reason: `Transition ${from} -> ${to}`,
        timestamp: "2025-01-15T10:00:00.000Z",
      });
      expect(result.ok).toBe(true);
    }
  });

  it("all invalid transitions are rejected", () => {
    const invalidPairs: [WalletLifecycleState, WalletLifecycleState][] = [
      ["INVITED", "ACTIVE"],
      ["INVITED", "CLOSED"],
      ["ENROLLED", "ACTIVE"],
      ["ENROLLED", "CLOSED"],
      ["VERIFIED", "CLOSED"],
      ["VERIFIED", "SUSPENDED"],
      ["ACTIVE", "INVITED"],
      ["ACTIVE", "CLOSED"],
      ["CLOSED", "ACTIVE"],
      ["CLOSED", "INVITED"],
      ["CLOSED", "ENROLLED"],
      ["CLOSED", "SUSPENDED"],
    ];

    for (const [from, to] of invalidPairs) {
      const result = validateAndRecordTransition({
        wallet_id: walletId,
        actor_id: actorId,
        from_state: from,
        to_state: to,
        reason: `Invalid transition ${from} -> ${to}`,
        timestamp: "2025-01-15T10:00:00.000Z",
      });
      expect(result.ok).toBe(false);
    }
  });

  it("CLOSED is terminal - no transitions out", () => {
    const targets: WalletLifecycleState[] = [
      "INVITED", "ENROLLED", "VERIFIED", "ACTIVE",
      "SUSPENDED", "RECOVERY_LOCKED", "OFFBOARDING",
    ];
    for (const to of targets) {
      const result = validateAndRecordTransition({
        wallet_id: walletId,
        actor_id: actorId,
        from_state: "CLOSED",
        to_state: to,
        reason: "Attempt escape from CLOSED",
        timestamp: "2025-01-15T10:00:00.000Z",
      });
      expect(result.ok).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Task 3: Mutation Rejecting States
// ---------------------------------------------------------------------------

describe("Mutation Rejecting States", () => {
  it("SUSPENDED rejects mutations", () => {
    expect(isMutationRejectingState("SUSPENDED")).toBe(true);
  });

  it("RECOVERY_LOCKED rejects mutations", () => {
    expect(isMutationRejectingState("RECOVERY_LOCKED")).toBe(true);
  });

  it("OFFBOARDING rejects mutations", () => {
    expect(isMutationRejectingState("OFFBOARDING")).toBe(true);
  });

  it("CLOSED rejects mutations", () => {
    expect(isMutationRejectingState("CLOSED")).toBe(true);
  });

  it("ACTIVE allows mutations", () => {
    expect(isMutationRejectingState("ACTIVE")).toBe(false);
  });

  it("INVITED allows mutations", () => {
    expect(isMutationRejectingState("INVITED")).toBe(false);
  });

  it("ENROLLED allows mutations", () => {
    expect(isMutationRejectingState("ENROLLED")).toBe(false);
  });

  it("VERIFIED allows mutations", () => {
    expect(isMutationRejectingState("VERIFIED")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Task 3: In-memory Repositories and Isolation
// ---------------------------------------------------------------------------

describe("InMemoryWalletRepository", () => {
  const walletA: WalletAccount = {
    wallet_id: "ctr_wallet_aaa" as CounterId<"wallet">,
    principal_id: "ctr_actor_alice" as CounterId<"actor">,
    state: "ACTIVE",
    created_at: "2025-01-15T10:00:00.000Z",
    updated_at: "2025-01-15T10:00:00.000Z",
  };

  const walletB: WalletAccount = {
    wallet_id: "ctr_wallet_bbb" as CounterId<"wallet">,
    principal_id: "ctr_actor_bob" as CounterId<"actor">,
    state: "ACTIVE",
    created_at: "2025-01-16T10:00:00.000Z",
    updated_at: "2025-01-16T10:00:00.000Z",
  };

  it("saves and retrieves wallets by ID", () => {
    const repo = new InMemoryWalletRepository();
    repo.save(walletA);
    const found = repo.findById(walletA.wallet_id);
    expect(found).toEqual(walletA);
  });

  it("findById returns undefined for unknown wallet", () => {
    const repo = new InMemoryWalletRepository();
    const found = repo.findById("ctr_wallet_unknown" as CounterId<"wallet">);
    expect(found).toBeUndefined();
  });

  it("findByPrincipal returns only wallets for that principal", () => {
    const repo = new InMemoryWalletRepository();
    repo.save(walletA);
    repo.save(walletB);
    const aliceWallets = repo.findByPrincipal(walletA.principal_id);
    expect(aliceWallets).toHaveLength(1);
    expect(aliceWallets[0]!.wallet_id).toBe(walletA.wallet_id);
  });

  it("transition updates wallet state and records history", () => {
    const repo = new InMemoryWalletRepository();
    repo.save(walletA);
    const record: StateTransitionRecord = {
      wallet_id: walletA.wallet_id,
      actor_id: "ctr_actor_admin" as CounterId<"actor">,
      from_state: "ACTIVE",
      to_state: "SUSPENDED",
      reason: "Suspicious activity detected",
      timestamp: "2025-01-17T10:00:00.000Z",
    };
    const rejection = repo.transition(walletA.wallet_id, record);
    expect(rejection).toBeUndefined();
    const updated = repo.findById(walletA.wallet_id);
    expect(updated?.state).toBe("SUSPENDED");
    expect(updated?.updated_at).toBe("2025-01-17T10:00:00.000Z");
  });

  it("CLOSED wallet rejects transition", () => {
    const repo = new InMemoryWalletRepository();
    const closedWallet: WalletAccount = { ...walletA, state: "CLOSED" };
    repo.save(closedWallet);
    const record: StateTransitionRecord = {
      wallet_id: closedWallet.wallet_id,
      actor_id: "ctr_actor_admin" as CounterId<"actor">,
      from_state: "CLOSED",
      to_state: "ACTIVE",
      reason: "Attempt to reactivate",
      timestamp: "2025-01-17T10:00:00.000Z",
    };
    const rejection = repo.transition(closedWallet.wallet_id, record);
    expect(rejection).toBeDefined();
    expect(rejection!.kind).toBe("mutation_rejected");
    expect(rejection!.state).toBe("CLOSED");
  });

  it("suspended wallet rejects save mutations", () => {
    const repo = new InMemoryWalletRepository();
    const suspended: WalletAccount = { ...walletA, state: "SUSPENDED" };
    repo.save(suspended);
    const updated: WalletAccount = { ...suspended, display_name: "New Name" };
    const rejection = repo.save(updated);
    expect(rejection).toBeDefined();
    expect(rejection!.kind).toBe("mutation_rejected");
    expect(rejection!.state).toBe("SUSPENDED");
    expect(rejection!.reason).toContain("suspended");
  });

  it("recovery_locked wallet rejects save mutations", () => {
    const repo = new InMemoryWalletRepository();
    const locked: WalletAccount = { ...walletA, state: "RECOVERY_LOCKED" };
    repo.save(locked);
    const updated: WalletAccount = { ...locked, display_name: "New Name" };
    const rejection = repo.save(updated);
    expect(rejection).toBeDefined();
    expect(rejection!.kind).toBe("mutation_rejected");
    expect(rejection!.state).toBe("RECOVERY_LOCKED");
    expect(rejection!.reason).toContain("recovery-locked");
  });

  it("offboarding wallet rejects save mutations", () => {
    const repo = new InMemoryWalletRepository();
    const offboarding: WalletAccount = { ...walletA, state: "OFFBOARDING" };
    repo.save(offboarding);
    const updated: WalletAccount = { ...offboarding, display_name: "New Name" };
    const rejection = repo.save(updated);
    expect(rejection).toBeDefined();
    expect(rejection!.kind).toBe("mutation_rejected");
    expect(rejection!.state).toBe("OFFBOARDING");
  });
});

describe("InMemoryInvitationRepository", () => {
  const walletA: WalletAccount = {
    wallet_id: "ctr_wallet_aaa" as CounterId<"wallet">,
    principal_id: "ctr_actor_alice" as CounterId<"actor">,
    state: "ACTIVE",
    created_at: "2025-01-15T10:00:00.000Z",
    updated_at: "2025-01-15T10:00:00.000Z",
  };

  const walletB: WalletAccount = {
    wallet_id: "ctr_wallet_bbb" as CounterId<"wallet">,
    principal_id: "ctr_actor_bob" as CounterId<"actor">,
    state: "ACTIVE",
    created_at: "2025-01-16T10:00:00.000Z",
    updated_at: "2025-01-16T10:00:00.000Z",
  };

  const inviteA: WalletInvitation = {
    invitation_id: "inv-aaa-001",
    inviter_id: walletA.principal_id,
    invitee_email: "guest@example.com",
    wallet_id: walletA.wallet_id,
    issued_at: "2025-01-15T10:00:00.000Z",
    expires_at: "2025-01-22T10:00:00.000Z",
    status: "PENDING",
  };

  const inviteB: WalletInvitation = {
    invitation_id: "inv-bbb-001",
    inviter_id: walletB.principal_id,
    invitee_email: "friend@example.com",
    wallet_id: walletB.wallet_id,
    issued_at: "2025-01-16T10:00:00.000Z",
    expires_at: "2025-01-23T10:00:00.000Z",
    status: "PENDING",
  };

  function createRepos() {
    const walletRepo = new InMemoryWalletRepository();
    walletRepo.save(walletA);
    walletRepo.save(walletB);
    const invitationRepo = new InMemoryInvitationRepository(
      (wId) => walletRepo.findById(wId),
    );
    return { walletRepo, invitationRepo };
  }

  it("saves and retrieves invitations", () => {
    const { invitationRepo } = createRepos();
    invitationRepo.save(inviteA);
    const found = invitationRepo.findById(inviteA.invitation_id, walletA.wallet_id);
    expect(found).toEqual(inviteA);
  });

  it("findById enforces wallet isolation", () => {
    const { invitationRepo } = createRepos();
    invitationRepo.save(inviteA);
    const found = invitationRepo.findById(inviteA.invitation_id, walletB.wallet_id);
    expect(found).toBeUndefined();
  });

  it("findByWallet returns only that wallet invitations", () => {
    const { invitationRepo } = createRepos();
    invitationRepo.save(inviteA);
    invitationRepo.save(inviteB);
    const aInvites = invitationRepo.findByWallet(walletA.wallet_id);
    expect(aInvites).toHaveLength(1);
    expect(aInvites[0]!.invitation_id).toBe(inviteA.invitation_id);
    const bInvites = invitationRepo.findByWallet(walletB.wallet_id);
    expect(bInvites).toHaveLength(1);
    expect(bInvites[0]!.invitation_id).toBe(inviteB.invitation_id);
  });

  it("findPending returns only pending invitations for the wallet", () => {
    const { invitationRepo } = createRepos();
    invitationRepo.save(inviteA);
    const accepted: WalletInvitation = { ...inviteB, status: "ACCEPTED" };
    invitationRepo.save(accepted);
    const pendingA = invitationRepo.findPending(walletA.wallet_id);
    expect(pendingA).toHaveLength(1);
    const pendingB = invitationRepo.findPending(walletB.wallet_id);
    expect(pendingB).toHaveLength(0);
  });

  it("accept transitions invitation to ACCEPTED", () => {
    const { invitationRepo } = createRepos();
    invitationRepo.save(inviteA);
    const rejection = invitationRepo.accept(
      inviteA.invitation_id,
      walletA.wallet_id,
      "2025-01-16T10:00:00.000Z",
    );
    expect(rejection).toBeUndefined();
    const updated = invitationRepo.findById(inviteA.invitation_id, walletA.wallet_id);
    expect(updated?.status).toBe("ACCEPTED");
    expect(updated?.accepted_at).toBe("2025-01-16T10:00:00.000Z");
  });

  it("revoke transitions invitation to REVOKED", () => {
    const { invitationRepo } = createRepos();
    invitationRepo.save(inviteA);
    const rejection = invitationRepo.revoke(inviteA.invitation_id, walletA.wallet_id);
    expect(rejection).toBeUndefined();
    const updated = invitationRepo.findById(inviteA.invitation_id, walletA.wallet_id);
    expect(updated?.status).toBe("REVOKED");
  });

  it("expire transitions invitation to EXPIRED", () => {
    const { invitationRepo } = createRepos();
    invitationRepo.save(inviteA);
    const rejection = invitationRepo.expire(inviteA.invitation_id, walletA.wallet_id);
    expect(rejection).toBeUndefined();
    const updated = invitationRepo.findById(inviteA.invitation_id, walletA.wallet_id);
    expect(updated?.status).toBe("EXPIRED");
  });

  it("suspended wallet rejects invitation mutations", () => {
    const walletRepo = new InMemoryWalletRepository();
    const suspended: WalletAccount = { ...walletA, state: "SUSPENDED" };
    walletRepo.save(suspended);
    const invitationRepo = new InMemoryInvitationRepository(
      (wId) => walletRepo.findById(wId),
    );
    const rejection = invitationRepo.save(inviteA);
    expect(rejection).toBeDefined();
    expect(rejection!.kind).toBe("mutation_rejected");
    expect(rejection!.reason).toContain("suspended");
  });

  it("closed wallet rejects invitation accept", () => {
    const walletRepo = new InMemoryWalletRepository();
    const closed: WalletAccount = { ...walletA, state: "CLOSED" };
    walletRepo.save(closed);
    const invitationRepo = new InMemoryInvitationRepository(
      (wId) => walletRepo.findById(wId),
    );
    const rejection = invitationRepo.accept(
      inviteA.invitation_id,
      walletA.wallet_id,
      "2025-01-17T10:00:00.000Z",
    );
    expect(rejection).toBeDefined();
    expect(rejection!.kind).toBe("mutation_rejected");
    expect(rejection!.state).toBe("CLOSED");
    expect(rejection!.reason).toContain("terminal");
  });
});

describe("Cross-Wallet Isolation", () => {
  const walletA: WalletAccount = {
    wallet_id: "ctr_wallet_isolation_a" as CounterId<"wallet">,
    principal_id: "ctr_actor_alice" as CounterId<"actor">,
    state: "ACTIVE",
    created_at: "2025-01-15T10:00:00.000Z",
    updated_at: "2025-01-15T10:00:00.000Z",
  };

  const walletB: WalletAccount = {
    wallet_id: "ctr_wallet_isolation_b" as CounterId<"wallet">,
    principal_id: "ctr_actor_bob" as CounterId<"actor">,
    state: "ACTIVE",
    created_at: "2025-01-16T10:00:00.000Z",
    updated_at: "2025-01-16T10:00:00.000Z",
  };

  it("wallet A data is invisible to wallet B queries", () => {
    const walletRepo = new InMemoryWalletRepository();
    walletRepo.save(walletA);
    walletRepo.save(walletB);

    const invRepo = new InMemoryInvitationRepository(
      (wId) => walletRepo.findById(wId),
    );

    const invA: WalletInvitation = {
      invitation_id: "inv-iso-a1",
      inviter_id: walletA.principal_id,
      invitee_email: "a-guest@example.com",
      wallet_id: walletA.wallet_id,
      issued_at: "2025-01-15T10:00:00.000Z",
      expires_at: "2025-01-22T10:00:00.000Z",
      status: "PENDING",
    };

    const invB: WalletInvitation = {
      invitation_id: "inv-iso-b1",
      inviter_id: walletB.principal_id,
      invitee_email: "b-guest@example.com",
      wallet_id: walletB.wallet_id,
      issued_at: "2025-01-16T10:00:00.000Z",
      expires_at: "2025-01-23T10:00:00.000Z",
      status: "PENDING",
    };

    invRepo.save(invA);
    invRepo.save(invB);

    expect(invRepo.findById(invB.invitation_id, walletA.wallet_id)).toBeUndefined();
    expect(invRepo.findByWallet(walletA.wallet_id)).toHaveLength(1);
    expect(invRepo.findByWallet(walletA.wallet_id)[0]!.wallet_id).toBe(walletA.wallet_id);

    expect(invRepo.findById(invA.invitation_id, walletB.wallet_id)).toBeUndefined();
    expect(invRepo.findByWallet(walletB.wallet_id)).toHaveLength(1);
    expect(invRepo.findByWallet(walletB.wallet_id)[0]!.wallet_id).toBe(walletB.wallet_id);
  });

  it("principal queries are scoped - wallet repo findByPrincipal does not cross-leak", () => {
    const walletRepo = new InMemoryWalletRepository();
    walletRepo.save(walletA);
    walletRepo.save(walletB);

    const aliceWallets = walletRepo.findByPrincipal(walletA.principal_id);
    expect(aliceWallets).toHaveLength(1);
    expect(aliceWallets[0]!.wallet_id).toBe(walletA.wallet_id);

    const bobWallets = walletRepo.findByPrincipal(walletB.principal_id);
    expect(bobWallets).toHaveLength(1);
    expect(bobWallets[0]!.wallet_id).toBe(walletB.wallet_id);
  });

  it("transition on wallet A does not affect wallet B", () => {
    const walletRepo = new InMemoryWalletRepository();
    walletRepo.save(walletA);
    walletRepo.save(walletB);

    const record: StateTransitionRecord = {
      wallet_id: walletA.wallet_id,
      actor_id: "ctr_actor_admin" as CounterId<"actor">,
      from_state: "ACTIVE",
      to_state: "SUSPENDED",
      reason: "Flagged for review",
      timestamp: "2025-01-17T10:00:00.000Z",
    };
    walletRepo.transition(walletA.wallet_id, record);

    expect(walletRepo.findById(walletA.wallet_id)?.state).toBe("SUSPENDED");
    expect(walletRepo.findById(walletB.wallet_id)?.state).toBe("ACTIVE");
  });
});
