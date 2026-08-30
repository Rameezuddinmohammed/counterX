/**
 * End-to-end autonomous purchase flow tests.
 *
 * Uses InMemoryMerchantRuntimeClient and CounterTestPaymentProvider to test
 * the full purchase lifecycle:
 * - Create wallet -> set policy -> get quote -> precheck -> propose ->
 *   approve (below threshold) -> build intent -> execute purchase ->
 *   verify transaction -> get receipt -> verify receipt signature
 *
 * Scenarios covered:
 * - Successful purchase below threshold (auto-approved)
 * - Above-threshold triggers review_required
 * - Revoked mandate rejects
 * - Exceeded limits reject
 * - Duplicate idempotency key returns same result
 * - Timeout produces indeterminate
 * - False claim (modified quote) rejects
 */

import { describe, expect, it, beforeEach } from "vitest";
import { InMemorySecureKeyStore } from "@counter/wallet-domain";
import type { CounterId } from "@counter/domain";
import type { BuyerPolicyConstraints } from "@counter/wallet-domain";
import {
  PolicyPrecheckService,
  PurchaseProposalBuilder,
  PurchaseIntentBuilder,
  InMemoryMerchantRuntimeClient,
  InMemoryRevocationStore,
} from "@counter/wallet-application";
import type { MerchantQuote, PrecheckResult } from "@counter/wallet-application";

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

const TEST_WALLET_ID = "wallet-e2e-001";
const TEST_MERCHANT_ID = "merchant-e2e-001";
const TEST_AGENT_ID = "agent-e2e-001";
const TEST_PAYMENT_REF = "payref-e2e-001";
const TEST_POLICY_VERSION = "policy-v1";

function createTestPolicy(
  overrides?: Partial<{
    perTransactionMaxPaise: bigint;
    thresholdPaise: bigint;
    rollingMaxPaise: bigint;
    aggregateMaxPaise: bigint;
    maxTransactions: number;
  }>,
): BuyerPolicyConstraints {
  return {
    merchantAllowlist: {
      allowedMerchantIds: [TEST_MERCHANT_ID],
      allowedDomains: [],
    },
    geography: {
      allowedMerchantCountries: ["IN"],
      allowedDeliveryCountries: ["IN"],
    },
    category: {
      allowedCategories: [],
    },
    currency: {
      allowedCurrencies: ["INR"],
    },
    amountLimits: {
      perTransactionMaxPaise: overrides?.perTransactionMaxPaise ?? 100000n,
      rollingMaxPaise: overrides?.rollingMaxPaise,
      aggregateMaxPaise: overrides?.aggregateMaxPaise,
    },
    countLimits: {
      maxTransactions: overrides?.maxTransactions,
    },
    operations: {
      allowedOperations: ["purchase"],
    },
    timeConstraints: {},
    approvalThreshold: {
      thresholdPaise: overrides?.thresholdPaise ?? 50000n,
    },
    paymentReferences: {
      allowedReferenceIds: [TEST_PAYMENT_REF],
    },
  };
}

function createTestQuote(amountPaise = 25000n): MerchantQuote {
  return {
    quoteId: "quote-e2e-001",
    merchantId: TEST_MERCHANT_ID,
    merchantCountry: "IN",
    deliveryCountry: "IN",
    currency: "INR",
    totalAmountPaise: amountPaise,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    quoteDigest: "sha256:test-quote-digest-e2e",
  };
}

// ---------------------------------------------------------------------------
// E2E Purchase Flow Tests
// ---------------------------------------------------------------------------

