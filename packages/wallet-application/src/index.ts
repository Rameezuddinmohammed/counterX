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

export type { ConsentAttestationResult as ConsentBuildResult } from "./consent-attestation.js";

// Device pairing
export { PAIRING_STATUSES, PairingService } from "./device-pairing.js";

export type {
  PairingStatus,
  PairingRequest,
  PairingResult,
  PairingError,
  PairingOutcome,
} from "./device-pairing.js";

// Agent registration
export { AgentRegistrationService } from "./agent-registration.js";

export type {
  AgentPublicKeyDescriptor,
  AgentRegistration,
  RegistrationError,
  RegistrationOutcome,
} from "./agent-registration.js";

// Mandate service
export { MandateService } from "./mandate-service.js";

export type {
  MandateIssuanceParams,
  MandateIssuanceOutput,
  MandateIssuanceError,
  MandateIssuanceResult,
  AgentLookup,
  ConsentDigestValidator,
} from "./mandate-service.js";

// Mandate sync
export { FRESHNESS_STATUSES, MandateSyncService } from "./mandate-sync.js";

export type { FreshnessStatus, CachedMandate, MandateSyncResult } from "./mandate-sync.js";

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

export type { ClientErrorKind, MerchantClientError } from "./client-errors.js";

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

export type { HttpClientOptions, SimulatedFailure } from "./merchant-runtime-client.js";

// Policy precheck service
export { PolicyPrecheckService } from "./policy-precheck.js";

export type { MerchantQuote, PrecheckResult } from "./policy-precheck.js";

// Purchase proposal builder
export { PurchaseProposalBuilder, deriveProposalIdempotencyKey } from "./purchase-proposal.js";

export type { PurchaseProposal } from "./purchase-proposal.js";

// Purchase intent builder
export { PurchaseIntentBuilder, deriveIntentIdempotencyKey } from "./purchase-intent.js";

export type { PurchaseIntent, SignedPurchaseIntent } from "./purchase-intent.js";

// Approval inbox
export {
  APPROVAL_TASK_STATUSES,
  ApprovalInbox,
  InMemoryApprovalTaskStore,
} from "./approval-inbox.js";

export type {
  ApprovalTaskStatus,
  ApprovalTask,
  NotificationRecord,
  ApprovalResult,
  ApprovalTaskStore,
} from "./approval-inbox.js";

// Payment action service
export {
  PAYMENT_ACTION_STATES,
  isPaymentActionState,
  PaymentActionService,
} from "./payment-action.js";

export type {
  PaymentActionState,
  PaymentLineItem,
  MerchantInfo,
  GrantBinding,
  HostedPaymentAction,
  PaymentActionEvent,
  ContinuationCheckDeps,
  PaymentActionSubscriber,
} from "./payment-action.js";

// Time trigger scheduler
export { TimeTriggerScheduler } from "./time-trigger.js";

export type {
  CronSchedule,
  IntervalSchedule,
  TriggerSchedule,
  PurchaseTemplate,
  TimeTrigger,
  TriggerExecutionRecord,
  CreateTriggerParams,
  TriggerCreationResult,
  TriggerCreationError,
  TriggerExecutionResult,
  TriggerExecutionError,
  TriggerExecutionDeps,
} from "./time-trigger.js";

// Claim ledger
export { CLAIM_SOURCE_TYPES, isClaimSourceType, ClaimLedger } from "./claim-ledger.js";

export type {
  ClaimSourceType,
  ClaimRecord,
  ReceiptConsumption,
  RecordClaimParams,
  ConsumeReceiptParams,
  ClaimRecordResult,
  ReceiptConsumptionResult,
  ClaimLedgerError,
} from "./claim-ledger.js";

// Recovery service
export { RecoveryService } from "./recovery-service.js";

export type {
  RecoveryLockRecord,
  RecoveryError,
  RecoveryResult,
  ReRegistrationOutput,
} from "./recovery-service.js";

// Export service
export { ExportService, InMemoryWalletDataStore } from "./export-service.js";

export type {
  WalletExportData,
  ExportedTransaction,
  ExportedMandate,
  ExportedDevice,
  ExportedPolicy,
  AuditEntry,
  RetentionHold,
  ClosureReceiptPayload,
  ExportError,
  ExportResult,
  WalletDataStore,
} from "./export-service.js";

// Operations service
export {
  METRIC_EVENT_TYPES,
  ANOMALY_TYPES,
  ANOMALY_SEVERITIES,
  OPERATIONS_KILL_SWITCH_SCOPES,
  OperationsService,
} from "./operations-service.js";

export type {
  WalletMetrics,
  MetricEvent,
  MetricEventType,
  AnomalyAlert,
  AnomalyType,
  AnomalySeverity,
  AnomalyDetectionConfig,
  OperationsKillSwitchScope,
  OperationsKillSwitch,
  OperationsError,
  OperationsResult,
} from "./operations-service.js";

// Pilot evidence bundle
export { COVERAGE_TYPES, PilotEvidenceBundle } from "./pilot-evidence.js";

export type {
  ScenarioResult,
  EvidenceMapping,
  CoverageType,
  PilotEvidencePayload,
  PilotEvidenceError,
  PilotEvidenceResult,
} from "./pilot-evidence.js";
