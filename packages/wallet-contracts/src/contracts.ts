/**
 * Wallet API contract types.
 *
 * Defines request/response shapes for all wallet service endpoints.
 */

import type { CounterId } from "@counter/domain";

// ---------------------------------------------------------------------------
// Error Codes
// ---------------------------------------------------------------------------

export const WALLET_ERROR_CODES = [
  "WALLET_NOT_FOUND",
  "WALLET_ALREADY_EXISTS",
  "INVALID_STATE_TRANSITION",
  "INVITATION_EXPIRED",
  "INVITATION_ALREADY_ACCEPTED",
  "VERIFICATION_FAILED",
  "UNAUTHORIZED",
  "VALIDATION_ERROR",
] as const;

export type WalletErrorCode = (typeof WALLET_ERROR_CODES)[number];

const walletErrorCodeSet: ReadonlySet<string> = new Set(WALLET_ERROR_CODES);

export function isWalletErrorCode(value: unknown): value is WalletErrorCode {
  return typeof value === "string" && walletErrorCodeSet.has(value);
}

export interface WalletApiError {
  readonly code: WalletErrorCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Endpoint Definitions
// ---------------------------------------------------------------------------

export const WALLET_ENDPOINTS = [
  "wallet.create",
  "wallet.invite",
  "wallet.enroll",
  "wallet.verify",
  "wallet.status",
  "wallet.suspend",
  "wallet.close",
] as const;

export type WalletEndpoint = (typeof WALLET_ENDPOINTS)[number];

// ---------------------------------------------------------------------------
// Create Wallet
// ---------------------------------------------------------------------------

export interface CreateWalletRequest {
  readonly principal_id: CounterId<"actor">;
  readonly display_name?: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface CreateWalletResponse {
  readonly wallet_id: CounterId<"wallet">;
  readonly state: string;
  readonly created_at: string;
}

// ---------------------------------------------------------------------------
// Invite to Wallet
// ---------------------------------------------------------------------------

export interface InviteToWalletRequest {
  readonly wallet_id: CounterId<"wallet">;
  readonly inviter_id: CounterId<"actor">;
  readonly invitee_email: string;
  readonly expires_in_hours?: number;
}

export interface InviteToWalletResponse {
  readonly invitation_id: string;
  readonly wallet_id: CounterId<"wallet">;
  readonly expires_at: string;
  readonly status: string;
}

// ---------------------------------------------------------------------------
// Enroll Wallet
// ---------------------------------------------------------------------------

export interface EnrollWalletRequest {
  readonly invitation_id: string;
  readonly auth_provider: string;
  readonly auth_subject: string;
  readonly auth_token: string;
}

export interface EnrollWalletResponse {
  readonly wallet_id: CounterId<"wallet">;
  readonly principal_id: CounterId<"actor">;
  readonly state: string;
  readonly enrolled_at: string;
}

// ---------------------------------------------------------------------------
// Verify Wallet
// ---------------------------------------------------------------------------

export interface VerifyWalletRequest {
  readonly wallet_id: CounterId<"wallet">;
  readonly verification_method: string;
  readonly verification_evidence: string;
}

export interface VerifyWalletResponse {
  readonly wallet_id: CounterId<"wallet">;
  readonly state: string;
  readonly verified_at: string;
}

// ---------------------------------------------------------------------------
// Wallet Status
// ---------------------------------------------------------------------------

export interface WalletStatusRequest {
  readonly wallet_id: CounterId<"wallet">;
}

export interface WalletStatusResponse {
  readonly wallet_id: CounterId<"wallet">;
  readonly principal_id: CounterId<"actor">;
  readonly state: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly display_name?: string;
}

// ---------------------------------------------------------------------------
// Suspend Wallet
// ---------------------------------------------------------------------------

export interface SuspendWalletRequest {
  readonly wallet_id: CounterId<"wallet">;
  readonly reason: string;
  readonly suspended_by: CounterId<"actor">;
}

export interface SuspendWalletResponse {
  readonly wallet_id: CounterId<"wallet">;
  readonly state: string;
  readonly suspended_at: string;
}

// ---------------------------------------------------------------------------
// Close Wallet
// ---------------------------------------------------------------------------

export interface CloseWalletRequest {
  readonly wallet_id: CounterId<"wallet">;
  readonly reason: string;
  readonly closed_by: CounterId<"actor">;
}

export interface CloseWalletResponse {
  readonly wallet_id: CounterId<"wallet">;
  readonly state: string;
  readonly closed_at: string;
}
