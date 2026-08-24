/**
 * Typed operator command framework.
 *
 * Provides a generic command infrastructure for platform operators:
 * authorization enforcement, preview (dry-run) mode, and audit trail creation.
 * Each command declares its required permissions, optional step-up, and
 * parameter/preview/result shapes.
 */
import type { CorrelationId, Instant, OperatorId } from "@counter/domain";

/**
 * The set of operator command names known to the platform.
 */
export const OPERATOR_COMMAND_NAMES = [
  "replay_job",
  "reconcile",
  "toggle_kill_switch",
  "issue_grant",
  "revoke_grant",
] as const;

export type OperatorCommandName = (typeof OPERATOR_COMMAND_NAMES)[number];

/**
 * Authorization requirement for an operator command.
 */
export interface CommandAuthorization {
  readonly role: "platform.operator";
  readonly permissions: readonly string[];
  readonly requiresStepUp: boolean;
}

/**
 * Preview output from a dry-run execution.
 */
export interface CommandPreview<Preview> {
  readonly commandName: OperatorCommandName;
  readonly parameters: unknown;
  readonly preview: Preview;
  readonly executedAt: Instant;
}

/**
 * Audit entry capturing who ran what, when, and why.
 */
export interface CommandAuditEntry<Params = unknown, Preview = unknown, Result = unknown> {
  readonly commandName: OperatorCommandName;
  readonly operatorId: OperatorId;
  readonly correlationId: CorrelationId;
  readonly executedAt: Instant;
  readonly reason: string;
  readonly scope: string;
  readonly parameters: Params;
  readonly preview: Preview | null;
  readonly result: Result | null;
  readonly dryRun: boolean;
}

/**
 * Definition of an operator command.
 */
export interface OperatorCommandDefinition<Params, Preview, Result> {
  readonly name: OperatorCommandName;
  readonly authorization: CommandAuthorization;
  readonly execute: (params: Params) => Result;
  readonly previewFn: (params: Params) => Preview;
}

/**
 * Context required to execute an operator command.
 */
export interface OperatorCommandContext {
  readonly operatorId: OperatorId;
  readonly correlationId: CorrelationId;
  readonly roles: readonly string[];
  readonly reason: string;
  readonly scope: string;
  readonly now: Instant;
}

/**
 * Result of attempting to execute a command.
 */
export type CommandExecutionResult<Preview, Result> =
  | Readonly<{ ok: true; kind: "executed"; result: Result; audit: CommandAuditEntry }>
  | Readonly<{
      ok: true;
      kind: "preview";
      preview: CommandPreview<Preview>;
      audit: CommandAuditEntry;
    }>
  | Readonly<{ ok: false; kind: "unauthorized"; message: string }>;

/**
 * Registry for operator commands. Allows registration and lookup.
 */
export interface CommandRegistry {
  register<Params, Preview, Result>(
    definition: OperatorCommandDefinition<Params, Preview, Result>,
  ): void;
  lookup(
    name: OperatorCommandName,
  ): OperatorCommandDefinition<unknown, unknown, unknown> | undefined;
  execute<Params, Preview, Result>(
    name: OperatorCommandName,
    context: OperatorCommandContext,
    params: Params,
    dryRun: boolean,
  ): CommandExecutionResult<Preview, Result>;
}

/**
 * Creates a new command registry.
 */
export function createCommandRegistry(): CommandRegistry {
  const commands = new Map<
    OperatorCommandName,
    OperatorCommandDefinition<unknown, unknown, unknown>
  >();

  function register<Params, Preview, Result>(
    definition: OperatorCommandDefinition<Params, Preview, Result>,
  ): void {
    commands.set(
      definition.name,
      definition as unknown as OperatorCommandDefinition<unknown, unknown, unknown>,
    );
  }

  function lookup(
    name: OperatorCommandName,
  ): OperatorCommandDefinition<unknown, unknown, unknown> | undefined {
    return commands.get(name);
  }

  function execute<Params, Preview, Result>(
    name: OperatorCommandName,
    context: OperatorCommandContext,
    params: Params,
    dryRun: boolean,
  ): CommandExecutionResult<Preview, Result> {
    const definition = commands.get(name);
    if (definition === undefined) {
      return Object.freeze({
        ok: false,
        kind: "unauthorized",
        message: `Command "${name}" is not registered`,
      });
    }

    if (!context.roles.includes(definition.authorization.role)) {
      return Object.freeze({
        ok: false,
        kind: "unauthorized",
        message: `Operator lacks required role "${definition.authorization.role}"`,
      });
    }

    if (dryRun) {
      const preview = definition.previewFn(params) as Preview;
      const audit = createAuditEntry(name, context, params, preview, null, true);
      return Object.freeze({
        ok: true,
        kind: "preview",
        preview: Object.freeze({
          commandName: name,
          parameters: params,
          preview,
          executedAt: context.now,
        }),
        audit,
      });
    }

    const result = definition.execute(params) as Result;
    const audit = createAuditEntry(name, context, params, null, result, false);
    return Object.freeze({
      ok: true,
      kind: "executed",
      result,
      audit,
    });
  }

  return Object.freeze({ register, lookup, execute });
}

function createAuditEntry<Params, Preview, Result>(
  commandName: OperatorCommandName,
  context: OperatorCommandContext,
  parameters: Params,
  preview: Preview | null,
  result: Result | null,
  dryRun: boolean,
): CommandAuditEntry<Params, Preview, Result> {
  return Object.freeze({
    commandName,
    operatorId: context.operatorId,
    correlationId: context.correlationId,
    executedAt: context.now,
    reason: context.reason,
    scope: context.scope,
    parameters,
    preview,
    result,
    dryRun,
  });
}

