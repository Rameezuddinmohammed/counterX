import { describe, expect, it } from "vitest";
import { OperationsService } from "./operations-service.js";
import type { MetricEvent } from "./operations-service.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WALLET_ID = "wlt-ops-001";
const NOW = "2025-01-15T10:00:00.000Z";

function createEvent(overrides?: Partial<MetricEvent>): MetricEvent {
  return {
    walletId: WALLET_ID,
    eventType: "transaction",
    timestamp: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OperationsService", () => {
  describe("metrics collection", () => {
    it("records transaction events and updates counts", () => {
      const service = new OperationsService();

      service.recordEvent(createEvent({ eventType: "transaction" }));
      service.recordEvent(createEvent({ eventType: "transaction" }));
      service.recordEvent(createEvent({ eventType: "approval" }));

      const metrics = service.getMetrics(WALLET_ID);
      expect(metrics).toBeDefined();
      expect(metrics?.transactionCount).toBe(2);
      expect(metrics?.approvalCount).toBe(1);
      expect(metrics?.rejectionCount).toBe(0);
    });

    it("tracks trigger execution counts", () => {
      const service = new OperationsService();

      service.recordEvent(createEvent({ eventType: "trigger_execution" }));
      service.recordEvent(createEvent({ eventType: "trigger_execution" }));
      service.recordEvent(createEvent({ eventType: "trigger_execution" }));

      const metrics = service.getMetrics(WALLET_ID);
      expect(metrics?.triggerExecutionCount).toBe(3);
    });

    it("tracks approval rates via approvals and rejections", () => {
      const service = new OperationsService();

      service.recordEvent(createEvent({ eventType: "approval" }));
      service.recordEvent(createEvent({ eventType: "approval" }));
      service.recordEvent(createEvent({ eventType: "rejection" }));

      const metrics = service.getMetrics(WALLET_ID);
      expect(metrics?.approvalCount).toBe(2);
      expect(metrics?.rejectionCount).toBe(1);
    });

    it("returns undefined for unknown wallet", () => {
      const service = new OperationsService();
      expect(service.getMetrics("unknown-wallet")).toBeUndefined();
    });

    it("returns events for a specific wallet", () => {
      const service = new OperationsService();

      service.recordEvent(createEvent({ walletId: WALLET_ID }));
      service.recordEvent(createEvent({ walletId: "other-wallet" }));

      expect(service.getEvents(WALLET_ID)).toHaveLength(1);
      expect(service.getEvents("other-wallet")).toHaveLength(1);
    });
  });

  describe("anomaly detection", () => {
    it("flags unusual amounts exceeding threshold", () => {
      const service = new OperationsService({ unusualAmountThreshold: 50000n });

      service.recordEvent(createEvent({
        eventType: "transaction",
        amount: 100000n,
      }));

      const alerts = service.getAlerts(WALLET_ID);
      expect(alerts.length).toBeGreaterThanOrEqual(1);

      const amountAlert = alerts.find((a) => a.anomalyType === "unusual_amount");
      expect(amountAlert).toBeDefined();
      expect(amountAlert?.severity).toBe("high");
    });

    it("does not flag amounts below threshold", () => {
      const service = new OperationsService({ unusualAmountThreshold: 50000n });

      service.recordEvent(createEvent({
        eventType: "transaction",
        amount: 10000n,
      }));

      const alerts = service.getAlerts(WALLET_ID);
      const amountAlert = alerts.find((a) => a.anomalyType === "unusual_amount");
      expect(amountAlert).toBeUndefined();
    });

    it("flags frequency spikes", () => {
      const service = new OperationsService({
        frequencyWindowMs: 60 * 60 * 1000,
        frequencyMaxCount: 3,
      });

      const now = Date.now();
      for (let i = 0; i < 5; i++) {
        service.recordEvent(createEvent({
          eventType: "transaction",
          timestamp: new Date(now + i * 1000).toISOString(),
        }));
      }

      const alerts = service.getAlerts(WALLET_ID);
      const spikeAlert = alerts.find((a) => a.anomalyType === "frequency_spike");
      expect(spikeAlert).toBeDefined();
      expect(spikeAlert?.severity).toBe("medium");
    });

    it("flags repeated failed policy checks", () => {
      const service = new OperationsService({ failedPolicyCheckThreshold: 3 });

      for (let i = 0; i < 4; i++) {
        service.recordEvent(createEvent({ eventType: "policy_check_failure" }));
      }

      const alerts = service.getAlerts(WALLET_ID);
      const policyAlert = alerts.find((a) => a.anomalyType === "failed_policy_checks");
      expect(policyAlert).toBeDefined();
      expect(policyAlert?.severity).toBe("high");
    });
  });

  describe("kill switch management", () => {
    it("activates a global kill switch", () => {
      const service = new OperationsService();

      const result = service.activateKillSwitch("global", null, "Emergency shutdown", "ops-admin");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.scope).toBe("global");
        expect(result.value.active).toBe(true);
        expect(result.value.reason).toBe("Emergency shutdown");
      }
      expect(service.isKilled("global", null)).toBe(true);
      expect(service.isKilled("wallet", "wlt-001")).toBe(true); // global kills everything
    });

    it("activates a merchant-scoped kill switch", () => {
      const service = new OperationsService();

      service.activateKillSwitch("merchant", "merchant-001", "Suspicious activity", "ops-admin");

      expect(service.isKilled("merchant", "merchant-001")).toBe(true);
      expect(service.isKilled("merchant", "merchant-002")).toBe(false);
      expect(service.isKilled("wallet", "wlt-001")).toBe(false);
    });

    it("activates a wallet-scoped kill switch", () => {
      const service = new OperationsService();

      service.activateKillSwitch("wallet", "wlt-001", "Compromised wallet", "ops-admin");

      expect(service.isKilled("wallet", "wlt-001")).toBe(true);
      expect(service.isKilled("wallet", "wlt-002")).toBe(false);
    });

    it("deactivates a kill switch", () => {
      const service = new OperationsService();

      const activateResult = service.activateKillSwitch("wallet", "wlt-001", "Test", "admin");
      expect(activateResult.ok).toBe(true);

      if (activateResult.ok) {
        const deactivateResult = service.deactivateKillSwitch(activateResult.value.switchId);
        expect(deactivateResult.ok).toBe(true);
        if (deactivateResult.ok) {
          expect(deactivateResult.value.active).toBe(false);
        }
      }

      expect(service.isKilled("wallet", "wlt-001")).toBe(false);
    });

    it("returns error when deactivating non-existent switch", () => {
      const service = new OperationsService();

      const result = service.deactivateKillSwitch("nonexistent");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.reason).toContain("not found");
      }
    });

    it("lists all kill switches", () => {
      const service = new OperationsService();

      service.activateKillSwitch("global", null, "Reason 1", "admin");
      service.activateKillSwitch("merchant", "m-001", "Reason 2", "admin");

      const switches = service.listKillSwitches();
      expect(switches).toHaveLength(2);
    });
  });
});
