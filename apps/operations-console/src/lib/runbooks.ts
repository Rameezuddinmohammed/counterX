/**
 * Structured runbook definitions for operations console.
 *
 * Each runbook provides a step-by-step guide for operators
 * handling common operational scenarios.
 */

// ─── Types ─────────────────────────────────────────────────────────────────────

/**
 * A single step in a runbook procedure.
 */
export interface RunbookStep {
  readonly order: number;
  readonly title: string;
  readonly description: string;
  readonly automated: boolean;
  readonly commandRef?: string;
  readonly verificationCriteria?: string;
  readonly rollbackAction?: string;
}

/**
 * Severity level determining the urgency of a runbook.
 */
export type RunbookSeverity = "critical" | "high" | "medium" | "low";

/**
 * A structured runbook for operator guidance.
 */
export interface Runbook {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly severity: RunbookSeverity;
  readonly triggerConditions: readonly string[];
  readonly estimatedDurationMinutes: number;
  readonly steps: readonly RunbookStep[];
  readonly escalationPath: readonly string[];
  readonly tags: readonly string[];
}

// ─── Outage Runbook ─────────────────────────────────────────────────────────────

/**
 * Runbook for handling provider or system outages.
 * Covers detection, isolation, recovery, and verification.
 */
export const OUTAGE_RUNBOOK: Runbook = Object.freeze({
  id: "runbook-outage-001",
  name: "Provider/System Outage",
  description:
    "Step-by-step procedure for detecting, isolating, and recovering from provider or system outages",
  severity: "critical" as const,
  triggerConditions: Object.freeze([
    "Provider response time exceeds 10s for 5 consecutive minutes",
    "Transaction failure rate exceeds 50% for a single provider",
    "System health check returns unhealthy for 3 consecutive checks",
    "Multiple kill switches activated within 5 minutes",
  ]),
  estimatedDurationMinutes: 60,
  steps: Object.freeze([
    Object.freeze({
      order: 1,
      title: "Detection and Assessment",
      description:
        "Confirm the outage scope by checking provider health metrics, transaction failure rates, and error patterns",
      automated: true,
      commandRef: "telemetry_dashboard.provider_response_time",
      verificationCriteria:
        "Outage scope identified: affected provider(s), merchant(s), transaction types",
    }),
    Object.freeze({
      order: 2,
      title: "Activate Kill Switch",
      description:
        "Immediately activate kill switch for affected provider/scope to prevent new transaction attempts",
      automated: false,
      commandRef: "kill_switch.activate",
      verificationCriteria: "Kill switch active, no new transactions routed to affected provider",
      rollbackAction: "Deactivate kill switch if outage was a false positive",
    }),
    Object.freeze({
      order: 3,
      title: "Notify Stakeholders",
      description:
        "Send alerts to on-call team, affected merchant contacts, and management if severity warrants",
      automated: true,
      verificationCriteria: "All required parties notified with incident reference",
    }),
    Object.freeze({
      order: 4,
      title: "Isolate Affected Transactions",
      description:
        "Move in-flight transactions to a holding state; drain affected queues using move_to_dlq strategy",
      automated: false,
      commandRef: "drain_queue",
      verificationCriteria: "All in-flight transactions safely parked, no data loss",
    }),
    Object.freeze({
      order: 5,
      title: "Monitor Provider Recovery",
      description: "Poll provider health endpoint and internal metrics for signs of recovery",
      automated: true,
      commandRef: "telemetry_dashboard.provider_response_time",
      verificationCriteria:
        "Provider responding within normal parameters for 5 consecutive minutes",
    }),
    Object.freeze({
      order: 6,
      title: "Replay Failed Transactions",
      description:
        "Once provider is healthy, replay affected transactions from dead letter queue using dry-run first",
      automated: false,
      commandRef: "replay",
      verificationCriteria: "All replayed transactions resolve (success or permanent failure)",
      rollbackAction: "Halt replay if failure rate exceeds 10%",
    }),
    Object.freeze({
      order: 7,
      title: "Deactivate Kill Switch",
      description: "Remove kill switch and verify normal traffic flow",
      automated: false,
      commandRef: "kill_switch.deactivate",
      verificationCriteria: "Transaction success rate returns to baseline within 15 minutes",
    }),
    Object.freeze({
      order: 8,
      title: "Post-Incident Review",
      description:
        "Document timeline, root cause, and action items. Export audit log for affected period",
      automated: false,
      commandRef: "export_audit_log",
      verificationCriteria: "Incident report filed with root cause and prevention measures",
    }),
  ]),
  escalationPath: Object.freeze(["On-call engineer", "Platform lead", "VP Engineering"]),
  tags: Object.freeze(["outage", "provider", "kill-switch", "recovery"]),
});

