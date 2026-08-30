/**
 * Tests for operations console merchant operations, telemetry,
 * recovery evidence, credential scanning, and support grants.
 */
import { describe, expect, it } from "vitest";

import {
  type TransactionDetail,
  type MerchantTransaction,
  createMerchantOperatorApi,
} from "./operator-api";

import {
  projectTransaction,
  projectMerchantHealth,
  createAlertProjection,
  projectQueueHealth,
} from "./projections";

import {
  ALL_METRICS,
  TRANSACTION_SUCCESS_RATE,
  TRANSACTION_FAILURE_RATE,
  RECONCILIATION_LATENCY,
  PROVIDER_RESPONSE_TIME,
  QUEUE_DEPTH,
  QUEUE_PROCESSING_RATE,
  ERROR_RATE_BY_CATEGORY,
  KILL_SWITCH_ACTIVATIONS,
  evaluateMetricStatus,
  createMetricSnapshot,
} from "./telemetry-dashboard";

import {
  createReplayCommand,
  createRotateCredentialsCommand,
  createBackupRestoreCommand,
  createDrainQueueCommand,
  createForceReconcileCommand,
  validateCommand,
} from "./recovery-commands";

import {
  ALL_RUNBOOKS,
  OUTAGE_RUNBOOK,
  QUEUE_BACKLOG_RUNBOOK,
  CRASH_RECOVERY_RUNBOOK,
  OFFBOARDING_RUNBOOK,
  ROTATION_RUNBOOK,
  findRunbookById,
  findRunbooksByTag,
} from "./runbooks";

import {
  FORBIDDEN_CREDENTIAL_FIELDS,
  matchesForbiddenPattern,
  scanObjectForCredentials,
  scanStorageForCredentials,
  scanTelemetryForCredentials,
  type StoragePort,
  type TelemetryPort,
} from "./credential-scanner";

import {
  type SupportGrant,
  type GrantStore,
  VALID_PERMISSIONS,
  MAX_GRANT_DURATION_MINUTES,
  validateGrantConfig,
  createSupportGrant,
  revokeSupportGrant,
  listActiveGrants,
} from "./support-grants";

