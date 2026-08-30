/**
 * Comprehensive tests for the CheckoutOrchestrator.
 *
 * Covers all acceptance criteria:
 * 1. Successful end-to-end checkout
 * 2. Policy denial stops before payment
 * 3. Kill switch blocks finalization
 * 4. Expired mandate rejection
 * 5. Revoked authorization rejection (expired auth)
 * 6. Amount limit breach
 * 7. Rolling total exceeded
 * 8. Attempt count exceeded
 * 9. Stale quote/draft binding detection
 * 10. Duplicate idempotent replay
 * 11. Indeterminate payment handling
 * 12. Declined payment handling
 * 13. Compensation on post-payment finalization failure
 */

import { describe, expect, it } from "vitest";
import type {
  AgentId,
  Environment,
  Instant,
  IsoCurrencyCode,
  MerchantId,
  WalletId,
} from "@counter/domain";
import { CryptoIdGenerator } from "@counter/domain";
import { createTestSignerA, TEST_KID_A } from "@counter/trust-protocol";

import { CheckoutOrchestrator } from "./checkout-orchestrator.js";
import type { CheckoutOrchestratorConfig } from "./checkout-orchestrator.js";
import type {
  CheckoutCommand,
  DraftOrderPort,
  DraftOrderResult,
  OrderResult,
  PolicyDecisionResult,
  PolicyEvaluationPort,
  ReconciliationPort,
  ReconciliationResult,
  ReceiptPort,
  ReceiptResult,
} from "./checkout-types.js";
import { InMemoryTransactionLedger, enforceTransactionLimits } from "./checkout-limits.js";
import { InMemoryKillSwitchStore, KillSwitchEvaluator } from "./kill-switch.js";
import { CounterTestPaymentProvider } from "./test-provider.js";
import { createCounterTestAuthorization } from "./test-authorization.js";
import type { PaymentAuthorization } from "./authorization.js";

// ─── Test Helpers ────────────────────────────────────────────────────────────

const idGen = new CryptoIdGenerator();
const FIXED_NOW = 1705312800000; // 2024-01-15T10:00:00.000Z
const fixedClock = () => FIXED_NOW;

function testWalletId(): WalletId {
  return idGen.generate("wallet") as WalletId;
}

function testMerchantId(): MerchantId {
  return idGen.generate("merchant") as MerchantId;
}

// ─── Mock Ports ──────────────────────────────────────────────────────────────

class MockPolicyPort implements PolicyEvaluationPort {
  public result: PolicyDecisionResult = { outcome: "allow" };
  public callCount = 0;

  evaluate(_command: CheckoutCommand): PolicyDecisionResult {
    this.callCount++;
    return this.result;
  }
}

class MockDraftOrderPort implements DraftOrderPort {
  public draftResult: DraftOrderResult = {
    draftOrderId: "draft-123",
    totalPrice: "1000.00",
    currencyCode: "INR",
  };
  public finalizeResult: OrderResult = {
    orderId: "order-456",
    status: "PAID",
  };
  public shouldFailDraft = false;
  public shouldFailFinalize = false;
  public draftCallCount = 0;
  public finalizeCallCount = 0;

  async createDraft(_command: CheckoutCommand): Promise<DraftOrderResult> {
    this.draftCallCount++;
    if (this.shouldFailDraft) {
      throw new Error("Draft creation failed");
    }
    return this.draftResult;
  }

  async finalizeDraft(_draftOrderId: string, _idempotencyKey: string): Promise<OrderResult> {
    this.finalizeCallCount++;
    if (this.shouldFailFinalize) {
      throw new Error("Finalization failed");
    }
    return this.finalizeResult;
  }
}

class MockReconciliationPort implements ReconciliationPort {
  public result: ReconciliationResult = { findingsCount: 0, hasCritical: false };
  public callCount = 0;

  reconcile(_params: {
    readonly transactionId: string;
    readonly paymentReference: string;
    readonly orderReference: string;
  }): ReconciliationResult {
    this.callCount++;
    return this.result;
  }
}

class MockReceiptPort implements ReceiptPort {
  public result: ReceiptResult = { receiptId: "receipt-789", issued: true };
  public callCount = 0;

  async issue(_params: {
    readonly transactionId: string;
    readonly merchantId: MerchantId;
    readonly walletId: WalletId;
  }): Promise<ReceiptResult> {
    this.callCount++;
    return this.result;
  }
}

