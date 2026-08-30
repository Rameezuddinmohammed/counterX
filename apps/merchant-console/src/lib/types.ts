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