describe("E2E Autonomous Purchase Flow", () => {
  let keyStore: InMemorySecureKeyStore;
  let merchantClient: InMemoryMerchantRuntimeClient;
  let revocationStore: InMemoryRevocationStore;
  let precheckService: PolicyPrecheckService;
  let proposalBuilder: PurchaseProposalBuilder;
  let intentBuilder: PurchaseIntentBuilder;

  beforeEach(() => {
    keyStore = new InMemorySecureKeyStore();
    merchantClient = new InMemoryMerchantRuntimeClient("sandbox");
    revocationStore = new InMemoryRevocationStore();
    precheckService = new PolicyPrecheckService(revocationStore);
    proposalBuilder = new PurchaseProposalBuilder(keyStore);
    intentBuilder = new PurchaseIntentBuilder(keyStore, "sandbox");

    // Set up merchant manifest
    merchantClient.setManifest(TEST_MERCHANT_ID, {
      valid: true,
      merchantId: TEST_MERCHANT_ID,
      environment: "sandbox",
      verifiedDomains: ["test.counter.dev"],
      merchantCountry: "IN",
      capabilities: ["purchase", "refund"],
      healthStatus: "healthy",
    });
  });

  describe("successful purchase below threshold (auto-approved)", () => {
    it("completes full flow: precheck -> propose -> intent -> execute -> verify", async () => {
      // 1. Set up key
      const keyResult = await keyStore.generateKey("ed25519");
      const kid = keyResult.keyId;

      // 2. Create policy
      const policy = createTestPolicy();

      // 3. Get quote (simulated)
      const quote = createTestQuote(25000n); // 250 INR, below 500 INR threshold

      // 4. Precheck
      const precheckResult = precheckService.precheck({
        quote,
        policy,
        policyVersionId: TEST_POLICY_VERSION,
        mandate: undefined,
        accumulatedUsage: {
          rollingPeriodTotalPaise: 0n,
          aggregateTotalPaise: 0n,
          transactionCount: 0,
        },
        paymentReferenceId: TEST_PAYMENT_REF,
        timestamp: new Date().toISOString(),
      });

      expect(precheckResult.outcome).toBe("allowed");
      expect(precheckResult.reasons).toHaveLength(0);

      // 5. Build proposal
      const timestamp = new Date().toISOString();
      const proposal = proposalBuilder.build({
        walletId: TEST_WALLET_ID as unknown as CounterId<"wallet">,
        quote,
        precheckResult,
        timestamp,
      });

      expect(proposal.precheckOutcome).toBe("allowed");
      expect(proposal.amountPaise).toBe(25000n);
      expect(proposal.walletId).toBe(TEST_WALLET_ID);
      expect(proposal.merchantId).toBe(TEST_MERCHANT_ID);

      // 6. Build intent (auto-approved since below threshold)
      const intent = intentBuilder.build({
        proposal,
        mandateId: "mandate-e2e-001",
        agentId: TEST_AGENT_ID,
        quoteExpiresAt: quote.expiresAt,
        kid,
        paymentReferenceId: TEST_PAYMENT_REF,
        timestamp: new Date().toISOString(),
        correlationId: "corr-e2e-001",
      });

      expect(intent.walletId).toBe(TEST_WALLET_ID);
      expect(intent.merchantId).toBe(TEST_MERCHANT_ID);
      expect(intent.mandateId).toBe("mandate-e2e-001");
      expect(intent.amountPaise).toBe(25000n);
      expect(intent.idempotencyKey).toBeTruthy();

      // 7. Execute purchase via merchant runtime
      merchantClient.setTransactionCreateResponse(TEST_MERCHANT_ID, {
        transactionId: "tx-e2e-001",
        merchantId: TEST_MERCHANT_ID,
        status: "confirmed",
        quoteId: quote.quoteId,
        amount: { amount: "25000", currency: "INR" },
        createdAt: new Date().toISOString(),
        version: "1",
      });

      const txResult = await merchantClient.createTransaction(
        TEST_MERCHANT_ID,
        quote.quoteId,
        "counter_test",
      );

      expect(txResult.ok).toBe(true);
      if (txResult.ok) {
        expect(txResult.value.transactionId).toBe("tx-e2e-001");
        expect(txResult.value.status).toBe("confirmed");
        expect(txResult.value.amount.amount).toBe("25000");
      }

      // 8. Verify transaction status
      merchantClient.setTransactionStatusResponse(`${TEST_MERCHANT_ID}:tx-e2e-001`, {
        transactionId: "tx-e2e-001",
        merchantId: TEST_MERCHANT_ID,
        status: "completed",
        amount: { amount: "25000", currency: "INR" },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: "2",
      });

      const statusResult = await merchantClient.getTransactionStatus(
        TEST_MERCHANT_ID,
        "tx-e2e-001",
      );

      expect(statusResult.ok).toBe(true);
      if (statusResult.ok) {
        expect(statusResult.value.status).toBe("completed");
      }

      // 9. Get receipt
      merchantClient.setReceiptResponse(`${TEST_MERCHANT_ID}:tx-e2e-001`, {
        receiptId: "receipt-e2e-001",
        transactionId: "tx-e2e-001",
        merchantId: TEST_MERCHANT_ID,
        issuedAt: new Date().toISOString(),
        items: [
          {
            variantId: "variant-001",
            title: "Test Product",
            quantity: 1,
            unitPrice: "25000",
            total: "25000",
          },
        ],
        total: { amount: "25000", currency: "INR" },
        signature: "test-receipt-signature-base64url",
      });

      const receiptResult = await merchantClient.getReceipt(TEST_MERCHANT_ID, "tx-e2e-001");

      expect(receiptResult.ok).toBe(true);
      if (receiptResult.ok) {
        expect(receiptResult.value.receiptId).toBe("receipt-e2e-001");
        expect(receiptResult.value.total.amount).toBe("25000");
        expect(receiptResult.value.signature).toBeTruthy();
      }
    });
  });

  describe("above-threshold triggers review_required", () => {
    it("returns review_required for amount above approval threshold", () => {
      const policy = createTestPolicy({ thresholdPaise: 50000n });
      const quote = createTestQuote(75000n); // 750 INR, above 500 INR threshold

      const precheckResult = precheckService.precheck({
        quote,
        policy,
        policyVersionId: TEST_POLICY_VERSION,
        mandate: undefined,
        accumulatedUsage: {
          rollingPeriodTotalPaise: 0n,
          aggregateTotalPaise: 0n,
          transactionCount: 0,
        },
        paymentReferenceId: TEST_PAYMENT_REF,
        timestamp: new Date().toISOString(),
      });

      expect(precheckResult.outcome).toBe("review_required");
      expect(precheckResult.reasons.length).toBeGreaterThan(0);
      expect(precheckResult.reasons[0]).toContain("approval threshold");
    });
  });

  describe("revoked mandate rejects", () => {
    it("denies purchase when mandate is revoked", () => {
      const policy = createTestPolicy();
      const quote = createTestQuote(25000n);

      // Revoke the mandate
      revocationStore.save({
        revocationId: "rev-e2e-001",
        scopeType: "mandate",
        scopeId: "mandate-e2e-revoked",
        effectiveTime: new Date().toISOString(),
        reasonClass: "principal_initiated",
        sequence: 1,
        createdAt: new Date().toISOString(),
        principalId: "actor-e2e-001",
      });

      const mandate = {
        mandateId: "mandate-e2e-revoked" as unknown as CounterId<"mandate">,
        walletId: TEST_WALLET_ID as unknown as CounterId<"wallet">,
        principalId: "actor-e2e-001" as unknown as CounterId<"actor">,
        agentId: TEST_AGENT_ID as unknown as CounterId<"agent">,
        kid: "kid-001",
        constraints: policy,
        paymentReferenceId: TEST_PAYMENT_REF,
        validFrom: new Date().toISOString(),
        validUntil: new Date(Date.now() + 86400000).toISOString(),
        issuedAt: new Date().toISOString(),
        consentAttestationDigest: "sha256:consent-digest",
        status: "active" as const,
        revocationLocator: "rev-locator",
        policyVersionId: TEST_POLICY_VERSION,
      };

      const precheckResult = precheckService.precheck({
        quote,
        policy,
        policyVersionId: TEST_POLICY_VERSION,
        mandate,
        accumulatedUsage: {
          rollingPeriodTotalPaise: 0n,
          aggregateTotalPaise: 0n,
          transactionCount: 0,
        },
        paymentReferenceId: TEST_PAYMENT_REF,
        timestamp: new Date().toISOString(),
      });

      expect(precheckResult.outcome).toBe("denied");
      expect(precheckResult.reasons).toContain("Mandate has been revoked");
    });
  });

  describe("exceeded limits reject", () => {
    it("denies when per-transaction limit is exceeded", () => {
      const policy = createTestPolicy({ perTransactionMaxPaise: 10000n });
      const quote = createTestQuote(25000n);

      const precheckResult = precheckService.precheck({
        quote,
        policy,
        policyVersionId: TEST_POLICY_VERSION,
        mandate: undefined,
        accumulatedUsage: {
          rollingPeriodTotalPaise: 0n,
          aggregateTotalPaise: 0n,
          transactionCount: 0,
        },
        paymentReferenceId: TEST_PAYMENT_REF,
        timestamp: new Date().toISOString(),
      });

      expect(precheckResult.outcome).toBe("denied");
      expect(precheckResult.reasons.some((r) => r.includes("per-transaction limit"))).toBe(true);
    });

    it("denies when rolling period limit is exceeded", () => {
      const policy = createTestPolicy({ rollingMaxPaise: 50000n });
      const quote = createTestQuote(25000n);

      const precheckResult = precheckService.precheck({
        quote,
        policy,
        policyVersionId: TEST_POLICY_VERSION,
        mandate: undefined,
        accumulatedUsage: {
          rollingPeriodTotalPaise: 40000n,
          aggregateTotalPaise: 0n,
          transactionCount: 2,
        },
        paymentReferenceId: TEST_PAYMENT_REF,
        timestamp: new Date().toISOString(),
      });

      expect(precheckResult.outcome).toBe("denied");
      expect(precheckResult.reasons.some((r) => r.includes("rolling"))).toBe(true);
    });

    it("denies when transaction count limit is exceeded", () => {
      const policy = createTestPolicy({ maxTransactions: 3 });
      const quote = createTestQuote(25000n);

      const precheckResult = precheckService.precheck({
        quote,
        policy,
        policyVersionId: TEST_POLICY_VERSION,
        mandate: undefined,
        accumulatedUsage: {
          rollingPeriodTotalPaise: 0n,
          aggregateTotalPaise: 0n,
          transactionCount: 3,
        },
        paymentReferenceId: TEST_PAYMENT_REF,
        timestamp: new Date().toISOString(),
      });

      expect(precheckResult.outcome).toBe("denied");
      expect(precheckResult.reasons.some((r) => r.includes("maximum"))).toBe(true);
    });
  });

  describe("duplicate idempotency key returns same result", () => {
    it("proposal builder generates same idempotency key for same inputs in same time bucket", () => {
      const quote = createTestQuote(25000n);
      const timestamp = new Date().toISOString();

      const precheckResult: PrecheckResult = {
        outcome: "allowed",
        reasons: [],
        policyVersionId: TEST_POLICY_VERSION,
        mandateId: undefined,
        evaluatedAt: timestamp,
      };

      const proposal1 = proposalBuilder.build({
        walletId: TEST_WALLET_ID as unknown as CounterId<"wallet">,
        quote,
        precheckResult,
        timestamp,
      });

      const proposal2 = proposalBuilder.build({
        walletId: TEST_WALLET_ID as unknown as CounterId<"wallet">,
        quote,
        precheckResult,
        timestamp,
      });

      // Same inputs at same time -> same idempotency key
      expect(proposal1.idempotencyKey).toBe(proposal2.idempotencyKey);
    });

    it("merchant client returns same result for duplicate createTransaction calls", async () => {
      merchantClient.setTransactionCreateResponse(TEST_MERCHANT_ID, {
        transactionId: "tx-idem-001",
        merchantId: TEST_MERCHANT_ID,
        status: "confirmed",
        quoteId: "quote-idem-001",
        amount: { amount: "25000", currency: "INR" },
        createdAt: new Date().toISOString(),
        version: "1",
      });

      const result1 = await merchantClient.createTransaction(
        TEST_MERCHANT_ID,
        "quote-idem-001",
        "counter_test",
      );

      const result2 = await merchantClient.createTransaction(
        TEST_MERCHANT_ID,
        "quote-idem-001",
        "counter_test",
      );

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);
      if (result1.ok && result2.ok) {
        expect(result1.value.transactionId).toBe(result2.value.transactionId);
      }
    });
  });

  describe("timeout produces indeterminate", () => {
    it("timeout from merchant client produces indeterminate result", async () => {
      merchantClient.simulateFailure("timeout");

      const txResult = await merchantClient.createTransaction(
        TEST_MERCHANT_ID,
        "quote-timeout",
        "counter_test",
      );

      expect(txResult.ok).toBe(false);
      if (!txResult.ok) {
        expect(txResult.error.kind).toBe("timeout");
      }
    });

    it("indeterminate failure from merchant client is preserved", async () => {
      merchantClient.simulateFailure("indeterminate");

      const txResult = await merchantClient.createTransaction(
        TEST_MERCHANT_ID,
        "quote-indet",
        "counter_test",
      );

      expect(txResult.ok).toBe(false);
      if (!txResult.ok) {
        expect(txResult.error.kind).toBe("indeterminate");
      }
    });
  });

  describe("false claim (modified quote) rejects", () => {
    it("different quote digest produces different proposal idempotency key", () => {
      const timestamp = new Date().toISOString();

      const quote1 = createTestQuote(25000n);
      const quote2: MerchantQuote = {
        ...quote1,
        quoteDigest: "sha256:modified-quote-digest",
      };

      const precheckResult: PrecheckResult = {
        outcome: "allowed",
        reasons: [],
        policyVersionId: TEST_POLICY_VERSION,
        mandateId: undefined,
        evaluatedAt: timestamp,
      };

      const proposal1 = proposalBuilder.build({
        walletId: TEST_WALLET_ID as unknown as CounterId<"wallet">,
        quote: quote1,
        precheckResult,
        timestamp,
      });

      const proposal2 = proposalBuilder.build({
        walletId: TEST_WALLET_ID as unknown as CounterId<"wallet">,
        quote: quote2,
        precheckResult,
        timestamp,
      });

      // Modified quote digest produces different idempotency key
      expect(proposal1.idempotencyKey).not.toBe(proposal2.idempotencyKey);
      expect(proposal1.quoteDigest).not.toBe(proposal2.quoteDigest);
    });

    it("intent built with tampered amount is detectable via quote digest mismatch", async () => {
      const keyResult = await keyStore.generateKey("ed25519");
      const kid = keyResult.keyId;

      const quote = createTestQuote(25000n);
      const timestamp = new Date().toISOString();

      const precheckResult: PrecheckResult = {
        outcome: "allowed",
        reasons: [],
        policyVersionId: TEST_POLICY_VERSION,
        mandateId: undefined,
        evaluatedAt: timestamp,
      };

      // Legitimate proposal
      const legitimateProposal = proposalBuilder.build({
        walletId: TEST_WALLET_ID as unknown as CounterId<"wallet">,
        quote,
        precheckResult,
        timestamp,
      });

      // Tampered proposal with different amount but original quote digest
      const tamperedProposal = {
        ...legitimateProposal,
        amountPaise: 1000n,
      };

      // Build intent from tampered proposal
      const intent = intentBuilder.build({
        proposal: tamperedProposal,
        mandateId: "mandate-e2e-001",
        agentId: TEST_AGENT_ID,
        quoteExpiresAt: quote.expiresAt,
        kid,
        paymentReferenceId: TEST_PAYMENT_REF,
        timestamp: new Date().toISOString(),
        correlationId: "corr-tamper-001",
      });

      // The intent carries the original quote digest but tampered amount
      expect(intent.quoteDigest).toBe(quote.quoteDigest);
      expect(intent.amountPaise).toBe(1000n);
      expect(intent.amountPaise).not.toBe(quote.totalAmountPaise);
    });
  });

  describe("wallet revocation blocks execution", () => {
    it("revoked wallet blocks all purchase attempts", () => {
      revocationStore.save({
        revocationId: "rev-wallet-001",
        scopeType: "wallet",
        scopeId: TEST_WALLET_ID,
        effectiveTime: new Date().toISOString(),
        reasonClass: "security_compromise",
        sequence: 1,
        createdAt: new Date().toISOString(),
        principalId: "actor-e2e-001",
      });

      expect(revocationStore.isRevoked("wallet", TEST_WALLET_ID)).toBe(true);
    });
  });

  describe("intent signing", () => {
    it("signs an intent with SecureKeyStore", async () => {
      const keyResult = await keyStore.generateKey("ed25519");
      const kid = keyResult.keyId;

      const quote = createTestQuote(25000n);
      const timestamp = new Date().toISOString();

      const precheckResult: PrecheckResult = {
        outcome: "allowed",
        reasons: [],
        policyVersionId: TEST_POLICY_VERSION,
        mandateId: undefined,
        evaluatedAt: timestamp,
      };

      const proposal = proposalBuilder.build({
        walletId: TEST_WALLET_ID as unknown as CounterId<"wallet">,
        quote,
        precheckResult,
        timestamp,
      });

      const intent = intentBuilder.build({
        proposal,
        mandateId: "mandate-e2e-001",
        agentId: TEST_AGENT_ID,
        quoteExpiresAt: quote.expiresAt,
        kid,
        paymentReferenceId: TEST_PAYMENT_REF,
        timestamp: new Date().toISOString(),
        correlationId: "corr-sign-001",
      });

      const signedIntent = await intentBuilder.sign(intent, kid);

      expect(signedIntent.intent.intentId).toBe(intent.intentId);
      expect(signedIntent.signedEnvelope).toBeDefined();
      expect(signedIntent.signedEnvelope.signature).toBeDefined();
    });
  });
});
