/**
 * UI model types for the Counter Merchant Console.
 *
 * These types represent the client-side view models used by the console
 * screens. They are decoupled from the domain layer and represent what
 * the UI needs to render.
 */

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

export enum Screen {
  Home = "/",
  Invite = "/invite",
  BusinessBasics = "/invite/business-basics",
  CatalogConnect = "/invite/catalog-connect",
  Shopify = "/shopify",
  Mapping = "/mapping",
  Policy = "/policy",
  Razorpay = "/razorpay",
  Readiness = "/readiness",
  Manifest = "/manifest",
  Transactions = "/transactions",
  Findings = "/findings",
  KillSwitch = "/killswitch",
  Audit = "/audit",
  Suspension = "/suspension",
}

// ---------------------------------------------------------------------------
// Invitation & Lifecycle
// ---------------------------------------------------------------------------

export type LifecyclePhase =
  | "invited"
  | "accepted"
  | "onboarding"
  | "active"
  | "suspended"
  | "offboarded";

export interface InvitationStatus {
  readonly merchantId: string;
  readonly email: string;
  readonly invitedAt: string;
  readonly acceptedAt: string | null;
  readonly phase: LifecyclePhase;
  readonly expiresAt: string | null;
}

// ---------------------------------------------------------------------------
// Merchant Application (REAL self-serve onboarding wizard, Steps 0-2) —
// mirrors apps/control-plane-api/src/merchant-application-store.ts's
// MerchantApplicationSnapshot / lifecycle states exactly. Distinct from the
// InvitationStatus/LifecyclePhase types above, which back the old, unwired
// invite-gated demo concept this wizard replaces (see /invite/page.tsx).
// ---------------------------------------------------------------------------

/** Mirrors packages/merchant-application/src/lifecycle.ts's MERCHANT_LIFECYCLE_STATES exactly. */
export type MerchantLifecycleState =
  | "DRAFT"
  | "CONNECTING"
  | "MAPPING"
  | "VERIFYING"
  | "SANDBOX_READY"
  | "ACTIVATION_REVIEW"
  | "ACTIVE"
  | "ACTIVE_DEGRADED"
  | "SUSPENDED"
  | "OFFBOARDING"
  | "CLOSED";

export type MerchantApprovalStatus = "pending" | "approved" | "rejected";

/** Mirrors packages/merchant-application/src/capability-manifest.ts's FULFILLMENT_CAPABILITIES exactly. */
export type FulfillmentCapability =
  | "fulfillment.physical.ship"
  | "fulfillment.digital.deliver"
  | "fulfillment.access.grant"
  | "fulfillment.booking.schedule"
  | "fulfillment.event.ticket"
  | "fulfillment.rental.temporary"
  | "fulfillment.quote.custom";

export interface ProvisionMerchantApplicationResponse {
  readonly merchantId: string;
  readonly merchantUserActorId: string;
  readonly created: boolean;
  readonly lifecycleState: MerchantLifecycleState;
  readonly approvalStatus: MerchantApprovalStatus;
}

