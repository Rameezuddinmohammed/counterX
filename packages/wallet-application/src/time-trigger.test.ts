/**
 * Tests for TimeTriggerScheduler.
 *
 * Covers: trigger creation, occurrence idempotency, fresh precheck on
 * execution, mandate expiry rejection, kill-switch block,
 * non-test-provider rejection.
 */

import { describe, it, expect, vi } from "vitest";
import type { MerchantId, WalletId } from "@counter/domain";
import type { PrecheckResult } from "./policy-precheck.js";
import type { CreateTriggerParams, PurchaseTemplate, TriggerExecutionDeps } from "./time-trigger.js";
import { TimeTriggerScheduler } from "./time-trigger.js";

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function makeTemplate(overrides?: Partial<PurchaseTemplate>): PurchaseTemplate {
  return {
    merchantId: "ctr_merchant_test_shop1" as MerchantId,
    lineItems: [{ title: "Test Item", quantity: 1, unitPricePaise: 50000n }],
    currency: "INR",
    ...overrides,
  };
}

function makeCreateParams(overrides?: Partial<CreateTriggerParams>): CreateTriggerParams {
  return {
    triggerRef: "trigger-001",
    walletId: "ctr_wallet_test1" as WalletId,
    policyVersionId: "policy-v1",
    mandateRef: "mandate-001",
    template: makeTemplate(),
    schedule: { type: "interval", intervalMs: 60000 },
    ...overrides,
  };
}

function makePrecheckAllowed(): PrecheckResult {
  return {
    outcome: "allowed",
    reasons: [],
    policyVersionId: "policy-v1",
    mandateId: "mandate-001",
    evaluatedAt: "2024-01-01T00:00:00.000Z",
  };
}

function makePrecheckDenied(reasons: string[] = ["Exceeded limit"]): PrecheckResult {
  return {
    outcome: "denied",
    reasons,
    policyVersionId: "policy-v1",
    mandateId: "mandate-001",
    evaluatedAt: "2024-01-01T00:00:00.000Z",
  };
}

