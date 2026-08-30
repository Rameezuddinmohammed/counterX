import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import type { Instant, Sha256Digest } from "@counter/domain";
import {
  createVerificationRecord,
  isVerificationExpired,
  isVerificationBlocking,
  checkAllVerificationsComplete,
  revalidateVerification,
} from "./index.js";
import type {
  MerchantOwnershipVerification,
  VerificationMethodName,
  VerificationTargetType,
} from "./index.js";

// --- Test Helpers ---

const NOW = 1_700_000_000_000 as Instant;
const LATER = 1_700_001_000_000 as Instant;
const EXPIRY = 1_700_100_000_000 as Instant;
const PAST_EXPIRY = 1_700_200_000_000 as Instant;
const VALID_DIGEST_2 = `sha256:${"b".repeat(64)}` as Sha256Digest;

const METHOD_TARGET_PAIRS: ReadonlyArray<{
  method_name: VerificationMethodName;
  target_type: VerificationTargetType;
  target_id: string;
  subject: string;
}> = [
  {
    method_name: "merchant_administrator_authority",
    target_type: "merchant_admin",
    target_id: "admin@merchant.com",
    subject: "Merchant Corp Legal",
  },
  {
    method_name: "domain_control_or_dev_store_limitation",
    target_type: "domain",
    target_id: "shop.merchant.com",
    subject: "Merchant Corp Legal",
  },
  {
    method_name: "shopify_shop_identity",
    target_type: "shopify_shop",
    target_id: "my-shop.myshopify.com",
    subject: "Merchant Corp Legal",
  },
  {
    method_name: "razorpay_test_account_ownership",
    target_type: "razorpay_account",
    target_id: "rzp_test_abc123",
    subject: "Merchant Corp Legal",
  },
];

function makeValidRecordInput(
  method_name: VerificationMethodName,
  target_type: VerificationTargetType,
  target_id: string,
  subject: string,
  result_type = "VERIFIED",
) {
  return {
    target_type,
    target_id,
    subject,
    method_name,
    verifier_actor: "counter_platform_auth_service",
    evidence_reference: `sha256:${"a".repeat(64)}`,
    observed_time: NOW,
    expiry_time: EXPIRY,
    result_type,
    revalidation_rule: "re_verify_on_each_activation_attempt",
    manual_review_fallback: "escalate_to_operations_team",
  };
}

function createVerifiedRecord(
  method_name: VerificationMethodName,
  target_type: VerificationTargetType,
  target_id: string,
  subject: string,
): MerchantOwnershipVerification {
  const result = createVerificationRecord(
    makeValidRecordInput(method_name, target_type, target_id, subject, "VERIFIED"),
  );
  if (!result.ok) throw new Error(`Failed to create record: ${result.error.message}`);
  return result.value;
}

// --- Tests ---