// ─── Queue Backlog Runbook ──────────────────────────────────────────────────────

/**
 * Runbook for handling queue backlogs.
 * Covers monitoring, drain, and replay procedures.
 */
export const QUEUE_BACKLOG_RUNBOOK: Runbook = Object.freeze({
  id: "runbook-queue-backlog-001",
  name: "Queue Backlog Resolution",
  description: "Procedure for monitoring and resolving job queue backlogs without data loss",
  severity: "high" as const,
  triggerConditions: Object.freeze([
    "Queue depth exceeds 5000 for more than 10 minutes",
    "Oldest job age exceeds 30 minutes",
    "Processing rate drops below 5 jobs/second for 15 minutes",
  ]),
  estimatedDurationMinutes: 45,
  steps: Object.freeze([
    Object.freeze({
      order: 1,
      title: "Assess Backlog Severity",
      description: "Check queue depth, oldest job age, and processing rate to determine severity",
      automated: true,
      commandRef: "telemetry_dashboard.queue_depth",
      verificationCriteria: "Backlog size, age, and growth rate documented",
    }),
    Object.freeze({
      order: 2,
      title: "Identify Root Cause",
      description:
        "Determine if backlog is from burst traffic, consumer failure, or downstream dependency issue",
      automated: false,
      verificationCriteria: "Root cause identified (burst/consumer/dependency)",
    }),
    Object.freeze({
      order: 3,
      title: "Scale Consumers",
      description: "If consumer capacity is the bottleneck, increase consumer count or allocation",
      automated: false,
      verificationCriteria: "Processing rate increased or confirmed not the issue",
    }),
    Object.freeze({
      order: 4,
      title: "Drain Stale Jobs",
      description: "Move jobs older than threshold to dead letter queue for investigation",
      automated: false,
      commandRef: "drain_queue",
      verificationCriteria: "Stale jobs moved to DLQ, queue depth decreasing",
      rollbackAction: "Replay DLQ jobs if they were incorrectly classified as stale",
    }),
    Object.freeze({
      order: 5,
      title: "Replay Dead Letters",
      description:
        "After root cause is resolved, replay dead letter entries from the backlog period",
      automated: false,
      commandRef: "replay",
      verificationCriteria: "All replayable jobs processed successfully",
    }),
    Object.freeze({
      order: 6,
      title: "Verify Recovery",
      description: "Confirm queue depth returned to normal and processing rate is stable",
      automated: true,
      commandRef: "telemetry_dashboard.queue_depth",
      verificationCriteria: "Queue depth below threshold for 15 minutes",
    }),
  ]),
  escalationPath: Object.freeze(["On-call engineer", "Platform lead"]),
  tags: Object.freeze(["queue", "backlog", "drain", "replay"]),
});

// ─── Crash Recovery Runbook ─────────────────────────────────────────────────────

/**
 * Runbook for crash recovery.
 * Covers state assessment, replay, and verification.
 */
