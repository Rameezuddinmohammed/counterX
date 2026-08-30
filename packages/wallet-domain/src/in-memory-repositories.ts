/**
 * In-memory repository implementations for wallet domain testing.
 *
 * These enforce cross-wallet isolation: queries scoped to walletId A never
 * return data from walletId B. Wallets in suspended, recovery_locked,
 * offboarding, or closed states reject mutation attempts with descriptive errors.
 */

import type { CounterId } from "@counter/domain";
import type { WalletAccount, WalletInvitation } from "./value-objects.js";
import type { StateTransitionRecord } from "./transition-record.js";
import type { WalletRepository, InvitationRepository, MutationRejection } from "./repositories.js";
import { isMutationRejectingState, createMutationRejection } from "./repositories.js";

// ---------------------------------------------------------------------------
// InMemoryWalletRepository
// ---------------------------------------------------------------------------

export class InMemoryWalletRepository implements WalletRepository {
  private readonly wallets = new Map<string, WalletAccount>();
  private readonly transitionHistory = new Map<string, StateTransitionRecord[]>();

  findById(walletId: CounterId<"wallet">): WalletAccount | undefined {
    return this.wallets.get(walletId);
  }

  findByPrincipal(principalId: CounterId<"actor">): readonly WalletAccount[] {
    const results: WalletAccount[] = [];
    for (const wallet of this.wallets.values()) {
      if (wallet.principal_id === principalId) {
        results.push(wallet);
      }
    }
    return results;
  }

  save(account: WalletAccount): MutationRejection | undefined {
    // Check if this wallet already exists and is in a rejecting state
    const existing = this.wallets.get(account.wallet_id);
    if (existing && isMutationRejectingState(existing.state)) {
      return createMutationRejection(existing.wallet_id, existing.state);
    }
    this.wallets.set(account.wallet_id, account);
    return undefined;
  }

  transition(
    walletId: CounterId<"wallet">,
    record: StateTransitionRecord,
  ): MutationRejection | undefined {
    const existing = this.wallets.get(walletId);
    if (!existing) {
      return undefined;
    }

    // Closed wallets reject all transitions
    if (existing.state === "CLOSED") {
      return createMutationRejection(walletId, existing.state);
    }

    // Apply the transition - update wallet state
    const updated: WalletAccount = {
      ...existing,
      state: record.to_state,
      updated_at: record.timestamp,
    };
    this.wallets.set(walletId, updated);

    // Store the transition record
    const history = this.transitionHistory.get(walletId) ?? [];
    history.push(record);
    this.transitionHistory.set(walletId, history);

    return undefined;
  }

  /**
   * Returns the transition history for a wallet (test helper).
   */
  getTransitionHistory(walletId: CounterId<"wallet">): readonly StateTransitionRecord[] {
    return this.transitionHistory.get(walletId) ?? [];
  }

  /**
   * Returns the count of stored wallets (test helper).
   */
  get size(): number {
    return this.wallets.size;
  }
}

// ---------------------------------------------------------------------------
// InMemoryInvitationRepository
// ---------------------------------------------------------------------------

export class InMemoryInvitationRepository implements InvitationRepository {
  private readonly invitations = new Map<string, WalletInvitation>();
  private readonly walletLookup: (walletId: CounterId<"wallet">) => WalletAccount | undefined;

  constructor(walletLookup: (walletId: CounterId<"wallet">) => WalletAccount | undefined) {
    this.walletLookup = walletLookup;
  }

  findById(invitationId: string, walletId: CounterId<"wallet">): WalletInvitation | undefined {
    const invitation = this.invitations.get(invitationId);
    // Enforce wallet isolation: only return if walletId matches
    if (invitation && invitation.wallet_id === walletId) {
      return invitation;
    }
    return undefined;
  }

  findByWallet(walletId: CounterId<"wallet">): readonly WalletInvitation[] {
    const results: WalletInvitation[] = [];
    for (const invitation of this.invitations.values()) {
      if (invitation.wallet_id === walletId) {
        results.push(invitation);
      }
    }
    return results;
  }

  findPending(walletId: CounterId<"wallet">): readonly WalletInvitation[] {
    const results: WalletInvitation[] = [];
    for (const invitation of this.invitations.values()) {
      if (invitation.wallet_id === walletId && invitation.status === "PENDING") {
        results.push(invitation);
      }
    }
    return results;
  }

  accept(
    invitationId: string,
    walletId: CounterId<"wallet">,
    acceptedAt: string,
  ): MutationRejection | undefined {
    const rejection = this.checkWalletMutation(walletId);
    if (rejection) return rejection;

    const invitation = this.invitations.get(invitationId);
    if (!invitation || invitation.wallet_id !== walletId) {
      return undefined;
    }

    const updated: WalletInvitation = {
      ...invitation,
      status: "ACCEPTED",
      accepted_at: acceptedAt,
    };
    this.invitations.set(invitationId, updated);
    return undefined;
  }

  revoke(invitationId: string, walletId: CounterId<"wallet">): MutationRejection | undefined {
    const rejection = this.checkWalletMutation(walletId);
    if (rejection) return rejection;

    const invitation = this.invitations.get(invitationId);
    if (!invitation || invitation.wallet_id !== walletId) {
      return undefined;
    }

    const updated: WalletInvitation = {
      ...invitation,
      status: "REVOKED",
    };
    this.invitations.set(invitationId, updated);
    return undefined;
  }

  expire(invitationId: string, walletId: CounterId<"wallet">): MutationRejection | undefined {
    const rejection = this.checkWalletMutation(walletId);
    if (rejection) return rejection;

    const invitation = this.invitations.get(invitationId);
    if (!invitation || invitation.wallet_id !== walletId) {
      return undefined;
    }

    const updated: WalletInvitation = {
      ...invitation,
      status: "EXPIRED",
    };
    this.invitations.set(invitationId, updated);
    return undefined;
  }

  save(invitation: WalletInvitation): MutationRejection | undefined {
    const rejection = this.checkWalletMutation(invitation.wallet_id);
    if (rejection) return rejection;

    this.invitations.set(invitation.invitation_id, invitation);
    return undefined;
  }

  /**
   * Returns the count of stored invitations (test helper).
   */
  get size(): number {
    return this.invitations.size;
  }

  private checkWalletMutation(walletId: CounterId<"wallet">): MutationRejection | undefined {
    const wallet = this.walletLookup(walletId);
    if (wallet && isMutationRejectingState(wallet.state)) {
      return createMutationRejection(walletId, wallet.state);
    }
    return undefined;
  }
}
