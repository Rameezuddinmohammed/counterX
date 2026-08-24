/**
 * Runbook templates for platform alerts.
 *
 * Each runbook provides structured investigation and resolution steps
 * tied to a specific alert definition.
 */

/**
 * A structured runbook entry.
 */
export interface RunbookEntry {
  readonly title: string;
  readonly alertReferences: readonly string[];
  readonly symptoms: readonly string[];
  readonly investigationSteps: readonly string[];
  readonly resolutionSteps: readonly string[];
  readonly escalationPath: string;
}

/**
 * The platform runbook catalog.
 */
export const RUNBOOK_CATALOG: Readonly<Record<string, RunbookEntry>> = Object.freeze({
  "runbook:high_error_rate": Object.freeze({
    title: "High API Error Rate",
    alertReferences: Object.freeze(["high_error_rate"]),
    symptoms: Object.freeze([
      "Elevated 5xx response codes across API endpoints",
      "Customer-facing errors reported in support channels",
      "Health check degradation on dependent services",
    ]),
    investigationSteps: Object.freeze([
      "Check API error logs for recurring exception patterns",
      "Identify affected endpoints and correlate with recent deployments",
      "Verify downstream dependency health (database, providers)",
      "Check for resource exhaustion (CPU, memory, connections)",
    ]),
    resolutionSteps: Object.freeze([
      "Roll back recent deployments if correlated with error onset",
      "Scale resources if under load pressure",
      "Activate circuit breakers for failing dependencies",
      "Engage provider support if external dependency is root cause",
    ]),
    escalationPath: "On-call SRE -> Engineering Lead -> VP Engineering",
  }),

  "runbook:high_latency_p99": Object.freeze({
    title: "High API Latency (p99)",
    alertReferences: Object.freeze(["high_latency_p99"]),
    symptoms: Object.freeze([
      "Slow API responses exceeding SLO thresholds",
      "Timeout errors in client applications",
      "Increased queue depth as consumers slow down",
    ]),
    investigationSteps: Object.freeze([
      "Identify slowest endpoints from latency histograms",
      "Check database query performance and lock contention",
      "Verify network latency to external providers",
      "Check for garbage collection pauses or memory pressure",
    ]),
    resolutionSteps: Object.freeze([
      "Optimize slow database queries or add missing indexes",
      "Scale horizontally to distribute load",
      "Enable request shedding for non-critical traffic",
      "Engage database team for schema-level changes",
    ]),
    escalationPath: "On-call SRE -> Database Team -> Engineering Lead",
  }),

  "runbook:job_queue_depth": Object.freeze({
    title: "Job Queue Depth Exceeded",
    alertReferences: Object.freeze(["job_queue_depth"]),
    symptoms: Object.freeze([
      "Growing backlog of unprocessed jobs",
      "Increased job age metrics",
      "Delayed event processing visible to merchants",
    ]),
    investigationSteps: Object.freeze([
      "Check job worker health and active instance count",
      "Identify job types with highest backlog",
      "Look for poison messages causing repeated failures",
      "Verify resource availability for job processing",
    ]),
    resolutionSteps: Object.freeze([
      "Scale job workers to match incoming rate",
      "Identify and quarantine poison messages to dead letter",
      "Temporarily increase concurrency limits",
      "Prioritize critical job types if backlog is mixed",
    ]),
    escalationPath: "On-call SRE -> Platform Team -> Engineering Lead",
  }),

  "runbook:outbox_lag_critical": Object.freeze({
    title: "Outbox Delivery Lag Critical",
    alertReferences: Object.freeze(["outbox_lag_critical"]),
    symptoms: Object.freeze([
      "Events not being delivered to downstream consumers",
      "Stale data in read models and projections",
      "Merchant webhooks delayed or missing",
    ]),
    investigationSteps: Object.freeze([
      "Check outbox worker process health",
      "Verify message broker connectivity",
      "Look for failed delivery attempts in logs",
      "Check for schema incompatibilities blocking serialization",
    ]),
    resolutionSteps: Object.freeze([
      "Restart outbox worker processes",
      "Verify and restore message broker connectivity",
      "Clear stuck messages that cannot be serialized",
      "Scale outbox workers if throughput is the bottleneck",
    ]),
    escalationPath: "On-call SRE -> Platform Team -> Engineering Lead",
  }),

  "runbook:dead_letter_accumulation": Object.freeze({
    title: "Dead Letter Queue Accumulation",
    alertReferences: Object.freeze(["dead_letter_accumulation"]),
    symptoms: Object.freeze([
      "Messages failing max retry attempts",
      "Data inconsistencies from unprocessed events",
      "Growing dead letter count in monitoring dashboard",
    ]),
    investigationSteps: Object.freeze([
      "Sample dead letters to identify common failure patterns",
      "Check for schema changes that broke deserialization",
      "Verify handler logic for edge cases",
      "Correlate with recent deployments or data migrations",
    ]),
    resolutionSteps: Object.freeze([
      "Fix handler bugs and replay dead letters",
      "Update schemas and redrive compatible messages",
      "Purge truly unrecoverable messages with audit trail",
      "Add defensive handling for newly discovered edge cases",
    ]),
    escalationPath: "On-call SRE -> Platform Team -> Engineering Lead",
  }),

  "runbook:indeterminate_age_critical": Object.freeze({
    title: "Indeterminate Outcome Age Critical",
    alertReferences: Object.freeze(["indeterminate_age_critical"]),
    symptoms: Object.freeze([
      "Payment outcomes stuck in indeterminate state",
      "Merchants unable to see final transaction status",
      "Reconciliation processes blocked on unresolved outcomes",
    ]),
    investigationSteps: Object.freeze([
      "Identify affected transactions and their providers",
      "Check provider API status and connectivity",
      "Verify reconciliation job is running and not stuck",
      "Look for provider-side outages or rate limiting",
    ]),
    resolutionSteps: Object.freeze([
      "Trigger manual reconciliation for affected transactions",
      "Contact provider support for stuck transactions",
      "Apply timeout-based resolution policy if configured",
      "Escalate unresolvable cases to finance operations",
    ]),
    escalationPath: "On-call SRE -> Payments Team -> Finance Operations",
  }),

  "runbook:reconciliation_lag_critical": Object.freeze({
    title: "Reconciliation Lag Critical",
    alertReferences: Object.freeze(["reconciliation_lag_critical"]),
    symptoms: Object.freeze([
      "Growing gap between local and provider state",
      "Stale transaction statuses displayed to merchants",
      "Audit findings accumulating from unreconciled records",
    ]),
    investigationSteps: Object.freeze([
      "Check reconciliation worker health and schedule",
      "Verify provider API availability for status queries",
      "Look for rate limiting or authentication failures",
      "Check for data volume spikes exceeding processing capacity",
    ]),
    resolutionSteps: Object.freeze([
      "Restart reconciliation workers if crashed",
      "Adjust rate limiting configuration for provider APIs",
      "Scale reconciliation capacity for volume spikes",
      "Manually trigger reconciliation for critical merchants",
    ]),
    escalationPath: "On-call SRE -> Payments Team -> Provider Relations",
  }),

  "runbook:authority_failure_spike": Object.freeze({
    title: "Authority Failure Spike",
    alertReferences: Object.freeze(["authority_failure_spike"]),
    symptoms: Object.freeze([
      "Elevated authorization denials across the platform",
      "Legitimate operator actions being rejected",
      "Potential security incident indicators",
    ]),
    investigationSteps: Object.freeze([
      "Identify which actors and permissions are failing",
      "Check for recent role assignment or policy changes",
      "Look for credential expiry or rotation issues",
      "Assess whether failures indicate a security incident",
    ]),
    resolutionSteps: Object.freeze([
      "Revert recent policy changes if they caused legitimate failures",
      "Rotate and redistribute credentials if expired",
      "Engage security team if incident indicators are present",
      "Communicate with affected operators about resolution",
    ]),
    escalationPath: "On-call SRE -> Security Team -> CISO",
  }),

  "runbook:receipt_signing_failure": Object.freeze({
    title: "Receipt Signing Failure",
    alertReferences: Object.freeze(["receipt_signing_failure"]),
    symptoms: Object.freeze([
      "Receipts cannot be signed for completed transactions",
      "Compliance evidence generation blocked",
      "HSM or key management errors in logs",
    ]),
    investigationSteps: Object.freeze([
      "Check HSM connectivity and health",
      "Verify signing key availability and expiry status",
      "Look for certificate chain or trust store issues",
      "Check for concurrent key rotation conflicts",
    ]),
    resolutionSteps: Object.freeze([
      "Restore HSM connectivity if network issue",
      "Rotate to backup signing key if primary is unavailable",
      "Re-establish trust chain if certificates expired",
      "Engage security team for key management issues",
    ]),
    escalationPath: "On-call SRE -> Security Team -> Compliance Officer",
  }),
});
