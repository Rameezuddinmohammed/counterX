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

// Mandate service
export {
  MandateService,
} from "./mandate-service.js";

export type {
  MandateIssuanceParams,
  MandateIssuanceOutput,
  MandateIssuanceError,
  MandateIssuanceResult,
  AgentLookup,
  ConsentDigestValidator,
} from "./mandate-service.js";

// Mandate sync
export {
  FRESHNESS_STATUSES,
  MandateSyncService,
} from "./mandate-sync.js";

export type {
  FreshnessStatus,
  CachedMandate,
  MandateSyncResult,
} from "./mandate-sync.js";

// Revocation service
export {
  REVOCATION_SCOPE_TYPES,
  REVOCATION_REASON_CLASSES,
  isRevocationScopeType,
  InMemoryRevocationStore,
  WalletRevocationService,
} from "./revocation-service.js";

export type {
  RevocationScopeType,
  RevocationReasonClass,
  RevocationRecord,
  RevocationInput,
  RevocationOutput,
  RevocationError,
  RevocationResult,
  RevocationStore,
} from "./revocation-service.js";

// Payment reference service
export { PaymentReferenceService } from "./payment-reference-service.js";

export type {
  PaymentReferenceErrorKind,
  PaymentReferenceError,
  PaymentReferenceResult,
  CreatePaymentReferenceParams,
  UpdatePaymentReferenceParams,
  PaymentReferenceOutput,
} from "./payment-reference-service.js";

// Client errors
export {
  CLIENT_ERROR_KINDS,
  createNetworkError,
  createTimeoutError,
  createMalformedResponseError,
  createManifestVerificationError,
  createStaleManifestError,
  createUnknownExtensionError,
  createServerError,
  createUnauthorizedError,
  createIndeterminateError,
} from "./client-errors.js";

export type {
  ClientErrorKind,
  MerchantClientError,
} from "./client-errors.js";

// Merchant client types
export type {
  ClientResult,
  ManifestVerificationResult,
  SearchFilters,
  PaginationParams,
  MerchantRuntimeClient,
} from "./merchant-client-types.js";

// Merchant runtime client implementations
export {
  HttpMerchantRuntimeClient,
  InMemoryMerchantRuntimeClient,
} from "./merchant-runtime-client.js";

export type {
  HttpClientOptions,
  SimulatedFailure,
} from "./merchant-runtime-client.js";
