/**
 * Wallet domain value objects.
 *
 * These interfaces represent the core entities in the wallet domain.
 * They use brand types from @counter/domain for nominal typing of IDs.
 */

import type { CounterId } from "@counter/domain";
import type { WalletLifecycleState } from "./lifecycle.js";

// ---------------------------------------------------------------------------
// WalletAccount
// ---------------------------------------------------------------------------

/**
 * Represents a wallet account owned by a principal.
 * Tracks lifecycle state and metadata about the wallet.
 */
export interface WalletAccount {
  readonly wallet_id: CounterId<"wallet">;
  readonly principal_id: CounterId<"actor">;
  readonly state: WalletLifecycleState;
  readonly created_at: string;
  readonly updated_at: string;
  readonly display_name?: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

// ---------------------------------------------------------------------------
// WalletPrincipal
// ---------------------------------------------------------------------------

/**
 * Represents the principal (person/entity) that owns a wallet.
 * A principal may own multiple wallets.
 */
export interface WalletPrincipal {
  readonly principal_id: CounterId<"actor">;
  readonly display_name: string;
  readonly auth_provider: string;
  readonly auth_subject: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly email_verified?: boolean;
}

// ---------------------------------------------------------------------------
// WalletInvitation
// ---------------------------------------------------------------------------

/**
 * Represents an invitation to create a wallet.
 * Invitations expire and can only be used once.
 */
export interface WalletInvitation {
  readonly invitation_id: string;
  readonly inviter_id: CounterId<"actor">;
  readonly invitee_email: string;
  readonly wallet_id: CounterId<"wallet">;
  readonly issued_at: string;
  readonly expires_at: string;
  readonly accepted_at?: string;
  readonly status: WalletInvitationStatus;
}

// ---------------------------------------------------------------------------
// WalletInvitation Status
// ---------------------------------------------------------------------------

export const WALLET_INVITATION_STATUSES = ["PENDING", "ACCEPTED", "EXPIRED", "REVOKED"] as const;

export type WalletInvitationStatus = (typeof WALLET_INVITATION_STATUSES)[number];

const walletInvitationStatusSet: ReadonlySet<string> = new Set(WALLET_INVITATION_STATUSES);

export function isWalletInvitationStatus(value: unknown): value is WalletInvitationStatus {
  return typeof value === "string" && walletInvitationStatusSet.has(value);
}