describe("verification negative tests", () => {
  describe("valid record creation for each method", () => {
    for (const pair of METHOD_TARGET_PAIRS) {
      it(`creates a valid record for ${pair.method_name}`, () => {
        const result = createVerificationRecord(
          makeValidRecordInput(pair.method_name, pair.target_type, pair.target_id, pair.subject),
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.method_name).toBe(pair.method_name);
          expect(result.value.target_type).toBe(pair.target_type);
          expect(result.value.result_type).toBe("VERIFIED");
          expect(Object.isFrozen(result.value)).toBe(true);
        }
      });
    }
  });

  describe("BLOCKED result handling", () => {
    it("record with BLOCKED result_type is created successfully", () => {
      const result = createVerificationRecord(
        makeValidRecordInput(
          "domain_control_or_dev_store_limitation",
          "domain",
          "wrong-domain.com",
          "Merchant Corp Legal",
          "BLOCKED",
        ),
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.result_type).toBe("BLOCKED");
      }
    });

    it("isVerificationBlocking returns true for BLOCKED result", () => {
      const record = createVerificationRecord(
        makeValidRecordInput(
          "domain_control_or_dev_store_limitation",
          "domain",
          "wrong-domain.com",
          "Merchant Corp Legal",
          "BLOCKED",
        ),
      );
      expect(record.ok).toBe(true);
      if (record.ok) {
        expect(isVerificationBlocking(record.value)).toBe(true);
      }
    });
  });

  describe("expired verification", () => {
    it("isVerificationExpired returns true after expiry_time", () => {
      const record = createVerifiedRecord(
        "merchant_administrator_authority",
        "merchant_admin",
        "admin@merchant.com",
        "Merchant Corp Legal",
      );
      expect(isVerificationExpired(record, PAST_EXPIRY)).toBe(true);
    });

    it("isVerificationExpired returns false before expiry_time", () => {
      const record = createVerifiedRecord(
        "merchant_administrator_authority",
        "merchant_admin",
        "admin@merchant.com",
        "Merchant Corp Legal",
      );
      expect(isVerificationExpired(record, LATER)).toBe(false);
    });
  });

  describe("revoked OAuth (shopify_shop_identity)", () => {
    it("record with BLOCKED result blocks activation", () => {
      const blockedRecord = createVerificationRecord(
        makeValidRecordInput(
          "shopify_shop_identity",
          "shopify_shop",
          "my-shop.myshopify.com",
          "Merchant Corp Legal",
          "BLOCKED",
        ),
      );
      expect(blockedRecord.ok).toBe(true);
      if (blockedRecord.ok) {
        expect(isVerificationBlocking(blockedRecord.value)).toBe(true);
      }
    });
  });

  describe("wrong provider account (razorpay)", () => {
    it("razorpay key not rzp_test_ prefix creates BLOCKED record", () => {
      const result = createVerificationRecord(
        makeValidRecordInput(
          "razorpay_test_account_ownership",
          "razorpay_account",
          "rzp_live_invalid_key",
          "Merchant Corp Legal",
          "BLOCKED",
        ),
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.result_type).toBe("BLOCKED");
        expect(isVerificationBlocking(result.value)).toBe(true);
      }
    });
  });

  describe("mismatched legal subject", () => {
    it("different subject between records means they do not represent same merchant", () => {
      const record1 = createVerifiedRecord(
        "merchant_administrator_authority",
        "merchant_admin",
        "admin@merchant.com",
        "Merchant Corp A",
      );
      const record2 = createVerifiedRecord(
        "domain_control_or_dev_store_limitation",
        "domain",
        "shop.merchant.com",
        "Merchant Corp B",
      );
      expect(record1.subject).not.toBe(record2.subject);
    });
  });

  describe("checkAllVerificationsComplete", () => {
    it("fails with only 3 of 4 methods VERIFIED", () => {
      const records = METHOD_TARGET_PAIRS.slice(0, 3).map((p) =>
        createVerifiedRecord(p.method_name, p.target_type, p.target_id, p.subject),
      );
      const result = checkAllVerificationsComplete(records, LATER);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("UNSUPPORTED_VALUE");
      }
    });

    it("succeeds with all 4 methods VERIFIED and not expired", () => {
      const records = METHOD_TARGET_PAIRS.map((p) =>
        createVerifiedRecord(p.method_name, p.target_type, p.target_id, p.subject),
      );
      const result = checkAllVerificationsComplete(records, LATER);
      expect(result.ok).toBe(true);
    });

    it("expired single method fails checkAllVerificationsComplete even if previously VERIFIED", () => {
      const records = METHOD_TARGET_PAIRS.map((p) =>
        createVerifiedRecord(p.method_name, p.target_type, p.target_id, p.subject),
      );
      const result = checkAllVerificationsComplete(records, PAST_EXPIRY);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("OUT_OF_RANGE");
      }
    });

    it("BLOCKED record for one method fails the check", () => {
      const records = METHOD_TARGET_PAIRS.map((p, i) => {
        if (i === 2) {
          const r = createVerificationRecord(
            makeValidRecordInput(p.method_name, p.target_type, p.target_id, p.subject, "BLOCKED"),
          );
          if (!r.ok) throw new Error("unreachable");
          return r.value;
        }
        return createVerifiedRecord(p.method_name, p.target_type, p.target_id, p.subject);
      });
      const result = checkAllVerificationsComplete(records, LATER);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("UNSUPPORTED_VALUE");
      }
    });
  });

  describe("revalidation preserves identity", () => {
    it("after revalidateVerification, target_type/target_id/subject/method_name are unchanged", () => {
      const original = createVerifiedRecord(
        "shopify_shop_identity",
        "shopify_shop",
        "my-shop.myshopify.com",
        "Merchant Corp Legal",
      );

      const newObserved = 1_700_050_000_000 as Instant;
      const newExpiry = 1_700_150_000_000 as Instant;

      const result = revalidateVerification(original, VALID_DIGEST_2, newObserved, newExpiry);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.target_type).toBe(original.target_type);
        expect(result.value.target_id).toBe(original.target_id);
        expect(result.value.subject).toBe(original.subject);
        expect(result.value.method_name).toBe(original.method_name);
        expect(result.value.evidence_reference).toBe(VALID_DIGEST_2);
        expect(result.value.observed_time).toBe(newObserved);
        expect(result.value.expiry_time).toBe(newExpiry);
        expect(result.value.result_type).toBe("VERIFIED");
        expect(Object.isFrozen(result.value)).toBe(true);
      }
    });

    it("revalidateVerification rejects newExpiryTime <= newObservedTime", () => {
      const original = createVerifiedRecord(
        "merchant_administrator_authority",
        "merchant_admin",
        "admin@merchant.com",
        "Merchant Corp Legal",
      );

      const result = revalidateVerification(original, VALID_DIGEST_2, LATER, NOW);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("OUT_OF_RANGE");
      }
    });
  });

  describe("manual review (PENDING_REVIEW)", () => {
    it("PENDING_REVIEW is not blocking but does not satisfy checkAllVerificationsComplete", () => {
      const pendingRecord = createVerificationRecord(
        makeValidRecordInput(
          "merchant_administrator_authority",
          "merchant_admin",
          "admin@merchant.com",
          "Merchant Corp Legal",
          "PENDING_REVIEW",
        ),
      );
      expect(pendingRecord.ok).toBe(true);
      if (!pendingRecord.ok) return;

      expect(isVerificationBlocking(pendingRecord.value)).toBe(false);

      const otherRecords = METHOD_TARGET_PAIRS.slice(1).map((p) =>
        createVerifiedRecord(p.method_name, p.target_type, p.target_id, p.subject),
      );

      const allRecords = [pendingRecord.value, ...otherRecords];
      const result = checkAllVerificationsComplete(allRecords, LATER);
      expect(result.ok).toBe(false);
    });
  });

  describe("property-based tests", () => {
    it("property: for any random set of < 4 verification records, checkAllVerificationsComplete returns err", () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 3 }), (count) => {
          const records = METHOD_TARGET_PAIRS.slice(0, count).map((p) =>
            createVerifiedRecord(p.method_name, p.target_type, p.target_id, p.subject),
          );
          const result = checkAllVerificationsComplete(records, LATER);
          expect(result.ok).toBe(false);
        }),
      );
    });
  });
});
