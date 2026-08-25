/**
 * @counter/wallet-application
 *
 * Application service ports and interfaces for wallet lifecycle management,
 * invitation flows, and consent attestation. Defines the boundary between
 * domain logic and external adapters.
 */

export const PACKAGE_NAME = "@counter/wallet-application";

export type {
  WalletAccountRepository,
  WalletPrincipalRepository,
  WalletInvitationRepository,
  WalletLifecycleService,
  WalletInvitationService,
  ConsentAttestationService,
  ConsentAttestationParams,
  ConsentAttestationResult,
  ConsentAttestationValidation,
} from "./ports.js";
