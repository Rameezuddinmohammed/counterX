/**
 * @counter/wallet-domain
 *
 * Core wallet domain types, lifecycle states, value objects, and transition
 * validation. This package intentionally imports no frameworks, database
 * drivers, cloud SDKs, providers, MCP transports, or adapters (ADR-0001).
 */

export const PACKAGE_NAME = "@counter/wallet-domain";

export {
  WALLET_LIFECYCLE_STATES,
  isWalletLifecycleState,
  validateTransition,
  allowedTransitionsFrom,
  isTerminalState,
} from "./lifecycle.js";

export type {
  WalletLifecycleState,
  TransitionValidationResult,
} from "./lifecycle.js";

export type {
  WalletAccount,
  WalletPrincipal,
  WalletInvitation,
  WalletInvitationStatus,
} from "./value-objects.js";

export {
  WALLET_INVITATION_STATUSES,
  isWalletInvitationStatus,
} from "./value-objects.js";
