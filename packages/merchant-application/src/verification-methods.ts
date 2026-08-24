/**
 * Typed verification method definitions and configuration.
 *
 * Defines per-method configuration interfaces, blocking conditions,
 * and default expiry durations for the four merchant ownership
 * verification methods.
 */

import type { VerificationMethodName } from "./verification.js";

// ─── Method Expiry Durations (milliseconds) ─────────────────────────────────

/**
 * Default expiry durations for each verification method in milliseconds.
 *
 * - merchant_administrator_authority: 24 hours (86_400_000 ms)
 * - domain_control_or_dev_store_limitation: 90 days (7_776_000_000 ms)
 * - shopify_shop_identity: 90 days (7_776_000_000 ms)
 * - razorpay_test_account_ownership: 90 days (7_776_000_000 ms)
 */
export const METHOD_EXPIRY_DURATIONS: Readonly<Record<VerificationMethodName, number>> =
  Object.freeze({
    merchant_administrator_authority: 86_400_000,
    domain_control_or_dev_store_limitation: 7_776_000_000,
    shopify_shop_identity: 7_776_000_000,
    razorpay_test_account_ownership: 7_776_000_000,
  });

// ─── Method 1: Merchant Administrator Authority ─────────────────────────────

/**
 * Configuration for merchant administrator authority verification.
 * Requires MFA completion and allowlist membership.
 * 24-hour expiry window.
 */
export interface MerchantAdminVerificationConfig {
  readonly methodName: "merchant_administrator_authority";
  readonly requiresMfa: true;
  readonly requiresAllowlistMembership: true;
  readonly expiryMilliseconds: 86_400_000;
  readonly verifierActor: "counter_platform_auth_service";
  readonly revalidationRule: "re_verify_on_each_activation_attempt";
}

export const MERCHANT_ADMIN_BLOCKING_CONDITIONS = [
  "principal_not_on_allowlist",
  "mfa_not_completed",
  "session_expired",
  "principal_merchant_mismatch",
] as const;

export type MerchantAdminBlockingCondition =
  (typeof MERCHANT_ADMIN_BLOCKING_CONDITIONS)[number];

// ─── Method 2: Domain Control or Development Store Limitation ────────────────

/**
 * Configuration for domain control verification.
 * Supports DNS/HTTP challenge or operator review for dev stores.
 * 90-day expiry window.
 */
export interface DomainControlVerificationConfig {
  readonly methodName: "domain_control_or_dev_store_limitation";
  readonly supportsDnsChallenge: true;
  readonly supportsHttpChallenge: true;
  readonly supportsOperatorReview: true;
  readonly expiryMilliseconds: 7_776_000_000;
  readonly verifierActors: readonly ["counter_domain_verifier", "counter_operator"];
  readonly revalidationRule: "re_verify_before_expiry_or_on_dns_change";
}

export const DOMAIN_CONTROL_BLOCKING_CONDITIONS = [
  "challenge_response_mismatch",
  "domain_resolves_unexpected_target",
  "operator_identifies_shop_identity_mismatch",
  "evidence_expired_without_revalidation",
] as const;

export type DomainControlBlockingCondition =
  (typeof DOMAIN_CONTROL_BLOCKING_CONDITIONS)[number];

// ─── Method 3: Shopify Shop Identity ────────────────────────────────────────

/**
 * Configuration for Shopify shop identity verification.
 * Uses OAuth install callback to verify shop ownership.
 * Event-driven expiry (uninstall/scope change) or 90-day periodic check.
 */
export interface ShopifyShopVerificationConfig {
  readonly methodName: "shopify_shop_identity";
  readonly usesOAuthCallback: true;
  readonly eventDrivenExpiry: true;
  readonly periodicCheckMilliseconds: 7_776_000_000;
  readonly expiryMilliseconds: 7_776_000_000;
  readonly verifierActor: "counter_shopify_connector";
  readonly requiredScopes: readonly [
    "read_products",
    "write_draft_orders",
    "read_orders",
    "write_orders",
    "read_inventory",
  ];
  readonly revalidationRule: "re_verify_on_scope_change_or_reinstall_or_periodic";
}

export const SHOPIFY_SHOP_BLOCKING_CONDITIONS = [
  "shop_domain_mismatch",
  "missing_required_scopes",
  "oauth_flow_incomplete",
  "token_validation_failure",
  "shop_merchant_subject_mismatch",
] as const;

export type ShopifyShopBlockingCondition =
  (typeof SHOPIFY_SHOP_BLOCKING_CONDITIONS)[number];

// ─── Method 4: Razorpay Test Account Ownership ──────────────────────────────

/**
 * Configuration for Razorpay test account ownership verification.
 * Uses formal operator review as primary verification path.
 * 90-day expiry window.
 */
export interface RazorpayTestAccountVerificationConfig {
  readonly methodName: "razorpay_test_account_ownership";
  readonly requiresFormalOperatorReview: true;
  readonly isPrimaryPathManualReview: true;
  readonly expiryMilliseconds: 7_776_000_000;
  readonly verifierActor: "counter_operator";
  readonly revalidationRule: "re_verify_before_expiry_or_on_account_change";
}

export const RAZORPAY_BLOCKING_CONDITIONS = [
  "business_name_mismatch",
  "key_id_not_test_prefix",
  "test_api_call_fails",
  "reviewer_cannot_confirm_ownership",
  "evidence_expired_without_revalidation",
] as const;

export type RazorpayBlockingCondition =
  (typeof RAZORPAY_BLOCKING_CONDITIONS)[number];
