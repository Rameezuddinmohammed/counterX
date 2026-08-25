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

// Step-up service
export {
  PRIVILEGED_OPERATIONS,
  ASSURANCE_LEVELS,
  isPrivilegedOperation,
  meetsAssuranceLevel,
  StepUpService,
} from "./step-up-service.js";

export type {
  PrivilegedOperation,
  StepUpAssuranceLevel,
  StepUpSession,
  StepUpRequirement,
  StepUpValidationResult,
  StepUpServiceConfig,
} from "./step-up-service.js";

// Consent text renderer
export {
  CONSENT_OPERATION_TYPES,
  isConsentOperationType,
  ConsentTextRenderer,
} from "./consent-text-renderer.js";

export type {
  ConsentOperationType,
  ConsentTextTemplate,
  ConsentRenderParams,
  RenderedConsentText,
} from "./consent-text-renderer.js";

// Consent attestation builder
export {
  CONSENT_AUTH_METHODS,
  isConsentAuthMethod,
  ConsentNonceTracker,
  ConsentAttestationBuilder,
} from "./consent-attestation.js";

export type {
  ConsentAuthMethod,
  ConsentAttestationInput,
  ConsentAttestationOutput,
  ConsentAttestationError,
} from "./consent-attestation.js";

export type {
  ConsentAttestationResult as ConsentBuildResult,
} from "./consent-attestation.js";

// Device pairing
export {
  PAIRING_STATUSES,
  PairingService,
} from "./device-pairing.js";

export type {
  PairingStatus,
  PairingRequest,
  PairingResult,
  PairingError,
  PairingOutcome,
} from "./device-pairing.js";

// Agent registration
export {
  AgentRegistrationService,
} from "./agent-registration.js";

export type {
  AgentPublicKeyDescriptor,
  AgentRegistration,
  RegistrationError,
  RegistrationOutcome,
} from "./agent-registration.js";
