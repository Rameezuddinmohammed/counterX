/**
 * Operations service for wallet platform monitoring and control.
 *
 * Provides:
 * - Metrics collection: transaction counts, approval rates, trigger execution counts
 * - Anomaly detection: unusual amounts, frequency spikes, failed policy checks
 * - Kill switch management: global/merchant/wallet scope activation/deactivation
 */

// ---------------------------------------------------------------------------
// Metrics Types
// ---------------------------------------------------------------------------

export interface WalletMetrics {
  readonly walletId: string;
  readonly transactionCount: number;
  readonly approvalCount: number;
  readonly rejectionCount: number;
  readonly triggerExecutionCount: number;
  readonly failedPolicyCheckCount: number;
  readonly lastUpdated: string;
}

export interface MetricEvent {
  readonly walletId: string;
  readonly eventType: MetricEventType;
  readonly timestamp: string;
  readonly amount?: bigint;
  readonly merchantId?: string;
  readonly details?: string;
}

export const METRIC_EVENT_TYPES = [
  "transaction",
  "approval",
  "rejection",
  "trigger_execution",
  "policy_check_failure",
] as const;

export type MetricEventType = (typeof METRIC_EVENT_TYPES)[number];

// ---------------------------------------------------------------------------
// Anomaly Types
// ---------------------------------------------------------------------------

export interface AnomalyAlert {
  readonly alertId: string;
  readonly walletId: string;
  readonly anomalyType: AnomalyType;
  readonly severity: AnomalySeverity;
  readonly description: string;
  readonly detectedAt: string;
  readonly context: Record<string, unknown>;
}

export const ANOMALY_TYPES = [
  "unusual_amount",
  "frequency_spike",
  "failed_policy_checks",
] as const;

export type AnomalyType = (typeof ANOMALY_TYPES)[number];

export const ANOMALY_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type AnomalySeverity = (typeof ANOMALY_SEVERITIES)[number];

// ---------------------------------------------------------------------------
// Anomaly Detection Config
// ---------------------------------------------------------------------------

export interface AnomalyDetectionConfig {
  /** Threshold above which an amount is considered unusual (in paise) */
  readonly unusualAmountThreshold: bigint;
  /** Maximum transactions in a time window before a frequency spike is flagged */
  readonly frequencyWindowMs: number;
  readonly frequencyMaxCount: number;
  /** Number of failed policy checks to trigger an alert */
  readonly failedPolicyCheckThreshold: number;
}

const DEFAULT_ANOMALY_CONFIG: AnomalyDetectionConfig = {
  unusualAmountThreshold: 1_000_000n, // 10,000 INR
  frequencyWindowMs: 60 * 60 * 1000, // 1 hour
  frequencyMaxCount: 10,
  failedPolicyCheckThreshold: 5,
};

// ---------------------------------------------------------------------------
// Kill Switch Types
// ---------------------------------------------------------------------------

export const OPERATIONS_KILL_SWITCH_SCOPES = ["global", "merchant", "wallet"] as const;
export type OperationsKillSwitchScope = (typeof OPERATIONS_KILL_SWITCH_SCOPES)[number];

export interface OperationsKillSwitch {
  readonly switchId: string;
  readonly scope: OperationsKillSwitchScope;
  readonly entityId: string | null;
  readonly active: boolean;
  readonly reason: string;
  readonly activatedAt: string;
  readonly activatedBy: string;
}

// ---------------------------------------------------------------------------
// Operations Error
// ---------------------------------------------------------------------------

export interface OperationsError {
  readonly kind: "operations_error";
  readonly reason: string;
}

export type OperationsResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: OperationsError };

// ---------------------------------------------------------------------------
// OperationsService
// ---------------------------------------------------------------------------

export class OperationsService {
  readonly #metrics = new Map<string, WalletMetrics>();
  readonly #events: MetricEvent[] = [];
  readonly #alerts: AnomalyAlert[] = [];
  readonly #killSwitches = new Map<string, OperationsKillSwitch>();
  readonly #config: AnomalyDetectionConfig;
  #switchCounter = 0;
  #alertCounter = 0;

  constructor(config?: Partial<AnomalyDetectionConfig>) {
    this.#config = { ...DEFAULT_ANOMALY_CONFIG, ...config };
  }

  // -------------------------------------------------------------------------
  // Metrics
  // -------------------------------------------------------------------------

  /**
   * Records a metric event and updates aggregated metrics.
   */
  recordEvent(event: MetricEvent): void {
    this.#events.push(event);
    this.#updateMetrics(event);
    this.#detectAnomalies(event);
  }

  /**
   * Gets aggregated metrics for a wallet.
   */
  getMetrics(walletId: string): WalletMetrics | undefined {
    return this.#metrics.get(walletId);
  }

  /**
   * Gets all recorded events for a wallet.
   */
  getEvents(walletId: string): readonly MetricEvent[] {
    return this.#events.filter((e) => e.walletId === walletId);
  }

  // -------------------------------------------------------------------------
  // Anomaly Detection
  // -------------------------------------------------------------------------

  /**
   * Gets all anomaly alerts for a wallet.
   */
  getAlerts(walletId: string): readonly AnomalyAlert[] {
    return this.#alerts.filter((a) => a.walletId === walletId);
  }

