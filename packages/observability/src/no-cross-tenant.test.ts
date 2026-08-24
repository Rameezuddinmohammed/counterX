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
import { isKilled, type KillSwitchRecord, type KillSwitchScope } from "./kill-switch.js";

const NOW = 1_700_000_000_000 as Instant;

function makeContext(overrides?: Partial<OperatorCommandContext>): OperatorCommandContext {
  return {
    operatorId: "ctr_operator_AAAAAAAAAAAAAAAAAAAAAA" as OperatorId,
    correlationId: "ctr_correlation_AAAAAAAAAAAAAAAAAAAAAA" as CorrelationId,
    roles: ["platform.operator"],
    reason: "incident response",
    scope: "platform",
    now: NOW,
    ...overrides,
  };
}

describe("No cross-tenant access - operator command authorization", () => {
  it("operator commands require platform.operator role", () => {
    const registry = createCommandRegistry();
    registry.register(REPLAY_JOB_COMMAND);
    registry.register(RECONCILE_COMMAND);
    registry.register(TOGGLE_KILL_SWITCH_COMMAND);
    registry.register(ISSUE_GRANT_COMMAND);
    registry.register(REVOKE_GRANT_COMMAND);

    const merchantContext = makeContext({ roles: ["merchant.owner"] });

    const commands = [
      { name: "replay_job" as const, params: { jobId: "j1" } },
      { name: "reconcile" as const, params: { targetScope: "merchant:m1" } },
      { name: "toggle_kill_switch" as const, params: { switchId: "ks1", active: true } },
      {
        name: "issue_grant" as const,
        params: { targetScope: "m1", permissions: [], reason: "test" },
      },
      { name: "revoke_grant" as const, params: { grantId: "g1", reason: "test" } },
    ];

    for (const cmd of commands) {
      const result = registry.execute(cmd.name, merchantContext, cmd.params, false);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.kind).toBe("unauthorized");
      }
    }
  });

  it("wallet.owner role cannot execute operator commands", () => {
    const registry = createCommandRegistry();
    registry.register(REPLAY_JOB_COMMAND);

    const walletContext = makeContext({ roles: ["wallet.owner"] });
    const result = registry.execute("replay_job", walletContext, { jobId: "j1" }, false);
    expect(result.ok).toBe(false);
  });

  it("empty roles cannot execute operator commands", () => {
    const registry = createCommandRegistry();
    registry.register(REPLAY_JOB_COMMAND);

    const noRolesContext = makeContext({ roles: [] });
    const result = registry.execute("replay_job", noRolesContext, { jobId: "j1" }, false);
    expect(result.ok).toBe(false);
  });
});

describe("No cross-tenant access - kill switch scope matching", () => {
  it("merchant-scoped switch does not affect wallet scope", () => {
    const sw: KillSwitchRecord = Object.freeze({
      id: "ks-1",
      scope: "merchant" as KillSwitchScope,
      entityId: null,
      status: "active" as const,
      reason: "test",
      activatedBy: "operator-1",
      activatedAt: (NOW - 1000) as Instant,
      expiresAt: null,
    });

    expect(isKilled([sw], { scope: "wallet", entityId: "w1", now: NOW })).toBe(false);
    expect(isKilled([sw], { scope: "agent", entityId: "a1", now: NOW })).toBe(false);
    expect(isKilled([sw], { scope: "platform", entityId: null, now: NOW })).toBe(false);
  });

  it("entity-specific switch cannot cross-tenant block different entity", () => {
    const sw: KillSwitchRecord = Object.freeze({
      id: "ks-1",
      scope: "merchant" as KillSwitchScope,
      entityId: "merchant-A",
      status: "active" as const,
      reason: "test",
      activatedBy: "operator-1",
      activatedAt: (NOW - 1000) as Instant,
      expiresAt: null,
    });

    expect(isKilled([sw], { scope: "merchant", entityId: "merchant-A", now: NOW })).toBe(true);
    expect(isKilled([sw], { scope: "merchant", entityId: "merchant-B", now: NOW })).toBe(false);
  });
});

describe("No cross-tenant access - support grants cannot be self-issued", () => {
  it("issue_grant command requires platform.operator role (prevents self-issue by non-operators)", () => {
    const registry = createCommandRegistry();
    registry.register(ISSUE_GRANT_COMMAND);

    const serviceContext = makeContext({ roles: ["service.identity"] });
    const result = registry.execute(
      "issue_grant",
      serviceContext,
      { targetScope: "merchant:m1", permissions: ["identity.scope.read"], reason: "self" },
      false,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("unauthorized");
    }
  });

  it("issue_grant authorization requires step-up (prevents casual self-issuance)", () => {
    expect(ISSUE_GRANT_COMMAND.authorization.requiresStepUp).toBe(true);
  });
});