// ─── Test Fixtures ───────────────────────────────────────────────────────────

function createTestAuth(
  walletId: WalletId,
  merchantId: MerchantId,
  overrides?: Partial<{ validFrom: Instant; validUntil: Instant; amountCeiling: bigint }>,
): PaymentAuthorization {
  return createCounterTestAuthorization({
    walletId,
    agentId: idGen.generate("agent") as AgentId,
    merchantId,
    amountCeiling: overrides?.amountCeiling ?? 500_000n,
    currency: "INR" as IsoCurrencyCode,
    validFrom: overrides?.validFrom ?? ((FIXED_NOW - 3600_000) as Instant),
    validUntil: overrides?.validUntil ?? ((FIXED_NOW + 3600_000) as Instant),
  });
}

function createTestCommand(
  walletId: WalletId,
  merchantId: MerchantId,
  auth: PaymentAuthorization,
  overrides?: Partial<CheckoutCommand>,
): CheckoutCommand {
  return {
    idempotencyKey: overrides?.idempotencyKey ?? `checkout-${Date.now()}-${Math.random()}`,
    walletId,
    merchantId,
    authorization: auth,
    amount: overrides?.amount ?? { amountMinor: 100_000n, currency: "INR" as IsoCurrencyCode },
    currency: overrides?.currency ?? ("INR" as IsoCurrencyCode),
    environment: overrides?.environment ?? ("test" as Environment),
    mandateRef: overrides?.mandateRef ?? "mandate-ref-1",
    mandateExpiresAt: overrides?.mandateExpiresAt ?? ((FIXED_NOW + 1800_000) as Instant),
    intentRef: overrides?.intentRef ?? "intent-ref-1",
    quoteDigest: overrides?.quoteDigest ?? "quote-digest-abc",
    lineItems: overrides?.lineItems ?? [{ variantId: "variant-1", quantity: 1 }],
  };
}