// ═══════════════════════════════════════════════════════════════════════════════
// Operator API Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("operator-api", () => {
  describe("createMerchantOperatorApi", () => {
    it("returns a frozen object with all required methods", () => {
      const api = createMerchantOperatorApi();
      expect(Object.isFrozen(api)).toBe(true);
      expect(typeof api.listMerchantTransactions).toBe("function");
      expect(typeof api.getTransactionDetail).toBe("function");
      expect(typeof api.retryTransaction).toBe("function");
      expect(typeof api.voidTransaction).toBe("function");
      expect(typeof api.issueRefund).toBe("function");
      expect(typeof api.suspendMerchant).toBe("function");
      expect(typeof api.grantSupportAccess).toBe("function");
      expect(typeof api.exportAuditLog).toBe("function");
    });

    it("listMerchantTransactions returns empty frozen array", async () => {
      const api = createMerchantOperatorApi();
      const result = await api.listMerchantTransactions("merchant-1");
      expect(result).toEqual([]);
      expect(Object.isFrozen(result)).toBe(true);
    });

    it("getTransactionDetail returns null for stub", async () => {
      const api = createMerchantOperatorApi();
      const result = await api.getTransactionDetail("tx-1");
      expect(result).toBeNull();
    });

    it("retryTransaction returns success result", async () => {
      const api = createMerchantOperatorApi();
      const result = await api.retryTransaction("tx-1");
      expect(result.success).toBe(true);
      expect(result.message).toContain("retry");
      expect(result.timestamp).toBeDefined();
    });

    it("voidTransaction returns success result", async () => {
      const api = createMerchantOperatorApi();
      const result = await api.voidTransaction("tx-1");
      expect(result.success).toBe(true);
      expect(result.message).toContain("voided");
    });

    it("issueRefund returns success result", async () => {
      const api = createMerchantOperatorApi();
      const result = await api.issueRefund("tx-1", 5000);
      expect(result.success).toBe(true);
      expect(result.message).toContain("Refund");
    });

    it("suspendMerchant returns success result", async () => {
      const api = createMerchantOperatorApi();
      const result = await api.suspendMerchant("merchant-1", "Policy violation");
      expect(result.success).toBe(true);
      expect(result.message).toContain("suspended");
    });

    it("grantSupportAccess returns success result", async () => {
      const api = createMerchantOperatorApi();
      const result = await api.grantSupportAccess("merchant-1", {
        operatorId: "op-1",
        permissions: ["view_transactions"],
        reason: "Customer support case",
        durationMinutes: 60,
      });
      expect(result.success).toBe(true);
      expect(result.message).toContain("granted");
    });

    it("exportAuditLog returns export with merchant and date range", async () => {
      const api = createMerchantOperatorApi();
      const result = await api.exportAuditLog("merchant-1", {
        from: "2024-01-01T00:00:00Z",
        to: "2024-01-31T23:59:59Z",
      });
      expect(result.merchantId).toBe("merchant-1");
      expect(result.dateRange.from).toBe("2024-01-01T00:00:00Z");
      expect(result.dateRange.to).toBe("2024-01-31T23:59:59Z");
      expect(result.entries).toEqual([]);
      expect(result.exportedAt).toBeDefined();
    });
  });

  describe("type safety", () => {
    it("MerchantTransaction type fields are readonly", () => {
      const tx: MerchantTransaction = {
        id: "tx-1",
        merchantId: "m-1",
        amount: 1000,
        currency: "INR",
        status: "captured",
        providerId: "razorpay",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:01:00Z",
      };
      expect(tx.status).toBe("captured");
    });

    it("TransactionDetail includes audit trail", () => {
      const detail: TransactionDetail = {
        id: "tx-1",
        merchantId: "m-1",
        amount: 1000,
        currency: "INR",
        status: "captured",
        providerId: "razorpay",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:01:00Z",
        attempts: 1,
        metadata: {},
        auditTrail: [
          {
            timestamp: "2024-01-01T00:00:00Z",
            action: "authorize",
            operatorId: "system",
            detail: "Transaction authorized",
          },
        ],
      };
      expect(detail.auditTrail).toHaveLength(1);
      expect(detail.attempts).toBe(1);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Projections Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("projections", () => {
  describe("projectTransaction", () => {
    it("projects raw transaction data to flat view", () => {
      const result = projectTransaction({
        id: "tx-1",
        merchantId: "m-1",
        merchantName: "Test Store",
        amount: 5000,
        currency: "INR",
        status: "captured",
        providerName: "Razorpay",
        createdAt: "2024-01-01T00:00:00Z",
        completedAt: "2024-01-01T00:00:05Z",
      });

      expect(result.id).toBe("tx-1");
      expect(result.merchantName).toBe("Test Store");
      expect(result.durationMs).toBe(5000);
      expect(result.hasError).toBe(false);
      expect(result.errorCategory).toBeUndefined();
      expect(Object.isFrozen(result)).toBe(true);
    });

    it("categorizes errors by prefix", () => {
      const result = projectTransaction({
        id: "tx-2",
        merchantId: "m-1",
        amount: 1000,
        currency: "INR",
        status: "failed",
        createdAt: "2024-01-01T00:00:00Z",
        errorCode: "PROVIDER_TIMEOUT",
      });

      expect(result.hasError).toBe(true);
      expect(result.errorCategory).toBe("provider");
    });

    it("defaults merchantName and providerName to Unknown", () => {
      const result = projectTransaction({
        id: "tx-3",
        merchantId: "m-1",
        amount: 500,
        currency: "INR",
        status: "pending",
        createdAt: "2024-01-01T00:00:00Z",
      });

      expect(result.merchantName).toBe("Unknown");
      expect(result.providerName).toBe("Unknown");
    });
  });

  describe("projectMerchantHealth", () => {
    it("calculates health metrics from aggregate data", () => {
      const result = projectMerchantHealth({
        merchantId: "m-1",
        merchantName: "Test Store",
        totalTransactions: 100,
        successfulTransactions: 95,
        totalLatencyMs: 200000,
        activeIncidents: 0,
        killSwitchesActive: 0,
        lastTransactionAt: "2024-01-01T12:00:00Z",
      });

      expect(result.transactionSuccessRate).toBe(0.95);
      expect(result.averageLatencyMs).toBe(2000);
      expect(result.healthScore).toBe(98);
      expect(Object.isFrozen(result)).toBe(true);
    });

    it("deducts health score for incidents and kill switches", () => {
      const result = projectMerchantHealth({
        merchantId: "m-1",
        merchantName: "Test Store",
        totalTransactions: 100,
        successfulTransactions: 100,
        totalLatencyMs: 100000,
        activeIncidents: 2,
        killSwitchesActive: 1,
        lastTransactionAt: "2024-01-01T12:00:00Z",
      });

      // 100 - 0 (all success) - 30 (2 incidents) - 10 (1 switch) = 60
      expect(result.healthScore).toBe(60);
    });

    it("handles zero transactions gracefully", () => {
      const result = projectMerchantHealth({
        merchantId: "m-1",
        merchantName: "New Store",
        totalTransactions: 0,
        successfulTransactions: 0,
        totalLatencyMs: 0,
        activeIncidents: 0,
        killSwitchesActive: 0,
        lastTransactionAt: null,
      });

      expect(result.transactionSuccessRate).toBe(1);
      expect(result.averageLatencyMs).toBe(0);
      expect(result.healthScore).toBe(100);
    });
  });

  describe("createAlertProjection", () => {
    it("returns null when value is within threshold", () => {
      const result = createAlertProjection({
        id: "alert-1",
        metric: "queue_depth",
        threshold: 1000,
        currentValue: 500,
      });
      expect(result).toBeNull();
    });

    it("creates info alert just above threshold", () => {
      const result = createAlertProjection({
        id: "alert-1",
        metric: "queue_depth",
        threshold: 1000,
        currentValue: 1100,
      });
      expect(result).not.toBeNull();
      expect(result!.severity).toBe("info");
    });

    it("creates warning alert at 1.5x threshold", () => {
      const result = createAlertProjection({
        id: "alert-1",
        metric: "queue_depth",
        threshold: 1000,
        currentValue: 1800,
      });
      expect(result).not.toBeNull();
      expect(result!.severity).toBe("warning");
    });

    it("creates critical alert at 3x threshold", () => {
      const result = createAlertProjection({
        id: "alert-1",
        metric: "queue_depth",
        threshold: 1000,
        currentValue: 3500,
        merchantId: "m-1",
      });
      expect(result).not.toBeNull();
      expect(result!.severity).toBe("critical");
      expect(result!.merchantId).toBe("m-1");
    });
  });

  describe("projectQueueHealth", () => {
    it("projects healthy queue", () => {
      const result = projectQueueHealth({
        name: "transactions",
        depth: 50,
        processingRate: 100,
        oldestJobAgeMs: 500,
      });

      expect(result.healthStatus).toBe("healthy");
      expect(result.isBacklogged).toBe(false);
      expect(result.estimatedDrainTimeMs).toBe(500);
      expect(Object.isFrozen(result)).toBe(true);
    });

    it("projects degraded queue", () => {
      const result = projectQueueHealth({
        name: "reconciliation",
        depth: 1500,
        processingRate: 10,
        oldestJobAgeMs: 60000,
        backlogThreshold: 1000,
      });

      expect(result.healthStatus).toBe("degraded");
      expect(result.isBacklogged).toBe(true);
    });

    it("projects critical queue", () => {
      const result = projectQueueHealth({
        name: "payments",
        depth: 5000,
        processingRate: 1,
        oldestJobAgeMs: 300000,
        backlogThreshold: 1000,
      });

      expect(result.healthStatus).toBe("critical");
    });

    it("handles zero processing rate", () => {
      const result = projectQueueHealth({
        name: "dead",
        depth: 100,
        processingRate: 0,
        oldestJobAgeMs: 600000,
      });

      expect(result.estimatedDrainTimeMs).toBe(-1);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Telemetry Dashboard Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("telemetry-dashboard", () => {
  describe("metric definitions", () => {
    it("ALL_METRICS contains all defined metrics", () => {
      expect(ALL_METRICS).toHaveLength(8);
      expect(ALL_METRICS).toContain(TRANSACTION_SUCCESS_RATE);
      expect(ALL_METRICS).toContain(TRANSACTION_FAILURE_RATE);
      expect(ALL_METRICS).toContain(RECONCILIATION_LATENCY);
      expect(ALL_METRICS).toContain(PROVIDER_RESPONSE_TIME);
      expect(ALL_METRICS).toContain(QUEUE_DEPTH);
      expect(ALL_METRICS).toContain(QUEUE_PROCESSING_RATE);
      expect(ALL_METRICS).toContain(ERROR_RATE_BY_CATEGORY);
      expect(ALL_METRICS).toContain(KILL_SWITCH_ACTIVATIONS);
    });

    it("each metric definition is frozen", () => {
      for (const metric of ALL_METRICS) {
        expect(Object.isFrozen(metric)).toBe(true);
      }
    });

    it("metrics have unique IDs", () => {
      const ids = ALL_METRICS.map((m) => m.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe("evaluateMetricStatus", () => {
    it("returns normal for success rate above warning", () => {
      expect(evaluateMetricStatus(TRANSACTION_SUCCESS_RATE, 98)).toBe("normal");
    });

    it("returns warning for success rate between thresholds", () => {
      expect(evaluateMetricStatus(TRANSACTION_SUCCESS_RATE, 92)).toBe("warning");
    });

    it("returns critical for success rate below critical", () => {
      expect(evaluateMetricStatus(TRANSACTION_SUCCESS_RATE, 85)).toBe("critical");
    });

    it("returns normal for failure rate below warning", () => {
      expect(evaluateMetricStatus(TRANSACTION_FAILURE_RATE, 3)).toBe("normal");
    });

    it("returns warning for failure rate between thresholds", () => {
      expect(evaluateMetricStatus(TRANSACTION_FAILURE_RATE, 7)).toBe("warning");
    });

    it("returns critical for failure rate above critical", () => {
      expect(evaluateMetricStatus(TRANSACTION_FAILURE_RATE, 15)).toBe("critical");
    });

    it("returns critical for high queue depth", () => {
      expect(evaluateMetricStatus(QUEUE_DEPTH, 6000)).toBe("critical");
    });
  });

  describe("createMetricSnapshot", () => {
    it("creates snapshot from data points", () => {
      const dataPoints = [
        { timestamp: "2024-01-01T00:00:00Z", value: 96 },
        { timestamp: "2024-01-01T00:01:00Z", value: 97 },
        { timestamp: "2024-01-01T00:02:00Z", value: 98 },
      ];

      const snapshot = createMetricSnapshot(TRANSACTION_SUCCESS_RATE, dataPoints, "5m");

      expect(snapshot.metricId).toBe("txn_success_rate");
      expect(snapshot.currentValue).toBe(98);
      expect(snapshot.previousValue).toBe(97);
      expect(snapshot.trend).toBe("up");
      expect(snapshot.status).toBe("normal");
      expect(snapshot.window).toBe("5m");
      expect(Object.isFrozen(snapshot)).toBe(true);
    });

    it("handles empty data points", () => {
      const snapshot = createMetricSnapshot(TRANSACTION_SUCCESS_RATE, [], "5m");
      expect(snapshot.currentValue).toBe(0);
      expect(snapshot.trend).toBe("stable");
    });

    it("detects downward trend", () => {
      const dataPoints = [
        { timestamp: "2024-01-01T00:00:00Z", value: 98 },
        { timestamp: "2024-01-01T00:01:00Z", value: 95 },
      ];

      const snapshot = createMetricSnapshot(TRANSACTION_SUCCESS_RATE, dataPoints, "5m");
      expect(snapshot.trend).toBe("down");
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Recovery Commands Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("recovery-commands", () => {
  describe("createReplayCommand", () => {
    it("creates a valid replay command", () => {
      const cmd = createReplayCommand({
        id: "cmd-1",
        initiatedBy: "operator-1",
        reason: "Stuck transactions after outage",
        targetTransactionIds: ["tx-1", "tx-2"],
        dryRun: true,
      });

      expect(cmd.type).toBe("replay");
      expect(cmd.status).toBe("pending");
      expect(cmd.targetTransactionIds).toEqual(["tx-1", "tx-2"]);
      expect(cmd.maxRetries).toBe(3);
      expect(cmd.dryRun).toBe(true);
      expect(Object.isFrozen(cmd)).toBe(true);
    });
  });

  describe("createRotateCredentialsCommand", () => {
    it("creates a valid rotation command", () => {
      const cmd = createRotateCredentialsCommand({
        id: "cmd-2",
        initiatedBy: "operator-1",
        reason: "Scheduled rotation",
        providerId: "razorpay",
        merchantId: "m-1",
        rotationType: "api_key",
        gracePeriodMs: 120000,
      });

      expect(cmd.type).toBe("rotate_credentials");
      expect(cmd.providerId).toBe("razorpay");
      expect(cmd.gracePeriodMs).toBe(120000);
      expect(Object.isFrozen(cmd)).toBe(true);
    });
  });

  describe("createBackupRestoreCommand", () => {
    it("creates a backup command with encryption", () => {
      const cmd = createBackupRestoreCommand({
        id: "cmd-3",
        initiatedBy: "operator-1",
        reason: "Merchant offboarding",
        operation: "backup",
        merchantId: "m-1",
        scope: ["transactions", "config", "audit_log"],
      });

      expect(cmd.type).toBe("backup_restore");
      expect(cmd.operation).toBe("backup");
      expect(cmd.encryptionRequired).toBe(true);
      expect(cmd.scope).toEqual(["transactions", "config", "audit_log"]);
      expect(Object.isFrozen(cmd)).toBe(true);
    });
  });

  describe("createDrainQueueCommand", () => {
    it("creates a drain command with defaults", () => {
      const cmd = createDrainQueueCommand({
        id: "cmd-4",
        initiatedBy: "operator-1",
        reason: "Queue backlog resolution",
        queueName: "reconciliation",
      });

      expect(cmd.type).toBe("drain_queue");
      expect(cmd.strategy).toBe("complete_in_flight");
      expect(cmd.timeoutMs).toBe(300000);
      expect(Object.isFrozen(cmd)).toBe(true);
    });
  });

  describe("createForceReconcileCommand", () => {
    it("creates a force reconcile command", () => {
      const cmd = createForceReconcileCommand({
        id: "cmd-5",
        initiatedBy: "operator-1",
        reason: "Post-crash verification",
        merchantId: "m-1",
        providerId: "razorpay",
        fromTimestamp: "2024-01-01T00:00:00Z",
        toTimestamp: "2024-01-01T23:59:59Z",
      });

      expect(cmd.type).toBe("force_reconcile");
      expect(cmd.includeSettled).toBe(false);
      expect(Object.isFrozen(cmd)).toBe(true);
    });
  });

  describe("validateCommand", () => {
    it("validates a correct replay command", () => {
      const cmd = createReplayCommand({
        id: "cmd-1",
        initiatedBy: "operator-1",
        reason: "Test",
        targetTransactionIds: ["tx-1"],
      });
      const result = validateCommand(cmd);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("rejects replay command with no targets and no time range", () => {
      const cmd = createReplayCommand({
        id: "cmd-1",
        initiatedBy: "operator-1",
        reason: "Test",
        targetTransactionIds: [],
      });
      const result = validateCommand(cmd);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("rejects backup restore without snapshot for restore", () => {
      const cmd = createBackupRestoreCommand({
        id: "cmd-1",
        initiatedBy: "operator-1",
        reason: "Test",
        operation: "restore",
        merchantId: "m-1",
        scope: ["transactions"],
      });
      const result = validateCommand(cmd);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("snapshot"))).toBe(true);
    });

    it("rejects force reconcile with invalid date range", () => {
      const cmd = createForceReconcileCommand({
        id: "cmd-1",
        initiatedBy: "operator-1",
        reason: "Test",
        merchantId: "m-1",
        providerId: "razorpay",
        fromTimestamp: "2024-01-31T00:00:00Z",
        toTimestamp: "2024-01-01T00:00:00Z",
      });
      const result = validateCommand(cmd);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("timestamp"))).toBe(true);
    });

    it("rejects drain queue with very short timeout", () => {
      const cmd = createDrainQueueCommand({
        id: "cmd-1",
        initiatedBy: "operator-1",
        reason: "Test",
        queueName: "test",
        timeoutMs: 500,
      });
      const result = validateCommand(cmd);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("1000ms"))).toBe(true);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Runbook Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("runbooks", () => {
  it("ALL_RUNBOOKS contains 5 runbooks", () => {
    expect(ALL_RUNBOOKS).toHaveLength(5);
  });

  it("each runbook has unique ID", () => {
    const ids = ALL_RUNBOOKS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("OutageRunbook covers detection through post-incident", () => {
    expect(OUTAGE_RUNBOOK.steps.length).toBeGreaterThan(5);
    expect(OUTAGE_RUNBOOK.severity).toBe("critical");
    expect(OUTAGE_RUNBOOK.steps[0]!.title).toContain("Detection");
    expect(OUTAGE_RUNBOOK.steps[OUTAGE_RUNBOOK.steps.length - 1]!.title).toContain("Post-Incident");
  });

  it("QueueBacklogRunbook handles monitoring and drain", () => {
    expect(QUEUE_BACKLOG_RUNBOOK.severity).toBe("high");
    expect(QUEUE_BACKLOG_RUNBOOK.tags).toContain("drain");
    expect(QUEUE_BACKLOG_RUNBOOK.tags).toContain("replay");
  });

  it("CrashRecoveryRunbook includes state assessment and replay", () => {
    expect(CRASH_RECOVERY_RUNBOOK.severity).toBe("critical");
    const stepTitles = CRASH_RECOVERY_RUNBOOK.steps.map((s) => s.title);
    expect(stepTitles.some((t) => t.includes("State"))).toBe(true);
    expect(stepTitles.some((t) => t.includes("Replay"))).toBe(true);
  });

  it("OffboardingRunbook covers full lifecycle", () => {
    expect(OFFBOARDING_RUNBOOK.severity).toBe("medium");
    const stepTitles = OFFBOARDING_RUNBOOK.steps.map((s) => s.title);
    expect(stepTitles.some((t) => t.includes("Suspend"))).toBe(true);
    expect(stepTitles.some((t) => t.includes("Export"))).toBe(true);
    expect(stepTitles.some((t) => t.includes("Cleanup"))).toBe(true);
    expect(stepTitles.some((t) => t.includes("Verify"))).toBe(true);
  });

  it("RotationRunbook enables zero-downtime rotation", () => {
    expect(ROTATION_RUNBOOK.severity).toBe("high");
    const stepTitles = ROTATION_RUNBOOK.steps.map((s) => s.title);
    expect(stepTitles.some((t) => t.includes("Dual-Credential"))).toBe(true);
    expect(stepTitles.some((t) => t.includes("Revoke Old"))).toBe(true);
  });

  it("findRunbookById returns correct runbook", () => {
    const found = findRunbookById("runbook-outage-001");
    expect(found).toBe(OUTAGE_RUNBOOK);
  });

  it("findRunbookById returns undefined for unknown ID", () => {
    const found = findRunbookById("nonexistent");
    expect(found).toBeUndefined();
  });

  it("findRunbooksByTag returns matching runbooks", () => {
    const found = findRunbooksByTag("recovery");
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((r) => r.tags.includes("recovery"))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Credential Scanner Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("credential-scanner", () => {
  describe("FORBIDDEN_CREDENTIAL_FIELDS", () => {
    it("contains expected forbidden fields", () => {
      expect(FORBIDDEN_CREDENTIAL_FIELDS).toContain("api_key");
      expect(FORBIDDEN_CREDENTIAL_FIELDS).toContain("api_secret");
      expect(FORBIDDEN_CREDENTIAL_FIELDS).toContain("private_key");
      expect(FORBIDDEN_CREDENTIAL_FIELDS).toContain("client_secret");
      expect(FORBIDDEN_CREDENTIAL_FIELDS).toContain("webhook_secret");
      expect(FORBIDDEN_CREDENTIAL_FIELDS).toContain("access_token");
      expect(FORBIDDEN_CREDENTIAL_FIELDS).toContain("password");
      expect(FORBIDDEN_CREDENTIAL_FIELDS.length).toBeGreaterThan(10);
    });
  });

  describe("matchesForbiddenPattern", () => {
    it("matches exact field names", () => {
      expect(matchesForbiddenPattern("api_key")).toBe("api_key");
      expect(matchesForbiddenPattern("api_secret")).toBe("api_secret");
      expect(matchesForbiddenPattern("private_key")).toBe("private_key");
    });

    it("matches with prefix", () => {
      expect(matchesForbiddenPattern("api_key_v2")).toBe("api_key");
      expect(matchesForbiddenPattern("private_key_rsa")).toBe("private_key");
    });

    it("matches with suffix", () => {
      expect(matchesForbiddenPattern("razorpay_api_key")).toBe("api_key");
      expect(matchesForbiddenPattern("provider_client_secret")).toBe("client_secret");
    });

    it("normalizes separators", () => {
      expect(matchesForbiddenPattern("api-key")).toBe("api_key");
      expect(matchesForbiddenPattern("api.key")).toBe("api_key");
    });

    it("is case insensitive", () => {
      expect(matchesForbiddenPattern("API_KEY")).toBe("api_key");
      expect(matchesForbiddenPattern("Private_Key")).toBe("private_key");
    });

    it("returns null for safe field names", () => {
      expect(matchesForbiddenPattern("merchantId")).toBeNull();
      expect(matchesForbiddenPattern("transaction_id")).toBeNull();
      expect(matchesForbiddenPattern("amount")).toBeNull();
    });
  });

  describe("scanObjectForCredentials", () => {
    it("detects credentials in flat objects", () => {
      const findings = scanObjectForCredentials({
        merchantId: "m-1",
        api_key: "sk_live_abc123",
        amount: 1000,
      });

      expect(findings).toHaveLength(1);
      expect(findings[0]!.field).toBe("api_key");
      expect(findings[0]!.severity).not.toBe("low");
    });

    it("detects credentials in nested objects", () => {
      const findings = scanObjectForCredentials({
        config: {
          provider: {
            client_secret: "secret_value",
          },
        },
      });

      expect(findings).toHaveLength(1);
      expect(findings[0]!.location).toBe("config.provider.client_secret");
    });

    it("detects credentials in arrays", () => {
      const findings = scanObjectForCredentials({
        providers: [{ name: "razorpay", api_secret: "secret" }],
      });

      expect(findings).toHaveLength(1);
      expect(findings[0]!.location).toContain("providers[0]");
    });

    it("returns empty array for clean objects", () => {
      const findings = scanObjectForCredentials({
        merchantId: "m-1",
        name: "Test Store",
        amount: 5000,
        status: "active",
      });

      expect(findings).toHaveLength(0);
    });

    it("does not flag empty or null values", () => {
      const findings = scanObjectForCredentials({
        api_key: "",
        api_secret: null,
      });

      expect(findings).toHaveLength(0);
    });

    it("provides remediation guidance", () => {
      const findings = scanObjectForCredentials({
        private_key: "-----BEGIN RSA PRIVATE KEY-----",
      });

      expect(findings[0]!.remediation).toContain("Remove or redact");
      expect(findings[0]!.severity).toBe("critical");
    });
  });

  describe("scanStorageForCredentials", () => {
    it("scans all keys and reports findings", async () => {
      const mockStorage: StoragePort = {
        listKeys: async () => ["merchant:m-1", "merchant:m-2"],
        getValue: async (key) => {
          if (key === "merchant:m-1") return { id: "m-1", api_key: "secret" };
          return { id: "m-2", name: "clean" };
        },
      };

      const result = await scanStorageForCredentials(mockStorage);

      expect(result.scanType).toBe("storage");
      expect(result.totalRecordsScanned).toBe(2);
      expect(result.findings).toHaveLength(1);
      expect(result.clean).toBe(false);
    });

    it("reports clean when no findings", async () => {
      const mockStorage: StoragePort = {
        listKeys: async () => ["merchant:m-1"],
        getValue: async () => ({ id: "m-1", name: "Safe Store" }),
      };

      const result = await scanStorageForCredentials(mockStorage);
      expect(result.clean).toBe(true);
      expect(result.findings).toHaveLength(0);
    });
  });

  describe("scanTelemetryForCredentials", () => {
    it("scans logs and metrics for credentials", async () => {
      const mockTelemetry: TelemetryPort = {
        getRecentLogEntries: async () => [
          { message: "Auth failed", access_token: "tok_123" },
          { message: "Request ok", requestId: "req-1" },
        ],
        getRecentMetricPayloads: async () => [
          { metric: "latency", value: 100 },
          { metric: "auth", bearer_token: "bearer_abc" },
        ],
      };

      const result = await scanTelemetryForCredentials(mockTelemetry, 10);

      expect(result.scanType).toBe("telemetry");
      expect(result.totalRecordsScanned).toBe(4);
      expect(result.findings).toHaveLength(2);
      expect(result.clean).toBe(false);
    });

    it("reports clean for safe telemetry", async () => {
      const mockTelemetry: TelemetryPort = {
        getRecentLogEntries: async () => [{ message: "ok", requestId: "r-1" }],
        getRecentMetricPayloads: async () => [{ metric: "latency", value: 50 }],
      };

      const result = await scanTelemetryForCredentials(mockTelemetry);
      expect(result.clean).toBe(true);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Support Grants Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("support-grants", () => {
  function createMockStore(): GrantStore & { grants: Map<string, SupportGrant> } {
    const grants = new Map<string, SupportGrant>();
    return {
      grants,
      save: async (grant) => {
        grants.set(grant.id, grant);
      },
      findById: async (id) => grants.get(id) ?? null,
      findByMerchant: async (merchantId) =>
        Array.from(grants.values()).filter((g) => g.merchantId === merchantId),
      update: async (grant) => {
        grants.set(grant.id, grant);
      },
    };
  }

  describe("validateGrantConfig", () => {
    it("validates a correct config", () => {
      const result = validateGrantConfig({
        merchantId: "m-1",
        operatorId: "op-1",
        permissions: ["view_transactions"],
        reason: "Customer support case #12345",
        durationMinutes: 60,
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("rejects missing merchant ID", () => {
      const result = validateGrantConfig({
        merchantId: "",
        operatorId: "op-1",
        permissions: ["view_transactions"],
        reason: "Customer support case #12345",
        durationMinutes: 60,
      });
      expect(result.valid).toBe(false);
    });

    it("rejects short reason", () => {
      const result = validateGrantConfig({
        merchantId: "m-1",
        operatorId: "op-1",
        permissions: ["view_transactions"],
        reason: "short",
        durationMinutes: 60,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("10 characters"))).toBe(true);
    });

    it("rejects invalid permissions", () => {
      const result = validateGrantConfig({
        merchantId: "m-1",
        operatorId: "op-1",
        permissions: ["delete_everything"],
        reason: "Customer support case",
        durationMinutes: 60,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Invalid permissions"))).toBe(true);
    });

    it("rejects duration exceeding max", () => {
      const result = validateGrantConfig({
        merchantId: "m-1",
        operatorId: "op-1",
        permissions: ["view_transactions"],
        reason: "Customer support case",
        durationMinutes: MAX_GRANT_DURATION_MINUTES + 1,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("exceed"))).toBe(true);
    });

    it("rejects empty permissions", () => {
      const result = validateGrantConfig({
        merchantId: "m-1",
        operatorId: "op-1",
        permissions: [],
        reason: "Customer support case",
        durationMinutes: 60,
      });
      expect(result.valid).toBe(false);
    });
  });

  describe("createSupportGrant", () => {
    it("creates a grant successfully", async () => {
      const store = createMockStore();
      const result = await createSupportGrant(store, {
        merchantId: "m-1",
        operatorId: "op-1",
        permissions: ["view_transactions", "view_audit_log"],
        reason: "Customer support case investigation",
        durationMinutes: 60,
      });

      expect(result.success).toBe(true);
      expect(result.grantId).toBeTruthy();
      expect(store.grants.size).toBe(1);

      const saved = store.grants.values().next().value as SupportGrant;
      expect(saved.status).toBe("active");
      expect(saved.merchantId).toBe("m-1");
      expect(saved.operatorId).toBe("op-1");
    });

    it("rejects invalid config", async () => {
      const store = createMockStore();
      const result = await createSupportGrant(store, {
        merchantId: "",
        operatorId: "op-1",
        permissions: [],
        reason: "x",
        durationMinutes: 0,
      });

      expect(result.success).toBe(false);
      expect(result.grantId).toBe("");
      expect(store.grants.size).toBe(0);
    });
  });

  describe("revokeSupportGrant", () => {
    it("revokes an active grant", async () => {
      const store = createMockStore();
      await createSupportGrant(store, {
        merchantId: "m-1",
        operatorId: "op-1",
        permissions: ["view_transactions"],
        reason: "Customer support case #12345",
        durationMinutes: 60,
      });

      const grantId = store.grants.keys().next().value as string;
      const result = await revokeSupportGrant(store, grantId, "admin-1");

      expect(result.success).toBe(true);
      const updated = store.grants.get(grantId)!;
      expect(updated.status).toBe("revoked");
      expect(updated.revokedBy).toBe("admin-1");
    });

    it("returns error for non-existent grant", async () => {
      const store = createMockStore();
      const result = await revokeSupportGrant(store, "nonexistent", "admin-1");
      expect(result.success).toBe(false);
      expect(result.message).toContain("not found");
    });

    it("returns error for already revoked grant", async () => {
      const store = createMockStore();
      await createSupportGrant(store, {
        merchantId: "m-1",
        operatorId: "op-1",
        permissions: ["view_transactions"],
        reason: "Customer support case #12345",
        durationMinutes: 60,
      });

      const grantId = store.grants.keys().next().value as string;
      await revokeSupportGrant(store, grantId, "admin-1");
      const result = await revokeSupportGrant(store, grantId, "admin-2");

      expect(result.success).toBe(false);
      expect(result.message).toContain("revoked");
    });
  });

  describe("listActiveGrants", () => {
    it("returns only active non-expired grants", async () => {
      const store = createMockStore();

      // Create an active grant
      await createSupportGrant(store, {
        merchantId: "m-1",
        operatorId: "op-1",
        permissions: ["view_transactions"],
        reason: "Customer support case #12345",
        durationMinutes: 60,
      });

      const result = await listActiveGrants(store, "m-1");
      expect(result).toHaveLength(1);
    });

    it("filters out grants for other merchants", async () => {
      const store = createMockStore();

      await createSupportGrant(store, {
        merchantId: "m-1",
        operatorId: "op-1",
        permissions: ["view_transactions"],
        reason: "Customer support case #12345",
        durationMinutes: 60,
      });

      const result = await listActiveGrants(store, "m-2");
      expect(result).toHaveLength(0);
    });
  });

  describe("VALID_PERMISSIONS", () => {
    it("contains expected permission set", () => {
      expect(VALID_PERMISSIONS).toContain("view_transactions");
      expect(VALID_PERMISSIONS).toContain("retry_transaction");
      expect(VALID_PERMISSIONS).toContain("void_transaction");
      expect(VALID_PERMISSIONS).toContain("issue_refund");
      expect(VALID_PERMISSIONS).toContain("export_data");
    });
  });
});
