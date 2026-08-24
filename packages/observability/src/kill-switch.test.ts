import { describe, expect, it } from "vitest";
import type { Instant } from "@counter/domain";
import {
  createInMemoryKillSwitchRegistry,
  findApplicableSwitches,
  isKilled,
  KILL_SWITCH_SCOPES,
  type KillSwitchRecord,
  type KillSwitchScope,
} from "./kill-switch.js";

const NOW = 1_700_000_000_000 as Instant;

function makeSwitch(overrides?: Partial<KillSwitchRecord>): KillSwitchRecord {
  return Object.freeze({
    id: "ks-1",
    scope: "merchant" as KillSwitchScope,
    entityId: null,
    status: "active" as const,
    reason: "incident",
    activatedBy: "operator-1",
    activatedAt: (NOW - 60_000) as Instant,
    expiresAt: null,
    ...overrides,
  });
}

describe("KillSwitch evaluation", () => {
  it("active switch blocks matching scope", () => {
    const sw = makeSwitch({ scope: "merchant" });
    expect(isKilled([sw], { scope: "merchant", entityId: "m1", now: NOW })).toBe(true);
  });

  it("inactive switch does not block", () => {
    const sw = makeSwitch({ status: "inactive" });
    expect(isKilled([sw], { scope: "merchant", entityId: "m1", now: NOW })).toBe(false);
  });

  it("expired switch does not block", () => {
    const sw = makeSwitch({ expiresAt: (NOW - 1000) as Instant });
    expect(isKilled([sw], { scope: "merchant", entityId: "m1", now: NOW })).toBe(false);
  });

  it("non-expired switch blocks", () => {
    const sw = makeSwitch({ expiresAt: (NOW + 60_000) as Instant });
    expect(isKilled([sw], { scope: "merchant", entityId: "m1", now: NOW })).toBe(true);
  });

  it("scope mismatch does not block", () => {
    const sw = makeSwitch({ scope: "wallet" });
    expect(isKilled([sw], { scope: "merchant", entityId: "m1", now: NOW })).toBe(false);
  });

  it("entity-specific switch only blocks matching entity", () => {
    const sw = makeSwitch({ entityId: "m1" });
    expect(isKilled([sw], { scope: "merchant", entityId: "m1", now: NOW })).toBe(true);
    expect(isKilled([sw], { scope: "merchant", entityId: "m2", now: NOW })).toBe(false);
  });

  it("null entityId switch blocks all entities in scope", () => {
    const sw = makeSwitch({ entityId: null });
    expect(isKilled([sw], { scope: "merchant", entityId: "m1", now: NOW })).toBe(true);
    expect(isKilled([sw], { scope: "merchant", entityId: "m2", now: NOW })).toBe(true);
  });

  it("supports all scope types", () => {
    for (const scope of KILL_SWITCH_SCOPES) {
      const sw = makeSwitch({ scope });
      expect(isKilled([sw], { scope, entityId: "e1", now: NOW })).toBe(true);
    }
  });

  it("findApplicableSwitches returns only matching switches", () => {
    const switches = [
      makeSwitch({ id: "ks-1", scope: "merchant" }),
      makeSwitch({ id: "ks-2", scope: "wallet" }),
      makeSwitch({ id: "ks-3", scope: "merchant", status: "inactive" }),
    ];
    const applicable = findApplicableSwitches(switches, {
      scope: "merchant",
      entityId: "m1",
      now: NOW,
    });
    expect(applicable).toHaveLength(1);
    expect(applicable[0]!.id).toBe("ks-1");
  });
});

describe("InMemoryKillSwitchRegistry CRUD", () => {
  it("creates and retrieves records", () => {
    const registry = createInMemoryKillSwitchRegistry();
    const sw = makeSwitch();
    registry.create(sw);
    expect(registry.get("ks-1")).toEqual(sw);
  });

  it("lists all records", () => {
    const registry = createInMemoryKillSwitchRegistry();
    registry.create(makeSwitch({ id: "ks-1" }));
    registry.create(makeSwitch({ id: "ks-2", scope: "wallet" }));
    expect(registry.list()).toHaveLength(2);
  });

  it("updates records", () => {
    const registry = createInMemoryKillSwitchRegistry();
    registry.create(makeSwitch());
    const updated = registry.update("ks-1", { status: "inactive" });
    expect(updated?.status).toBe("inactive");
    expect(registry.get("ks-1")?.status).toBe("inactive");
  });

  it("returns undefined when updating non-existent record", () => {
    const registry = createInMemoryKillSwitchRegistry();
    expect(registry.update("not-found", { status: "inactive" })).toBeUndefined();
  });

  it("removes records", () => {
    const registry = createInMemoryKillSwitchRegistry();
    registry.create(makeSwitch());
    expect(registry.remove("ks-1")).toBe(true);
    expect(registry.get("ks-1")).toBeUndefined();
  });

  it("returns false when removing non-existent record", () => {
    const registry = createInMemoryKillSwitchRegistry();
    expect(registry.remove("not-found")).toBe(false);
  });
});