export const CRASH_RECOVERY_RUNBOOK: Runbook = Object.freeze({
  id: "runbook-crash-recovery-001",
  name: "Crash Recovery",
  description:
    "Procedure for recovering from unexpected process/system crashes with state verification",
  severity: "critical" as const,
  triggerConditions: Object.freeze([
    "Process crash detected by health monitor",
    "Unexpected restart loop (3+ restarts in 10 minutes)",
    "Transaction state inconsistency detected",
    "Database connection pool exhaustion",
  ]),
  estimatedDurationMinutes: 90,
  steps: Object.freeze([
    Object.freeze({
      order: 1,
      title: "Assess System State",
      description: "Check for data corruption, incomplete transactions, and orphaned locks",
      automated: true,
      verificationCriteria: "State assessment complete: corruption/inconsistency extent known",
    }),
    Object.freeze({
      order: 2,
      title: "Stabilize System",
      description: "Restart affected services, clear connection pools, release orphaned locks",
      automated: false,
      verificationCriteria: "All services restarted and health checks passing",
      rollbackAction: "If services fail to start, activate kill switch and escalate",
    }),
    Object.freeze({
      order: 3,
      title: "Identify In-Flight Transactions",
      description: "Find transactions that were mid-processing during the crash",
      automated: true,
      verificationCriteria: "List of affected transaction IDs compiled",
    }),
    Object.freeze({
      order: 4,
      title: "Force Reconciliation",
      description: "Run force reconciliation against providers for all in-flight transactions",
      automated: false,
      commandRef: "force_reconcile",
      verificationCriteria: "All in-flight transactions reconciled or marked for manual review",
    }),
    Object.freeze({
      order: 5,
      title: "Replay Incomplete Work",
      description: "Replay transactions that were interrupted but not yet submitted to provider",
      automated: false,
      commandRef: "replay",
      verificationCriteria: "All incomplete transactions either completed or permanently failed",
      rollbackAction: "Void any transactions that created duplicates",
    }),
    Object.freeze({
      order: 6,
      title: "Verify Data Integrity",
      description: "Run consistency checks between local state and provider state",
      automated: true,
      verificationCriteria: "Zero discrepancies between local and provider records",
    }),
    Object.freeze({
      order: 7,
      title: "Resume Normal Operations",
      description: "Deactivate any protective kill switches and verify traffic flow",
      automated: false,
      verificationCriteria: "Normal transaction flow restored, metrics at baseline",
    }),
  ]),
  escalationPath: Object.freeze([
    "On-call engineer",
    "Platform lead",
    "VP Engineering",
    "CTO (if data loss confirmed)",
  ]),
  tags: Object.freeze(["crash", "recovery", "reconciliation", "state"]),
});

// ─── Offboarding Runbook ────────────────────────────────────────────────────────

/**
 * Runbook for merchant offboarding.
 * Covers suspension, data export, cleanup, and verification.
 */
export const OFFBOARDING_RUNBOOK: Runbook = Object.freeze({
  id: "runbook-offboarding-001",
  name: "Merchant Offboarding",
  description:
    "Complete procedure for safely offboarding a merchant including data export and cleanup",
  severity: "medium" as const,
  triggerConditions: Object.freeze([
    "Merchant requests account closure",
    "Merchant flagged for policy violation",
    "Contract expiration without renewal",
  ]),
  estimatedDurationMinutes: 120,
  steps: Object.freeze([
    Object.freeze({
      order: 1,
      title: "Suspend Merchant",
      description: "Suspend merchant to prevent new transactions while preserving existing data",
      automated: false,
      commandRef: "suspend_merchant",
      verificationCriteria: "Merchant status set to suspended, no new transactions accepted",
    }),
    Object.freeze({
      order: 2,
      title: "Complete In-Flight Transactions",
      description: "Wait for all pending transactions to settle or force reconcile",
      automated: false,
      commandRef: "force_reconcile",
      verificationCriteria: "Zero pending transactions for the merchant",
    }),
    Object.freeze({
      order: 3,
      title: "Export Merchant Data",
      description: "Create encrypted backup of all merchant data for retention compliance",
      automated: false,
      commandRef: "backup_restore",
      verificationCriteria: "Encrypted backup created and verified",
    }),
    Object.freeze({
      order: 4,
      title: "Export Audit Log",
      description: "Export full audit trail for the merchant lifetime",
      automated: false,
      commandRef: "export_audit_log",
      verificationCriteria: "Complete audit log exported and archived",
    }),
    Object.freeze({
      order: 5,
      title: "Revoke All Credentials",
      description: "Rotate and then revoke all provider credentials associated with this merchant",
      automated: false,
      commandRef: "rotate_credentials",
      verificationCriteria: "All credentials revoked, provider confirms deactivation",
    }),
    Object.freeze({
      order: 6,
      title: "Revoke Support Grants",
      description: "Revoke any active support grants for the merchant",
      automated: true,
      verificationCriteria: "Zero active support grants for the merchant",
    }),
    Object.freeze({
      order: 7,
      title: "Cleanup Resources",
      description: "Remove merchant-specific queues, caches, and configuration entries",
      automated: false,
      verificationCriteria: "All merchant-specific resources removed",
    }),
    Object.freeze({
      order: 8,
      title: "Verify Offboarding",
      description:
        "Confirm merchant cannot transact, all data exported, and no orphaned references",
      automated: true,
      verificationCriteria: "Full offboarding checklist verified, status set to offboarded",
    }),
  ]),
  escalationPath: Object.freeze([
    "Account manager",
    "Platform lead",
    "Legal (if data retention issues)",
  ]),
  tags: Object.freeze(["offboarding", "merchant", "cleanup", "data-export"]),
});

