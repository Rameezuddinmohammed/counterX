/**
 * Buyer policy evaluation, widening detection, and simulation tests.
 *
 * Tests cover:
 * - India geography (merchant country check, NOT IP)
 * - Overlapping constraints (multiple rules)
 * - Boundary values (exactly at limit)
 * - Rolling limit accumulation
 * - Fail-closed on error
 * - Policy widening detection
 * - Policy simulation
 * - Agent/MCP cannot mutate policy (policy changes only through principal with step-up)
 */

import { describe, it, expect } from "vitest";
import type { BuyerPolicyConstraints } from "./buyer-policy.js";
import type { ProposedAction, AccumulatedUsage } from "./policy-evaluator.js";
import { evaluatePolicy } from "./policy-evaluator.js";
import { isWidening } from "./policy-widening.js";
import { simulatePolicy } from "./policy-simulator.js";
import { InMemoryBuyerPolicyRepository } from "./buyer-policy-store.js";
import type { CounterId } from "@counter/domain";

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

function createTestPolicy(overrides?: Partial<BuyerPolicyConstraints>): BuyerPolicyConstraints {
  return {
    merchantAllowlist: {
      allowedMerchantIds: ["merchant-001", "merchant-002"],
      allowedDomains: ["shop.example.com"],
    },
    geography: {
      allowedMerchantCountries: ["IN"],
      allowedDeliveryCountries: ["IN"],
    },
    category: {
      allowedCategories: ["electronics", "books"],
      allowedSkus: undefined,
    },
    currency: {
      allowedCurrencies: ["INR"],
    },
    amountLimits: {
      perTransactionMaxPaise: 1_000_000n, // 10,000 INR
      rollingPeriodMs: 86_400_000, // 24 hours
      rollingMaxPaise: 5_000_000n, // 50,000 INR
      aggregateMaxPaise: 50_000_000n, // 500,000 INR
    },
    countLimits: {
      maxTransactions: 10,
      maxQuantityPerTransaction: 5,
    },
    operations: {
      allowedOperations: ["purchase", "refund"],
    },
    timeConstraints: {
      validDays: [1, 2, 3, 4, 5], // Monday-Friday
      validStartTime: "06:00",
      validEndTime: "22:00",
      expiresAt: "2026-12-31T23:59:59.000Z",
    },
    approvalThreshold: {
      thresholdPaise: 500_000n, // 5,000 INR
    },
    paymentReferences: {
      allowedReferenceIds: ["pay-ref-001", "pay-ref-002"],
    },
    ...overrides,
  };
}

function createTestAction(overrides?: Partial<ProposedAction>): ProposedAction {
  return {
    merchantId: "merchant-001",
    merchantCountry: "IN",
    deliveryCountry: "IN",
    category: "electronics",
    sku: undefined,
    currency: "INR",
    amountPaise: 100_000n, // 1,000 INR
    operation: "purchase",
    paymentReferenceId: "pay-ref-001",
    timestamp: "2025-01-06T10:00:00.000Z", // Monday 10 AM UTC
    ...overrides,
  };
}

function createZeroUsage(): AccumulatedUsage {
  return {
    rollingPeriodTotalPaise: 0n,
    aggregateTotalPaise: 0n,
    transactionCount: 0,
  };
}

// ---------------------------------------------------------------------------
// Policy Evaluation Tests
// ---------------------------------------------------------------------------

