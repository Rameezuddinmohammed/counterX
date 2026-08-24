/**
 * Recovery and replay commands for the operations console.
 *
 * These commands define structured actions operators can execute
 * for system recovery, data replay, credential rotation,
 * backup/restore, queue drain, and manual reconciliation.
 */

// ─── Shared Types ───────────────────────────────────────────────────────────────

/**
 * Status of a recovery command execution.
 */
export type CommandStatus = "pending" | "executing" | "completed" | "failed" | "cancelled";

/**
 * Base fields shared across all recovery commands.
 */
export interface RecoveryCommandBase {
  readonly id: string;
  readonly type: string;
  readonly initiatedBy: string;
  readonly initiatedAt: string;
  readonly status: CommandStatus;
  readonly reason: string;
}

// ─── Replay Command ─────────────────────────────────────────────────────────────

/**
 * Command for re-processing failed or stuck transactions.
 */
export interface ReplayCommand extends RecoveryCommandBase {
  readonly type: "replay";
  readonly targetTransactionIds: readonly string[];
  readonly fromTimestamp?: string;
  readonly toTimestamp?: string;
  readonly merchantId?: string;
  readonly maxRetries: number;
  readonly dryRun: boolean;
}

/**
 * Creates a replay command for reprocessing transactions.
 */
export function createReplayCommand(params: {
  readonly id: string;
  readonly initiatedBy: string;
  readonly reason: string;
  readonly targetTransactionIds: readonly string[];
  readonly fromTimestamp?: string;
  readonly toTimestamp?: string;
  readonly merchantId?: string;
  readonly maxRetries?: number;
  readonly dryRun?: boolean;
}): ReplayCommand {
  return Object.freeze({
    id: params.id,
    type: "replay" as const,
    initiatedBy: params.initiatedBy,
    initiatedAt: new Date().toISOString(),
    status: "pending" as const,
    reason: params.reason,
    targetTransactionIds: Object.freeze([...params.targetTransactionIds]),
    ...(params.fromTimestamp ? { fromTimestamp: params.fromTimestamp } : {}),
    ...(params.toTimestamp ? { toTimestamp: params.toTimestamp } : {}),
    ...(params.merchantId ? { merchantId: params.merchantId } : {}),
    maxRetries: params.maxRetries ?? 3,
    dryRun: params.dryRun ?? false,
  });
}

// ─── Rotate Credentials Command ─────────────────────────────────────────────────

/**
 * Command for rotating provider credentials without downtime.
 */
export interface RotateCredentialsCommand extends RecoveryCommandBase {
  readonly type: "rotate_credentials";
  readonly providerId: string;
  readonly merchantId: string;
  readonly rotationType: "api_key" | "secret" | "certificate" | "webhook_secret";
  readonly gracePeriodMs: number;
}

/**
 * Creates a credential rotation command.
 */
export function createRotateCredentialsCommand(params: {
  readonly id: string;
  readonly initiatedBy: string;
  readonly reason: string;
  readonly providerId: string;
  readonly merchantId: string;
  readonly rotationType: "api_key" | "secret" | "certificate" | "webhook_secret";
  readonly gracePeriodMs?: number;
}): RotateCredentialsCommand {
  return Object.freeze({
    id: params.id,
    type: "rotate_credentials" as const,
    initiatedBy: params.initiatedBy,
    initiatedAt: new Date().toISOString(),
    status: "pending" as const,
    reason: params.reason,
    providerId: params.providerId,
    merchantId: params.merchantId,
    rotationType: params.rotationType,
    gracePeriodMs: params.gracePeriodMs ?? 60000,
  });
}

// ─── Backup/Restore Command ─────────────────────────────────────────────────────

/**
 * Operation type for backup/restore.
 */
export type BackupOperation = "backup" | "restore";

/**
 * Command for merchant data backup or restore.
 */
export interface BackupRestoreCommand extends RecoveryCommandBase {
  readonly type: "backup_restore";
  readonly operation: BackupOperation;
  readonly merchantId: string;
  readonly scope: readonly string[];
  readonly targetSnapshotId?: string;
  readonly encryptionRequired: boolean;
}

/**
 * Creates a backup/restore command.
 */
export function createBackupRestoreCommand(params: {
  readonly id: string;
  readonly initiatedBy: string;
  readonly reason: string;
  readonly operation: BackupOperation;
  readonly merchantId: string;
  readonly scope: readonly string[];
  readonly targetSnapshotId?: string;
  readonly encryptionRequired?: boolean;
}): BackupRestoreCommand {
  return Object.freeze({
    id: params.id,
    type: "backup_restore" as const,
    initiatedBy: params.initiatedBy,
    initiatedAt: new Date().toISOString(),
    status: "pending" as const,
    reason: params.reason,
    operation: params.operation,
    merchantId: params.merchantId,
    scope: Object.freeze([...params.scope]),
    ...(params.targetSnapshotId ? { targetSnapshotId: params.targetSnapshotId } : {}),
    encryptionRequired: params.encryptionRequired ?? true,
  });
}

