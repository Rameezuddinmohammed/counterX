/**
 * Merchant ownership verification record types.
 *
 * Defines the typed verification record schema that all four ownership
 * verification methods produce. Records identify target type/ID,
 * merchant/legal subject, method, verifier actor, evidence digest,
 * observed/expiry times, result, and revalidation rule.
 */

import type { Sha256Digest, Instant } from "@counter/domain";

// ─── Verification Target Types ──────────────────────────────────────────────

export const VERIFICATION_TARGET_TYPES = [
  "merchant_admin",
  "domain",
  "shopify_shop",
  "razorpay_account",
] as const;

export type VerificationTargetType = (typeof VERIFICATION_TARGET_TYPES)[number];

const verificationTargetTypeSet: ReadonlySet<string> = new Set(VERIFICATION_TARGET_TYPES);

export function isVerificationTargetType(value: unknown): value is VerificationTargetType {
  return typeof value === "string" && verificationTargetTypeSet.has(value);
}

// ─── Verification Method Names ──────────────────────────────────────────────

export const VERIFICATION_METHOD_NAMES = [
  "merchant_administrator_authority",
  "domain_control_or_dev_store_limitation",
  "shopify_shop_identity",
  "razorpay_test_account_ownership",
] as const;

export type VerificationMethodName = (typeof VERIFICATION_METHOD_NAMES)[number];

const verificationMethodNameSet: ReadonlySet<string> = new Set(VERIFICATION_METHOD_NAMES);

export function isVerificationMethodName(value: unknown): value is VerificationMethodName {
  return typeof value === "string" && verificationMethodNameSet.has(value);
}

// ─── Verification Result Types ──────────────────────────────────────────────

export const VERIFICATION_RESULT_TYPES = [
  "VERIFIED",
  "BLOCKED",
  "EXPIRED",
  "PENDING_REVIEW",
] as const;

export type VerificationResultType = (typeof VERIFICATION_RESULT_TYPES)[number];

const verificationResultTypeSet: ReadonlySet<string> = new Set(VERIFICATION_RESULT_TYPES);

export function isVerificationResultType(value: unknown): value is VerificationResultType {
  return typeof value === "string" && verificationResultTypeSet.has(value);
}

// ─── Merchant Ownership Verification Record ─────────────────────────────────

/**
 * A typed ownership verification record conforming to the schema defined in
 * docs/merchant/verification-methods.md.
 *
 * Evidence references use Sha256Digest (content digests, not raw evidence).
 * Credential validity alone is NEVER sufficient for ownership verification.
 */
export interface MerchantOwnershipVerification {
  readonly target_type: VerificationTargetType;
  readonly target_id: string;
  readonly subject: string;
  readonly method_name: VerificationMethodName;
  readonly verifier_actor: string;
  readonly evidence_reference: Sha256Digest;
  readonly observed_time: Instant;
  readonly expiry_time: Instant;
  readonly result_type: VerificationResultType;
  readonly revalidation_rule: string;
  readonly manual_review_fallback: string;
}
