/**
 * Operations console data projections.
 *
 * These projections flatten complex domain data into shapes
 * optimized for operator dashboards and alert displays.
 */

// ─── Transaction Projection ────────────────────────────────────────────────────

/**
 * Flattened transaction view for operator dashboards.
 */
export interface TransactionProjection {
  readonly id: string;
  readonly merchantId: string;
  readonly merchantName: string;
  readonly amount: number;
  readonly currency: string;
  readonly status: string;
  readonly providerName: string;
  readonly createdAt: string;
  readonly durationMs: number;
  readonly hasError: boolean;
  readonly errorCategory?: string;
}

/**
 * Projects raw transaction data into a flattened dashboard view.
 */
export function projectTransaction(raw: {
  readonly id: string;
  readonly merchantId: string;
  readonly merchantName?: string;
  readonly amount: number;
  readonly currency: string;
  readonly status: string;
  readonly providerName?: string;
  readonly createdAt: string;
  readonly completedAt?: string;
  readonly errorCode?: string;
}): TransactionProjection {
  const createdMs = new Date(raw.createdAt).getTime();
  const completedMs = raw.completedAt ? new Date(raw.completedAt).getTime() : Date.now();
  const durationMs = Math.max(0, completedMs - createdMs);

  return Object.freeze({
    id: raw.id,
    merchantId: raw.merchantId,
    merchantName: raw.merchantName ?? "Unknown",
    amount: raw.amount,
    currency: raw.currency,
    status: raw.status,
    providerName: raw.providerName ?? "Unknown",
    createdAt: raw.createdAt,
    durationMs,
    hasError: raw.errorCode !== undefined,
    ...(raw.errorCode ? { errorCategory: categorizeError(raw.errorCode) } : {}),
  });
}

// ─── Merchant Health Projection ─────────────────────────────────────────────────

/**
 * Aggregated merchant health metrics.
 */
export interface MerchantHealthProjection {
  readonly merchantId: string;
  readonly merchantName: string;
  readonly transactionSuccessRate: number;
  readonly averageLatencyMs: number;
  readonly activeIncidents: number;
  readonly killSwitchesActive: number;
  readonly lastTransactionAt: string | null;
  readonly healthScore: number;
}

/**
 * Projects merchant health from aggregate inputs.
 */
export function projectMerchantHealth(input: {
  readonly merchantId: string;
  readonly merchantName: string;
  readonly totalTransactions: number;
  readonly successfulTransactions: number;
  readonly totalLatencyMs: number;
  readonly activeIncidents: number;
  readonly killSwitchesActive: number;
  readonly lastTransactionAt: string | null;
}): MerchantHealthProjection {
  const successRate =
    input.totalTransactions > 0 ? input.successfulTransactions / input.totalTransactions : 1;
  const avgLatency =
    input.totalTransactions > 0 ? input.totalLatencyMs / input.totalTransactions : 0;

  // Health score: 100 base, deductions for issues
  const healthScore = Math.max(
    0,
    Math.round(
      100 - (1 - successRate) * 50 - input.activeIncidents * 15 - input.killSwitchesActive * 10,
    ),
  );

  return Object.freeze({
    merchantId: input.merchantId,
    merchantName: input.merchantName,
    transactionSuccessRate: Math.round(successRate * 10000) / 10000,
    averageLatencyMs: Math.round(avgLatency),
    activeIncidents: input.activeIncidents,
    killSwitchesActive: input.killSwitchesActive,
    lastTransactionAt: input.lastTransactionAt,
    healthScore,
  });
}

// ─── Alert Projection ───────────────────────────────────────────────────────────

/**
 * Severity levels for operator alerts.
 */
export type AlertSeverity = "critical" | "warning" | "info";

/**
 * Threshold-based alert for operator attention.
 */
export interface AlertProjection {
  readonly id: string;
  readonly severity: AlertSeverity;
  readonly title: string;
  readonly description: string;
  readonly metric: string;
  readonly threshold: number;
  readonly currentValue: number;
  readonly triggeredAt: string;
  readonly merchantId?: string;
}

/**
 * Creates an alert projection when a metric exceeds its threshold.
 */
export function createAlertProjection(input: {
  readonly id: string;
  readonly metric: string;
  readonly threshold: number;
  readonly currentValue: number;
  readonly merchantId?: string;
}): AlertProjection | null {
  if (input.currentValue <= input.threshold) {
    return null;
  }

  const ratio = input.currentValue / input.threshold;
  const severity: AlertSeverity = ratio >= 3 ? "critical" : ratio >= 1.5 ? "warning" : "info";

  return Object.freeze({
    id: input.id,
    severity,
    title: `${input.metric} threshold exceeded`,
    description: `Current value ${input.currentValue} exceeds threshold ${input.threshold}`,
    metric: input.metric,
    threshold: input.threshold,
    currentValue: input.currentValue,
    triggeredAt: new Date().toISOString(),
    ...(input.merchantId ? { merchantId: input.merchantId } : {}),
  });
}

// ─── Queue Projection ───────────────────────────────────────────────────────────

/**
 * Job queue status projection for operator dashboards.
 */
export interface QueueProjection {
  readonly name: string;
  readonly depth: number;
  readonly processingRate: number;
  readonly estimatedDrainTimeMs: number;
  readonly oldestJobAgeMs: number;
  readonly isBacklogged: boolean;
  readonly healthStatus: "healthy" | "degraded" | "critical";
}

/**
 * Projects queue health from raw queue metrics.
 */
export function projectQueueHealth(input: {
  readonly name: string;
  readonly depth: number;
  readonly processingRate: number;
  readonly oldestJobAgeMs: number;
  readonly backlogThreshold?: number;
}): QueueProjection {
  const backlogThreshold = input.backlogThreshold ?? 1000;
  const estimatedDrainTimeMs =
    input.processingRate > 0 ? (input.depth / input.processingRate) * 1000 : Infinity;
  const isBacklogged = input.depth > backlogThreshold;

  const healthStatus: "healthy" | "degraded" | "critical" =
    input.depth > backlogThreshold * 3 ? "critical" : isBacklogged ? "degraded" : "healthy";

  return Object.freeze({
    name: input.name,
    depth: input.depth,
    processingRate: input.processingRate,
    estimatedDrainTimeMs: estimatedDrainTimeMs === Infinity ? -1 : Math.round(estimatedDrainTimeMs),
    oldestJobAgeMs: input.oldestJobAgeMs,
    isBacklogged,
    healthStatus,
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function categorizeError(errorCode: string): string {
  if (errorCode.startsWith("PROVIDER_")) return "provider";
  if (errorCode.startsWith("NETWORK_")) return "network";
  if (errorCode.startsWith("VALIDATION_")) return "validation";
  if (errorCode.startsWith("TIMEOUT_")) return "timeout";
  if (errorCode.startsWith("AUTH_")) return "authentication";
  return "unknown";
}