// ─── Drain Queue Command ────────────────────────────────────────────────────────

/**
 * Command for gracefully draining a job queue.
 */
export interface DrainQueueCommand extends RecoveryCommandBase {
  readonly type: "drain_queue";
  readonly queueName: string;
  readonly strategy: "complete_in_flight" | "reject_new" | "move_to_dlq";
  readonly timeoutMs: number;
}

/**
 * Creates a queue drain command.
 */
export function createDrainQueueCommand(params: {
  readonly id: string;
  readonly initiatedBy: string;
  readonly reason: string;
  readonly queueName: string;
  readonly strategy?: "complete_in_flight" | "reject_new" | "move_to_dlq";
  readonly timeoutMs?: number;
}): DrainQueueCommand {
  return Object.freeze({
    id: params.id,
    type: "drain_queue" as const,
    initiatedBy: params.initiatedBy,
    initiatedAt: new Date().toISOString(),
    status: "pending" as const,
    reason: params.reason,
    queueName: params.queueName,
    strategy: params.strategy ?? "complete_in_flight",
    timeoutMs: params.timeoutMs ?? 300000,
  });
}

// ─── Force Reconcile Command ────────────────────────────────────────────────────

/**
 * Command for triggering manual reconciliation.
 */
export interface ForceReconcileCommand extends RecoveryCommandBase {
  readonly type: "force_reconcile";
  readonly merchantId: string;
  readonly providerId: string;
  readonly fromTimestamp: string;
  readonly toTimestamp: string;
  readonly includeSettled: boolean;
}

/**
 * Creates a force reconciliation command.
 */
export function createForceReconcileCommand(params: {
  readonly id: string;
  readonly initiatedBy: string;
  readonly reason: string;
  readonly merchantId: string;
  readonly providerId: string;
  readonly fromTimestamp: string;
  readonly toTimestamp: string;
  readonly includeSettled?: boolean;
}): ForceReconcileCommand {
  return Object.freeze({
    id: params.id,
    type: "force_reconcile" as const,
    initiatedBy: params.initiatedBy,
    initiatedAt: new Date().toISOString(),
    status: "pending" as const,
    reason: params.reason,
    merchantId: params.merchantId,
    providerId: params.providerId,
    fromTimestamp: params.fromTimestamp,
    toTimestamp: params.toTimestamp,
    includeSettled: params.includeSettled ?? false,
  });
}

// ─── Union Type ─────────────────────────────────────────────────────────────────

/**
 * Union of all recovery command types.
 */
export type RecoveryCommand =
  | ReplayCommand
  | RotateCredentialsCommand
  | BackupRestoreCommand
  | DrainQueueCommand
  | ForceReconcileCommand;

/**
 * Validates that a command is safe to execute (basic sanity checks).
 */
export function validateCommand(command: RecoveryCommand): {
  readonly valid: boolean;
  readonly errors: readonly string[];
} {
  const errors: string[] = [];

  if (!command.id) errors.push("Command ID is required");
  if (!command.initiatedBy) errors.push("Initiator is required");
  if (!command.reason) errors.push("Reason is required");

  switch (command.type) {
    case "replay":
      if (command.targetTransactionIds.length === 0 && !command.fromTimestamp) {
        errors.push("Either target transaction IDs or a time range is required");
      }
      if (command.maxRetries < 1 || command.maxRetries > 10) {
        errors.push("Max retries must be between 1 and 10");
      }
      break;
    case "rotate_credentials":
      if (!command.providerId) errors.push("Provider ID is required");
      if (!command.merchantId) errors.push("Merchant ID is required");
      if (command.gracePeriodMs < 0) errors.push("Grace period must be non-negative");
      break;
    case "backup_restore":
      if (!command.merchantId) errors.push("Merchant ID is required");
      if (command.scope.length === 0) errors.push("Backup scope must not be empty");
      if (command.operation === "restore" && !command.targetSnapshotId) {
        errors.push("Restore requires a target snapshot ID");
      }
      break;
    case "drain_queue":
      if (!command.queueName) errors.push("Queue name is required");
      if (command.timeoutMs < 1000) errors.push("Timeout must be at least 1000ms");
      break;
    case "force_reconcile":
      if (!command.merchantId) errors.push("Merchant ID is required");
      if (!command.providerId) errors.push("Provider ID is required");
      if (new Date(command.fromTimestamp) >= new Date(command.toTimestamp)) {
        errors.push("From timestamp must be before to timestamp");
      }
      break;
  }

  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}