export interface MerchantApplicationStatus {
  readonly merchantId: string;
  readonly legalEntityName: string | null;
  readonly contactEmail: string | null;
  readonly contactPhone: string | null;
  readonly goodsTypes: readonly string[];
  readonly approvalStatus: MerchantApprovalStatus;
  readonly lifecycleState: MerchantLifecycleState;
  readonly lifecycleVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface BusinessBasicsRequest {
  readonly legalEntityName: string;
  readonly contactEmail: string;
  readonly contactPhone?: string;
  readonly goodsTypes: readonly FulfillmentCapability[];
}

export interface ManualCatalogItem {
  readonly itemId: string;
  readonly merchantId: string;
  readonly name: string;
  readonly description: string | null;
  readonly priceMinor: number;
  readonly currency: string;
  readonly createdAt: string;
  readonly reviewed: boolean;
}

export interface ManualCatalogItemRequest {
  readonly name: string;
  readonly description?: string;
  readonly priceMinor: number;
  readonly currency: string;
}

// ---------------------------------------------------------------------------
// Merchant Application, Steps 3-6 (catalog review, own-gateway payment
// connect, readiness check, manifest confirmation) — mirrors the REAL
// control-plane-api responses exactly. Deliberately distinct names from the
// operator-facing RazorpayStatus/ReadinessStatus/ManifestStatus types above
// (which back a different, older-demo concern — see those pages' own
// headers) so this wizard's real, narrower response shapes are never
// confused with that unrelated surface.
// ---------------------------------------------------------------------------

/** POST/GET .../payment-connection — Step 4, own-gateway Razorpay ONLY. See that route's docs for the real scope boundary. */
export interface WizardPaymentConnectionStatus {
  readonly connected: boolean;
  readonly provider?: "razorpay";
  readonly keyId?: string;
  readonly verifiedAt?: string;
}

export interface RazorpayConnectRequest {
  readonly keyId: string;
  readonly keySecret: string;
}

/** Mirrors readiness-types.ts's ReadinessStatus severities exactly. */
export type WizardReadinessCheckStatus =
  | "Blocking"
  | "AcceptedLimitation"
  | "Advisory"
  | "Expiring";

/** Mirrors readiness-types.ts's ReadinessCheckKind exactly (minus evidence_valid — not evaluated by this pass). */
export type WizardReadinessCheckKind =
  | "connector_health"
  | "mapping_freshness"
  | "policy_compiled"
  | "payment_configured"
  | "protocol_version";

export interface WizardReadinessCheck {
  readonly checkKind: WizardReadinessCheckKind;
  readonly status: WizardReadinessCheckStatus;
  readonly reason: string;
}

export interface WizardVersionBindings {
  readonly connectorVersion: string;
  readonly mappingSchemaHash: string;
  readonly policyVersion: string;
  readonly protocolVersion: string;
  readonly paymentProviderVersion: string;
}

/** GET .../readiness — Step 5. */
export interface WizardReadinessSummary {
  readonly merchantId: string;
  readonly isReady: boolean;
  readonly overallStatus: WizardReadinessCheckStatus;
  readonly checks: readonly WizardReadinessCheck[];
  readonly lifecycleState: MerchantLifecycleState;
  readonly versionBindings: WizardVersionBindings;
  readonly evaluatedAt: string;
}

/** POST/GET .../manifest — Step 6. */
export interface WizardManifest {
  readonly merchantId: string;
  readonly manifestVersion: string;
  readonly capabilities: readonly string[];
  readonly fulfillmentCapabilities: readonly string[];
  readonly versionBindings: WizardVersionBindings;
  readonly generatedAt: string;
  readonly signatureDigest: string;
}

// ---------------------------------------------------------------------------
// Shopify Setup
// ---------------------------------------------------------------------------

export type ConnectionState = "disconnected" | "connecting" | "connected" | "error";

export interface ShopifySetupStatus {
  readonly storeUrl: string | null;
  readonly connectionState: ConnectionState;
  readonly credentialsValid: boolean;
  readonly webhooksConfigured: boolean;
  readonly lastSyncAt: string | null;
  readonly productCount: number;
  readonly orderCount: number;
  readonly errorMessage: string | null;
}

/**
 * The REAL Shopify OAuth connection status — mirrors
 * apps/control-plane-api/src/shopify-connection-store.ts's
 * ShopifyConnectionStatus response shape exactly (GET
 * /control/v1/merchants/:merchantId/shopify/connection). Deliberately
 * narrower than ShopifySetupStatus above (no webhook/sync/product-count
 * fields) — this only reports whether a real access token has been
 * obtained via the authorization-code grant, not sync state.
 */
export interface ShopifyConnectionStatus {
  readonly connected: boolean;
  readonly shopDomain?: string;
  readonly connectedAt?: string;
}

// ---------------------------------------------------------------------------
// Mapping Preview
// ---------------------------------------------------------------------------

export interface MappingEntry {
  readonly shopifyProductId: string;
  readonly shopifyTitle: string;
  readonly counterSku: string;
  readonly counterCategory: string;
  readonly status: "mapped" | "unmapped" | "conflict";
}

export interface MappingPreview {
  readonly totalProducts: number;
  readonly mappedCount: number;
  readonly unmappedCount: number;
  readonly conflictCount: number;
  readonly entries: readonly MappingEntry[];
  readonly lastUpdatedAt: string;
  readonly version: number;
}

// ---------------------------------------------------------------------------
// Policy Simulation
// ---------------------------------------------------------------------------

export type RuleVerdict = "allow" | "deny" | "conditional";

export interface PolicyRuleResult {
  readonly ruleId: string;
  readonly ruleName: string;
  readonly verdict: RuleVerdict;
  readonly reason: string;
  readonly evaluatedAt: string;
}

export interface PolicySimulationResult {
  readonly simulationId: string;
  readonly merchantId: string;
  readonly scenarioName: string;
  readonly overallVerdict: RuleVerdict;
  readonly rules: readonly PolicyRuleResult[];
  readonly walletAuthorityLimit: number;
  readonly currency: "INR";
  readonly executedAt: string;
}

// ---------------------------------------------------------------------------
// Policy Configuration (matches the REAL backend wire shape returned/accepted
// by GET/POST /control/v1/merchants/:merchantId/policy — see
// apps/control-plane-api/src/policy-routes.ts and
// packages/merchant-policy/src/wire.ts. This mirrors
// @counter/merchant-policy's real typed 12-rule discriminated union
// (MerchantPolicyRuleConfig) exactly, hand-copied rather than imported:
// this app deliberately has no dependency on @counter/domain or
// @counter/merchant-policy (see this file's own header — it talks to
// control-plane-api over HTTP only, never touches domain packages
// directly), so bigint/branded-Instant fields are represented the same
// JSON-safe way the wire codec represents them: Money.amountMinor and
// DecimalQuantity.value as decimal strings, Instant as ISO-8601 strings.
// Distinct from PolicySimulationResult above, which described a policy
// *simulation* concept that never had a backing route in control-plane-api.
// ---------------------------------------------------------------------------

export interface WireMoney {
  readonly amountMinor: string;
  readonly currency: string;
}

export interface WireDecimalQuantity {
  readonly value: string;
  readonly unit: string;
}

/** The platform's supported payment rails — mirrors packages/policy/src/types.ts's PaymentMethod exactly. */
export type PolicyPaymentMethod =
  | "upi"
  | "card"
  | "netbanking"
  | "wallet"
  | "bank_transfer"
  | "bnpl";

export type MerchantPolicyRuleConfig =
  | { readonly kind: "product-allowlist"; readonly products: readonly string[] }
  | { readonly kind: "category-allowlist"; readonly categories: readonly string[] }
  | { readonly kind: "inr-only" }
  | { readonly kind: "quantity-limit"; readonly maxQuantity: WireDecimalQuantity }
  | { readonly kind: "count-limit"; readonly maxCount: number; readonly windowDurationMs: number }
  | { readonly kind: "india-destination"; readonly allowedDestinations: readonly string[] }
  | {
      readonly kind: "operating-window";
      readonly allowedFrom: string;
      readonly allowedUntil: string;
    }
  | { readonly kind: "freshness-requirement"; readonly maxAgeMs: number }
  | { readonly kind: "payment-path"; readonly allowedMethods: readonly PolicyPaymentMethod[] }
  | { readonly kind: "review-threshold"; readonly thresholdAmount: WireMoney }
  | {
      readonly kind: "cancellation-policy";
      readonly allowedWithinMs: number;
      readonly refundPercentage: number;
    }
  | {
      readonly kind: "refund-policy";
      readonly maxRefundWindowMs: number;
      readonly partialRefundAllowed: boolean;
    };

export type PolicyRuleKind = MerchantPolicyRuleConfig["kind"];

/** All 12 real rule kinds, in the same order as @counter/merchant-policy's RULE_KINDS. */
export const POLICY_RULE_KINDS: readonly PolicyRuleKind[] = [
  "product-allowlist",
  "category-allowlist",
  "inr-only",
  "quantity-limit",
  "count-limit",
  "india-destination",
  "operating-window",
  "freshness-requirement",
  "payment-path",
  "review-threshold",
  "cancellation-policy",
  "refund-policy",
];

export interface MerchantPolicyRuleSet {
  readonly merchantId: string;
  readonly version: number;
  readonly rules: readonly MerchantPolicyRuleConfig[];
  readonly effectiveFrom: string;
  readonly effectiveUntil: string | null;
}

/** GET response body. */
export interface PolicyConfigView {
  readonly merchantId: string;
  readonly policy: MerchantPolicyRuleSet;
  /** Plain-language lines from @counter/merchant-policy's renderPolicySummary() — what a non-technical merchant reads, not the raw rule JSON. */
  readonly summary: readonly string[];
}

/** What POST accepts — no merchantId (from the URL) or version (server-assigned). */
export interface SavePolicyRequest {
  readonly rules: readonly MerchantPolicyRuleConfig[];
  readonly effectiveFrom: string;
  readonly effectiveUntil: string | null;
}

/** POST response body. */
export interface PolicySaveResult {
  readonly merchantId: string;
  readonly policyVersion: string;
  readonly compiled: {
    readonly version: number;
    readonly compiledAt: string;
    readonly summary: readonly string[];
  };
}

// ---------------------------------------------------------------------------
// Razorpay Status
// ---------------------------------------------------------------------------

export type RazorpayMode = "test" | "live";

export interface RazorpayStatus {
  readonly accountId: string | null;
  readonly mode: RazorpayMode;
  readonly keyConfigured: boolean;
  readonly webhookActive: boolean;
  readonly supportedMethods: readonly string[];
  readonly recentAttempts: readonly TransactionAttempt[];
  readonly lastVerifiedAt: string | null;
}

export interface TransactionAttempt {
  readonly attemptId: string;
  readonly amount: number;
  readonly currency: "INR";
  readonly status: "success" | "failed" | "pending";
  readonly method: string;
  readonly timestamp: string;
  readonly errorCode: string | null;
}

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

export type ReadinessCategory = "Blocking" | "AcceptedLimitation" | "Advisory" | "Expiring";

export interface ReadinessCheck {
  readonly checkId: string;
  readonly name: string;
  readonly category: ReadinessCategory;
  readonly passed: boolean;
  readonly message: string;
  readonly detail: string | null;
  readonly checkedAt: string;
}

export interface ReadinessStatus {
  readonly merchantId: string;
  readonly overallReady: boolean;
  readonly blockingCount: number;
  readonly advisoryCount: number;
  readonly checks: readonly ReadinessCheck[];
  readonly lastRunAt: string;
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

export type ManifestState = "draft" | "pending_activation" | "active" | "revoked";

export interface CapabilityGate {
  readonly gateId: string;
  readonly name: string;
  readonly satisfied: boolean;
  readonly requiredFor: string;
}

export interface ManifestStatus {
  readonly manifestId: string;
  readonly merchantId: string;
  readonly state: ManifestState;
  readonly version: number;
  readonly capabilities: readonly string[];
  readonly gates: readonly CapabilityGate[];
  readonly activatedAt: string | null;
  readonly publishedAt: string | null;
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

export type TransactionState =
  | "initiated"
  | "authorized"
  | "captured"
  | "settled"
  | "refunded"
  | "failed"
  | "disputed";

export interface TransactionStateTransition {
  readonly from: TransactionState | null;
  readonly to: TransactionState;
  readonly timestamp: string;
  readonly actor: string;
  readonly evidenceRef: string | null;
}

export interface Transaction {
  readonly transactionId: string;
  readonly merchantId: string;
  readonly amount: number;
  readonly currency: "INR";
  readonly currentState: TransactionState;
  readonly buyerRef: string;
  readonly method: string;
  readonly createdAt: string;
  readonly transitions: readonly TransactionStateTransition[];
}

/**
 * What Counter has collected from buyers on this merchant's behalf and has not
 * yet paid out. Mirrors control-plane-api's SettlementSummary exactly.
 *
 * This is an amount OWED to the merchant, derived from their settled
 * transactions — NOT a stored balance the merchant holds with Counter, and not
 * a withdrawable instrument. Label it accordingly in the UI: "pending
 * settlement", never "wallet" or "balance".
 */
export interface SettlementSummary {
  /** Integer INR paise as a decimal string — parse with BigInt, never Number. */
  readonly pendingMinor: string;
  readonly currency: "INR";
  readonly orderCount: number;
  /** True when the server hit its scan cap, so the total is a floor, not exact. */
  readonly truncated: boolean;
}

// ---------------------------------------------------------------------------
// Findings & Reconciliation
// ---------------------------------------------------------------------------

export type FindingSeverity = "critical" | "high" | "medium" | "low" | "info";
export type FindingResolution = "open" | "acknowledged" | "compensated" | "resolved" | "dismissed";

export interface Finding {
  readonly findingId: string;
  readonly merchantId: string;
  readonly severity: FindingSeverity;
  readonly title: string;
  readonly description: string;
  readonly affectedObject: string;
  readonly resolution: FindingResolution;
  readonly compensationCommand: string | null;
  readonly detectedAt: string;
  readonly resolvedAt: string | null;
}

// ---------------------------------------------------------------------------
// Kill Switches
// ---------------------------------------------------------------------------

export type KillSwitchScope = "merchant" | "global";

export interface KillSwitchState {
  readonly switchId: string;
  readonly name: string;
  readonly scope: KillSwitchScope;
  readonly active: boolean;
  readonly activatedBy: string | null;
  readonly activatedAt: string | null;
  readonly reason: string | null;
  readonly affectedMerchants: readonly string[];
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export type AuditAction =
  | "login"
  | "config_change"
  | "activation"
  | "suspension"
  | "kill_switch"
  | "export"
  | "offboarding";

export interface AuditEntry {
  readonly entryId: string;
  readonly merchantId: string;
  readonly action: AuditAction;
  readonly actor: string;
  readonly detail: string;
  readonly timestamp: string;
  readonly immutable: true;
}

// ---------------------------------------------------------------------------
// Suspension & Offboarding
// ---------------------------------------------------------------------------

export type SuspensionReason =
  | "policy_violation"
  | "kill_switch"
  | "manual"
  | "reconciliation_failure"
  | "inactivity";

export type OffboardingStep =
  | "initiated"
  | "data_export"
  | "payment_settlement"
  | "webhook_removal"
  | "credential_revocation"
  | "completed";

export interface SuspensionStatus {
  readonly merchantId: string;
  readonly suspended: boolean;
  readonly suspendedAt: string | null;
  readonly reason: SuspensionReason | null;
  readonly suspendedBy: string | null;
  readonly offboardingStep: OffboardingStep | null;
  readonly offboardingStartedAt: string | null;
}

// ---------------------------------------------------------------------------
// Console State (aggregate)
// ---------------------------------------------------------------------------

export interface MerchantConsoleState {
  readonly merchantId: string;
  readonly currentScreen: Screen;
  readonly identity: {
    readonly merchantName: string;
    readonly email: string;
    readonly environment: "pilot" | "production";
  };
  readonly invitation: InvitationStatus | null;
  readonly shopify: ShopifySetupStatus | null;
  readonly mapping: MappingPreview | null;
  readonly policy: PolicySimulationResult | null;
  readonly razorpay: RazorpayStatus | null;
  readonly readiness: ReadinessStatus | null;
  readonly manifest: ManifestStatus | null;
  readonly transactions: readonly Transaction[];
  readonly findings: readonly Finding[];
  readonly killSwitches: readonly KillSwitchState[];
  readonly audit: readonly AuditEntry[];
  readonly suspension: SuspensionStatus | null;
}
