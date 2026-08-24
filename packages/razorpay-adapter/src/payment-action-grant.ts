/**
 * Short-lived PaymentActionGrant for the human-present certification workflow.
 *
 * A grant is bound to:
 * - transactionId
 * - version (optimistic concurrency)
 * - mandateRef
 * - approvalRef
 * - quoteDigest
 * - amount
 * - paymentRef (Razorpay order ID)
 *
 * Expiry default: 10 minutes (from PILOT.md)
 */

import type { Instant, Money } from "@counter/domain";
import { createCanonicalError, moneyEquals } from "@counter/domain";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Default grant expiry in milliseconds (10 minutes per PILOT.md). */
export const GRANT_EXPIRY_MS = 10 * 60 * 1000;

// ─── Grant Types ─────────────────────────────────────────────────────────────

export interface PaymentActionGrantBindings {
  readonly transactionId: string;
  readonly version: number;
  readonly mandateRef: string;
  readonly approvalRef: string;
  readonly quoteDigest: string;
  readonly amount: Money;
  readonly paymentRef: string;
}

export interface PaymentActionGrant {
  readonly grantId: string;
  readonly bindings: PaymentActionGrantBindings;
  readonly issuedAt: Instant;
  readonly expiresAt: Instant;
}

export interface GrantValidationResult {
  readonly valid: boolean;
  readonly reason?: string;
}

// ─── Grant Creation ──────────────────────────────────────────────────────────

/**
 * Creates a short-lived PaymentActionGrant bound to the given transaction parameters.
 */
export function createPaymentActionGrant(
  grantId: string,
  bindings: PaymentActionGrantBindings,
  issuedAt: Instant,
  expiresAt: Instant,
): PaymentActionGrant {
  return Object.freeze({
    grantId,
    bindings: Object.freeze({ ...bindings }),
    issuedAt,
    expiresAt,
  });
}

// ─── Grant Validation ────────────────────────────────────────────────────────

export interface ValidateGrantParams {
  readonly grant: PaymentActionGrant;
  readonly now: Instant;
  readonly transactionId: string;
  readonly version: number;
  readonly mandateRef: string;
  readonly approvalRef: string;
  readonly quoteDigest: string;
  readonly amount: Money;
  readonly paymentRef: string;
}

/**
 * Validates a PaymentActionGrant by checking:
 * 1. Expiry (not expired based on current time)
 * 2. All bindings match the provided parameters
 *
 * Returns a GrantValidationResult indicating validity.
 * Throws CanonicalError on expired or mismatched grants for enforcement use.
 */
export function validateGrant(params: ValidateGrantParams): GrantValidationResult {
  const { grant, now, transactionId, version, mandateRef, approvalRef, quoteDigest, amount, paymentRef } = params;

  // Check expiry
  if (now > grant.expiresAt) {
    return Object.freeze({
      valid: false,
      reason: "Grant has expired",
    });
  }

  // Check all bindings
  if (grant.bindings.transactionId !== transactionId) {
    return Object.freeze({
      valid: false,
      reason: "Transaction ID mismatch",
    });
  }

  if (grant.bindings.version !== version) {
    return Object.freeze({
      valid: false,
      reason: "Version mismatch",
    });
  }

  if (grant.bindings.mandateRef !== mandateRef) {
    return Object.freeze({
      valid: false,
      reason: "Mandate reference mismatch",
    });
  }

  if (grant.bindings.approvalRef !== approvalRef) {
    return Object.freeze({
      valid: false,
      reason: "Approval reference mismatch",
    });
  }

  if (grant.bindings.quoteDigest !== quoteDigest) {
    return Object.freeze({
      valid: false,
      reason: "Quote digest mismatch",
    });
  }

  if (!moneyEquals(grant.bindings.amount, amount)) {
    return Object.freeze({
      valid: false,
      reason: "Amount mismatch",
    });
  }

  if (grant.bindings.paymentRef !== paymentRef) {
    return Object.freeze({
      valid: false,
      reason: "Payment reference mismatch",
    });
  }

  return Object.freeze({ valid: true });
}

/**
 * Enforcing variant: throws a CanonicalError if the grant is invalid.
 */
export function enforceGrant(params: ValidateGrantParams): void {
  const result = validateGrant(params);
  if (!result.valid) {
    throw createCanonicalError({
      code: "UNAUTHORIZED",
      category: "authorization",
      message: `PaymentActionGrant validation failed: ${result.reason}`,
    });
  }
}