// ─── Rotation Runbook ───────────────────────────────────────────────────────────

/**
 * Runbook for credential rotation without downtime.
 */
export const ROTATION_RUNBOOK: Runbook = Object.freeze({
  id: "runbook-rotation-001",
  name: "Credential Rotation",
  description: "Zero-downtime credential rotation procedure for provider API keys and secrets",
  severity: "high" as const,
  triggerConditions: Object.freeze([
    "Scheduled rotation period reached (90 days)",
    "Credential compromise suspected",
    "Provider requires key rotation",
    "Security audit finding",
  ]),
  estimatedDurationMinutes: 30,
  steps: Object.freeze([
    Object.freeze({
      order: 1,
      title: "Generate New Credentials",
      description: "Request new credentials from provider while keeping old credentials active",
      automated: false,
      verificationCriteria: "New credentials generated and stored in vault",
    }),
    Object.freeze({
      order: 2,
      title: "Configure Dual-Credential Mode",
      description: "Set up system to accept both old and new credentials during grace period",
      automated: false,
      commandRef: "rotate_credentials",
      verificationCriteria: "System operating with both credential sets",
    }),
    Object.freeze({
      order: 3,
      title: "Verify New Credentials",
      description: "Run test transactions using new credentials to confirm they work",
      automated: true,
      verificationCriteria: "Test transactions succeed with new credentials",
      rollbackAction: "Revert to old credentials if test fails",
    }),
    Object.freeze({
      order: 4,
      title: "Switch Primary to New",
      description: "Set new credentials as primary, old as fallback",
      automated: false,
      verificationCriteria: "All new transactions using new credentials",
    }),
    Object.freeze({
      order: 5,
      title: "Monitor Grace Period",
      description: "Wait for grace period to ensure no issues with new credentials",
      automated: true,
      verificationCriteria: "Transaction success rate stable for grace period duration",
      rollbackAction: "Revert to old credentials if success rate drops",
    }),
    Object.freeze({
      order: 6,
      title: "Revoke Old Credentials",
      description: "Deactivate and remove old credentials after grace period",
      automated: false,
      verificationCriteria:
        "Old credentials revoked, system operating normally on new credentials only",
    }),
    Object.freeze({
      order: 7,
      title: "Scan for Credential Exposure",
      description: "Run credential scanner to ensure old credentials are not persisted anywhere",
      automated: true,
      commandRef: "credential_scanner",
      verificationCriteria: "No traces of old credentials in storage or telemetry",
    }),
  ]),
  escalationPath: Object.freeze(["Security engineer", "Platform lead"]),
  tags: Object.freeze(["rotation", "credentials", "security", "zero-downtime"]),
});

// ─── Exports ────────────────────────────────────────────────────────────────────

/**
 * All defined runbooks.
 */
export const ALL_RUNBOOKS: readonly Runbook[] = Object.freeze([
  OUTAGE_RUNBOOK,
  QUEUE_BACKLOG_RUNBOOK,
  CRASH_RECOVERY_RUNBOOK,
  OFFBOARDING_RUNBOOK,
  ROTATION_RUNBOOK,
]);

/**
 * Finds a runbook by its ID.
 */
export function findRunbookById(id: string): Runbook | undefined {
  return ALL_RUNBOOKS.find((r) => r.id === id);
}

/**
 * Finds runbooks matching given tags.
 */
export function findRunbooksByTag(tag: string): readonly Runbook[] {
  return Object.freeze(ALL_RUNBOOKS.filter((r) => r.tags.includes(tag)));
}
