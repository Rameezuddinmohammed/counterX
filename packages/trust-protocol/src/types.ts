/**
 * Counter Trust Protocol (CTP) 0.1 type definitions.
 *
 * All CTP object types and the common envelope are defined here as TypeScript
 * interfaces following the domain package pattern (no classes, Brand types for
 * nominal typing, Result pattern for fallible operations).
 */

import type { Brand } from "@counter/domain";

// ---------------------------------------------------------------------------
// CTP Version & Object Types
// ---------------------------------------------------------------------------

export const CTP_VERSION = "0.1";

export const CTP_OBJECT_TYPES = [
  "counter.agent-registration.v1",
  "counter.buyer-policy.v1",
  "counter.principal-consent-attestation.v1",
  "counter.mandate.v1",
  "counter.merchant-quote.v1",
  "counter.purchase-intent.v1",
  "counter.approval.v1",
  "counter.revocation.v1",
  "counter.payment-authorization-reference.v1",
  "counter.policy-decision.v1",
  "counter.transaction-state.v1",
  "counter.evidence.v1",
  "counter.finding.v1",
  "counter.transaction-receipt.v1",
] as const;

export type CtpObjectType = (typeof CTP_OBJECT_TYPES)[number];

const ctpObjectTypeSet: ReadonlySet<string> = new Set(CTP_OBJECT_TYPES);

export function isCtpObjectType(value: unknown): value is CtpObjectType {
  return typeof value === "string" && ctpObjectTypeSet.has(value);
}

// ---------------------------------------------------------------------------
// CTP Environments (production envelope environments only - not local/test)
// ---------------------------------------------------------------------------

export const CTP_ENVIRONMENTS = ["sandbox", "pilot", "production"] as const;

export type CtpEnvironment = (typeof CTP_ENVIRONMENTS)[number];

const ctpEnvironmentSet: ReadonlySet<string> = new Set(CTP_ENVIRONMENTS);

export function isCtpEnvironment(value: unknown): value is CtpEnvironment {
  return typeof value === "string" && ctpEnvironmentSet.has(value);
}

// ---------------------------------------------------------------------------
// Signature Algorithm
// ---------------------------------------------------------------------------

export const CTP_SIGNATURE_ALGORITHM = "EdDSA";

export type CtpSignatureAlgorithm = typeof CTP_SIGNATURE_ALGORITHM;

// ---------------------------------------------------------------------------
// Branded types for CTP-specific values
// ---------------------------------------------------------------------------

/** Base64url-encoded (no padding) nonce value. */
export type Nonce = Brand<string, "CtpNonce">;

/** Base64url-encoded (no padding) signature value. */
export type SignatureValue = Brand<string, "CtpSignatureValue">;

// ---------------------------------------------------------------------------
// Signature block
// ---------------------------------------------------------------------------

export interface CtpSignature {
  readonly alg: CtpSignatureAlgorithm;
  readonly kid: string;
  readonly value: SignatureValue;
}

// ---------------------------------------------------------------------------
// Evidence reference
// ---------------------------------------------------------------------------

export interface EvidenceRef {
  readonly type: string;
  readonly id: string;
  readonly digest: string;
}

// ---------------------------------------------------------------------------
// Common Trust Envelope
// ---------------------------------------------------------------------------

export interface CtpEnvelope<Payload = unknown> {
  readonly ctp_version: typeof CTP_VERSION;
  readonly type: CtpObjectType;
  readonly id: string;
  readonly issuer: string;
  readonly subject: string;
  readonly audience: readonly string[];
  readonly environment: CtpEnvironment;
  readonly issued_at: string;
  readonly not_before: string;
  readonly expires_at: string;
  readonly nonce: Nonce;
  readonly correlation_id: string;
  readonly payload_digest: string;
  readonly payload: Payload;
  readonly evidence_refs: readonly EvidenceRef[];
  readonly signature: CtpSignature;
}

/**
 * Unsigned envelope - all fields except signature.value.
 * Used as input to the signing pipeline.
 */
export interface UnsignedCtpEnvelope<Payload = unknown> {
  readonly ctp_version: typeof CTP_VERSION;
  readonly type: CtpObjectType;
  readonly id: string;
  readonly issuer: string;
  readonly subject: string;
  readonly audience: readonly string[];
  readonly environment: CtpEnvironment;
  readonly issued_at: string;
  readonly not_before: string;
  readonly expires_at: string;
  readonly nonce: Nonce;
  readonly correlation_id: string;
  readonly payload_digest: string;
  readonly payload: Payload;
  readonly evidence_refs: readonly EvidenceRef[];
  readonly signature: {
    readonly alg: CtpSignatureAlgorithm;
    readonly kid: string;
  };
}