/**
 * Predefined command definitions for the Counter platform.
 */

interface ReplayJobParams {
  readonly jobId: string;
}

interface ReplayJobPreview {
  readonly jobId: string;
  readonly estimatedDuration: string;
}

interface ReplayJobResult {
  readonly jobId: string;
  readonly replayed: true;
}

export const REPLAY_JOB_COMMAND: OperatorCommandDefinition<
  ReplayJobParams,
  ReplayJobPreview,
  ReplayJobResult
> = Object.freeze({
  name: "replay_job",
  authorization: Object.freeze({
    role: "platform.operator" as const,
    permissions: Object.freeze(["identity.support_grant.use"]),
    requiresStepUp: false,
  }),
  execute: (params: ReplayJobParams): ReplayJobResult =>
    Object.freeze({ jobId: params.jobId, replayed: true as const }),
  previewFn: (params: ReplayJobParams): ReplayJobPreview =>
    Object.freeze({ jobId: params.jobId, estimatedDuration: "~30s" }),
});

interface ReconcileParams {
  readonly targetScope: string;
}

interface ReconcilePreview {
  readonly targetScope: string;
  readonly affectedRecords: number;
}

interface ReconcileResult {
  readonly targetScope: string;
  readonly reconciled: true;
}

export const RECONCILE_COMMAND: OperatorCommandDefinition<
  ReconcileParams,
  ReconcilePreview,
  ReconcileResult
> = Object.freeze({
  name: "reconcile",
  authorization: Object.freeze({
    role: "platform.operator" as const,
    permissions: Object.freeze(["identity.support_grant.use"]),
    requiresStepUp: true,
  }),
  execute: (params: ReconcileParams): ReconcileResult =>
    Object.freeze({ targetScope: params.targetScope, reconciled: true as const }),
  previewFn: (params: ReconcileParams): ReconcilePreview =>
    Object.freeze({ targetScope: params.targetScope, affectedRecords: 0 }),
});

interface ToggleKillSwitchParams {
  readonly switchId: string;
  readonly active: boolean;
}

interface ToggleKillSwitchPreview {
  readonly switchId: string;
  readonly currentStatus: string;
  readonly newStatus: string;
}

interface ToggleKillSwitchResult {
  readonly switchId: string;
  readonly active: boolean;
  readonly toggled: true;
}

export const TOGGLE_KILL_SWITCH_COMMAND: OperatorCommandDefinition<
  ToggleKillSwitchParams,
  ToggleKillSwitchPreview,
  ToggleKillSwitchResult
> = Object.freeze({
  name: "toggle_kill_switch",
  authorization: Object.freeze({
    role: "platform.operator" as const,
    permissions: Object.freeze(["identity.support_grant.use"]),
    requiresStepUp: true,
  }),
  execute: (params: ToggleKillSwitchParams): ToggleKillSwitchResult =>
    Object.freeze({ switchId: params.switchId, active: params.active, toggled: true as const }),
  previewFn: (params: ToggleKillSwitchParams): ToggleKillSwitchPreview =>
    Object.freeze({
      switchId: params.switchId,
      currentStatus: params.active ? "inactive" : "active",
      newStatus: params.active ? "active" : "inactive",
    }),
});

interface IssueGrantParams {
  readonly targetScope: string;
  readonly permissions: readonly string[];
  readonly reason: string;
}

interface IssueGrantPreview {
  readonly targetScope: string;
  readonly permissions: readonly string[];
  readonly estimatedDuration: string;
}

interface IssueGrantResult {
  readonly targetScope: string;
  readonly grantId: string;
  readonly issued: true;
}

export const ISSUE_GRANT_COMMAND: OperatorCommandDefinition<
  IssueGrantParams,
  IssueGrantPreview,
  IssueGrantResult
> = Object.freeze({
  name: "issue_grant",
  authorization: Object.freeze({
    role: "platform.operator" as const,
    permissions: Object.freeze(["identity.support_grant.issue"]),
    requiresStepUp: true,
  }),
  execute: (params: IssueGrantParams): IssueGrantResult =>
    Object.freeze({
      targetScope: params.targetScope,
      grantId: "grant-placeholder",
      issued: true as const,
    }),
  previewFn: (params: IssueGrantParams): IssueGrantPreview =>
    Object.freeze({
      targetScope: params.targetScope,
      permissions: params.permissions,
      estimatedDuration: "4h max",
    }),
});

interface RevokeGrantParams {
  readonly grantId: string;
  readonly reason: string;
}

interface RevokeGrantPreview {
  readonly grantId: string;
  readonly currentExpiry: string;
}

interface RevokeGrantResult {
  readonly grantId: string;
  readonly revoked: true;
}

export const REVOKE_GRANT_COMMAND: OperatorCommandDefinition<
  RevokeGrantParams,
  RevokeGrantPreview,
  RevokeGrantResult
> = Object.freeze({
  name: "revoke_grant",
  authorization: Object.freeze({
    role: "platform.operator" as const,
    permissions: Object.freeze(["identity.support_grant.revoke"]),
    requiresStepUp: false,
  }),
  execute: (params: RevokeGrantParams): RevokeGrantResult =>
    Object.freeze({ grantId: params.grantId, revoked: true as const }),
  previewFn: (params: RevokeGrantParams): RevokeGrantPreview =>
    Object.freeze({ grantId: params.grantId, currentExpiry: "unknown" }),
});
