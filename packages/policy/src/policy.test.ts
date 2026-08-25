/**
 * Comprehensive fast-check property tests for the bilateral policy engine.
 *
 * Categories:
 * 1. Replay determinism
 * 2. Precedence (DENY > REVIEW_REQUIRED > ALLOW)
 * 3. Boundary (amounts at/over limits, window edges)
 * 4. Missing evidence (fail closed)
 * 5. Evaluation errors (malformed constraints fail closed)
 * 6. High concurrency (limit reservations)
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { Instant, IsoCurrencyCode, Money } from "@counter/domain";
import type {
  BuyerPolicyConstraints,
  ConnectorCapabilityConstraints,
  MerchantPolicyConstraints,
  OperationType,
  PaymentMethod,
  PlatformSafetyConstraints,
  PolicyEvaluationInput,
  ProviderConstraints,
  RiskResultConstraints,
  TransactionStateConstraints,
} from "./types.js";
import type { CounterId } from "@counter/domain";
import type { DecimalQuantity, QuantityUnit } from "@counter/domain";
import { PolicyEngine } from "./engine.js";
import { InMemoryLimitStore } from "./in-memory-limit-store.js";
import { reduceToDecision } from "./intersection.js";
import { evaluateAllRules } from "./rules.js";
import type { Clock } from "@counter/domain";
import type { LimitBucket } from "./limit-store.js";

// ---------------------------------------------------------------------------
// Test helpers and arbitraries
// ---------------------------------------------------------------------------

const TEST_CURRENCY = "INR" as IsoCurrencyCode;
const TEST_NOW = 1_700_000_000_000 as Instant;

function makeTestClock(now: Instant = TEST_NOW): Clock {
  return { now: () => now };
}

function makeMoney(amountMinor: bigint, currency: IsoCurrencyCode = TEST_CURRENCY): Money {
  return Object.freeze({ amountMinor, currency });
}

function makeQuantity(value: string = "1", unit: string = "items"): DecimalQuantity {
  return Object.freeze({ value, unit: unit as QuantityUnit });
}

function makeTransactionId(): CounterId<"transaction"> {
  return "ctr_transaction_AAAAAAAAAAAAAAAAAAAAAA" as CounterId<"transaction">;
}

function makePlatformConstraints(overrides?: Partial<PlatformSafetyConstraints>): PlatformSafetyConstraints {
  return Object.freeze({
    version: 1 as const,
    source: "platform_v1",
    blockedCategories: [] as string[],
    blockedMerchants: [] as string[],
    maxTransactionAmount: makeMoney(10_000_00n),
    requiredAssuranceLevel: "basic" as const,
    blockedCountries: [] as string[],
    ...overrides,
  });
}

function makeBuyerConstraints(overrides?: Partial<BuyerPolicyConstraints>): BuyerPolicyConstraints {
  return Object.freeze({
    version: 1 as const,
    source: "buyer_v1",
    merchantAllowlist: [] as string[],
    domainAllowlist: [] as string[],
    indiaGeographyRequired: false,
    allowedCategories: [] as string[],
    allowedSkus: [] as string[],
    inrCurrencyOnly: false,
    perTransactionLimit: { maxAmount: makeMoney(5_000_00n) },
    rollingPeriodLimit: { maxAmount: makeMoney(50_000_00n), windowDurationMs: 86_400_000 },
    aggregateLimit: { maxTotalAmount: makeMoney(500_000_00n) },
    quantityLimit: { maxQuantity: makeQuantity("100") },
    countLimit: { maxCount: 50, windowDurationMs: 86_400_000 },
    allowedOperations: ["payment"] as OperationType[],
    timeWindow: {
      allowedFrom: (TEST_NOW - 1_000_000) as Instant,
      allowedUntil: (TEST_NOW + 1_000_000) as Instant,
    },
    approvalThreshold: {
      thresholdAmount: makeMoney(100_000_00n),
      requiresApproval: false,
    },
    ...overrides,
  });
}

function makeMerchantConstraints(overrides?: Partial<MerchantPolicyConstraints>): MerchantPolicyConstraints {
  return Object.freeze({
    version: 1 as const,
    source: "merchant_v1",
    allowedProducts: [] as string[],
    allowedCategories: [] as string[],
    maxQuantity: makeQuantity("1000"),
    minAmount: makeMoney(1n),
    maxAmount: makeMoney(10_000_00n),
    allowedCurrencies: [TEST_CURRENCY] as IsoCurrencyCode[],
    allowedDestinations: [] as string[],
    allowedPaymentPaths: ["upi"] as PaymentMethod[],
    timeWindow: {
      allowedFrom: (TEST_NOW - 1_000_000) as Instant,
      allowedUntil: (TEST_NOW + 1_000_000) as Instant,
    },
    ...overrides,
  });
}

function makeConnectorConstraints(overrides?: Partial<ConnectorCapabilityConstraints>): ConnectorCapabilityConstraints {
  return Object.freeze({
    version: 1 as const,
    source: "connector_v1",
    supportedOperations: ["payment"] as OperationType[],
    freshnessMaxAgeMs: 60_000,
    lastRefreshedAt: (TEST_NOW - 10_000) as Instant,
    supportedCurrencies: [TEST_CURRENCY] as IsoCurrencyCode[],
    supportedMethods: ["upi"] as PaymentMethod[],
    ...overrides,
  });
}

function makeProviderConstraints(overrides?: Partial<ProviderConstraints>): ProviderConstraints {
  return Object.freeze({
    version: 1 as const,
    source: "provider_v1",
    supportedMethods: ["upi"] as PaymentMethod[],
    supportedCurrencies: [TEST_CURRENCY] as IsoCurrencyCode[],
    minAmount: makeMoney(1n),
    maxAmount: makeMoney(10_000_00n),
    ...overrides,
  });
}

function makeRiskConstraints(overrides?: Partial<RiskResultConstraints>): RiskResultConstraints {
  return Object.freeze({
    version: 1 as const,
    source: "risk_v1",
    riskScore: 10,
    riskLevel: "low" as const,
    flags: [] as string[],
    requiredActions: [] as string[],
    ...overrides,
  });
}

function makeTransactionStateConstraints(overrides?: Partial<TransactionStateConstraints>): TransactionStateConstraints {
  return Object.freeze({
    version: 1 as const,
    source: "txn_state_v1",
    currentPhase: "initiated" as const,
    allowedTransitions: ["initiated"] as TransactionStateConstraints["allowedTransitions"],
    stateVersion: 1,
    requiredBindings: [] as string[],
    ...overrides,
  });
}

function makeValidInput(overrides?: Partial<PolicyEvaluationInput>): PolicyEvaluationInput {
  return Object.freeze({
    transactionId: makeTransactionId(),
    operationType: "payment" as OperationType,
    requestedAmount: makeMoney(1_000_00n),
    requestedAt: TEST_NOW,
    merchantId: "merchant_123",
    merchantDomain: "shop.example.com",
    merchantCategory: "electronics",
    buyerCountry: "IN",
    sku: "SKU001",
    quantity: makeQuantity("1"),
    paymentMethod: "upi" as PaymentMethod,
    destination: "dest_1",
    platform: makePlatformConstraints(),
    buyer: makeBuyerConstraints(),
    mandate: undefined,
    merchant: makeMerchantConstraints(),
    connector: makeConnectorConstraints(),
    provider: makeProviderConstraints(),
    risk: makeRiskConstraints(),
    transactionState: makeTransactionStateConstraints(),
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Fast-check arbitraries for policy inputs
// ---------------------------------------------------------------------------

const amountArb = fc.bigInt(1n, 9_999_99n);

const moneyArb = amountArb.map((a) => makeMoney(a));

const instantArb = fc.integer({ min: TEST_NOW - 500_000, max: TEST_NOW + 500_000 })
  .map((v) => v as Instant);

const operationArb: fc.Arbitrary<OperationType> = fc.constantFrom(
  "payment" as OperationType,
  "refund" as OperationType,
  "payout" as OperationType,
);

const paymentMethodArb: fc.Arbitrary<PaymentMethod> = fc.constantFrom(
  "upi" as PaymentMethod,
  "card" as PaymentMethod,
  "netbanking" as PaymentMethod,
);

const validInputArb: fc.Arbitrary<PolicyEvaluationInput> = fc.record({
  amount: moneyArb,
  requestedAt: instantArb,
  operation: operationArb,
  method: paymentMethodArb,
}).map(({ amount, requestedAt, operation, method }) =>
  makeValidInput({
    requestedAmount: amount,
    requestedAt,
    operationType: operation,
    paymentMethod: method,
    buyer: makeBuyerConstraints({
      allowedOperations: [operation],
    }),
    merchant: makeMerchantConstraints({
      allowedPaymentPaths: [method],
    }),
    connector: makeConnectorConstraints({
      supportedOperations: [operation],
      supportedMethods: [method],
      lastRefreshedAt: (requestedAt - 5_000) as Instant,
    }),
    provider: makeProviderConstraints({
      supportedMethods: [method],
    }),
  }),
);

// ---------------------------------------------------------------------------
// 1. REPLAY DETERMINISM
// ---------------------------------------------------------------------------

describe("replay determinism", () => {
  it("same inputs produce same deterministic decision", () => {
    fc.assert(
      fc.property(validInputArb, (input) => {
        const results1 = evaluateAllRules(input);
        const results2 = evaluateAllRules(input);
        const decision1 = reduceToDecision(results1, input);
        const decision2 = reduceToDecision(results2, input);

        expect(decision1.outcome).toBe(decision2.outcome);

        if (decision1.outcome === "ALLOW" && decision2.outcome === "ALLOW") {
          expect(decision1.materialInputDigest).toBe(decision2.materialInputDigest);
          expect(decision1.validUntil).toBe(decision2.validUntil);
        }
        if (decision1.outcome === "DENY" && decision2.outcome === "DENY") {
          expect(decision1.ruleIds).toEqual(decision2.ruleIds);
          expect(decision1.explanation).toBe(decision2.explanation);
        }
        if (decision1.outcome === "REVIEW_REQUIRED" && decision2.outcome === "REVIEW_REQUIRED") {
          expect(decision1.blockingRuleIds).toEqual(decision2.blockingRuleIds);
          expect(decision1.reviewReason).toBe(decision2.reviewReason);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("engine produces identical decisions for repeated evaluation", async () => {
    const engine = new PolicyEngine({
      clock: makeTestClock(),
      limitStore: undefined,
      defaultValidityMs: 300_000,
    });

    const input = makeValidInput();
    const decision1 = await engine.evaluate(input);
    const decision2 = await engine.evaluate(input);

    expect(decision1.outcome).toBe(decision2.outcome);
    if (decision1.outcome === "ALLOW" && decision2.outcome === "ALLOW") {
      expect(decision1.materialInputDigest).toBe(decision2.materialInputDigest);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. PRECEDENCE
// ---------------------------------------------------------------------------

describe("precedence", () => {
  it("DENY always wins over ALLOW and REVIEW_REQUIRED", () => {
    fc.assert(
      fc.property(amountArb, (amount) => {
        const input = makeValidInput({
          requestedAmount: makeMoney(amount),
          platform: makePlatformConstraints({
            blockedCategories: ["electronics"],
          }),
        });

        const results = evaluateAllRules(input);
        const decision = reduceToDecision(results, input);

        expect(decision.outcome).toBe("DENY");
      }),
      { numRuns: 100 },
    );
  });

  it("REVIEW_REQUIRED wins over ALLOW when no DENY", () => {
    fc.assert(
      fc.property(amountArb, (amount) => {
        // High risk level triggers REVIEW_REQUIRED
        // Ensure amount is within all limits to avoid DENY from amount checks
        const input = makeValidInput({
          requestedAmount: makeMoney(amount),
          risk: makeRiskConstraints({ riskLevel: "high" }),
          buyer: makeBuyerConstraints({
            perTransactionLimit: { maxAmount: makeMoney(10_000_00n) },
          }),
          platform: makePlatformConstraints({
            maxTransactionAmount: makeMoney(10_000_00n),
          }),
          merchant: makeMerchantConstraints({
            maxAmount: makeMoney(10_000_00n),
          }),
          provider: makeProviderConstraints({
            maxAmount: makeMoney(10_000_00n),
          }),
        });

        const results = evaluateAllRules(input);
        const decision = reduceToDecision(results, input);

        expect(decision.outcome).toBe("REVIEW_REQUIRED");
      }),
      { numRuns: 100 },
    );
  });

  it("ALLOW only when all rules pass", () => {
    fc.assert(
      fc.property(validInputArb, (input) => {
        const results = evaluateAllRules(input);
        const decision = reduceToDecision(results, input);

        if (decision.outcome === "ALLOW") {
          for (const result of results) {
            expect(result.outcome).toBe("pass");
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it("DENY beats REVIEW_REQUIRED when both present", () => {
    const input = makeValidInput({
      platform: makePlatformConstraints({ blockedCategories: ["electronics"] }),
      risk: makeRiskConstraints({ riskLevel: "high" }),
    });

    const results = evaluateAllRules(input);
    const decision = reduceToDecision(results, input);

    expect(decision.outcome).toBe("DENY");
  });
});

// ---------------------------------------------------------------------------
// 3. BOUNDARY CONDITIONS
// ---------------------------------------------------------------------------

describe("boundary conditions", () => {
  it("amount exactly at per-transaction limit produces ALLOW", () => {
    fc.assert(
      fc.property(
        fc.bigInt(1n, 100_000n),
        (limit) => {
          const input = makeValidInput({
            requestedAmount: makeMoney(limit),
            buyer: makeBuyerConstraints({
              perTransactionLimit: { maxAmount: makeMoney(limit) },
            }),
            platform: makePlatformConstraints({
              maxTransactionAmount: makeMoney(limit + 1n),
            }),
            merchant: makeMerchantConstraints({
              maxAmount: makeMoney(limit + 1n),
            }),
            provider: makeProviderConstraints({
              maxAmount: makeMoney(limit + 1n),
            }),
          });

          const results = evaluateAllRules(input);
          const decision = reduceToDecision(results, input);

          expect(decision.outcome).toBe("ALLOW");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("amount one unit over per-transaction limit produces DENY", () => {
    fc.assert(
      fc.property(
        fc.bigInt(1n, 100_000n),
        (limit) => {
          const input = makeValidInput({
            requestedAmount: makeMoney(limit + 1n),
            buyer: makeBuyerConstraints({
              perTransactionLimit: { maxAmount: makeMoney(limit) },
            }),
          });

          const results = evaluateAllRules(input);
          const decision = reduceToDecision(results, input);

          expect(decision.outcome).toBe("DENY");
          if (decision.outcome === "DENY") {
            expect(decision.ruleIds).toContain("buyer_amount_limit");
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("timestamp exactly at window boundary produces ALLOW", () => {
    const windowStart = (TEST_NOW - 100_000) as Instant;
    const windowEnd = (TEST_NOW + 100_000) as Instant;

    const inputStart = makeValidInput({
      requestedAt: windowStart,
      buyer: makeBuyerConstraints({
        timeWindow: { allowedFrom: windowStart, allowedUntil: windowEnd },
      }),
      merchant: makeMerchantConstraints({
        timeWindow: { allowedFrom: windowStart, allowedUntil: windowEnd },
      }),
      connector: makeConnectorConstraints({
        lastRefreshedAt: (windowStart - 5_000) as Instant,
      }),
    });

    const results = evaluateAllRules(inputStart);
    const decision = reduceToDecision(results, inputStart);
    expect(decision.outcome).toBe("ALLOW");
  });

  it("timestamp one ms outside window produces DENY", () => {
    const windowStart = TEST_NOW;
    const windowEnd = (TEST_NOW + 100_000) as Instant;

    const input = makeValidInput({
      requestedAt: ((windowStart as number) - 1) as Instant,
      buyer: makeBuyerConstraints({
        timeWindow: { allowedFrom: windowStart, allowedUntil: windowEnd },
      }),
      connector: makeConnectorConstraints({
        lastRefreshedAt: (((windowStart as number) - 1) - 5_000) as Instant,
      }),
    });

    const results = evaluateAllRules(input);
    const decision = reduceToDecision(results, input);
    expect(decision.outcome).toBe("DENY");
    if (decision.outcome === "DENY") {
      expect(decision.ruleIds).toContain("buyer_time_window");
    }
  });

  it("amount exactly at platform max produces ALLOW", () => {
    const limit = 5_000_00n;
    const input = makeValidInput({
      requestedAmount: makeMoney(limit),
      platform: makePlatformConstraints({
        maxTransactionAmount: makeMoney(limit),
      }),
      buyer: makeBuyerConstraints({
        perTransactionLimit: { maxAmount: makeMoney(limit + 1n) },
      }),
      merchant: makeMerchantConstraints({
        maxAmount: makeMoney(limit + 1n),
      }),
      provider: makeProviderConstraints({
        maxAmount: makeMoney(limit + 1n),
      }),
    });

    const results = evaluateAllRules(input);
    const decision = reduceToDecision(results, input);
    expect(decision.outcome).toBe("ALLOW");
  });

  it("amount one unit over platform max produces DENY", () => {
    const limit = 5_000_00n;
    const input = makeValidInput({
      requestedAmount: makeMoney(limit + 1n),
      platform: makePlatformConstraints({
        maxTransactionAmount: makeMoney(limit),
      }),
    });

    const results = evaluateAllRules(input);
    const decision = reduceToDecision(results, input);
    expect(decision.outcome).toBe("DENY");
    if (decision.outcome === "DENY") {
      expect(decision.ruleIds).toContain("platform_safety");
    }
  });
});

// ---------------------------------------------------------------------------
// 4. MISSING EVIDENCE (fail closed)
// ---------------------------------------------------------------------------

describe("missing evidence", () => {
  const requiredSources: Array<{
    name: string;
    override: Partial<PolicyEvaluationInput>;
    expectedRuleId: string;
  }> = [
    { name: "platform", override: { platform: undefined }, expectedRuleId: "missing_platform" },
    { name: "buyer", override: { buyer: undefined }, expectedRuleId: "missing_buyer" },
    { name: "merchant", override: { merchant: undefined }, expectedRuleId: "missing_merchant" },
    { name: "connector", override: { connector: undefined }, expectedRuleId: "missing_connector" },
    { name: "provider", override: { provider: undefined }, expectedRuleId: "missing_provider" },
    { name: "risk", override: { risk: undefined }, expectedRuleId: "missing_risk" },
    { name: "transactionState", override: { transactionState: undefined }, expectedRuleId: "missing_transactionState" },
  ];

  for (const { name, override, expectedRuleId } of requiredSources) {
    it(`absent ${name} constraint source produces DENY via engine`, async () => {
      const engine = new PolicyEngine({
        clock: makeTestClock(),
        limitStore: undefined,
        defaultValidityMs: 300_000,
      });

      const input = makeValidInput(override);
      const decision = await engine.evaluate(input);

      expect(decision.outcome).toBe("DENY");
      if (decision.outcome === "DENY") {
        expect(decision.ruleIds).toContain(expectedRuleId);
      }
    });
  }

  it("property: any missing required source always produces DENY", () => {
    const sourceKeys = [
      "platform",
      "buyer",
      "merchant",
      "connector",
      "provider",
      "risk",
      "transactionState",
    ] as const;

    fc.assert(
      fc.property(
        fc.constantFrom(...sourceKeys),
        (sourceToRemove) => {
          const override: Record<string, undefined> = {};
          override[sourceToRemove] = undefined;
          const input = makeValidInput(override as Partial<PolicyEvaluationInput>);

          const results = evaluateAllRules(input);
          const hasAnyDeny = results.some((r) => r.outcome === "deny");

          expect(hasAnyDeny).toBe(true);
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ---------------------------------------------------------------------------
// 5. EVALUATION ERRORS (malformed constraints fail closed)
// ---------------------------------------------------------------------------

describe("evaluation errors", () => {
  it("engine never throws on malformed input - always returns decision", async () => {
    const engine = new PolicyEngine({
      clock: makeTestClock(),
      limitStore: undefined,
      defaultValidityMs: 300_000,
    });

    const malformedInput = {
      transactionId: makeTransactionId(),
      operationType: "payment" as OperationType,
      requestedAmount: makeMoney(100n),
      requestedAt: TEST_NOW,
      merchantId: "m",
      merchantDomain: "d",
      merchantCategory: "c",
      buyerCountry: "XX",
      sku: "s",
      quantity: makeQuantity(),
      paymentMethod: "upi" as PaymentMethod,
      destination: "dest",
      platform: undefined,
      buyer: undefined,
      mandate: undefined,
      merchant: undefined,
      connector: undefined,
      provider: undefined,
      risk: undefined,
      transactionState: undefined,
    } satisfies PolicyEvaluationInput;

    const decision = await engine.evaluate(malformedInput);
    expect(decision.outcome).toBe("DENY");
  });

  it("property: malformed constraints never throw, always DENY", () => {
    fc.assert(
      fc.property(
        fc.record({
          blockedCat: fc.string(),
          riskScore: fc.double({ min: -100, max: 200 }),
        }),
        ({ blockedCat, riskScore }) => {
          const input = makeValidInput({
            merchantCategory: blockedCat,
            platform: makePlatformConstraints({
              blockedCategories: [blockedCat],
            }),
            risk: makeRiskConstraints({
              riskScore,
              riskLevel: riskScore > 80 ? "critical" : "low",
            }),
          });

          const results = evaluateAllRules(input);
          const decision = reduceToDecision(results, input);

          expect(decision.outcome).toBe("DENY");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("currency mismatch in constraints does not throw", async () => {
    const engine = new PolicyEngine({
      clock: makeTestClock(),
      limitStore: undefined,
      defaultValidityMs: 300_000,
    });

    const input = makeValidInput({
      requestedAmount: makeMoney(100n, "USD" as IsoCurrencyCode),
      merchant: makeMerchantConstraints({
        allowedCurrencies: [TEST_CURRENCY],
      }),
    });

    const decision = await engine.evaluate(input);
    expect(decision.outcome).toBe("DENY");
  });
});

// ---------------------------------------------------------------------------
// 6. HIGH CONCURRENCY
// ---------------------------------------------------------------------------

describe("high concurrency", () => {
  it("N concurrent reservations against limit N never exceed total", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 20 }),
        fc.integer({ min: 1, max: 5 }),
        async (totalSlots, extraAttempts) => {
          const store = new InMemoryLimitStore();
          const bucketId = "test_bucket";
          const bucket: LimitBucket = Object.freeze({
            bucketId,
            ownerId: "owner_1",
            limitType: "count" as const,
            currency: undefined,
            unit: undefined,
            maxValue: BigInt(totalSlots),
            windowDurationMs: 60_000,
            windowStart: TEST_NOW,
          });
          store.registerBucket(bucket);

          const totalAttempts = totalSlots + extraAttempts;
          const results = await Promise.all(
            Array.from({ length: totalAttempts }, (_, i) =>
              store.reserve(bucketId, 1n, {
                transactionId: `txn_${i}`,
                requestedAt: TEST_NOW,
                expiresAt: (TEST_NOW + 60_000) as Instant,
              }),
            ),
          );

          const successes = results.filter((r) => r.ok);
          const failures = results.filter((r) => !r.ok);

          expect(successes.length).toBe(totalSlots);
          expect(failures.length).toBe(extraAttempts);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("released reservations free capacity for new ones", async () => {
    const store = new InMemoryLimitStore();
    const bucketId = "release_bucket";
    const bucket: LimitBucket = Object.freeze({
      bucketId,
      ownerId: "owner_1",
      limitType: "amount" as const,
      currency: TEST_CURRENCY,
      unit: undefined,
      maxValue: 100n,
      windowDurationMs: 60_000,
      windowStart: TEST_NOW,
    });
    store.registerBucket(bucket);

    const r1 = await store.reserve(bucketId, 100n, {
      transactionId: "txn_1",
      requestedAt: TEST_NOW,
      expiresAt: (TEST_NOW + 60_000) as Instant,
    });
    expect(r1.ok).toBe(true);

    const r2 = await store.reserve(bucketId, 1n, {
      transactionId: "txn_2",
      requestedAt: TEST_NOW,
      expiresAt: (TEST_NOW + 60_000) as Instant,
    });
    expect(r2.ok).toBe(false);

    if (r1.ok) {
      const releaseResult = await store.release(r1.value.reservationId);
      expect(releaseResult.ok).toBe(true);
    }

    const r3 = await store.reserve(bucketId, 50n, {
      transactionId: "txn_3",
      requestedAt: TEST_NOW,
      expiresAt: (TEST_NOW + 60_000) as Instant,
    });
    expect(r3.ok).toBe(true);
  });

  it("expired reservations do not count against limit", async () => {
    const store = new InMemoryLimitStore();
    const bucketId = "expire_bucket";
    const bucket: LimitBucket = Object.freeze({
      bucketId,
      ownerId: "owner_1",
      limitType: "amount" as const,
      currency: TEST_CURRENCY,
      unit: undefined,
      maxValue: 100n,
      windowDurationMs: 60_000,
      windowStart: TEST_NOW,
    });
    store.registerBucket(bucket);

    const r1 = await store.reserve(bucketId, 100n, {
      transactionId: "txn_1",
      requestedAt: TEST_NOW,
      expiresAt: (TEST_NOW + 1) as Instant,
    });
    expect(r1.ok).toBe(true);

    const laterTime = (TEST_NOW + 100) as Instant;
    const r2 = await store.reserve(bucketId, 50n, {
      transactionId: "txn_2",
      requestedAt: laterTime,
      expiresAt: ((laterTime as number) + 60_000) as Instant,
    });
    expect(r2.ok).toBe(true);
  });

  it("property: total reserved never exceeds bucket max", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: 1, max: 30 }),
        async (maxValue, numAttempts) => {
          const store = new InMemoryLimitStore();
          const bucketId = "max_check_bucket";
          const bucket: LimitBucket = Object.freeze({
            bucketId,
            ownerId: "owner_1",
            limitType: "amount" as const,
            currency: TEST_CURRENCY,
            unit: undefined,
            maxValue: BigInt(maxValue),
            windowDurationMs: 60_000,
            windowStart: TEST_NOW,
          });
          store.registerBucket(bucket);

          const results = await Promise.all(
            Array.from({ length: numAttempts }, (_, i) =>
              store.reserve(bucketId, 1n, {
                transactionId: `txn_${i}`,
                requestedAt: TEST_NOW,
                expiresAt: (TEST_NOW + 60_000) as Instant,
              }),
            ),
          );

          const successes = results.filter((r) => r.ok).length;

          expect(successes).toBeLessThanOrEqual(maxValue);
          expect(successes).toBe(Math.min(numAttempts, maxValue));
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ---------------------------------------------------------------------------
// Integration: PolicyEngine with LimitStore
// ---------------------------------------------------------------------------

describe("engine integration with limit store", () => {
  it("ALLOW decision includes reservation ID when limit store is present", async () => {
    const store = new InMemoryLimitStore();
    const bucketId = "rolling_amount_buyer_v1";
    const bucket: LimitBucket = Object.freeze({
      bucketId,
      ownerId: "owner_1",
      limitType: "amount" as const,
      currency: TEST_CURRENCY,
      unit: undefined,
      maxValue: 10_000_00n,
      windowDurationMs: 86_400_000,
      windowStart: TEST_NOW,
    });
    store.registerBucket(bucket);

    const engine = new PolicyEngine({
      clock: makeTestClock(),
      limitStore: store,
      defaultValidityMs: 300_000,
    });

    const input = makeValidInput();
    const decision = await engine.evaluate(input);

    expect(decision.outcome).toBe("ALLOW");
    if (decision.outcome === "ALLOW") {
      expect(decision.reservationId).toBeDefined();
    }
  });

  it("reservation is released on releaseDecision", async () => {
    const store = new InMemoryLimitStore();
    const bucketId = "rolling_amount_buyer_v1";
    const bucket: LimitBucket = Object.freeze({
      bucketId,
      ownerId: "owner_1",
      limitType: "amount" as const,
      currency: TEST_CURRENCY,
      unit: undefined,
      maxValue: 10_000_00n,
      windowDurationMs: 86_400_000,
      windowStart: TEST_NOW,
    });
    store.registerBucket(bucket);

    const engine = new PolicyEngine({
      clock: makeTestClock(),
      limitStore: store,
      defaultValidityMs: 300_000,
    });

    const input = makeValidInput();
    const decision = await engine.evaluate(input);
    expect(decision.outcome).toBe("ALLOW");

    const releaseResult = await engine.releaseDecision(input.transactionId);
    expect(releaseResult.ok).toBe(true);

    const usage = await store.getCurrentUsage(bucketId, TEST_NOW, (TEST_NOW + 86_400_000) as Instant);
    expect(usage.ok).toBe(true);
    if (usage.ok) {
      expect(usage.value.reserved).toBe(0n);
    }
  });

  it("DENY when rolling limit is exceeded", async () => {
    const store = new InMemoryLimitStore();
    const bucketId = "rolling_amount_buyer_v1";
    const bucket: LimitBucket = Object.freeze({
      bucketId,
      ownerId: "owner_1",
      limitType: "amount" as const,
      currency: TEST_CURRENCY,
      unit: undefined,
      maxValue: 500n,
      windowDurationMs: 86_400_000,
      windowStart: TEST_NOW,
    });
    store.registerBucket(bucket);

    const engine = new PolicyEngine({
      clock: makeTestClock(),
      limitStore: store,
      defaultValidityMs: 300_000,
    });

    const input = makeValidInput({
      requestedAmount: makeMoney(1_000_00n),
    });
    const decision = await engine.evaluate(input);

    expect(decision.outcome).toBe("DENY");
    if (decision.outcome === "DENY") {
      expect(decision.ruleIds).toContain("rolling_limit_exceeded");
    }
  });
});
