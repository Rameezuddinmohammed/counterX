/**
 * Application service port interfaces for the wallet domain.
 *
 * Ports define the boundaries between the wallet application layer and
 * external adapters (persistence, messaging, authentication).
 */

import type { CounterId } from "@counter/domain";
import type { WalletAccount, WalletInvitation, WalletPrincipal } from "@counter/wallet-domain";
import type {
  CreateWalletRequest,
  CreateWalletResponse,
  InviteToWalletRequest,
  InviteToWalletResponse,
  EnrollWalletRequest,
  EnrollWalletResponse,
  VerifyWalletRequest,
  VerifyWalletResponse,
  WalletStatusResponse,
  SuspendWalletRequest,
  SuspendWalletResponse,
  CloseWalletRequest,
  CloseWalletResponse,
} from "@counter/wallet-contracts";

// ---------------------------------------------------------------------------
// Repository Ports (driven by application, implemented by data layer)
// ---------------------------------------------------------------------------

/**
 * Repository for wallet account persistence.
 */
export interface WalletAccountRepository {
  findById(walletId: CounterId<"wallet">): Promise<WalletAccount | undefined>;
  findByPrincipal(principalId: CounterId<"actor">): Promise<readonly WalletAccount[]>;
  save(account: WalletAccount): Promise<void>;
}

/**
 * Repository for wallet principal persistence.
 */
export interface WalletPrincipalRepository {
  findById(principalId: CounterId<"actor">): Promise<WalletPrincipal | undefined>;
  findByAuthSubject(provider: string, subject: string): Promise<WalletPrincipal | undefined>;
  save(principal: WalletPrincipal): Promise<void>;
}

/**
 * Repository for wallet invitation persistence.
 */
export interface WalletInvitationRepository {
  findById(invitationId: string): Promise<WalletInvitation | undefined>;
  findByWallet(walletId: CounterId<"wallet">): Promise<readonly WalletInvitation[]>;
  save(invitation: WalletInvitation): Promise<void>;
}

// ---------------------------------------------------------------------------
// Service Ports (application services consumed by adapters/transport layers)
// ---------------------------------------------------------------------------

/**
 * Wallet lifecycle management service port.
 * Orchestrates create, suspend, reinstate, offboard, and close operations.
 */
export interface WalletLifecycleService {
  create(request: CreateWalletRequest): Promise<CreateWalletResponse>;
  status(walletId: CounterId<"wallet">): Promise<WalletStatusResponse>;
  suspend(request: SuspendWalletRequest): Promise<SuspendWalletResponse>;
  close(request: CloseWalletRequest): Promise<CloseWalletResponse>;
}

/**
 * Wallet invitation flow service port.
 * Manages invitation creation, acceptance, and enrollment.
 */
export interface WalletInvitationService {
  invite(request: InviteToWalletRequest): Promise<InviteToWalletResponse>;
  enroll(request: EnrollWalletRequest): Promise<EnrollWalletResponse>;
  verify(request: VerifyWalletRequest): Promise<VerifyWalletResponse>;
}

/**
 * Consent attestation service port.
 * Creates and validates principal consent attestation CTP objects.
 */
export interface ConsentAttestationService {
  createAttestation(params: ConsentAttestationParams): Promise<ConsentAttestationResult>;
  validateAttestation(attestationId: string): Promise<ConsentAttestationValidation>;
}

// ---------------------------------------------------------------------------
// Consent Attestation Supporting Types
// ---------------------------------------------------------------------------

export interface ConsentAttestationParams {
  readonly principal_id: CounterId<"actor">;
  readonly wallet_id: CounterId<"wallet">;
  readonly object_type: string;
  readonly object_id: string;
  readonly object_digest: string;
  readonly consent_text: string;
  readonly consent_version: string;
  readonly auth_provider: string;
  readonly auth_method: string;
  readonly auth_assurance: string;
  readonly audience: readonly string[];
  readonly expiry: string;
  readonly nonce: string;
}

export interface ConsentAttestationResult {
  readonly attestation_id: string;
  readonly issued_at: string;
  readonly expires_at: string;
}

export interface ConsentAttestationValidation {
  readonly valid: boolean;
  readonly expired: boolean;
  readonly revoked: boolean;
  readonly reason?: string;
}