function makeDeps(overrides?: Partial<TriggerExecutionDeps>): TriggerExecutionDeps {
  return {
    freshPolicyPrecheck: () => makePrecheckAllowed(),
    isMandateValid: () => true,
    isKillSwitchActive: () => false,
    onExecute: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TimeTriggerScheduler", () => {
  describe("trigger creation", () => {
    it("creates a trigger bound to policy/mandate/template/schedule", () => {
      const deps = makeDeps();
      const scheduler = new TimeTriggerScheduler(deps);

      const result = scheduler.create(makeCreateParams());

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.triggerRef).toBe("trigger-001");
      expect(result.value.policyVersionId).toBe("policy-v1");
      expect(result.value.mandateRef).toBe("mandate-001");
      expect(result.value.template.merchantId).toBe("ctr_merchant_test_shop1");
      expect(result.value.schedule.type).toBe("interval");
      expect(result.value.active).toBe(true);
    });

    it("supports cron schedule type", () => {
      const deps = makeDeps();
      const scheduler = new TimeTriggerScheduler(deps);

      const result = scheduler.create(
        makeCreateParams({
          schedule: { type: "cron", expression: "0 9 * * *" },
        }),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.schedule).toEqual({ type: "cron", expression: "0 9 * * *" });
    });

    it("rejects non-Counter-test-provider merchants", () => {
      const deps = makeDeps();
      const scheduler = new TimeTriggerScheduler(deps);

      const result = scheduler.create(
        makeCreateParams({
          template: makeTemplate({ merchantId: "ctr_merchant_live_shop" as MerchantId }),
        }),
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.reason).toContain("Counter test provider");
    });

    it("rejects merchants without test prefix", () => {
      const deps = makeDeps();
      const scheduler = new TimeTriggerScheduler(deps);

      const result = scheduler.create(
        makeCreateParams({
          template: makeTemplate({ merchantId: "other_merchant_123" as MerchantId }),
        }),
      );

      expect(result.ok).toBe(false);
    });
  });

  describe("occurrence-level idempotency", () => {
    it("prevents duplicate executions for same triggerRef + scheduledTime", () => {
      const onExecute = vi.fn();
      const deps = makeDeps({ onExecute });
      const scheduler = new TimeTriggerScheduler(deps);

      scheduler.create(makeCreateParams());

      const result1 = scheduler.execute("trigger-001", "2024-01-01T09:00:00.000Z");
      const result2 = scheduler.execute("trigger-001", "2024-01-01T09:00:00.000Z");

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);
      // Should only execute once
      expect(onExecute).toHaveBeenCalledTimes(1);
    });

    it("allows execution for different scheduled times", () => {
      const onExecute = vi.fn();
      const deps = makeDeps({ onExecute });
      const scheduler = new TimeTriggerScheduler(deps);

      scheduler.create(makeCreateParams());

      scheduler.execute("trigger-001", "2024-01-01T09:00:00.000Z");
      scheduler.execute("trigger-001", "2024-01-01T10:00:00.000Z");

      expect(onExecute).toHaveBeenCalledTimes(2);
    });

    it("returns the same record for duplicate execution", () => {
      const deps = makeDeps();
      const scheduler = new TimeTriggerScheduler(deps);

      scheduler.create(makeCreateParams());

      const result1 = scheduler.execute("trigger-001", "2024-01-01T09:00:00.000Z");
      const result2 = scheduler.execute("trigger-001", "2024-01-01T09:00:00.000Z");

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);
      if (!result1.ok || !result2.ok) return;
      expect(result1.value.occurrenceKey).toBe(result2.value.occurrenceKey);
    });
  });

  describe("fresh precheck on execution", () => {
    it("runs fresh policy precheck before each execution", () => {
      const freshPolicyPrecheck = vi.fn(() => makePrecheckAllowed());
      const deps = makeDeps({ freshPolicyPrecheck });
      const scheduler = new TimeTriggerScheduler(deps);

      scheduler.create(makeCreateParams());
      scheduler.execute("trigger-001", "2024-01-01T09:00:00.000Z");

      expect(freshPolicyPrecheck).toHaveBeenCalledWith(
        "ctr_wallet_test1",
        "policy-v1",
        "ctr_merchant_test_shop1",
      );
    });

    it("rejects execution when policy precheck denies", () => {
      const deps = makeDeps({
        freshPolicyPrecheck: () => makePrecheckDenied(["Over budget"]),
      });
      const scheduler = new TimeTriggerScheduler(deps);

      scheduler.create(makeCreateParams());
      const result = scheduler.execute("trigger-001", "2024-01-01T09:00:00.000Z");

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.outcome).toBe("precheck_denied");
      expect(result.value.reason).toContain("Over budget");
    });
  });

  describe("mandate expiry rejection", () => {
    it("rejects execution when mandate is no longer valid", () => {
      const deps = makeDeps({
        isMandateValid: () => false,
      });
      const scheduler = new TimeTriggerScheduler(deps);

      scheduler.create(makeCreateParams());
      const result = scheduler.execute("trigger-001", "2024-01-01T09:00:00.000Z");

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.outcome).toBe("mandate_expired");
    });
  });

  describe("kill-switch block", () => {
    it("blocks execution when kill switch is active", () => {
      const deps = makeDeps({
        isKillSwitchActive: () => true,
      });
      const scheduler = new TimeTriggerScheduler(deps);

      scheduler.create(makeCreateParams());
      const result = scheduler.execute("trigger-001", "2024-01-01T09:00:00.000Z");

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.outcome).toBe("kill_switch_blocked");
    });
  });

  describe("trigger lifecycle", () => {
    it("deactivates a trigger", () => {
      const deps = makeDeps();
      const scheduler = new TimeTriggerScheduler(deps);

      scheduler.create(makeCreateParams());
      scheduler.deactivate("trigger-001");

      const result = scheduler.execute("trigger-001", "2024-01-01T09:00:00.000Z");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.reason).toContain("inactive");
    });

    it("returns error for non-existent trigger", () => {
      const deps = makeDeps();
      const scheduler = new TimeTriggerScheduler(deps);

      const result = scheduler.execute("unknown", "2024-01-01T09:00:00.000Z");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.reason).toContain("not found");
    });
  });
});
