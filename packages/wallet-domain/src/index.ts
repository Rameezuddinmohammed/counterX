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

// Transition records
export { validateAndRecordTransition } from "./transition-record.js";

export type {
  StateTransitionRecord,
  TransitionError,
  TransitionResult,
  TransitionInput,
} from "./transition-record.js";

// Repository ports
export {
  MUTATION_REJECTING_STATES,
  isMutationRejectingState,
  createMutationRejection,
} from "./repositories.js";

export type {
  WalletRepository,
  InvitationRepository,
  MutationRejection,
} from "./repositories.js";

// In-memory repository implementations
export {
  InMemoryWalletRepository,
  InMemoryInvitationRepository,
} from "./in-memory-repositories.js";
