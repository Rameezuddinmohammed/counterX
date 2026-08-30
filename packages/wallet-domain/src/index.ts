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

export type { WalletLifecycleState, TransitionValidationResult } from "./lifecycle.js";

export type {
  WalletAccount,
  WalletPrincipal,
  WalletInvitation,
  WalletInvitationStatus,
} from "./value-objects.js";

export { WALLET_INVITATION_STATUSES, isWalletInvitationStatus } from "./value-objects.js";

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

export type { WalletRepository, InvitationRepository, MutationRejection } from "./repositories.js";

// In-memory repository implementations
export {
  InMemoryWalletRepository,
  InMemoryInvitationRepository,
} from "./in-memory-repositories.js";

// Secure key store port
export type {
  SecureKeyStore,
  PublicKeyDescriptor,
  GeneratedKeyResult,
} from "./secure-key-store.js";

// Secure key store implementations
export { InMemorySecureKeyStore } from "./in-memory-key-store.js";
export { FileSecureKeyStore, defaultWalletKeyStorePath } from "./file-key-store.js";
export { WindowsSecureKeyStore } from "./windows-key-store.js";

// Buyer policy types
export type {
  MerchantAllowlistConstraint,
  GeographyConstraint,
  CategoryConstraint,
  CurrencyConstraint,
  AmountLimitsConstraint,
  CountLimitsConstraint,
  OperationConstraint,
  TimeConstraint,
  ApprovalThresholdConstraint,
  PaymentReferenceConstraint,
  BuyerPolicyConstraints,
  BuyerPolicyVersion,
} from "./buyer-policy.js";

// Buyer policy store
export type { BuyerPolicyRepository } from "./buyer-policy-store.js";
export { InMemoryBuyerPolicyRepository } from "./buyer-policy-store.js";

// Policy evaluator
export type { ProposedAction, AccumulatedUsage, PolicyDecision } from "./policy-evaluator.js";
export { evaluatePolicy } from "./policy-evaluator.js";

// Policy widening detection
export { isWidening } from "./policy-widening.js";

// Policy simulator
export type { SimulationResult, SimulationSummary } from "./policy-simulator.js";
export { simulatePolicy } from "./policy-simulator.js";

// Mandate types
export { MANDATE_STATUSES, isMandateStatus, InMemoryMandateRepository } from "./mandate.js";
export type { MandateStatus, WalletMandate, MandateRepository } from "./mandate.js";

// Payment references
export {
  PAYMENT_REFERENCE_ENVIRONMENTS,
  PAYMENT_REFERENCE_STATUSES,
  isPaymentReferenceEnvironment,
  createCounterTestReference,
  createRazorpayRecurringReference,
  isTestEnvironmentOnly,
  InMemoryPaymentReferenceRepository,
} from "./payment-references.js";

export type {
  PaymentReferenceEnvironment,
  PaymentReferenceStatus,
  PaymentAuthorizationReference,
  CounterTestAuthorization,
  CreateCounterTestReferenceParams,
  RazorpayRecurringAuthorization,
  CreateRazorpayRecurringReferenceParams,
  PaymentReferenceRepository,
} from "./payment-references.js";