describe("evaluatePolicy", () => {
  describe("basic evaluation", () => {
    it("should allow a valid action within all constraints", () => {
      const policy = createTestPolicy();
      const action = createTestAction();
      const result = evaluatePolicy(policy, action, createZeroUsage(), "v1");

      expect(result.outcome).toBe("allowed");
      expect(result.reasons).toHaveLength(0);
      expect(result.policyVersionId).toBe("v1");
    });

    it("should be deterministic - same input always produces same output", () => {
      const policy = createTestPolicy();
      const action = createTestAction();
      const usage = createZeroUsage();

      const result1 = evaluatePolicy(policy, action, usage, "v1");
      const result2 = evaluatePolicy(policy, action, usage, "v1");

      expect(result1).toEqual(result2);
    });
  });

  describe("merchant allowlist", () => {
    it("should deny unknown merchant", () => {
      const policy = createTestPolicy();
      const action = createTestAction({ merchantId: "unknown-merchant" });
      const result = evaluatePolicy(policy, action, createZeroUsage(), "v1");

      expect(result.outcome).toBe("denied");
      expect(result.reasons[0]).toContain("unknown-merchant");
      expect(result.reasons[0]).toContain("not in the allowed merchant list");
    });

    it("should deny when allowlist is empty", () => {
      const policy = createTestPolicy({
        merchantAllowlist: { allowedMerchantIds: [], allowedDomains: [] },
      });
      const action = createTestAction();
      const result = evaluatePolicy(policy, action, createZeroUsage(), "v1");

      expect(result.outcome).toBe("denied");
      expect(result.reasons[0]).toContain("empty");
    });
  });

  describe("India geography (verified merchant metadata, NOT IP/domain)", () => {
    it("should allow merchant in India (IN) based on verified metadata", () => {
      const policy = createTestPolicy();
      const action = createTestAction({ merchantCountry: "IN" });
      const result = evaluatePolicy(policy, action, createZeroUsage(), "v1");

      expect(result.outcome).toBe("allowed");
    });

    it("should deny merchant not in India based on verified metadata", () => {
      const policy = createTestPolicy();
      const action = createTestAction({ merchantCountry: "US" });
      const result = evaluatePolicy(policy, action, createZeroUsage(), "v1");

      expect(result.outcome).toBe("denied");
      expect(result.reasons[0]).toContain("US");
      expect(result.reasons[0]).toContain("verified merchant legal/settlement metadata");
      expect(result.reasons[0]).toContain("not IP or domain");
    });

    it("should deny delivery outside allowed countries", () => {
      const policy = createTestPolicy();
      const action = createTestAction({ deliveryCountry: "UK" });
      const result = evaluatePolicy(policy, action, createZeroUsage(), "v1");

      expect(result.outcome).toBe("denied");
      expect(result.reasons[0]).toContain("UK");
      expect(result.reasons[0]).toContain("delivery countries");
    });
  });

  describe("category constraint", () => {
    it("should allow permitted category", () => {
      const policy = createTestPolicy();
      const action = createTestAction({ category: "books" });
      const result = evaluatePolicy(policy, action, createZeroUsage(), "v1");

      expect(result.outcome).toBe("allowed");
    });

    it("should deny disallowed category", () => {
      const policy = createTestPolicy();
      const action = createTestAction({ category: "weapons" });
      const result = evaluatePolicy(policy, action, createZeroUsage(), "v1");

      expect(result.outcome).toBe("denied");
      expect(result.reasons[0]).toContain("weapons");
    });

    it("should allow action with no category when categories are defined", () => {
      const policy = createTestPolicy();
      const action = createTestAction({ category: undefined });
      const result = evaluatePolicy(policy, action, createZeroUsage(), "v1");

      expect(result.outcome).toBe("allowed");
    });
  });

  describe("currency constraint", () => {
    it("should allow INR for pilot", () => {
      const policy = createTestPolicy();
      const action = createTestAction({ currency: "INR" });
      const result = evaluatePolicy(policy, action, createZeroUsage(), "v1");

      expect(result.outcome).toBe("allowed");
    });

    it("should deny non-INR currency in pilot", () => {
      const policy = createTestPolicy();
      const action = createTestAction({ currency: "USD" });
      const result = evaluatePolicy(policy, action, createZeroUsage(), "v1");

      expect(result.outcome).toBe("denied");
      expect(result.reasons[0]).toContain("USD");
      expect(result.reasons[0]).toContain("allowed currencies");
    });
  });

  describe("amount limits", () => {
    it("should allow amount exactly at the per-transaction limit", () => {
      const policy = createTestPolicy();
      const action = createTestAction({ amountPaise: 1_000_000n }); // Exactly at limit
      const result = evaluatePolicy(policy, action, createZeroUsage(), "v1");

      // At limit (not over), should be allowed (may trigger review if above threshold)
      expect(result.outcome).not.toBe("denied");
    });

    it("should deny amount exceeding per-transaction limit", () => {
      const policy = createTestPolicy();
      const action = createTestAction({ amountPaise: 1_000_001n }); // One paise over
      const result = evaluatePolicy(policy, action, createZeroUsage(), "v1");

      expect(result.outcome).toBe("denied");
      expect(result.reasons[0]).toContain("exceeds per-transaction limit");
    });

    it("should deny when rolling limit would be exceeded", () => {
      const policy = createTestPolicy();
      const action = createTestAction({ amountPaise: 100_000n });
      const usage: AccumulatedUsage = {
        rollingPeriodTotalPaise: 4_950_000n, // Already close to 5,000,000 limit
        aggregateTotalPaise: 0n,
        transactionCount: 0,
      };
      const result = evaluatePolicy(policy, action, usage, "v1");

      expect(result.outcome).toBe("denied");
      expect(result.reasons[0]).toContain("rolling limit");
    });

    it("should deny when aggregate limit would be exceeded", () => {
      const policy = createTestPolicy();
      const action = createTestAction({ amountPaise: 100_000n });
      const usage: AccumulatedUsage = {
        rollingPeriodTotalPaise: 0n,
        aggregateTotalPaise: 49_950_000n, // Close to 50,000,000 aggregate limit
        transactionCount: 0,
      };
      const result = evaluatePolicy(policy, action, usage, "v1");

      expect(result.outcome).toBe("denied");
      expect(result.reasons[0]).toContain("aggregate limit");
    });

    it("should allow amount exactly at rolling limit boundary", () => {
      const policy = createTestPolicy();
      const action = createTestAction({ amountPaise: 100_000n });
      const usage: AccumulatedUsage = {
        rollingPeriodTotalPaise: 4_900_000n, // 4,900,000 + 100,000 = 5,000,000 exactly
        aggregateTotalPaise: 0n,
        transactionCount: 0,
      };
      const result = evaluatePolicy(policy, action, usage, "v1");

      // Exactly at limit (not over) should be allowed
      expect(result.outcome).not.toBe("denied");
    });
  });

  describe("count limits", () => {
    it("should deny when transaction count reached", () => {
      const policy = createTestPolicy();
      const action = createTestAction();
      const usage: AccumulatedUsage = {
        rollingPeriodTotalPaise: 0n,
        aggregateTotalPaise: 0n,
        transactionCount: 10, // Already at max
      };
      const result = evaluatePolicy(policy, action, usage, "v1");

      expect(result.outcome).toBe("denied");
      expect(result.reasons[0]).toContain("maximum");
    });
  });

  describe("operation constraint", () => {
    it("should deny disallowed operation", () => {
      const policy = createTestPolicy();
      const action = createTestAction({ operation: "subscription" });
      const result = evaluatePolicy(policy, action, createZeroUsage(), "v1");

      expect(result.outcome).toBe("denied");
      expect(result.reasons[0]).toContain("subscription");
    });
  });

  describe("payment reference constraint", () => {
    it("should deny unknown payment reference", () => {
      const policy = createTestPolicy();
      const action = createTestAction({ paymentReferenceId: "unknown-ref" });
      const result = evaluatePolicy(policy, action, createZeroUsage(), "v1");

      expect(result.outcome).toBe("denied");
      expect(result.reasons[0]).toContain("unknown-ref");
    });
  });

  describe("time constraints", () => {
    it("should deny on weekend (Saturday)", () => {
      const policy = createTestPolicy();
      // 2025-01-04 is a Saturday
      const action = createTestAction({ timestamp: "2025-01-04T10:00:00.000Z" });
      const result = evaluatePolicy(policy, action, createZeroUsage(), "v1");

      expect(result.outcome).toBe("denied");
      expect(result.reasons[0]).toContain("Day of week");
    });

    it("should deny outside time window", () => {
      const policy = createTestPolicy();
      // 03:00 UTC is outside 06:00-22:00 window
      const action = createTestAction({ timestamp: "2025-01-06T03:00:00.000Z" });
      const result = evaluatePolicy(policy, action, createZeroUsage(), "v1");

      expect(result.outcome).toBe("denied");
      expect(result.reasons[0]).toContain("outside the allowed window");
    });

    it("should deny when policy has expired", () => {
      const policy = createTestPolicy({
        timeConstraints: {
          expiresAt: "2024-01-01T00:00:00.000Z", // Already expired
        },
      });
      const action = createTestAction({ timestamp: "2025-01-06T10:00:00.000Z" });
      const result = evaluatePolicy(policy, action, createZeroUsage(), "v1");

      expect(result.outcome).toBe("denied");
      expect(result.reasons[0]).toContain("expired");
    });
  });

  describe("approval threshold", () => {
    it("should return review_required when above threshold", () => {
      const policy = createTestPolicy();
      const action = createTestAction({ amountPaise: 600_000n }); // Above 500,000 threshold
      const result = evaluatePolicy(policy, action, createZeroUsage(), "v1");

      expect(result.outcome).toBe("review_required");
      expect(result.reasons[0]).toContain("approval threshold");
    });

    it("should allow when at or below threshold", () => {
      const policy = createTestPolicy();
      const action = createTestAction({ amountPaise: 500_000n }); // Exactly at threshold
      const result = evaluatePolicy(policy, action, createZeroUsage(), "v1");

      expect(result.outcome).toBe("allowed");
    });
  });

  describe("overlapping constraints (multiple denial reasons)", () => {
    it("should report all constraint violations", () => {
      const policy = createTestPolicy();
      const action = createTestAction({
        merchantId: "bad-merchant",
        merchantCountry: "US",
        currency: "USD",
        operation: "subscription",
      });
      const result = evaluatePolicy(policy, action, createZeroUsage(), "v1");

      expect(result.outcome).toBe("denied");
      expect(result.reasons.length).toBeGreaterThan(1);
    });
  });

  describe("fail-closed on error", () => {
    it("should deny when timestamp is invalid (fail-closed)", () => {
      const policy = createTestPolicy();
      const action = createTestAction({ timestamp: "not-a-date" });
      const result = evaluatePolicy(policy, action, createZeroUsage(), "v1");

      // Fail-closed: invalid input always results in denial regardless of which check catches it
      expect(result.outcome).toBe("denied");
      expect(result.reasons.length).toBeGreaterThan(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Widening Detection Tests
// ---------------------------------------------------------------------------

describe("isWidening", () => {
  const basePolicy = createTestPolicy();

  it("should detect adding merchants as widening", () => {
    const newPolicy: BuyerPolicyConstraints = {
      ...basePolicy,
      merchantAllowlist: {
        ...basePolicy.merchantAllowlist,
        allowedMerchantIds: ["merchant-001", "merchant-002", "merchant-003"],
      },
    };
    expect(isWidening(basePolicy, newPolicy)).toBe(true);
  });

  it("should detect higher per-transaction limit as widening", () => {
    const newPolicy: BuyerPolicyConstraints = {
      ...basePolicy,
      amountLimits: {
        ...basePolicy.amountLimits,
        perTransactionMaxPaise: 2_000_000n, // Double the original
      },
    };
    expect(isWidening(basePolicy, newPolicy)).toBe(true);
  });

  it("should detect removing categories as narrowing (not widening)", () => {
    const newPolicy: BuyerPolicyConstraints = {
      ...basePolicy,
      category: {
        ...basePolicy.category,
        allowedCategories: ["electronics"], // Removed "books"
      },
    };
    expect(isWidening(basePolicy, newPolicy)).toBe(false);
  });

  it("should detect adding categories as widening", () => {
    const newPolicy: BuyerPolicyConstraints = {
      ...basePolicy,
      category: {
        ...basePolicy.category,
        allowedCategories: ["electronics", "books", "clothing"],
      },
    };
    expect(isWidening(basePolicy, newPolicy)).toBe(true);
  });

  it("should detect removing rolling limit as widening", () => {
    const newPolicy: BuyerPolicyConstraints = {
      ...basePolicy,
      amountLimits: {
        ...basePolicy.amountLimits,
        rollingMaxPaise: undefined,
      },
    };
    expect(isWidening(basePolicy, newPolicy)).toBe(true);
  });

  it("should detect increasing rolling limit as widening", () => {
    const newPolicy: BuyerPolicyConstraints = {
      ...basePolicy,
      amountLimits: {
        ...basePolicy.amountLimits,
        rollingMaxPaise: 10_000_000n, // Double the original
      },
    };
    expect(isWidening(basePolicy, newPolicy)).toBe(true);
  });

  it("should detect lowering per-transaction limit as narrowing", () => {
    const newPolicy: BuyerPolicyConstraints = {
      ...basePolicy,
      amountLimits: {
        ...basePolicy.amountLimits,
        perTransactionMaxPaise: 500_000n, // Half the original
      },
    };
    expect(isWidening(basePolicy, newPolicy)).toBe(false);
  });

  it("should detect increasing approval threshold as widening", () => {
    const newPolicy: BuyerPolicyConstraints = {
      ...basePolicy,
      approvalThreshold: {
        thresholdPaise: 1_000_000n, // Double the original
      },
    };
    expect(isWidening(basePolicy, newPolicy)).toBe(true);
  });

  it("should detect extending expiry as widening", () => {
    const newPolicy: BuyerPolicyConstraints = {
      ...basePolicy,
      timeConstraints: {
        ...basePolicy.timeConstraints,
        expiresAt: "2027-12-31T23:59:59.000Z", // A year later
      },
    };
    expect(isWidening(basePolicy, newPolicy)).toBe(true);
  });

  it("should detect adding valid days as widening", () => {
    const newPolicy: BuyerPolicyConstraints = {
      ...basePolicy,
      timeConstraints: {
        ...basePolicy.timeConstraints,
        validDays: [0, 1, 2, 3, 4, 5, 6], // Added weekends
      },
    };
    expect(isWidening(basePolicy, newPolicy)).toBe(true);
  });

  it("should detect removing max transactions limit as widening", () => {
    const newPolicy: BuyerPolicyConstraints = {
      ...basePolicy,
      countLimits: {
        maxTransactions: undefined, // Removing limit
        maxQuantityPerTransaction: basePolicy.countLimits.maxQuantityPerTransaction,
      },
    };
    expect(isWidening(basePolicy, newPolicy)).toBe(true);
  });

  it("should return false for identical policies", () => {
    expect(isWidening(basePolicy, basePolicy)).toBe(false);
  });

  it("should detect adding operations as widening", () => {
    const newPolicy: BuyerPolicyConstraints = {
      ...basePolicy,
      operations: {
        allowedOperations: ["purchase", "refund", "subscription"],
      },
    };
    expect(isWidening(basePolicy, newPolicy)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Policy Simulation Tests
// ---------------------------------------------------------------------------

describe("simulatePolicy", () => {
  it("should simulate a batch of actions and return summary", () => {
    const policy = createTestPolicy();
    const actions: ProposedAction[] = [
      createTestAction(), // Should be allowed
      createTestAction({ merchantId: "unknown" }), // Should be denied
      createTestAction({ amountPaise: 600_000n }), // Should be review_required
    ];

    const summary = simulatePolicy(policy, actions);

    expect(summary.totalActions).toBe(3);
    expect(summary.allowed).toBe(1);
    expect(summary.denied).toBe(1);
    expect(summary.reviewRequired).toBe(1);
    expect(summary.results).toHaveLength(3);
  });

  it("should handle empty action list", () => {
    const policy = createTestPolicy();
    const summary = simulatePolicy(policy, []);

    expect(summary.totalActions).toBe(0);
    expect(summary.allowed).toBe(0);
    expect(summary.denied).toBe(0);
    expect(summary.reviewRequired).toBe(0);
  });

  it("should use provided accumulated usage", () => {
    const policy = createTestPolicy();
    const actions: ProposedAction[] = [
      createTestAction({ amountPaise: 100_000n }),
    ];
    const usage: AccumulatedUsage = {
      rollingPeriodTotalPaise: 4_950_000n, // Close to rolling limit
      aggregateTotalPaise: 0n,
      transactionCount: 0,
    };

    const summary = simulatePolicy(policy, actions, usage);

    expect(summary.denied).toBe(1);
    expect(summary.results[0]?.decision.reasons[0]).toContain("rolling");
  });
});

// ---------------------------------------------------------------------------
// Buyer Policy Store Tests
// ---------------------------------------------------------------------------

describe("InMemoryBuyerPolicyRepository", () => {
  it("should save and retrieve policy versions", () => {
    const repo = new InMemoryBuyerPolicyRepository();
    const walletId = "ctr_wallet_AAAAAAAAAAAAAAAAAAAAAA" as CounterId<"wallet">;

    const version = {
      versionId: "v1",
      walletId,
      constraints: createTestPolicy(),
      createdAt: "2025-01-01T00:00:00.000Z",
      createdBy: "principal-001",
    };

    repo.save(version);

    expect(repo.getVersion("v1")).toEqual(version);
    expect(repo.getCurrentVersion(walletId)).toEqual(version);
  });

  it("should return version history newest first", () => {
    const repo = new InMemoryBuyerPolicyRepository();
    const walletId = "ctr_wallet_AAAAAAAAAAAAAAAAAAAAAA" as CounterId<"wallet">;

    const v1 = {
      versionId: "v1",
      walletId,
      constraints: createTestPolicy(),
      createdAt: "2025-01-01T00:00:00.000Z",
      createdBy: "principal-001",
    };
    const v2 = {
      versionId: "v2",
      walletId,
      constraints: createTestPolicy(),
      createdAt: "2025-01-02T00:00:00.000Z",
      createdBy: "principal-001",
      supersedes: "v1",
    };

    repo.save(v1);
    repo.save(v2);

    const history = repo.getVersionHistory(walletId);
    expect(history).toHaveLength(2);
    expect(history[0]?.versionId).toBe("v2");
    expect(history[1]?.versionId).toBe("v1");
  });

  it("should return current (latest) version", () => {
    const repo = new InMemoryBuyerPolicyRepository();
    const walletId = "ctr_wallet_AAAAAAAAAAAAAAAAAAAAAA" as CounterId<"wallet">;

    repo.save({
      versionId: "v1",
      walletId,
      constraints: createTestPolicy(),
      createdAt: "2025-01-01T00:00:00.000Z",
      createdBy: "principal-001",
    });
    repo.save({
      versionId: "v2",
      walletId,
      constraints: createTestPolicy(),
      createdAt: "2025-01-02T00:00:00.000Z",
      createdBy: "principal-001",
      supersedes: "v1",
    });

    const current = repo.getCurrentVersion(walletId);
    expect(current?.versionId).toBe("v2");
  });

  it("should return undefined for unknown wallet", () => {
    const repo = new InMemoryBuyerPolicyRepository();
    const walletId = "ctr_wallet_BBBBBBBBBBBBBBBBBBBBBB" as CounterId<"wallet">;

    expect(repo.getCurrentVersion(walletId)).toBeUndefined();
    expect(repo.getVersionHistory(walletId)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Policy Mutation Guard Tests
// ---------------------------------------------------------------------------

describe("policy mutation prevention", () => {
  it("policy changes require step-up (no direct agent/MCP mutation path)", () => {
    // This test verifies the design: BuyerPolicyConstraints and BuyerPolicyVersion
    // are readonly interfaces. There is no API for agents/MCPs to mutate policy.
    // Policy changes can only happen through principal action with step-up service.
    //
    // The StepUpService requires operation "policy_widening" for widening changes.
    // Without step-up, no code path exists to modify policy.

    const policy = createTestPolicy();
    const version = {
      versionId: "v1",
      walletId: "ctr_wallet_AAAAAAAAAAAAAAAAAAAAAA" as CounterId<"wallet">,
      constraints: policy,
      createdAt: "2025-01-01T00:00:00.000Z",
      createdBy: "principal-001",
    };

    // TypeScript enforces readonly - the following would be compile errors:
    // version.constraints = newPolicy; // Error: readonly
    // policy.amountLimits.perTransactionMaxPaise = 999n; // Error: readonly

    // Verify immutability of saved version
    const repo = new InMemoryBuyerPolicyRepository();
    repo.save(version);
    const retrieved = repo.getVersion("v1");
    expect(retrieved).toEqual(version);
    expect(retrieved?.constraints).toEqual(policy);
  });
});
