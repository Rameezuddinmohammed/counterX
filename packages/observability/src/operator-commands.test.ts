import { describe, expect, it } from "vitest";
import type { CorrelationId, Instant, OperatorId } from "@counter/domain";
import {
  createCommandRegistry,
  ISSUE_GRANT_COMMAND,
  RECONCILE_COMMAND,
  REPLAY_JOB_COMMAND,
  REVOKE_GRANT_COMMAND,
  TOGGLE_KILL_SWITCH_COMMAND,
  type OperatorCommandContext,
} from "./operator-commands.js";

function makeContext(overrides?: Partial<OperatorCommandContext>): OperatorCommandContext {
  return {
    operatorId: "ctr_operator_AAAAAAAAAAAAAAAAAAAAAA" as OperatorId,
    correlationId: "ctr_correlation_AAAAAAAAAAAAAAAAAAAAAA" as CorrelationId,
    roles: ["platform.operator"],
    permissions: [
      "identity.support_grant.use",
      "identity.support_grant.issue",
      "identity.support_grant.revoke",
    ],
    assuranceLevel: "step_up",
    reason: "incident response",
    scope: "platform",
    now: 1_700_000_000_000 as Instant,
    ...overrides,
  };
}

describe("CommandRegistry", () => {
  it("registers and looks up commands", () => {
    const registry = createCommandRegistry();
    registry.register(REPLAY_JOB_COMMAND);

    const found = registry.lookup("replay_job");
    expect(found).toBeDefined();
    expect(found?.name).toBe("replay_job");
  });

  it("returns undefined for unregistered commands", () => {
    const registry = createCommandRegistry();
    expect(registry.lookup("replay_job")).toBeUndefined();
  });

  it("rejects execution when operator lacks required role", () => {
    const registry = createCommandRegistry();
    registry.register(REPLAY_JOB_COMMAND);

    const context = makeContext({ roles: ["merchant.owner"] });
    const result = registry.execute("replay_job", context, { jobId: "j1" }, false);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("unauthorized");
      expect(result.message).toContain("platform.operator");
    }
  });

  it("executes command and returns result with audit entry", () => {
    const registry = createCommandRegistry();
    registry.register(REPLAY_JOB_COMMAND);

    const context = makeContext();
    const result = registry.execute("replay_job", context, { jobId: "j1" }, false);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.kind).toBe("executed");
      if (result.kind === "executed") {
        expect(result.result).toEqual({ jobId: "j1", replayed: true });
        expect(result.audit.commandName).toBe("replay_job");
        expect(result.audit.operatorId).toBe(context.operatorId);
        expect(result.audit.correlationId).toBe(context.correlationId);
        expect(result.audit.reason).toBe("incident response");
        expect(result.audit.scope).toBe("platform");
        expect(result.audit.dryRun).toBe(false);
        expect(result.audit.parameters).toEqual({ jobId: "j1" });
        expect(result.audit.result).toEqual({ jobId: "j1", replayed: true });
        expect(result.audit.preview).toBeNull();
      }
    }
  });

  it("preview mode returns preview without executing", () => {
    const registry = createCommandRegistry();
    registry.register(REPLAY_JOB_COMMAND);

    const context = makeContext();
    const result = registry.execute("replay_job", context, { jobId: "j2" }, true);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.kind).toBe("preview");
      if (result.kind === "preview") {
        expect(result.preview.commandName).toBe("replay_job");
        expect(result.preview.preview).toEqual({
          jobId: "j2",
          estimatedDuration: "~30s",
        });
        expect(result.audit.dryRun).toBe(true);
        expect(result.audit.result).toBeNull();
        expect(result.audit.preview).toEqual({
          jobId: "j2",
          estimatedDuration: "~30s",
        });
      }
    }
  });

  it("audit entry captures all required fields", () => {
    const registry = createCommandRegistry();
    registry.register(RECONCILE_COMMAND);

    const context = makeContext({ reason: "quarterly audit", scope: "merchant:m1" });
    const result = registry.execute("reconcile", context, { targetScope: "merchant:m1" }, false);

    expect(result.ok).toBe(true);
    if (result.ok && result.kind === "executed") {
      const { audit } = result;
      expect(audit.commandName).toBe("reconcile");
      expect(audit.operatorId).toBe(context.operatorId);
      expect(audit.correlationId).toBe(context.correlationId);
      expect(audit.executedAt).toBe(context.now);
      expect(audit.reason).toBe("quarterly audit");
      expect(audit.scope).toBe("merchant:m1");
      expect(audit.parameters).toEqual({ targetScope: "merchant:m1" });
      expect(audit.dryRun).toBe(false);
    }
  });

  it("registers all predefined commands", () => {
    const registry = createCommandRegistry();
    registry.register(REPLAY_JOB_COMMAND);
    registry.register(RECONCILE_COMMAND);
    registry.register(TOGGLE_KILL_SWITCH_COMMAND);
    registry.register(ISSUE_GRANT_COMMAND);
    registry.register(REVOKE_GRANT_COMMAND);

    expect(registry.lookup("replay_job")).toBeDefined();
    expect(registry.lookup("reconcile")).toBeDefined();
    expect(registry.lookup("toggle_kill_switch")).toBeDefined();
    expect(registry.lookup("issue_grant")).toBeDefined();
    expect(registry.lookup("revoke_grant")).toBeDefined();
  });

  it("step-up commands declare requiresStepUp", () => {
    expect(RECONCILE_COMMAND.authorization.requiresStepUp).toBe(true);
    expect(TOGGLE_KILL_SWITCH_COMMAND.authorization.requiresStepUp).toBe(true);
    expect(ISSUE_GRANT_COMMAND.authorization.requiresStepUp).toBe(true);
    expect(REPLAY_JOB_COMMAND.authorization.requiresStepUp).toBe(false);
    expect(REVOKE_GRANT_COMMAND.authorization.requiresStepUp).toBe(false);
  });

  it("rejects execution when step-up is required but assurance is standard", () => {
    const registry = createCommandRegistry();
    registry.register(RECONCILE_COMMAND);

    const context = makeContext({ assuranceLevel: "standard" });
    const result = registry.execute("reconcile", context, { targetScope: "merchant:m1" }, false);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("unauthorized");
      expect(result.message).toContain("step-up");
    }
  });

  it("allows execution of non-step-up commands with standard assurance", () => {
    const registry = createCommandRegistry();
    registry.register(REPLAY_JOB_COMMAND);

    const context = makeContext({ assuranceLevel: "standard" });
    const result = registry.execute("replay_job", context, { jobId: "j1" }, false);

    expect(result.ok).toBe(true);
  });

  it("rejects execution when operator lacks required permissions", () => {
    const registry = createCommandRegistry();
    registry.register(ISSUE_GRANT_COMMAND);

    const context = makeContext({ permissions: ["identity.support_grant.use"] });
    const result = registry.execute(
      "issue_grant",
      context,
      { targetScope: "m1", permissions: [], reason: "test" },
      false,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("unauthorized");
      expect(result.message).toContain("identity.support_grant.issue");
    }
  });

  it("allows execution when operator has all required permissions", () => {
    const registry = createCommandRegistry();
    registry.register(ISSUE_GRANT_COMMAND);

    const context = makeContext({
      permissions: ["identity.support_grant.issue", "identity.support_grant.use"],
    });
    const result = registry.execute(
      "issue_grant",
      context,
      { targetScope: "m1", permissions: [], reason: "test" },
      false,
    );

    expect(result.ok).toBe(true);
  });
});
