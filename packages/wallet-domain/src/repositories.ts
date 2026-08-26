/**
 * Repository port interfaces for the wallet domain.
 *
 * All queries are scoped by walletId for isolation - a query with walletId A
 * cannot return data belonging to walletId B.
 */

import type { CounterId } from "@counter/domain";
import type { WalletAccount, WalletInvitation } from "./value-objects.js";
import type { StateTransitionRecord } from "./transition-record.js";
import type { WalletLifecycleState } from "./lifecycle.js";

// ---------------------------------------------------------------------------
// Mutation Error
// ---------------------------------------------------------------------------

/**
 * Returned when a mutation is rejected (e.g., wallet is suspended/closed).
 */
export interface MutationRejection {
  readonly kind: "mutation_rejected";
  readonly wallet_id: CounterId<"wallet">;
  readonly state: WalletLifecycleState;
  readonly reason: string;
}

// ---------------------------------------------------------------------------
// WalletRepository
// ---------------------------------------------------------------------------

/**
 * Repository for wallet account persistence.
 * Mutations are rejected for wallets in suspended, recovery_locked,
 * offboarding, or closed states.
 */
export interface WalletRepository {
  findById(walletId: CounterId<"wallet">): WalletAccount | undefined;
  findByPrincipal(principalId: CounterId<"actor">): readonly WalletAccount[];
  save(account: WalletAccount): MutationRejection | undefined;
  transition(
    walletId: CounterId<"wallet">,
    record: StateTransitionRecord,
  ): MutationRejection | undefined;
}

// ---------------------------------------------------------------------------
// InvitationRepository
// ---------------------------------------------------------------------------

/**
 * Repository for wallet invitations.
 * All queries are scoped by walletId for cross-wallet isolation.
 */
export interface InvitationRepository {
  findById(invitationId: string, walletId: CounterId<"wallet">): WalletInvitation | undefined;
  findByWallet(walletId: CounterId<"wallet">): readonly WalletInvitation[];
  findPending(walletId: CounterId<"wallet">): readonly WalletInvitation[];
  accept(
    invitationId: string,
    walletId: CounterId<"wallet">,
    acceptedAt: string,
  ): MutationRejection | undefined;
  revoke(
    invitationId: string,
    walletId: CounterId<"wallet">,
  ): MutationRejection | undefined;
  expire(
    invitationId: string,
    walletId: CounterId<"wallet">,
  ): MutationRejection | undefined;
  save(invitation: WalletInvitation): MutationRejection | undefined;
}

// ---------------------------------------------------------------------------
// States that reject mutations
// ---------------------------------------------------------------------------

/**
 * States where mutations are not allowed.
 */
export const MUTATION_REJECTING_STATES: readonly WalletLifecycleState[] = [
  "SUSPENDED",
  "RECOVERY_LOCKED",
  "OFFBOARDING",
  "CLOSED",
] as const;

const mutationRejectingSet: ReadonlySet<string> = new Set(MUTATION_REJECTING_STATES);

export function isMutationRejectingState(state: WalletLifecycleState): boolean {
  return mutationRejectingSet.has(state);
}

export function createMutationRejection(
  walletId: CounterId<"wallet">,
  state: WalletLifecycleState,
): MutationRejection {
  const stateDescriptions: Record<string, string> = {
    SUSPENDED: "Wallet is suspended; mutations are not permitted until reinstatement",
    RECOVERY_LOCKED: "Wallet is recovery-locked; mutations are not permitted until recovery completes",
    OFFBOARDING: "Wallet is offboarding; no further mutations are permitted",
    CLOSED: "Wallet is closed; this is a terminal state and no mutations are permitted",
  };
  return {
    kind: "mutation_rejected",
    wallet_id: walletId,
    state,
    reason: stateDescriptions[state] ?? `Wallet in state ${state} does not permit mutations`,
  };
}