// ---------------------------------------------------------------------------
// CTP Object Payloads (per TRUST-PROTOCOL.md sections 6-15)
// ---------------------------------------------------------------------------

/** Section 6: Agent Registration */
export interface AgentRegistrationPayload {
  readonly principal_id: string;
  readonly wallet_id: string;
  readonly agent_uri: string;
  readonly public_key: string;
  readonly kid: string;
  readonly proof_of_possession: string;
  readonly display_name?: string;
  readonly provider_metadata?: Record<string, unknown>;
  readonly allowed_interfaces?: readonly string[];
  readonly validity_start: string;
  readonly validity_end: string;
  readonly rotation_predecessor?: string;
  readonly revocation_locator?: string;
  readonly assurance_level: string;
  readonly registration_evidence?: readonly EvidenceRef[];
}

/** Section 7: Buyer Policy */
export interface BuyerPolicyPayload {
  readonly policy_id: string;
  readonly principal_id: string;
  readonly wallet_id: string;
  readonly allowed_merchants?: readonly string[];
  readonly allowed_domains?: readonly string[];
  readonly merchant_countries?: readonly string[];
  readonly delivery_countries?: readonly string[];
  readonly categories?: readonly string[];
  readonly skus?: readonly string[];
  readonly currencies?: readonly string[];
  readonly per_transaction_limit?: MoneyAmount;
  readonly rolling_period_limit?: RollingLimit;
  readonly aggregate_limit?: MoneyAmount;
  readonly quantity_limit?: number;
  readonly transaction_count_limit?: number;
  readonly allowed_operations?: readonly string[];
  readonly payment_authorization_refs?: readonly string[];
  readonly trigger_types?: readonly string[];
  readonly time_windows?: readonly TimeWindow[];
  readonly approval_threshold?: MoneyAmount;
  readonly material_change_behavior: string;
  readonly validity_start: string;
  readonly validity_end: string;
  readonly status: string;
  readonly predecessor?: string;
  readonly policy_digest: string;
}

/** Section 7.1: Principal Consent Attestation */
export interface PrincipalConsentAttestationPayload {
  readonly principal_id: string;
  readonly wallet_id: string;
  readonly object_type: string;
  readonly object_id: string;
  readonly object_digest: string;
  readonly consent_text: string;
  readonly consent_version: string;
  readonly auth_provider: string;
  readonly auth_method: string;
  readonly auth_assurance: string;
  readonly auth_time: string;
  readonly auth_timestamp: string;
  readonly audience: readonly string[];
  readonly expiry: string;
  readonly nonce: string;
  readonly step_up_evidence_ref?: string;
  readonly revocation_locator?: string;
}

/** Section 8: Mandate / Normalized Authority */
export interface MandatePayload {
  readonly mandate_id: string;
  readonly principal_id: string;
  readonly wallet_id: string;
  readonly agent_id: string;
  readonly kid: string;
  readonly allowed_merchants: readonly string[];
  readonly allowed_domains?: readonly string[];
  readonly merchant_countries?: readonly string[];
  readonly delivery_countries?: readonly string[];
  readonly categories?: readonly string[];
  readonly skus?: readonly string[];
  readonly currencies: readonly string[];
  readonly per_transaction_limit: MoneyAmount;
  readonly rolling_limits?: readonly RollingLimit[];
  readonly aggregate_limit?: MoneyAmount;
  readonly quantity_limit?: number;
  readonly transaction_count_limit?: number;
  readonly allowed_operations: readonly string[];
  readonly approval_threshold?: MoneyAmount;
  readonly approval_rule?: string;
  readonly trigger_types?: readonly string[];
  readonly time_windows?: readonly TimeWindow[];
  readonly payment_authorization_ref: string;
  readonly validity_start: string;
  readonly validity_end: string;
  readonly nonce_scope?: string;
  readonly revocation_locator?: string;
  readonly revocation_status_version?: string;
  readonly policy_version: string;
  readonly policy_digest: string;
}

/** Section 9: Merchant Quote */
export interface MerchantQuotePayload {
  readonly quote_id: string;
  readonly merchant_id: string;
  readonly environment: CtpEnvironment;
  readonly items: readonly QuoteItem[];
  readonly subtotal: MoneyAmount;
  readonly discounts?: MoneyAmount;
  readonly tax?: MoneyAmount;
  readonly shipping?: MoneyAmount;
  readonly fees?: MoneyAmount;
  readonly total: MoneyAmount;
  readonly currency: string;
  readonly availability_declaration?: string;
  readonly destination?: string;
  readonly fulfillment_constraints?: string;
  readonly source_freshness?: string;
  readonly quote_expiry: string;
  readonly quote_digest: string;
}

