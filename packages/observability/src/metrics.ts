/**
 * Domain-specific metric definitions using the OpenTelemetry Metrics API.
 *
 * Provides typed metric instruments for all Counter platform signals:
 * API SLI, job processing, outbox lag, policy outcomes, authority failures,
 * transaction states, provider errors, reconciliation, findings, and receipt
 * signing.
 */
import { type Meter, type Counter, type Histogram, type Gauge, metrics } from "@opentelemetry/api";

/**
 * All metric instrument names as constants for consistent registration.
 */
export const METRIC_NAMES = Object.freeze({
  API_REQUEST_DURATION: "counter.api.request_duration_seconds",
  JOB_AGE: "counter.job.age_seconds",
  JOB_ATTEMPTS: "counter.job.attempts",
  OUTBOX_LAG: "counter.outbox.lag_seconds",
  POLICY_DECISION_TOTAL: "counter.policy.decision_total",
  AUTHORITY_FAILURE_TOTAL: "counter.authority.failure_total",
  TRANSACTION_COUNT: "counter.transaction.count",
  INDETERMINATE_AGE: "counter.indeterminate.age_seconds",
  PROVIDER_ERROR_TOTAL: "counter.provider.error_total",
  RECONCILIATION_LAG: "counter.reconciliation.lag_seconds",
  FINDING_COUNT: "counter.finding.count",
  RECEIPT_SIGNING_FAILURE_TOTAL: "counter.receipt.signing_failure_total",
} as const);

export type MetricName = (typeof METRIC_NAMES)[keyof typeof METRIC_NAMES];

/**
 * Collection of all domain-specific metric instruments.
 */
export interface DomainMetrics {
  /** API request duration histogram segmented by route, method, and status. */
  readonly apiRequestDuration: Histogram;
  /** Job age histogram (time since job was created). */
  readonly jobAge: Histogram;
  /** Job attempt count histogram. */
  readonly jobAttempts: Histogram;
  /** Outbox delivery lag gauge. */
  readonly outboxLag: Gauge;
  /** Policy decision counter segmented by outcome. */
  readonly policyDecisionTotal: Counter;
  /** Authority failure counter segmented by reason. */
  readonly authorityFailureTotal: Counter;
  /** Transaction count gauge segmented by state. */
  readonly transactionCount: Gauge;
  /** Indeterminate age gauge (age of unresolved outcomes). */
  readonly indeterminateAge: Gauge;
  /** Provider/connector error counter segmented by provider and error class. */
  readonly providerErrorTotal: Counter;
  /** Reconciliation lag gauge. */
  readonly reconciliationLag: Gauge;
  /** Finding count gauge segmented by severity and status. */
  readonly findingCount: Gauge;
  /** Receipt signing failure counter. */
  readonly receiptSigningFailureTotal: Counter;
}

/**
 * Creates all domain-specific metric instruments on the given meter.
 */
export function createDomainMetrics(meter: Meter): DomainMetrics {
  return Object.freeze({
    apiRequestDuration: meter.createHistogram(METRIC_NAMES.API_REQUEST_DURATION, {
      description: "Duration of API requests in seconds by route, method, and status code",
      unit: "s",
    }),

    jobAge: meter.createHistogram(METRIC_NAMES.JOB_AGE, {
      description: "Age of jobs in seconds since creation",
      unit: "s",
    }),

    jobAttempts: meter.createHistogram(METRIC_NAMES.JOB_ATTEMPTS, {
      description: "Number of attempts per job execution",
      unit: "{attempts}",
    }),

    outboxLag: meter.createGauge(METRIC_NAMES.OUTBOX_LAG, {
      description: "Current outbox delivery lag in seconds",
      unit: "s",
    }),

    policyDecisionTotal: meter.createCounter(METRIC_NAMES.POLICY_DECISION_TOTAL, {
      description: "Total policy decisions segmented by outcome",
    }),

    authorityFailureTotal: meter.createCounter(METRIC_NAMES.AUTHORITY_FAILURE_TOTAL, {
      description: "Total authority failures segmented by reason",
    }),

    transactionCount: meter.createGauge(METRIC_NAMES.TRANSACTION_COUNT, {
      description: "Number of transactions segmented by state",
    }),

    indeterminateAge: meter.createGauge(METRIC_NAMES.INDETERMINATE_AGE, {
      description: "Age of indeterminate outcomes in seconds",
      unit: "s",
    }),

    providerErrorTotal: meter.createCounter(METRIC_NAMES.PROVIDER_ERROR_TOTAL, {
      description: "Total provider/connector errors segmented by provider and error class",
    }),

    reconciliationLag: meter.createGauge(METRIC_NAMES.RECONCILIATION_LAG, {
      description: "Current reconciliation lag in seconds",
      unit: "s",
    }),

    findingCount: meter.createGauge(METRIC_NAMES.FINDING_COUNT, {
      description: "Number of findings segmented by severity and status",
    }),

    receiptSigningFailureTotal: meter.createCounter(METRIC_NAMES.RECEIPT_SIGNING_FAILURE_TOTAL, {
      description: "Total receipt signing failures",
    }),
  });
}

/**
 * Creates domain metrics using the global meter provider.
 * Convenience function for applications that use the global OTel configuration.
 */
export function createGlobalDomainMetrics(meterName: string): DomainMetrics {
  const meter = metrics.getMeter(meterName);
  return createDomainMetrics(meter);
}