  /**
   * Gets all anomaly alerts.
   */
  getAllAlerts(): readonly AnomalyAlert[] {
    return [...this.#alerts];
  }

  // -------------------------------------------------------------------------
  // Kill Switch Management
  // -------------------------------------------------------------------------

  /**
   * Activates a kill switch for the specified scope.
   */
  activateKillSwitch(
    scope: OperationsKillSwitchScope,
    entityId: string | null,
    reason: string,
    activatedBy: string,
  ): OperationsResult<OperationsKillSwitch> {
    this.#switchCounter += 1;
    const switchId = `ks-${this.#switchCounter}`;

    const killSwitch: OperationsKillSwitch = {
      switchId,
      scope,
      entityId,
      active: true,
      reason,
      activatedAt: new Date().toISOString(),
      activatedBy,
    };

    this.#killSwitches.set(switchId, killSwitch);

    return { ok: true, value: killSwitch };
  }

  /**
   * Deactivates a kill switch.
   */
  deactivateKillSwitch(switchId: string): OperationsResult<OperationsKillSwitch> {
    const existing = this.#killSwitches.get(switchId);
    if (!existing) {
      return {
        ok: false,
        error: { kind: "operations_error", reason: "Kill switch not found" },
      };
    }

    const deactivated: OperationsKillSwitch = {
      ...existing,
      active: false,
    };
    this.#killSwitches.set(switchId, deactivated);

    return { ok: true, value: deactivated };
  }

  /**
   * Checks if a scope/entity is currently killed.
   */
  isKilled(scope: OperationsKillSwitchScope, entityId: string | null): boolean {
    for (const sw of this.#killSwitches.values()) {
      if (!sw.active) continue;
      if (sw.scope === "global") return true;
      if (sw.scope === scope && (sw.entityId === null || sw.entityId === entityId)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Lists all kill switches (active and inactive).
   */
  listKillSwitches(): readonly OperationsKillSwitch[] {
    return [...this.#killSwitches.values()];
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  #updateMetrics(event: MetricEvent): void {
    const existing = this.#metrics.get(event.walletId) ?? {
      walletId: event.walletId,
      transactionCount: 0,
      approvalCount: 0,
      rejectionCount: 0,
      triggerExecutionCount: 0,
      failedPolicyCheckCount: 0,
      lastUpdated: event.timestamp,
    };

    const updated: WalletMetrics = {
      ...existing,
      transactionCount: existing.transactionCount + (event.eventType === "transaction" ? 1 : 0),
      approvalCount: existing.approvalCount + (event.eventType === "approval" ? 1 : 0),
      rejectionCount: existing.rejectionCount + (event.eventType === "rejection" ? 1 : 0),
      triggerExecutionCount: existing.triggerExecutionCount + (event.eventType === "trigger_execution" ? 1 : 0),
      failedPolicyCheckCount: existing.failedPolicyCheckCount + (event.eventType === "policy_check_failure" ? 1 : 0),
      lastUpdated: event.timestamp,
    };

    this.#metrics.set(event.walletId, updated);
  }

  #detectAnomalies(event: MetricEvent): void {
    // Check unusual amount
    if (event.eventType === "transaction" && event.amount !== undefined) {
      if (event.amount > this.#config.unusualAmountThreshold) {
        this.#raiseAlert(event.walletId, "unusual_amount", "high", `Transaction amount ${event.amount} exceeds threshold`, {
          amount: event.amount.toString(),
          threshold: this.#config.unusualAmountThreshold.toString(),
        });
      }
    }

    // Check frequency spike
    if (event.eventType === "transaction") {
      const windowStart = Date.now() - this.#config.frequencyWindowMs;
      const recentCount = this.#events.filter(
        (e) =>
          e.walletId === event.walletId &&
          e.eventType === "transaction" &&
          new Date(e.timestamp).getTime() > windowStart,
      ).length;

      if (recentCount > this.#config.frequencyMaxCount) {
        this.#raiseAlert(event.walletId, "frequency_spike", "medium", `${recentCount} transactions in time window exceeds limit of ${this.#config.frequencyMaxCount}`, {
          count: recentCount,
          limit: this.#config.frequencyMaxCount,
        });
      }
    }

    // Check failed policy checks
    if (event.eventType === "policy_check_failure") {
      const metrics = this.#metrics.get(event.walletId);
      if (metrics && metrics.failedPolicyCheckCount >= this.#config.failedPolicyCheckThreshold) {
        this.#raiseAlert(event.walletId, "failed_policy_checks", "high", `${metrics.failedPolicyCheckCount} failed policy checks reached threshold`, {
          count: metrics.failedPolicyCheckCount,
          threshold: this.#config.failedPolicyCheckThreshold,
        });
      }
    }
  }

  #raiseAlert(
    walletId: string,
    anomalyType: AnomalyType,
    severity: AnomalySeverity,
    description: string,
    context: Record<string, unknown>,
  ): void {
    this.#alertCounter += 1;
    this.#alerts.push({
      alertId: `alert-${this.#alertCounter}`,
      walletId,
      anomalyType,
      severity,
      description,
      detectedAt: new Date().toISOString(),
      context,
    });
  }
}
