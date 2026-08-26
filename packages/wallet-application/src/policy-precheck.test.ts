import { describe, expect, it } from "vitest";
import type { BuyerPolicyConstraints } from "@counter/wallet-domain";
import type { AccumulatedUsage, WalletMandate } from "@counter/wallet-domain";
import { InMemoryRevocationStore } from "./revocation-service.js";
import { PolicyPrecheckService } from "./policy-precheck.js";
import type { MerchantQuote } from "./policy-precheck.js";

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

function createTestPolicy(overrides?: Partial<BuyerPolicyConstraints>): BuyerPolicyConstraints {
  return {
    merchantAllowlist: {
      allowedMerchantIds: ["merchant-001"],
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
      perTransactionMaxPaise: 100000n,
      rollingMaxPaise: 500000n,
      aggregateMaxPaise: 1000000n,
    },
    countLimits: {
      maxTransactions: 100,
    },
    operations: {
      allowedOperations: ["purchase"],
    },
    timeConstraints: {},
    approvalThreshold: {
      thresholdPaise: 50000n,
    },
    paymentReferences: {
      allowedReferenceIds: ["ref-001"],
    },
    ...overrides,
  };
}

function createTestQuote(overrides?: Partial<MerchantQuote>): MerchantQuote {
  return {
    quoteId: "quote-001",
    merchantId: "merchant-001",
    merchantCountry: "IN",
    deliveryCountry: "IN",
    currency: "INR",
    totalAmountPaise: 25000n,
    expiresAt: "2025-01-01T01:00:00.000Z",
    quoteDigest: "digest-abc123",
    ...overrides,
  };
}

function createTestUsage(overrides?: Partial<AccumulatedUsage>): AccumulatedUsage {
  return {
    rollingPeriodTotalPaise: 0n,
    aggregateTotalPaise: 0n,
    transactionCount: 0,
    ...overrides,
  };
}

function createTestMandate(): WalletMandate {
  return {
    mandateId: "mnd-test-001" as any,
    walletId: "wlt-test-001" as any,
    principalId: "act-test-001" as any,
    agentId: "agt-test-001" as any,
    kid: "kid-001",
    constraints: createTestPolicy(),
    paymentReferenceId: "ref-001",
    validFrom: "2024-01-01T00:00:00.000Z",
    validUntil: "2025-12-31T23:59:59.000Z",
    issuedAt: "2024-01-01T00:00:00.000Z",
    consentAttestationDigest: "consent-digest-abc",
    status: "active",
    revocationLocator: "rev:mnd-test-001",
    policyVersionId: "policy-v1",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PolicyPrecheckService", () => {
  it("returns allowed when action is within policy limits", () => {
    const store = new InMemoryRevocationStore();
    const service = new PolicyPrecheckService(store);

    const result = service.precheck({
      quote: createTestQuote(),
      policy: createTestPolicy(),
      policyVersionId: "policy-v1",
      mandate: createTestMandate(),
      accumulatedUsage: createTestUsage(),
      paymentReferenceId: "ref-001",
      timestamp: "2025-01-01T00:00:00.000Z",
    });

    expect(result.outcome).toBe("allowed");
    expect(result.reasons).toHaveLength(0);
    expect(result.policyVersionId).toBe("policy-v1");
  });

  it("returns denied when amount exceeds per-transaction limit", () => {
    const store = new InMemoryRevocationStore();
    const service = new PolicyPrecheckService(store);

    const result = service.precheck({
      quote: createTestQuote({ totalAmountPaise: 200000n }),
      policy: createTestPolicy(),
      policyVersionId: "policy-v1",
      mandate: createTestMandate(),
      accumulatedUsage: createTestUsage(),
      paymentReferenceId: "ref-001",
      timestamp: "2025-01-01T00:00:00.000Z",
    });

    expect(result.outcome).toBe("denied");
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.reasons[0]).toContain("per-transaction limit");
  });

  it("returns review_required when amount exceeds approval threshold but within limits", () => {
    const store = new InMemoryRevocationStore();
    const service = new PolicyPrecheckService(store);

    const result = service.precheck({
      quote: createTestQuote({ totalAmountPaise: 75000n }),
      policy: createTestPolicy(),
      policyVersionId: "policy-v1",
      mandate: createTestMandate(),
      accumulatedUsage: createTestUsage(),
      paymentReferenceId: "ref-001",
      timestamp: "2025-01-01T00:00:00.000Z",
    });

    expect(result.outcome).toBe("review_required");
    expect(result.reasons[0]).toContain("approval threshold");
  });

  it("returns denied when mandate is revoked", () => {
    const store = new InMemoryRevocationStore();
    store.save({
      revocationId: "rev-001",
      scopeType: "mandate",
      scopeId: "mnd-test-001",
      effectiveTime: "2024-12-01T00:00:00.000Z",
      reasonClass: "principal_initiated",
      sequence: 1,
      createdAt: "2024-12-01T00:00:00.000Z",
      principalId: "act-test-001",
    });
    const service = new PolicyPrecheckService(store);

    const result = service.precheck({
      quote: createTestQuote(),
      policy: createTestPolicy(),
      policyVersionId: "policy-v1",
      mandate: createTestMandate(),
      accumulatedUsage: createTestUsage(),
      paymentReferenceId: "ref-001",
      timestamp: "2025-01-01T00:00:00.000Z",
    });

    expect(result.outcome).toBe("denied");
    expect(result.reasons[0]).toContain("revoked");
  });

  it("returns denied when rolling limit would be exceeded", () => {
    const store = new InMemoryRevocationStore();
    const service = new PolicyPrecheckService(store);

    const result = service.precheck({
      quote: createTestQuote({ totalAmountPaise: 25000n }),
      policy: createTestPolicy(),
      policyVersionId: "policy-v1",
      mandate: createTestMandate(),
      accumulatedUsage: createTestUsage({ rollingPeriodTotalPaise: 490000n }),
      paymentReferenceId: "ref-001",
      timestamp: "2025-01-01T00:00:00.000Z",
    });

    expect(result.outcome).toBe("denied");
    expect(result.reasons[0]).toContain("Rolling period");
  });

  it("works without a mandate (policy-only check)", () => {
    const store = new InMemoryRevocationStore();
    const service = new PolicyPrecheckService(store);

    const result = service.precheck({
      quote: createTestQuote(),
      policy: createTestPolicy(),
      policyVersionId: "policy-v1",
      mandate: undefined,
      accumulatedUsage: createTestUsage(),
      paymentReferenceId: "ref-001",
      timestamp: "2025-01-01T00:00:00.000Z",
    });

    expect(result.outcome).toBe("allowed");
    expect(result.mandateId).toBeUndefined();
  });

  it("returns denied when merchant is not in allowlist", () => {
    const store = new InMemoryRevocationStore();
    const service = new PolicyPrecheckService(store);

    const result = service.precheck({
      quote: createTestQuote({ merchantId: "merchant-999" }),
      policy: createTestPolicy(),
      policyVersionId: "policy-v1",
      mandate: undefined,
      accumulatedUsage: createTestUsage(),
      paymentReferenceId: "ref-001",
      timestamp: "2025-01-01T00:00:00.000Z",
    });

    expect(result.outcome).toBe("denied");
    expect(result.reasons[0]).toContain("not in the allowed merchant list");
  });
});