/** Section 9: Purchase Intent */
export interface PurchaseIntentPayload {
  readonly intent_id: string;
  readonly mandate_id: string;
  readonly policy_id?: string;
  readonly wallet_id: string;
  readonly agent_id: string;
  readonly merchant_id: string;
  readonly environment: CtpEnvironment;
  readonly operation: string;
  readonly trigger_type: string;
  readonly items: readonly IntentItem[];
  readonly quote_id: string;
  readonly quote_version?: string;
  readonly quote_digest: string;
  readonly quote_issued_at: string;
  readonly quote_expires_at: string;
  readonly currency: string;
  readonly max_amount: MoneyAmount;
  readonly final_amount?: MoneyAmount;
  readonly delivery_country?: string;
  readonly delivery_address_ref?: string;
  readonly fulfillment_constraints?: string;
  readonly payment_authorization_ref: string;
  readonly transaction_id: string;
  readonly client_idempotency_id?: string;
  readonly approval_requirement?: string;
  readonly approval_reference?: string;
  readonly intent_expiry: string;
}

/** Section 10: Approval */
export interface ApprovalPayload {
  readonly approval_id: string;
  readonly principal_id: string;
  readonly reviewer?: string;
  readonly intent_id: string;
  readonly transaction_id: string;
  readonly quote_digest: string;
  readonly approved_amount: MoneyAmount;
  readonly approved_currency: string;
  readonly decision: string;
  readonly reason?: string;
  readonly auth_assurance: string;
  readonly validity_start: string;
  readonly validity_end: string;
}

/** Section 10: Revocation */
export interface RevocationPayload {
  readonly revocation_id: string;
  readonly scope_type: string;
  readonly scope_id: string;
  readonly effective_time: string;
  readonly reason_class: string;
  readonly reason?: string;
  readonly replacement_id?: string;
  readonly sequence: number;
  readonly version: string;
}

/** Section 11: Payment Authorization Reference */
export interface PaymentAuthorizationReferencePayload {
  readonly reference_id: string;
  readonly adapter: string;
  readonly provider?: string;
  readonly environment: CtpEnvironment;
  readonly wallet_id: string;
  readonly principal_id: string;
  readonly permitted_agents?: readonly string[];
  readonly permitted_merchants?: readonly string[];
  readonly method_class?: string;
  readonly currency?: string;
  readonly limits?: MoneyAmount;
  readonly validity_start: string;
  readonly validity_end: string;
  readonly status: string;
  readonly evidence_ref?: string;
  readonly assurance: string;
  readonly restrictions?: readonly string[];
  readonly test_only?: boolean;
}

/** Section 12: Policy Decision */
export interface PolicyDecisionPayload {
  readonly decision_id: string;
  readonly command: string;
  readonly material_digest: string;
  readonly platform_policy_version?: string;
  readonly buyer_policy_version?: string;
  readonly mandate_version?: string;
  readonly merchant_policy_version?: string;
  readonly connector_version?: string;
  readonly provider_version?: string;
  readonly risk_version?: string;
  readonly transaction_state_version?: string;
  readonly cumulative_reservations?: readonly string[];
  readonly outcome: "ALLOW" | "DENY" | "REVIEW_REQUIRED";
  readonly firing_rules?: readonly string[];
  readonly explanation?: string;
  readonly validity_start: string;
  readonly validity_end: string;
  readonly transaction_version?: string;
  readonly evidence_refs?: readonly EvidenceRef[];
}

/** Section 13: Transaction State */
export interface TransactionStatePayload {
  readonly transaction_id: string;
  readonly orchestration_phase: string;
  readonly reservation_state?: StateEntry;
  readonly payment_state?: StateEntry;
  readonly order_state?: StateEntry;
  readonly fulfillment_state?: StateEntry;
  readonly return_state?: StateEntry;
  readonly version: string;
}

/** Section 13: Evidence */
export interface EvidencePayload {
  readonly evidence_id: string;
  readonly source_type: string;
  readonly source_id: string;
  readonly observation_method: string;
  readonly observation_time: string;
  readonly source_version?: string;
  readonly integrity_digest?: string;
  readonly data_classification: string;
  readonly retention: string;
  readonly canonical_claim: Record<string, unknown>;
  readonly original_artifact_ref?: string;
}

