/**
 * Verification service functions.
 *
 * Provides pure functions for creating, validating, and revalidating
 * merchant ownership verification records.
 */

import type { Instant, Sha256Digest, Result } from "@counter/domain";
import { createCanonicalError, ok, err, parseSha256Digest } from "@counter/domain";
import type { MerchantOwnershipVerification } from "./verification.js";
import {
  isVerificationTargetType,
  isVerificationMethodName,
  isVerificationResultType,
  VERIFICATION_METHOD_NAMES,
} from "./verification.js";

// ─── Create Verification Record ─────────────────────────────────────────────

export interface CreateVerificationRecordInput {
  readonly target_type: string;
  readonly target_id: string;
  readonly subject: string;
  readonly method_name: string;
  readonly verifier_actor: string;
  readonly evidence_reference: string;
  readonly observed_time: Instant;
  readonly expiry_time: Instant;
  readonly result_type: string;
  readonly revalidation_rule: string;
  readonly manual_review_fallback: string;
}

/**
 * Creates a verified, frozen MerchantOwnershipVerification record.
 *
 * Validates all enum fields, non-empty strings, valid Sha256Digest,
 * and that expiry_time > observed_time.
 */
export function createVerificationRecord(
  input: CreateVerificationRecordInput,
): Result<MerchantOwnershipVerification> {
  // Validate target_type
  if (!isVerificationTargetType(input.target_type)) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "UNSUPPORTED_VALUE",
        message: "Invalid verification target type",
      }),
    );
  }

  // Validate target_id non-empty
  if (input.target_id.trim().length === 0) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "INVALID_FORMAT",
        message: "Verification target_id must not be empty",
      }),
    );
  }

  // Validate subject non-empty
  if (input.subject.trim().length === 0) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "INVALID_FORMAT",
        message: "Verification subject must not be empty",
      }),
    );
  }

  // Validate method_name
  if (!isVerificationMethodName(input.method_name)) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "UNSUPPORTED_VALUE",
        message: "Invalid verification method name",
      }),
    );
  }

  // Validate verifier_actor non-empty
  if (input.verifier_actor.trim().length === 0) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "INVALID_FORMAT",
        message: "Verification verifier_actor must not be empty",
      }),
    );
  }

  // Validate evidence_reference is a valid Sha256Digest
  const digestResult = parseSha256Digest(input.evidence_reference);
  if (!digestResult.ok) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "INVALID_FORMAT",
        message: "Verification evidence_reference must be a valid SHA-256 digest",
      }),
    );
  }

  // Validate result_type
  if (!isVerificationResultType(input.result_type)) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "UNSUPPORTED_VALUE",
        message: "Invalid verification result type",
      }),
    );
  }

  // Validate expiry > observed
  if (input.expiry_time <= input.observed_time) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "OUT_OF_RANGE",
        message: "Verification expiry_time must be after observed_time",
      }),
    );
  }

  // Validate revalidation_rule non-empty
  if (input.revalidation_rule.trim().length === 0) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "INVALID_FORMAT",
        message: "Verification revalidation_rule must not be empty",
      }),
    );
  }

  // Validate manual_review_fallback non-empty
  if (input.manual_review_fallback.trim().length === 0) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "INVALID_FORMAT",
        message: "Verification manual_review_fallback must not be empty",
      }),
    );
  }

  const record: MerchantOwnershipVerification = Object.freeze({
    target_type: input.target_type,
    target_id: input.target_id,
    subject: input.subject,
    method_name: input.method_name,
    verifier_actor: input.verifier_actor,
    evidence_reference: digestResult.value,
    observed_time: input.observed_time,
    expiry_time: input.expiry_time,
    result_type: input.result_type,
    revalidation_rule: input.revalidation_rule,
    manual_review_fallback: input.manual_review_fallback,
  });

  return ok(record);
}

// ─── Expiry Check ───────────────────────────────────────────────────────────

/**
 * Returns true if the verification has expired (now >= expiry_time).
 */
export function isVerificationExpired(
  record: MerchantOwnershipVerification,
  now: Instant,
): boolean {
  return now >= record.expiry_time;
}

// ─── Blocking Check ─────────────────────────────────────────────────────────

/**
 * Returns true if the verification result is blocking (BLOCKED or EXPIRED).
 */
export function isVerificationBlocking(record: MerchantOwnershipVerification): boolean {
  return record.result_type === "BLOCKED" || record.result_type === "EXPIRED";
}

// ─── All Verifications Complete Check ───────────────────────────────────────

/**
 * Checks that all 4 verification methods are complete and VERIFIED for activation.
 *
 * Must have exactly one VERIFIED, non-expired record per method_name.
 * Returns err if any method is missing, has BLOCKED result, or is expired.
 */
export function checkAllVerificationsComplete(
  records: readonly MerchantOwnershipVerification[],
  now: Instant,
): Result<void> {
  for (const methodName of VERIFICATION_METHOD_NAMES) {
    const methodRecords = records.filter((r) => r.method_name === methodName);

    if (methodRecords.length === 0) {
      return err(
        createCanonicalError({
          category: "validation",
          code: "UNSUPPORTED_VALUE",
          message: `Missing verification for method: ${methodName}`,
        }),
      );
    }

    // Find a VERIFIED, non-expired record for this method
    const verified = methodRecords.find(
      (r) => r.result_type === "VERIFIED" && !isVerificationExpired(r, now),
    );

    if (verified === undefined) {
      // Check if there is a BLOCKED record
      const blocked = methodRecords.find((r) => r.result_type === "BLOCKED");
      if (blocked !== undefined) {
        return err(
          createCanonicalError({
            category: "validation",
            code: "UNSUPPORTED_VALUE",
            message: `Verification for method ${methodName} is blocked`,
          }),
        );
      }

      // Check if all records are expired
      const allExpired = methodRecords.every((r) => isVerificationExpired(r, now));
      if (allExpired) {
        return err(
          createCanonicalError({
            category: "validation",
            code: "OUT_OF_RANGE",
            message: `Verification for method ${methodName} has expired`,
          }),
        );
      }

      // Otherwise, no VERIFIED record found
      return err(
        createCanonicalError({
          category: "validation",
          code: "UNSUPPORTED_VALUE",
          message: `No verified record for method: ${methodName}`,
        }),
      );
    }
  }

  return ok(undefined);
}

// ─── Revalidation ───────────────────────────────────────────────────────────

/**
 * Revalidates a verification with new evidence.
 *
 * Returns a new frozen record with updated times and evidence reference,
 * preserving the same target, subject, and method fields.
 */
export function revalidateVerification(
  record: MerchantOwnershipVerification,
  newEvidenceReference: Sha256Digest,
  newObservedTime: Instant,
  newExpiryTime: Instant,
): Result<MerchantOwnershipVerification> {
  if (newExpiryTime <= newObservedTime) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "OUT_OF_RANGE",
        message: "New expiry_time must be after new observed_time",
      }),
    );
  }

  const revalidated: MerchantOwnershipVerification = Object.freeze({
    target_type: record.target_type,
    target_id: record.target_id,
    subject: record.subject,
    method_name: record.method_name,
    verifier_actor: record.verifier_actor,
    evidence_reference: newEvidenceReference,
    observed_time: newObservedTime,
    expiry_time: newExpiryTime,
    result_type: "VERIFIED" as const,
    revalidation_rule: record.revalidation_rule,
    manual_review_fallback: record.manual_review_fallback,
  });

  return ok(revalidated);
}