function createConfig(overrides?: Partial<CheckoutOrchestratorConfig>): {
  config: CheckoutOrchestratorConfig;
  policyPort: MockPolicyPort;
  draftOrderPort: MockDraftOrderPort;
  killSwitchStore: InMemoryKillSwitchStore;
  reconciliationPort: MockReconciliationPort;
  receiptPort: MockReceiptPort;
  ledger: InMemoryTransactionLedger;
} {
  const signer = createTestSignerA();
  const provider = new CounterTestPaymentProvider({
    environment: "test",
    signer,
    kid: TEST_KID_A,
    clock: fixedClock,
  });
  const policyPort = new MockPolicyPort();
  const draftOrderPort = new MockDraftOrderPort();
  const killSwitchStore = new InMemoryKillSwitchStore();
  const killSwitchPort = new KillSwitchEvaluator(killSwitchStore);
  const reconciliationPort = new MockReconciliationPort();
  const receiptPort = new MockReceiptPort();
  const ledger = new InMemoryTransactionLedger();

  const baseConfig = {
    environment: "test" as Environment,
    provider: overrides?.provider ?? provider,
    policyPort: overrides?.policyPort ?? policyPort,
    draftOrderPort: overrides?.draftOrderPort ?? draftOrderPort,
    killSwitchPort: overrides?.killSwitchPort ?? killSwitchPort,
    reconciliationPort: overrides?.reconciliationPort ?? reconciliationPort,
    receiptPort: overrides?.receiptPort ?? receiptPort,
    ledger: overrides?.ledger ?? ledger,
    clock: overrides?.clock ?? fixedClock,
  };

  const config: CheckoutOrchestratorConfig =
    overrides?.limitConfig !== undefined
      ? { ...baseConfig, limitConfig: overrides.limitConfig }
      : baseConfig;

  return {
    config,
    policyPort,
    draftOrderPort,
    killSwitchStore,
    reconciliationPort,
    receiptPort,
    ledger,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("CheckoutOrchestrator", () => {
  describe("environment enforcement", () => {
    it("throws ENVIRONMENT_MISMATCH for production environment", () => {
      const { config } = createConfig();
      expect(
        () => new CheckoutOrchestrator({ ...config, environment: "production" as Environment }),
      ).toThrow();
      try {
        new CheckoutOrchestrator({ ...config, environment: "production" as Environment });
      } catch (error: unknown) {
        const e = error as { code?: string };
        expect(e.code).toBe("ENVIRONMENT_MISMATCH");
      }
    });

    it("throws ENVIRONMENT_MISMATCH for sandbox environment", () => {
      const { config } = createConfig();
      expect(
        () => new CheckoutOrchestrator({ ...config, environment: "sandbox" as Environment }),
      ).toThrow();
    });

    it("throws ENVIRONMENT_MISMATCH for pilot environment", () => {
      const { config } = createConfig();
      expect(
        () => new CheckoutOrchestrator({ ...config, environment: "pilot" as Environment }),
      ).toThrow();
    });

    it("accepts test environment", () => {
      const { config } = createConfig();
      expect(
        () => new CheckoutOrchestrator({ ...config, environment: "test" as Environment }),
      ).not.toThrow();
    });

    it("accepts local environment", () => {
      const signer = createTestSignerA();
      const provider = new CounterTestPaymentProvider({
        environment: "local",
        signer,
        kid: TEST_KID_A,
        clock: fixedClock,
      });
      const { config } = createConfig({ provider });
      expect(
        () => new CheckoutOrchestrator({ ...config, environment: "local" as Environment }),
      ).not.toThrow();
    });
  });

  describe("successful end-to-end checkout", () => {
    it("completes full flow: mandate -> policy -> draft -> payment -> finalize -> reconcile -> receipt", async () => {
      const walletId = testWalletId();
      const merchantId = testMerchantId();
      const { config, draftOrderPort, reconciliationPort, receiptPort } = createConfig();
      // Set draft total to match command amount (100000 minor = 1000.00 in major)
      draftOrderPort.draftResult = {
        draftOrderId: "draft-123",
        totalPrice: "1000.00",
        currencyCode: "INR",
      };
      const orchestrator = new CheckoutOrchestrator(config);
      const auth = createTestAuth(walletId, merchantId);
      const command = createTestCommand(walletId, merchantId, auth, {
        idempotencyKey: "e2e-success-key",
      });

      const result = await orchestrator.execute(command);

      expect(result.outcome).toBe("success");
      expect(result.phase).toBe("receipt");
      expect(result.paymentReference).toBeDefined();
      expect(result.orderReference).toBe("order-456");
      expect(draftOrderPort.draftCallCount).toBe(1);
      expect(draftOrderPort.finalizeCallCount).toBe(1);
      expect(reconciliationPort.callCount).toBe(1);
      expect(receiptPort.callCount).toBe(1);
    });
  });

  describe("policy denial stops before payment", () => {
    it("returns declined when policy denies the command", async () => {
      const walletId = testWalletId();
      const merchantId = testMerchantId();
      const { config, policyPort, draftOrderPort } = createConfig();
      policyPort.result = { outcome: "deny", reason: "Exceeds merchant risk tolerance" };
      const orchestrator = new CheckoutOrchestrator(config);
      const auth = createTestAuth(walletId, merchantId);
      const command = createTestCommand(walletId, merchantId, auth);

      const result = await orchestrator.execute(command);

      expect(result.outcome).toBe("declined");
      expect(result.phase).toBe("policy_check");
      expect(result.details).toContain("Policy denied");
      expect(draftOrderPort.draftCallCount).toBe(0);
    });

    it("returns review_required when policy flags for review", async () => {
      const walletId = testWalletId();
      const merchantId = testMerchantId();
      const { config, policyPort } = createConfig();
      policyPort.result = { outcome: "review_required", reason: "Unusual pattern detected" };
      const orchestrator = new CheckoutOrchestrator(config);
      const auth = createTestAuth(walletId, merchantId);
      const command = createTestCommand(walletId, merchantId, auth);

      const result = await orchestrator.execute(command);

      expect(result.outcome).toBe("review_required");
      expect(result.phase).toBe("policy_check");
    });
  });

  describe("kill switch blocks finalization", () => {
    it("blocks on global kill switch before finalization", async () => {
      const walletId = testWalletId();
      const merchantId = testMerchantId();
      const { config, killSwitchStore, draftOrderPort } = createConfig();
      draftOrderPort.draftResult = {
        draftOrderId: "draft-kill",
        totalPrice: "1000.00",
        currencyCode: "INR",
      };
      const orchestrator = new CheckoutOrchestrator(config);
      const auth = createTestAuth(walletId, merchantId);
      const command = createTestCommand(walletId, merchantId, auth, {
        idempotencyKey: "kill-switch-test",
      });

      // Activate global kill switch after orchestrator construction but before execution
      killSwitchStore.set({
        scope: "global",
        key: "all",
        reason: "Emergency maintenance",
        activatedAt: FIXED_NOW as Instant,
        active: true,
      });

      const result = await orchestrator.execute(command);

      expect(result.outcome).toBe("declined");
      expect(result.phase).toBe("continuation_gate");
      expect(result.details).toContain("Kill switch active");
      expect(result.details).toContain("global");
      expect(result.compensationRequired).toBe(true);
      expect(draftOrderPort.finalizeCallCount).toBe(0);
    });

    it("blocks on merchant-scoped kill switch", async () => {
      const walletId = testWalletId();
      const merchantId = testMerchantId();
      const { config, killSwitchStore, draftOrderPort } = createConfig();
      draftOrderPort.draftResult = {
        draftOrderId: "draft-merchant-kill",
        totalPrice: "1000.00",
        currencyCode: "INR",
      };
      const orchestrator = new CheckoutOrchestrator(config);
      const auth = createTestAuth(walletId, merchantId);
      const command = createTestCommand(walletId, merchantId, auth, {
        idempotencyKey: "merchant-kill-switch-test",
      });

      killSwitchStore.set({
        scope: "merchant",
        key: merchantId,
        reason: "Merchant suspended",
        activatedAt: FIXED_NOW as Instant,
        active: true,
      });

      const result = await orchestrator.execute(command);

      expect(result.outcome).toBe("declined");
      expect(result.phase).toBe("continuation_gate");
      expect(result.details).toContain("merchant");
      expect(result.compensationRequired).toBe(true);
    });

    it("blocks on wallet-scoped kill switch", async () => {
      const walletId = testWalletId();
      const merchantId = testMerchantId();
      const { config, killSwitchStore, draftOrderPort } = createConfig();
      draftOrderPort.draftResult = {
        draftOrderId: "draft-wallet-kill",
        totalPrice: "1000.00",
        currencyCode: "INR",
      };
      const orchestrator = new CheckoutOrchestrator(config);
      const auth = createTestAuth(walletId, merchantId);
      const command = createTestCommand(walletId, merchantId, auth, {
        idempotencyKey: "wallet-kill-switch-test",
      });

      killSwitchStore.set({
        scope: "wallet",
        key: walletId,
        reason: "Wallet flagged",
        activatedAt: FIXED_NOW as Instant,
        active: true,
      });

      const result = await orchestrator.execute(command);

      expect(result.outcome).toBe("declined");
      expect(result.phase).toBe("continuation_gate");
      expect(result.details).toContain("wallet");
    });
  });

  describe("expired mandate rejection", () => {
    it("rejects when mandate has expired", async () => {
      const walletId = testWalletId();
      const merchantId = testMerchantId();
      const { config } = createConfig();
      const orchestrator = new CheckoutOrchestrator(config);
      const auth = createTestAuth(walletId, merchantId);
      const command = createTestCommand(walletId, merchantId, auth, {
        mandateExpiresAt: (FIXED_NOW - 1000) as Instant, // Already expired
      });

      const result = await orchestrator.execute(command);

      expect(result.outcome).toBe("declined");
      expect(result.phase).toBe("mandate_validation");
      expect(result.details).toContain("Mandate has expired");
    });
  });

  describe("revoked authorization rejection", () => {
    it("rejects when authorization has expired", async () => {
      const walletId = testWalletId();
      const merchantId = testMerchantId();
      const { config } = createConfig();
      const orchestrator = new CheckoutOrchestrator(config);
      const auth = createTestAuth(walletId, merchantId, {
        validUntil: (FIXED_NOW - 1000) as Instant, // Already expired
      });
      const command = createTestCommand(walletId, merchantId, auth);

      const result = await orchestrator.execute(command);

      expect(result.outcome).toBe("declined");
      expect(result.phase).toBe("mandate_validation");
      expect(result.details).toContain("Authorization has expired");
    });

    it("rejects when authorization is not yet valid", async () => {
      const walletId = testWalletId();
      const merchantId = testMerchantId();
      const { config } = createConfig();
      const orchestrator = new CheckoutOrchestrator(config);
      const auth = createTestAuth(walletId, merchantId, {
        validFrom: (FIXED_NOW + 10_000) as Instant, // Not yet valid
      });
      const command = createTestCommand(walletId, merchantId, auth);

      const result = await orchestrator.execute(command);

      expect(result.outcome).toBe("declined");
      expect(result.phase).toBe("mandate_validation");
      expect(result.details).toContain("not yet valid");
    });
  });

  describe("amount limit breach", () => {
    it("rejects when transaction exceeds per-tx limit (INR 5000)", async () => {
      const walletId = testWalletId();
      const merchantId = testMerchantId();
      const { config } = createConfig();
      const orchestrator = new CheckoutOrchestrator(config);
      const auth = createTestAuth(walletId, merchantId, {
        amountCeiling: 1_000_000n, // Higher than PILOT limit
      });
      const command = createTestCommand(walletId, merchantId, auth, {
        amount: { amountMinor: 600_000n, currency: "INR" as IsoCurrencyCode }, // INR 6000 > INR 5000
      });

      const result = await orchestrator.execute(command);

      expect(result.outcome).toBe("declined");
      expect(result.details).toContain("per-transaction limit");
    });
  });

  describe("rolling total exceeded", () => {
    it("rejects when 24h rolling total would exceed INR 10000", async () => {
      const walletId = testWalletId();
      const merchantId = testMerchantId();
      const { config, ledger } = createConfig();
      const orchestrator = new CheckoutOrchestrator(config);
      const auth = createTestAuth(walletId, merchantId);

      // Record prior transactions totaling INR 8000 (800000 minor)
      ledger.recordAttempt({
        walletId,
        amountMinor: 400_000n,
        timestamp: (FIXED_NOW - 3600_000) as Instant,
        idempotencyKey: "prior-1",
      });
      ledger.recordAttempt({
        walletId,
        amountMinor: 400_000n,
        timestamp: (FIXED_NOW - 1800_000) as Instant,
        idempotencyKey: "prior-2",
      });

      // Try a new transaction for INR 3000 (300000 minor) -- total would be INR 11000
      const command = createTestCommand(walletId, merchantId, auth, {
        amount: { amountMinor: 300_000n, currency: "INR" as IsoCurrencyCode },
      });

      const result = await orchestrator.execute(command);

      expect(result.outcome).toBe("declined");
      expect(result.details).toContain("rolling total");
    });
  });

  describe("attempt count exceeded", () => {
    it("rejects when 5 attempts per 24h reached", async () => {
      const walletId = testWalletId();
      const merchantId = testMerchantId();
      const { config, ledger } = createConfig();
      const orchestrator = new CheckoutOrchestrator(config);
      const auth = createTestAuth(walletId, merchantId);

      // Record 5 prior attempts
      for (let i = 0; i < 5; i++) {
        ledger.recordAttempt({
          walletId,
          amountMinor: 10_000n,
          timestamp: (FIXED_NOW - 3600_000 + i * 1000) as Instant,
          idempotencyKey: `prior-attempt-${i}`,
        });
      }

      const command = createTestCommand(walletId, merchantId, auth, {
        amount: { amountMinor: 10_000n, currency: "INR" as IsoCurrencyCode },
      });

      const result = await orchestrator.execute(command);

      expect(result.outcome).toBe("declined");
      expect(result.details).toContain("Attempt count");
    });
  });

  describe("stale quote/draft binding detection", () => {
    it("rejects when draft total does not match command amount", async () => {
      const walletId = testWalletId();
      const merchantId = testMerchantId();
      const { config, draftOrderPort } = createConfig();
      // Draft returns a different total than the command amount
      draftOrderPort.draftResult = {
        draftOrderId: "draft-stale",
        totalPrice: "5000.00", // 500000 minor units
        currencyCode: "INR",
      };
      const orchestrator = new CheckoutOrchestrator(config);
      const auth = createTestAuth(walletId, merchantId);
      const command = createTestCommand(walletId, merchantId, auth, {
        idempotencyKey: "stale-quote-test",
        amount: { amountMinor: 100_000n, currency: "INR" as IsoCurrencyCode }, // 1000.00
      });

      const result = await orchestrator.execute(command);

      expect(result.outcome).toBe("declined");
      expect(result.phase).toBe("continuation_gate");
      expect(result.details).toContain("Stale quote/draft binding");
    });
  });

  describe("duplicate idempotent replay", () => {
    it("returns same result for duplicate idempotency key", async () => {
      const walletId = testWalletId();
      const merchantId = testMerchantId();
      const { config, draftOrderPort } = createConfig();
      draftOrderPort.draftResult = {
        draftOrderId: "draft-idem",
        totalPrice: "1000.00",
        currencyCode: "INR",
      };
      const orchestrator = new CheckoutOrchestrator(config);
      const auth = createTestAuth(walletId, merchantId);
      const command = createTestCommand(walletId, merchantId, auth, {
        idempotencyKey: "idempotent-key-1",
      });

      const result1 = await orchestrator.execute(command);
      const result2 = await orchestrator.execute(command);

      expect(result1.outcome).toBe("success");
      expect(result2.outcome).toBe(result1.outcome);
      expect(result2.phase).toBe(result1.phase);
      expect(result2.idempotencyKey).toBe(result1.idempotencyKey);
      // Should not call ports again
      expect(draftOrderPort.draftCallCount).toBe(1);
    });
  });

  describe("indeterminate payment handling", () => {
    it("returns indeterminate when payment times out", async () => {
      const walletId = testWalletId();
      const merchantId = testMerchantId();
      const signer = createTestSignerA();
      const provider = new CounterTestPaymentProvider({
        environment: "test",
        signer,
        kid: TEST_KID_A,
        clock: fixedClock,
        scenarios: new Map([["pay-indeterminate-key", "timeout_before_effect"]]),
      });
      const { config, draftOrderPort } = createConfig({ provider });
      draftOrderPort.draftResult = {
        draftOrderId: "draft-indet",
        totalPrice: "1000.00",
        currencyCode: "INR",
      };
      const orchestrator = new CheckoutOrchestrator(config);
      const auth = createTestAuth(walletId, merchantId);
      const command = createTestCommand(walletId, merchantId, auth, {
        idempotencyKey: "indeterminate-key",
      });

      const result = await orchestrator.execute(command);

      expect(result.outcome).toBe("indeterminate");
      expect(result.phase).toBe("payment_execution");
      expect(result.details).toContain("indeterminate");
    });
  });

  describe("declined payment handling", () => {
    it("returns declined when payment is declined", async () => {
      const walletId = testWalletId();
      const merchantId = testMerchantId();
      const signer = createTestSignerA();
      const provider = new CounterTestPaymentProvider({
        environment: "test",
        signer,
        kid: TEST_KID_A,
        clock: fixedClock,
        scenarios: new Map([["pay-declined-key", "immediate_decline"]]),
      });
      const { config, draftOrderPort } = createConfig({ provider });
      draftOrderPort.draftResult = {
        draftOrderId: "draft-decline",
        totalPrice: "1000.00",
        currencyCode: "INR",
      };
      const orchestrator = new CheckoutOrchestrator(config);
      const auth = createTestAuth(walletId, merchantId);
      const command = createTestCommand(walletId, merchantId, auth, {
        idempotencyKey: "declined-key",
      });

      const result = await orchestrator.execute(command);

      expect(result.outcome).toBe("declined");
      expect(result.phase).toBe("payment_execution");
      expect(result.details).toContain("declined");
    });
  });

  describe("compensation on post-payment finalization failure", () => {
    it("marks compensationRequired when finalization fails after payment", async () => {
      const walletId = testWalletId();
      const merchantId = testMerchantId();
      const { config, draftOrderPort } = createConfig();
      draftOrderPort.draftResult = {
        draftOrderId: "draft-comp",
        totalPrice: "1000.00",
        currencyCode: "INR",
      };
      draftOrderPort.shouldFailFinalize = true;
      const orchestrator = new CheckoutOrchestrator(config);
      const auth = createTestAuth(walletId, merchantId);
      const command = createTestCommand(walletId, merchantId, auth, {
        idempotencyKey: "compensation-key",
      });

      const result = await orchestrator.execute(command);

      expect(result.outcome).toBe("indeterminate");
      expect(result.phase).toBe("finalization");
      expect(result.compensationRequired).toBe(true);
      expect(result.paymentReference).toBeDefined();
    });
  });

  describe("authorization merchant check", () => {
    it("rejects when merchant is not in permitted merchants", async () => {
      const walletId = testWalletId();
      const merchantId = testMerchantId();
      const differentMerchantId = testMerchantId();
      const { config } = createConfig();
      const orchestrator = new CheckoutOrchestrator(config);
      // Auth permits a different merchant
      const auth = createTestAuth(walletId, differentMerchantId);
      const command = createTestCommand(walletId, merchantId, auth);

      const result = await orchestrator.execute(command);

      expect(result.outcome).toBe("declined");
      expect(result.phase).toBe("mandate_validation");
      expect(result.details).toContain("Merchant not permitted");
    });
  });

  describe("draft order creation failure", () => {
    it("returns indeterminate when draft order fails", async () => {
      const walletId = testWalletId();
      const merchantId = testMerchantId();
      const { config, draftOrderPort } = createConfig();
      draftOrderPort.shouldFailDraft = true;
      const orchestrator = new CheckoutOrchestrator(config);
      const auth = createTestAuth(walletId, merchantId);
      const command = createTestCommand(walletId, merchantId, auth);

      const result = await orchestrator.execute(command);

      expect(result.outcome).toBe("indeterminate");
      expect(result.phase).toBe("draft_creation");
    });
  });

  describe("revalidation gates", () => {
    it("revalidates policy at continuation gate", async () => {
      const walletId = testWalletId();
      const merchantId = testMerchantId();
      const { config, policyPort, draftOrderPort } = createConfig();
      draftOrderPort.draftResult = {
        draftOrderId: "draft-reval",
        totalPrice: "1000.00",
        currencyCode: "INR",
      };
      const orchestrator = new CheckoutOrchestrator(config);
      const auth = createTestAuth(walletId, merchantId);
      const command = createTestCommand(walletId, merchantId, auth, {
        idempotencyKey: "revalidation-test",
      });

      // Policy allows initially but will deny on revalidation (second call)
      let callCount = 0;
      policyPort.evaluate = (_cmd: CheckoutCommand): PolicyDecisionResult => {
        callCount++;
        if (callCount >= 2) {
          return { outcome: "deny", reason: "Policy changed" };
        }
        return { outcome: "allow" };
      };

      const result = await orchestrator.execute(command);

      expect(result.outcome).toBe("declined");
      expect(result.phase).toBe("continuation_gate");
      expect(result.details).toContain("Policy denied on revalidation");
      expect(result.compensationRequired).toBe(true);
    });

    it("revalidates authorization expiry at continuation gate", async () => {
      const walletId = testWalletId();
      const merchantId = testMerchantId();
      // Auth that expires very soon - just 10ms from now
      const authExpiresAt = (FIXED_NOW + 10) as Instant;
      // Clock advances: first calls return FIXED_NOW (before expiry),
      // then after the payment completes, the clock advances past expiry
      let callIndex = 0;
      const advancingClock = () => {
        callIndex++;
        // The orchestrator calls #now() at the start of the flow (call 1),
        // and then again in continuationGate (call 2+).
        // After call 1, advance past authExpiresAt.
        if (callIndex >= 2) {
          return FIXED_NOW + 100;
        }
        return FIXED_NOW;
      };

      const signer = createTestSignerA();
      const provider = new CounterTestPaymentProvider({
        environment: "test",
        signer,
        kid: TEST_KID_A,
        clock: advancingClock,
      });
      const { config, draftOrderPort } = createConfig({ provider, clock: advancingClock });
      draftOrderPort.draftResult = {
        draftOrderId: "draft-auth-expire",
        totalPrice: "1000.00",
        currencyCode: "INR",
      };
      const orchestrator = new CheckoutOrchestrator(config);
      const auth = createTestAuth(walletId, merchantId, {
        validUntil: authExpiresAt,
      });
      const command = createTestCommand(walletId, merchantId, auth, {
        idempotencyKey: "auth-expire-cont-gate",
      });

      const result = await orchestrator.execute(command);

      expect(result.outcome).toBe("declined");
      expect(result.phase).toBe("continuation_gate");
      expect(result.details).toContain("Authorization expired during checkout");
    });
  });
});

describe("KillSwitchEvaluator", () => {
  it("returns inactive when no kill switches are set", () => {
    const store = new InMemoryKillSwitchStore();
    const evaluator = new KillSwitchEvaluator(store);

    const status = evaluator.evaluate({
      walletId: testWalletId(),
      merchantId: testMerchantId(),
      environment: "test" as Environment,
    });

    expect(status.active).toBe(false);
  });

  it("global kill switch takes priority over merchant", () => {
    const store = new InMemoryKillSwitchStore();
    const merchantId = testMerchantId();
    store.set({
      scope: "global",
      key: "all",
      reason: "Global halt",
      activatedAt: FIXED_NOW as Instant,
      active: true,
    });
    store.set({
      scope: "merchant",
      key: merchantId,
      reason: "Merchant halt",
      activatedAt: FIXED_NOW as Instant,
      active: true,
    });

    const evaluator = new KillSwitchEvaluator(store);
    const status = evaluator.evaluate({
      walletId: testWalletId(),
      merchantId,
      environment: "test" as Environment,
    });

    expect(status.active).toBe(true);
    expect(status.scope).toBe("global");
  });

  it("can remove a kill switch", () => {
    const store = new InMemoryKillSwitchStore();
    store.set({
      scope: "global",
      key: "all",
      reason: "Temp halt",
      activatedAt: FIXED_NOW as Instant,
      active: true,
    });
    store.remove("global", "all");

    const evaluator = new KillSwitchEvaluator(store);
    const status = evaluator.evaluate({
      walletId: testWalletId(),
      merchantId: testMerchantId(),
      environment: "test" as Environment,
    });

    expect(status.active).toBe(false);
  });
});

describe("InMemoryTransactionLedger", () => {
  it("records and retrieves window entries", () => {
    const ledger = new InMemoryTransactionLedger();
    const walletId = testWalletId();

    ledger.recordAttempt({
      walletId,
      amountMinor: 100_000n,
      timestamp: FIXED_NOW as Instant,
      idempotencyKey: "entry-1",
    });

    const entries = ledger.getWindowEntries(walletId, (FIXED_NOW - 86_400_000) as Instant);
    expect(entries.length).toBe(1);
    expect(entries[0]!.amountMinor).toBe(100_000n);
  });

  it("prunes entries outside the window", () => {
    const ledger = new InMemoryTransactionLedger();
    const walletId = testWalletId();

    // Old entry outside window
    ledger.recordAttempt({
      walletId,
      amountMinor: 50_000n,
      timestamp: (FIXED_NOW - 100_000_000) as Instant,
      idempotencyKey: "old-entry",
    });
    // Recent entry inside window
    ledger.recordAttempt({
      walletId,
      amountMinor: 75_000n,
      timestamp: FIXED_NOW as Instant,
      idempotencyKey: "new-entry",
    });

    const entries = ledger.getWindowEntries(walletId, (FIXED_NOW - 86_400_000) as Instant);
    expect(entries.length).toBe(1);
    expect(entries[0]!.idempotencyKey).toBe("new-entry");
  });

  it("tracks idempotency keys", () => {
    const ledger = new InMemoryTransactionLedger();
    const walletId = testWalletId();

    expect(ledger.hasIdempotencyKey("key-x")).toBe(false);

    ledger.recordAttempt({
      walletId,
      amountMinor: 10_000n,
      timestamp: FIXED_NOW as Instant,
      idempotencyKey: "key-x",
    });

    expect(ledger.hasIdempotencyKey("key-x")).toBe(true);
  });
});

describe("enforceTransactionLimits", () => {
  it("allows transaction within all limits", () => {
    const ledger = new InMemoryTransactionLedger();
    const walletId = testWalletId();

    const result = enforceTransactionLimits(
      { amountMinor: 100_000n, currency: "INR" as IsoCurrencyCode },
      walletId,
      FIXED_NOW as Instant,
      ledger,
    );

    expect(result.allowed).toBe(true);
  });

  it("rejects unsupported currency", () => {
    const ledger = new InMemoryTransactionLedger();
    const walletId = testWalletId();

    const result = enforceTransactionLimits(
      { amountMinor: 100_000n, currency: "USD" as IsoCurrencyCode },
      walletId,
      FIXED_NOW as Instant,
      ledger,
    );

    expect(result.allowed).toBe(false);
    expect(result.code).toBe("UNSUPPORTED_CURRENCY");
  });
});
