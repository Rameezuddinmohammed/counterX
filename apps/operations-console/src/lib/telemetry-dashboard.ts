/**
 * Dashboard metric definitions for the operations console.
 *
 * Defines the telemetry metrics displayed on operator dashboards
 * for monitoring transaction health, provider performance, and queue status.
 */

// ─── Types ─────────────────────────────────────────────────────────────────────

/**
 * Unit of measurement for a metric.
 */
export type MetricUnit = "count" | "percentage" | "milliseconds" | "per_second" | "ratio";

/**
 * Time window for metric aggregation.
 */
export type MetricWindow = "1m" | "5m" | "15m" | "1h" | "6h" | "24h" | "7d";

/**
 * Definition of a dashboard metric.
 */
export interface MetricDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly unit: MetricUnit;
  readonly defaultWindow: MetricWindow;
  readonly warningThreshold: number;
  readonly criticalThreshold: number;
  readonly category: MetricCategory;
}

/**
 * Categories of dashboard metrics.
 */
export type MetricCategory =
  | "transaction_health"
  | "reconciliation"
  | "provider_performance"
  | "queue_operations"
  | "error_rates"
  | "kill_switch";

/**
 * A time-series data point.
 */
export interface MetricDataPoint {
  readonly timestamp: string;
  readonly value: number;
}

/**
 * A metric snapshot with current value and trend.
 */
export interface MetricSnapshot {
  readonly metricId: string;
  readonly currentValue: number;
  readonly previousValue: number;
  readonly trend: "up" | "down" | "stable";
  readonly window: MetricWindow;
  readonly dataPoints: readonly MetricDataPoint[];
  readonly status: "normal" | "warning" | "critical";
}

// ─── Metric Definitions ─────────────────────────────────────────────────────────

/**
 * Transaction success rate (percentage of transactions completing without error).
 */
export const TRANSACTION_SUCCESS_RATE: MetricDefinition = Object.freeze({
  id: "txn_success_rate",
  name: "Transaction Success Rate",
  description: "Percentage of transactions completing successfully within the window",
  unit: "percentage",
  defaultWindow: "5m",
  warningThreshold: 95,
  criticalThreshold: 90,
  category: "transaction_health",
});

/**
 * Transaction failure rate (percentage of transactions ending in error).
 */
export const TRANSACTION_FAILURE_RATE: MetricDefinition = Object.freeze({
  id: "txn_failure_rate",
  name: "Transaction Failure Rate",
  description: "Percentage of transactions failing within the window",
  unit: "percentage",
  defaultWindow: "5m",
  warningThreshold: 5,
  criticalThreshold: 10,
  category: "transaction_health",
});

/**
 * Reconciliation latency (time between transaction completion and reconciliation).
 */
export const RECONCILIATION_LATENCY: MetricDefinition = Object.freeze({
  id: "reconciliation_latency",
  name: "Reconciliation Latency",
  description: "Average time between transaction completion and reconciliation confirmation",
  unit: "milliseconds",
  defaultWindow: "15m",
  warningThreshold: 30000,
  criticalThreshold: 60000,
  category: "reconciliation",
});

/**
 * Provider response time (average round-trip time for provider API calls).
 */
export const PROVIDER_RESPONSE_TIME: MetricDefinition = Object.freeze({
  id: "provider_response_time",
  name: "Provider Response Time",
  description: "Average response time for payment provider API calls",
  unit: "milliseconds",
  defaultWindow: "5m",
  warningThreshold: 3000,
  criticalThreshold: 10000,
  category: "provider_performance",
});

/**
 * Queue depth (number of jobs waiting in processing queues).
 */
export const QUEUE_DEPTH: MetricDefinition = Object.freeze({
  id: "queue_depth",
  name: "Queue Depth",
  description: "Total number of jobs currently queued across all processing queues",
  unit: "count",
  defaultWindow: "1m",
  warningThreshold: 1000,
  criticalThreshold: 5000,
  category: "queue_operations",
});

/**
 * Queue processing rate (jobs processed per second).
 */
export const QUEUE_PROCESSING_RATE: MetricDefinition = Object.freeze({
  id: "queue_processing_rate",
  name: "Queue Processing Rate",
  description: "Number of queue jobs processed per second",
  unit: "per_second",
  defaultWindow: "5m",
  warningThreshold: 10,
  criticalThreshold: 5,
  category: "queue_operations",
});

/**
 * Error rate by category (errors per second grouped by error type).
 */
export const ERROR_RATE_BY_CATEGORY: MetricDefinition = Object.freeze({
  id: "error_rate_by_category",
  name: "Error Rate by Category",
  description: "Error occurrences per second grouped by error category",
  unit: "per_second",
  defaultWindow: "5m",
  warningThreshold: 1,
  criticalThreshold: 5,
  category: "error_rates",
});

/**
 * Kill switch activation history count.
 */
export const KILL_SWITCH_ACTIVATIONS: MetricDefinition = Object.freeze({
  id: "kill_switch_activations",
  name: "Kill Switch Activations",
  description: "Number of kill switch activations in the time window",
  unit: "count",
  defaultWindow: "24h",
  warningThreshold: 2,
  criticalThreshold: 5,
  category: "kill_switch",
});

/**
 * All defined dashboard metrics.
 */
export const ALL_METRICS: readonly MetricDefinition[] = Object.freeze([
  TRANSACTION_SUCCESS_RATE,
  TRANSACTION_FAILURE_RATE,
  RECONCILIATION_LATENCY,
  PROVIDER_RESPONSE_TIME,
  QUEUE_DEPTH,
  QUEUE_PROCESSING_RATE,
  ERROR_RATE_BY_CATEGORY,
  KILL_SWITCH_ACTIVATIONS,
]);

// ─── Metric Evaluation ──────────────────────────────────────────────────────────

/**
 * Evaluates a metric value against its definition thresholds.
 * For "lower is worse" metrics (success rate, processing rate), the logic is inverted.
 */
export function evaluateMetricStatus(
  definition: MetricDefinition,
  currentValue: number,
): "normal" | "warning" | "critical" {
  const isLowerIsBetter =
    definition.id === "txn_failure_rate" ||
    definition.id === "error_rate_by_category" ||
    definition.id === "queue_depth" ||
    definition.id === "kill_switch_activations" ||
    definition.id === "reconciliation_latency" ||
    definition.id === "provider_response_time";

  if (isLowerIsBetter) {
    if (currentValue >= definition.criticalThreshold) return "critical";
    if (currentValue >= definition.warningThreshold) return "warning";
    return "normal";
  }

  // Higher is better (success rate, processing rate)
  if (currentValue <= definition.criticalThreshold) return "critical";
  if (currentValue <= definition.warningThreshold) return "warning";
  return "normal";
}

/**
 * Creates a metric snapshot from data points.
 */
export function createMetricSnapshot(
  definition: MetricDefinition,
  dataPoints: readonly MetricDataPoint[],
  window: MetricWindow,
): MetricSnapshot {
  const currentValue = dataPoints.length > 0 ? dataPoints[dataPoints.length - 1]!.value : 0;
  const previousValue =
    dataPoints.length > 1 ? dataPoints[dataPoints.length - 2]!.value : currentValue;

  const trend: "up" | "down" | "stable" =
    currentValue > previousValue ? "up" : currentValue < previousValue ? "down" : "stable";

  return Object.freeze({
    metricId: definition.id,
    currentValue,
    previousValue,
    trend,
    window,
    dataPoints: Object.freeze([...dataPoints]),
    status: evaluateMetricStatus(definition, currentValue),
  });
}
