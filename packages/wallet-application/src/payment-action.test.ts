/**
 * Tests for PaymentActionService.
 *
 * Covers: rendering, poll state transitions, continuation denial,
 * refund-pending, human-remediation, grant expiry.
 */

import { describe, it, expect } from "vitest";
import type {
  GrantBinding,
  MerchantInfo,
  PaymentLineItem,
  PaymentActionEvent,
} from "./payment-action.js";
import { PaymentActionService } from "./payment-action.js";
import type { PrecheckResult } from "./policy-precheck.js";
import type { Instant, IsoCurrencyCode, MerchantId } from "@counter/domain";

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function makeMerchantInfo(overrides?: Partial<MerchantInfo>): MerchantInfo {
  return {
    merchantId: "ctr_merchant_test123" as MerchantId,
    merchantName: "Test Merchant",
    merchantCountry: "IN",
    ...overrides,
  };
}

function makeGrantBinding(overrides?: Partial<GrantBinding>): GrantBinding {
  return {
    grantId: "grant-001",
    transactionId: "txn-001",
    mandateRef: "mandate-001",
    approvalRef: "approval-001",
    quoteDigest: "sha256:abc123",
    amount: { amountMinor: 500000n, currency: "INR" as IsoCurrencyCode },
    paymentRef: "rzp_order_001",
    issuedAt: 1700000000000 as Instant,
    expiresAt: 1700000600000 as Instant, // +10 minutes
    ...overrides,
  };
}

