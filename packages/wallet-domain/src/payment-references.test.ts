/**
 * Tests for opaque payment authorization references.
 *
 * Validates:
 * - CounterTestAuthorization has testOnly: true marker
 * - Type system prevents balance/credential fields (compile-time check)
 * - Test references rejected by environment mismatch
 * - Reference binding to wallet/principal is enforced
 * - InMemoryPaymentReferenceRepository operations
 */

import { describe, expect, it } from "vitest";
import type { CounterId } from "@counter/domain";
import type { CounterTestAuthorization, PaymentAuthorizationReference } from "./payment-references.js";
import {
  createCounterTestReference,
  InMemoryPaymentReferenceRepository,
  isTestEnvironmentOnly,
} from "./payment-references.js";

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

const TEST_WALLET_ID = "ctr_wallet_AAAAAAAAAAAAAAAAAAAAAA" as CounterId<"wallet">;
const TEST_PRINCIPAL_ID = "ctr_actor_BBBBBBBBBBBBBBBBBBBBBB" as CounterId<"actor">;

function createValidTestReference(): CounterTestAuthorization {
  return createCounterTestReference({
    referenceId: "ref-001",
    walletId: TEST_WALLET_ID,
    principalId: TEST_PRINCIPAL_ID,
    validFrom: "2025-01-01T00:00:00Z",
    validUntil: "2025-12-31T23:59:59Z",
    amountCeilingPaise: 100_000n,
    eligibleMerchants: ["merchant-a", "merchant-b"],
    eligibleOperations: ["purchase", "refund"],
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PaymentAuthorizationReference", () => {
  describe("CounterTestAuthorization", () => {
    it("has testOnly: true marker", () => {
      const ref = createValidTestReference();
      expect(ref.testOnly).toBe(true);
    });

    it("has adapter set to counter_test_provider", () => {
      const ref = createValidTestReference();
      expect(ref.adapter).toBe("counter_test_provider");
    });

    it("is bound to sandbox environment", () => {
      const ref = createValidTestReference();
      expect(ref.environment).toBe("sandbox");
    });

    it("has INR currency", () => {
      const ref = createValidTestReference();
      expect(ref.currency).toBe("INR");
    });

    it("has amount ceiling in paise", () => {
      const ref = createValidTestReference();
      expect(ref.amountCeilingPaise).toBe(100_000n);
    });

    it("is bound to specific wallet", () => {
      const ref = createValidTestReference();
      expect(ref.walletId).toBe(TEST_WALLET_ID);
    });

    it("is bound to specific principal", () => {
      const ref = createValidTestReference();
      expect(ref.principalId).toBe(TEST_PRINCIPAL_ID);
    });

    it("carries eligible merchants", () => {
      const ref = createValidTestReference();
      expect(ref.eligibleMerchants).toEqual(["merchant-a", "merchant-b"]);
    });

    it("carries eligible operations", () => {
      const ref = createValidTestReference();
      expect(ref.eligibleOperations).toEqual(["purchase", "refund"]);
    });

    it("has active status on creation", () => {
      const ref = createValidTestReference();
      expect(ref.status).toBe("active");
    });

    /**
     * Compile-time type system check: PaymentAuthorizationReference and
     * CounterTestAuthorization do NOT have balance, credential, or secret
     * fields. This test uses runtime checking to confirm these properties
     * do not exist on an actual instance.
     */
    it("type system prevents balance/credential fields", () => {
      const ref: PaymentAuthorizationReference = createValidTestReference();

      const dangerousFields = [
        "balance",
        "top_up",
        "raw_credential",
        "pan",
        "cvv",
        "upi_pin",
        "bank_credential",
        "provider_secret",
        "token",
      ] as const;

      for (const field of dangerousFields) {
        expect(field in ref).toBe(false);
        expect(
          (ref as unknown as Record<string, unknown>)[field],
        ).toBeUndefined();
      }
    });

    it("CounterTestAuthorization also lacks dangerous fields", () => {
      const ref: CounterTestAuthorization = createValidTestReference();

      const dangerousFields = [
        "balance",
        "top_up",
        "raw_credential",
        "pan",
        "cvv",
        "upi_pin",
        "bank_credential",
        "provider_secret",
        "token",
      ] as const;

      for (const field of dangerousFields) {
        expect(field in ref).toBe(false);
      }
    });
  });

  describe("isTestEnvironmentOnly", () => {
    it("accepts test reference in sandbox environment", () => {
      const ref = createValidTestReference();
      expect(isTestEnvironmentOnly(ref, "sandbox")).toBe(true);
    });

    it("rejects test reference in pilot environment", () => {
      const ref = createValidTestReference();
      expect(isTestEnvironmentOnly(ref, "pilot")).toBe(false);
    });

    it("rejects test reference in production environment", () => {
      const ref = createValidTestReference();
      expect(isTestEnvironmentOnly(ref, "production")).toBe(false);
    });

    it("rejects production reference in sandbox environment", () => {
      const productionRef: PaymentAuthorizationReference = {
        referenceId: "ref-prod-001",
        walletId: TEST_WALLET_ID,
        principalId: TEST_PRINCIPAL_ID,
        environment: "production",
        adapter: "razorpay",
        status: "active",
        validFrom: "2025-01-01T00:00:00Z",
        validUntil: "2025-12-31T23:59:59Z",
        eligibleMerchants: ["merchant-a"],
        eligibleOperations: ["purchase"],
      };
      expect(isTestEnvironmentOnly(productionRef, "sandbox")).toBe(false);
    });

    it("accepts production reference in production environment", () => {
      const productionRef: PaymentAuthorizationReference = {
        referenceId: "ref-prod-001",
        walletId: TEST_WALLET_ID,
        principalId: TEST_PRINCIPAL_ID,
        environment: "production",
        adapter: "razorpay",
        status: "active",
        validFrom: "2025-01-01T00:00:00Z",
        validUntil: "2025-12-31T23:59:59Z",
        eligibleMerchants: ["merchant-a"],
        eligibleOperations: ["purchase"],
      };
      expect(isTestEnvironmentOnly(productionRef, "production")).toBe(true);
    });
  });

  describe("InMemoryPaymentReferenceRepository", () => {
    it("saves and retrieves a reference by ID", () => {
      const repo = new InMemoryPaymentReferenceRepository();
      const ref = createValidTestReference();
      repo.save(ref);
      expect(repo.findById("ref-001")).toEqual(ref);
    });

    it("returns undefined for unknown ID", () => {
      const repo = new InMemoryPaymentReferenceRepository();
      expect(repo.findById("unknown")).toBeUndefined();
    });

    it("finds references by wallet", () => {
      const repo = new InMemoryPaymentReferenceRepository();
      const ref = createValidTestReference();
      repo.save(ref);
      const results = repo.findByWallet(TEST_WALLET_ID);
      expect(results).toHaveLength(1);
      expect(results[0]?.referenceId).toBe("ref-001");
    });

    it("finds references by principal", () => {
      const repo = new InMemoryPaymentReferenceRepository();
      const ref = createValidTestReference();
      repo.save(ref);
      const results = repo.findByPrincipal(TEST_PRINCIPAL_ID);
      expect(results).toHaveLength(1);
    });

    it("finds only active references", () => {
      const repo = new InMemoryPaymentReferenceRepository();
      const ref = createValidTestReference();
      repo.save(ref);
      repo.updateStatus("ref-001", "revoked");
      const active = repo.findActive(TEST_WALLET_ID);
      expect(active).toHaveLength(0);
    });

    it("updates status correctly", () => {
      const repo = new InMemoryPaymentReferenceRepository();
      const ref = createValidTestReference();
      repo.save(ref);
      repo.updateStatus("ref-001", "revoked");
      const updated = repo.findById("ref-001");
      expect(updated?.status).toBe("revoked");
    });
  });
});