/** Section 14: Finding */
export interface FindingPayload {
  readonly finding_id: string;
  readonly finding_type: string;
  readonly severity: string;
  readonly affected_objects: readonly string[];
  readonly conflicting_evidence?: readonly string[];
  readonly missing_evidence?: readonly string[];
  readonly detected_time: string;
  readonly owner: string;
  readonly permitted_compensation?: CompensationCommand;
  readonly status: string;
  readonly resolution_evidence?: readonly EvidenceRef[];
}

/** Section 15: Transaction Receipt */
export interface TransactionReceiptPayload {
  readonly receipt_id: string;
  readonly transaction_id: string;
  readonly intent_id: string;
  readonly merchant_id: string;
  readonly state_vector: Record<string, string>;
  readonly items: readonly ReceiptItem[];
  readonly commercial_totals: CommercialTotals;
  readonly mandate_summary?: string;
  readonly authority_digest?: string;
  readonly policy_decision_digest?: string;
  readonly payment_authorization_class?: string;
  readonly payment_provider_state?: string;
  readonly payment_evidence_time?: string;
  readonly order_state?: string;
  readonly fulfillment_state?: string;
  readonly refund_state?: string;
  readonly order_evidence_time?: string;
  readonly fulfillment_evidence_time?: string;
  readonly refund_evidence_time?: string;
  readonly findings?: readonly string[];
  readonly unresolved_limitations?: readonly string[];
  readonly assurance_level: string;
  readonly evidence_root_digest?: string;
  readonly predecessor_receipt?: string;
  readonly superseded_receipt?: string;
}

// ---------------------------------------------------------------------------
// Supporting types used in payloads
// ---------------------------------------------------------------------------

export interface MoneyAmount {
  readonly amount: number;
  readonly currency: string;
}

export interface RollingLimit {
  readonly amount: number;
  readonly currency: string;
  readonly period: string;
}

export interface TimeWindow {
  readonly start: string;
  readonly end: string;
  readonly timezone?: string;
}

export interface QuoteItem {
  readonly item_id: string;
  readonly variant_id?: string;
  readonly quantity: number;
  readonly unit_price: MoneyAmount;
  readonly discount?: MoneyAmount;
  readonly tax?: MoneyAmount;
  readonly subtotal: MoneyAmount;
}

export interface IntentItem {
  readonly item_id: string;
  readonly variant_id?: string;
  readonly quantity: number;
  readonly allowed_substitutions?: readonly string[];
}

export interface StateEntry {
  readonly state: string;
  readonly source: string;
  readonly observed_time: string;
  readonly version: string;
  readonly assurance?: string;
}

export interface CompensationCommand {
  readonly type: string;
  readonly prerequisites?: readonly string[];
  readonly buyer_policy_authorization?: string;
  readonly merchant_policy_authorization?: string;
  readonly max_monetary_effect?: MoneyAmount;
  readonly idempotency_id: string;
  readonly provider_action?: string;
  readonly connector_action?: string;
  readonly expected_result?: string;
  readonly query_strategy?: string;
  readonly fallback_owner?: string;
}

export interface ReceiptItem {
  readonly item_id: string;
  readonly quantity: number;
  readonly unit_price_minor_units: number;
  readonly total_minor_units: number;
  readonly currency: string;
}

export interface CommercialTotals {
  readonly subtotal_minor_units: number;
  readonly tax_minor_units?: number;
  readonly shipping_minor_units?: number;
  readonly fees_minor_units?: number;
  readonly discounts_minor_units?: number;
  readonly total_minor_units: number;
  readonly currency: string;
}

// ---------------------------------------------------------------------------
// Payload type map (for typed envelope usage)
// ---------------------------------------------------------------------------

export interface CtpPayloadMap {
  "counter.agent-registration.v1": AgentRegistrationPayload;
  "counter.buyer-policy.v1": BuyerPolicyPayload;
  "counter.principal-consent-attestation.v1": PrincipalConsentAttestationPayload;
  "counter.mandate.v1": MandatePayload;
  "counter.merchant-quote.v1": MerchantQuotePayload;
  "counter.purchase-intent.v1": PurchaseIntentPayload;
  "counter.approval.v1": ApprovalPayload;
  "counter.revocation.v1": RevocationPayload;
  "counter.payment-authorization-reference.v1": PaymentAuthorizationReferencePayload;
  "counter.policy-decision.v1": PolicyDecisionPayload;
  "counter.transaction-state.v1": TransactionStatePayload;
  "counter.evidence.v1": EvidencePayload;
  "counter.finding.v1": FindingPayload;
  "counter.transaction-receipt.v1": TransactionReceiptPayload;
}