function makeLineItems(): PaymentLineItem[] {
  return [
    { title: "Widget A", quantity: 2, unitPricePaise: 100000n },
    { title: "Widget B", quantity: 1, unitPricePaise: 300000n },
  ];
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

function makePrecheckDenied(reasons: string[] = ["Policy violation"]): PrecheckResult {
  return {
    outcome: "denied",
    reasons,
    policyVersionId: "policy-v1",
    mandateId: "mandate-001",
    evaluatedAt: "2024-01-01T00:00:00.000Z",
  };
}

function createService(options?: {
  precheckResult?: PrecheckResult;
  killSwitchActive?: boolean;
  clock?: () => number;
}) {
  const {
    precheckResult = makePrecheckAllowed(),
    killSwitchActive = false,
    clock = () => 1700000100000,
  } = options ?? {};

  return new PaymentActionService(
    {
      policyPrecheck: () => precheckResult,
      killSwitchActive: () => killSwitchActive,
    },
    clock,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PaymentActionService", () => {
  describe("render", () => {
    it("renders hosted payment action with merchant/items/INR total/expiry", () => {
      const service = createService();
      const action = service.render({
        actionId: "action-001",
        merchant: makeMerchantInfo(),
        lineItems: makeLineItems(),
        grantBinding: makeGrantBinding(),
      });

      expect(action.actionId).toBe("action-001");
      expect(action.state).toBe("rendering");
      expect(action.merchant.merchantName).toBe("Test Merchant");
      expect(action.merchant.merchantCountry).toBe("IN");
      expect(action.lineItems).toHaveLength(2);
      expect(action.totalAmountPaise).toBe(500000n); // 2*100000 + 1*300000
      expect(action.currency).toBe("INR");
      expect(action.expiresAt).toBe(1700000600000);
      expect(action.grantBinding.grantId).toBe("grant-001");
    });

    it("calculates total from line items", () => {
      const service = createService();
      const items: PaymentLineItem[] = [
        { title: "Item 1", quantity: 3, unitPricePaise: 10000n },
        { title: "Item 2", quantity: 1, unitPricePaise: 5000n },
      ];
      const action = service.render({
        actionId: "action-002",
        merchant: makeMerchantInfo(),
        lineItems: items,
        grantBinding: makeGrantBinding(),
      });
      expect(action.totalAmountPaise).toBe(35000n); // 3*10000 + 1*5000
    });
  });

  describe("poll state transitions", () => {
    it("returns the current state", () => {
      const service = createService();
      service.render({
        actionId: "action-001",
        merchant: makeMerchantInfo(),
        lineItems: makeLineItems(),
        grantBinding: makeGrantBinding(),
      });

      const polled = service.poll("action-001");
      expect(polled?.state).toBe("rendering");
    });

    it("returns undefined for unknown actionId", () => {
      const service = createService();
      expect(service.poll("unknown")).toBeUndefined();
    });

    it("distinguishes provider-confirmed from order-confirmed", () => {
      const service = createService();
      service.render({
        actionId: "action-001",
        merchant: makeMerchantInfo(),
        lineItems: makeLineItems(),
        grantBinding: makeGrantBinding(),
      });

      service.markAwaitingUser("action-001");
      service.markProviderConfirmed("action-001");

      const providerConfirmed = service.poll("action-001");
      expect(providerConfirmed?.state).toBe("provider_confirmed");

      service.attemptOrderConfirmation("action-001");

      const orderConfirmed = service.poll("action-001");
      expect(orderConfirmed?.state).toBe("order_confirmed");
    });

    it("full happy path: rendering -> awaiting_user -> provider_confirmed -> order_confirmed -> completed", () => {
      const service = createService();
      service.render({
        actionId: "action-001",
        merchant: makeMerchantInfo(),
        lineItems: makeLineItems(),
        grantBinding: makeGrantBinding(),
      });

      service.markAwaitingUser("action-001");
      expect(service.poll("action-001")?.state).toBe("awaiting_user");

      service.markProviderConfirmed("action-001");
      expect(service.poll("action-001")?.state).toBe("provider_confirmed");

      service.attemptOrderConfirmation("action-001");
      expect(service.poll("action-001")?.state).toBe("order_confirmed");

      service.markCompleted("action-001");
      expect(service.poll("action-001")?.state).toBe("completed");
    });
  });

  describe("subscribe", () => {
    it("notifies subscribers on state change", () => {
      const service = createService();
      service.render({
        actionId: "action-001",
        merchant: makeMerchantInfo(),
        lineItems: makeLineItems(),
        grantBinding: makeGrantBinding(),
      });

      const events: PaymentActionEvent[] = [];
      service.subscribe("action-001", (e) => events.push(e));

      service.markAwaitingUser("action-001");

      expect(events).toHaveLength(1);
      expect(events[0]!.previousState).toBe("rendering");
      expect(events[0]!.newState).toBe("awaiting_user");
    });
  });

  describe("continuation denial", () => {
    it("re-checks policy before finalization and denies if policy fails", () => {
      const service = createService({
        precheckResult: makePrecheckDenied(["Exceeded spending limit"]),
      });

      service.render({
        actionId: "action-001",
        merchant: makeMerchantInfo(),
        lineItems: makeLineItems(),
        grantBinding: makeGrantBinding(),
      });
      service.markAwaitingUser("action-001");
      service.markProviderConfirmed("action-001");

      const result = service.attemptOrderConfirmation("action-001");
      expect(result?.state).toBe("continuation_denied");
    });

    it("re-checks kill-switch before finalization and denies if active", () => {
      const service = createService({ killSwitchActive: true });

      service.render({
        actionId: "action-001",
        merchant: makeMerchantInfo(),
        lineItems: makeLineItems(),
        grantBinding: makeGrantBinding(),
      });
      service.markAwaitingUser("action-001");
      service.markProviderConfirmed("action-001");

      const result = service.attemptOrderConfirmation("action-001");
      expect(result?.state).toBe("continuation_denied");
    });
  });

  describe("refund-pending", () => {
    it("transitions from continuation_denied to refund_pending", () => {
      const service = createService({
        precheckResult: makePrecheckDenied(),
      });

      service.render({
        actionId: "action-001",
        merchant: makeMerchantInfo(),
        lineItems: makeLineItems(),
        grantBinding: makeGrantBinding(),
      });
      service.markAwaitingUser("action-001");
      service.markProviderConfirmed("action-001");
      service.attemptOrderConfirmation("action-001");

      const result = service.markRefundPending("action-001", "Auto-refund triggered");
      expect(result?.state).toBe("refund_pending");
    });

    it("transitions from provider_confirmed to refund_pending", () => {
      const service = createService();

      service.render({
        actionId: "action-001",
        merchant: makeMerchantInfo(),
        lineItems: makeLineItems(),
        grantBinding: makeGrantBinding(),
      });
      service.markAwaitingUser("action-001");
      service.markProviderConfirmed("action-001");

      const result = service.markRefundPending("action-001");
      expect(result?.state).toBe("refund_pending");
    });
  });

  describe("human-remediation", () => {
    it("transitions to human_remediation from awaiting_user", () => {
      const service = createService();

      service.render({
        actionId: "action-001",
        merchant: makeMerchantInfo(),
        lineItems: makeLineItems(),
        grantBinding: makeGrantBinding(),
      });
      service.markAwaitingUser("action-001");

      const result = service.markHumanRemediation("action-001", "Payment stuck");
      expect(result?.state).toBe("human_remediation");
    });

    it("does not transition from terminal states", () => {
      const service = createService();

      service.render({
        actionId: "action-001",
        merchant: makeMerchantInfo(),
        lineItems: makeLineItems(),
        grantBinding: makeGrantBinding(),
      });
      service.markAwaitingUser("action-001");
      service.markProviderConfirmed("action-001");
      service.attemptOrderConfirmation("action-001");
      service.markCompleted("action-001");

      const result = service.markHumanRemediation("action-001");
      expect(result?.state).toBe("completed");
    });
  });

  describe("grant expiry", () => {
    it("detects expired grant on poll", () => {
      const service = createService({
        clock: () => 1700001000000, // After expiry (1700000600000)
      });

      service.render({
        actionId: "action-001",
        merchant: makeMerchantInfo(),
        lineItems: makeLineItems(),
        grantBinding: makeGrantBinding(),
      });

      const polled = service.poll("action-001");
      expect(polled?.state).toBe("expired");
    });

    it("does not expire completed actions", () => {
      let currentTime = 1700000100000;
      const service = createService({
        clock: () => currentTime,
      });

      service.render({
        actionId: "action-001",
        merchant: makeMerchantInfo(),
        lineItems: makeLineItems(),
        grantBinding: makeGrantBinding(),
      });
      service.markAwaitingUser("action-001");
      service.markProviderConfirmed("action-001");
      service.attemptOrderConfirmation("action-001");
      service.markCompleted("action-001");

      // Advance past expiry
      currentTime = 1700001000000;
      const polled = service.poll("action-001");
      expect(polled?.state).toBe("completed");
    });
  });

  describe("user abort", () => {
    it("user can abort during awaiting_user", () => {
      const service = createService();

      service.render({
        actionId: "action-001",
        merchant: makeMerchantInfo(),
        lineItems: makeLineItems(),
        grantBinding: makeGrantBinding(),
      });
      service.markAwaitingUser("action-001");

      const result = service.markAborted("action-001");
      expect(result?.state).toBe("aborted");
    });

    it("user cannot abort after provider_confirmed", () => {
      const service = createService();

      service.render({
        actionId: "action-001",
        merchant: makeMerchantInfo(),
        lineItems: makeLineItems(),
        grantBinding: makeGrantBinding(),
      });
      service.markAwaitingUser("action-001");
      service.markProviderConfirmed("action-001");

      const result = service.markAborted("action-001");
      expect(result?.state).toBe("provider_confirmed");
    });
  });
});
