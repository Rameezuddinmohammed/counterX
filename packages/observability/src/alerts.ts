/**
 * Alert definitions for the Counter platform.
 *
 * Each alert references a metric from the domain metrics catalog and
 * specifies severity, threshold conditions, and a runbook reference.
 */
import { METRIC_NAMES } from "./metrics.js";

/**
 * Alert severity levels.
 */
export const ALERT_SEVERITIES = ["critical", "warning", "info"] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

/**
 * Definition of a platform alert.
 */
export interface AlertDefinition {
  readonly name: string;
  readonly severity: AlertSeverity;
  readonly condition: string;
  readonly threshold: string;
  readonly metricReference: string;
  readonly runbookReference: string;
}

/**
 * All alert names in the catalog.
 */
export const ALERT_NAMES = [
  "high_error_rate",
  "high_latency_p99",
  "job_queue_depth",
  "outbox_lag_critical",
  "dead_letter_accumulation",
  "indeterminate_age_critical",
  "reconciliation_lag_critical",
  "authority_failure_spike",
  "receipt_signing_failure",
] as const;

export type AlertName = (typeof ALERT_NAMES)[number];

/**
 * The platform alert catalog. Maps alert names to their definitions.
 */
export const ALERT_CATALOG: Readonly<Record<AlertName, AlertDefinition>> = Object.freeze({
  high_error_rate: Object.freeze({
    name: "high_error_rate",
    severity: "critical" as const,
    condition: "API error rate exceeds threshold over 5-minute window",
    threshold: "> 5% of requests returning 5xx",
    metricReference: METRIC_NAMES.API_REQUEST_DURATION,
    runbookReference: "runbook:high_error_rate",
  }),

  high_latency_p99: Object.freeze({
    name: "high_latency_p99",
    severity: "warning" as const,
    condition: "API p99 latency exceeds threshold over 5-minute window",
    threshold: "> 2000ms p99",
    metricReference: METRIC_NAMES.API_REQUEST_DURATION,
    runbookReference: "runbook:high_latency_p99",
  }),

  job_queue_depth: Object.freeze({
    name: "job_queue_depth",
    severity: "warning" as const,
    condition: "Job queue depth exceeds threshold indicating processing backlog",
    threshold: "> 1000 pending jobs for 10 minutes",
    metricReference: METRIC_NAMES.JOB_AGE,
    runbookReference: "runbook:job_queue_depth",
  }),

  outbox_lag_critical: Object.freeze({
    name: "outbox_lag_critical",
    severity: "critical" as const,
    condition: "Outbox delivery lag exceeds critical threshold",
    threshold: "> 60s lag for 5 minutes",
    metricReference: METRIC_NAMES.OUTBOX_LAG,
    runbookReference: "runbook:outbox_lag_critical",
  }),

  dead_letter_accumulation: Object.freeze({
    name: "dead_letter_accumulation",
    severity: "warning" as const,
    condition: "Dead letter queue accumulating unprocessed messages",
    threshold: "> 50 dead letters in 30 minutes",
    metricReference: METRIC_NAMES.JOB_ATTEMPTS,
    runbookReference: "runbook:dead_letter_accumulation",
  }),

  indeterminate_age_critical: Object.freeze({
    name: "indeterminate_age_critical",
    severity: "critical" as const,
    condition: "Indeterminate outcomes aged beyond resolution threshold",
    threshold: "> 300s age for any indeterminate outcome",
    metricReference: METRIC_NAMES.INDETERMINATE_AGE,
    runbookReference: "runbook:indeterminate_age_critical",
  }),

  reconciliation_lag_critical: Object.freeze({
    name: "reconciliation_lag_critical",
    severity: "critical" as const,
    condition: "Reconciliation lag exceeds critical threshold",
    threshold: "> 120s lag for 5 minutes",
    metricReference: METRIC_NAMES.RECONCILIATION_LAG,
    runbookReference: "runbook:reconciliation_lag_critical",
  }),

  authority_failure_spike: Object.freeze({
    name: "authority_failure_spike",
    severity: "warning" as const,
    condition: "Authority failures spiking above normal baseline",
    threshold: "> 10 failures per minute for 5 minutes",
    metricReference: METRIC_NAMES.AUTHORITY_FAILURE_TOTAL,
    runbookReference: "runbook:authority_failure_spike",
  }),

  receipt_signing_failure: Object.freeze({
    name: "receipt_signing_failure",
    severity: "critical" as const,
    condition: "Receipt signing failures indicate key/HSM issues",
    threshold: "> 0 failures in 1 minute",
    metricReference: METRIC_NAMES.RECEIPT_SIGNING_FAILURE_TOTAL,
    runbookReference: "runbook:receipt_signing_failure",
  }),
});
