/**
 * Kill switch configuration records and evaluation.
 *
 * Kill switches are server-side feature flags that disable functionality
 * for specific scopes. They are evaluated synchronously and support
 * time-based expiry.
 */
import type { Instant } from "@counter/domain";

/**
 * Scopes that kill switches can target.
 */
export const KILL_SWITCH_SCOPES = [
  "platform",
  "merchant",
  "wallet",
  "agent",
  "mandate",
  "connector",
  "payment_adapter",
] as const;

export type KillSwitchScope = (typeof KILL_SWITCH_SCOPES)[number];

/**
 * Kill switch statuses.
 */
export const KILL_SWITCH_STATUSES = ["active", "inactive"] as const;
export type KillSwitchStatus = (typeof KILL_SWITCH_STATUSES)[number];

/**
 * A kill switch configuration record.
 */
export interface KillSwitchRecord {
  readonly id: string;
  readonly scope: KillSwitchScope;
  readonly entityId: string | null;
  readonly status: KillSwitchStatus;
  readonly reason: string;
  readonly activatedBy: string;
  readonly activatedAt: Instant;
  readonly expiresAt: Instant | null;
}

/**
 * Registry interface for kill switch CRUD operations.
 */
export interface KillSwitchRegistry {
  create(record: KillSwitchRecord): void;
  get(id: string): KillSwitchRecord | undefined;
  list(): readonly KillSwitchRecord[];
  update(id: string, patch: Partial<Pick<KillSwitchRecord, "status" | "reason" | "expiresAt">>): KillSwitchRecord | undefined;
  remove(id: string): boolean;
}

/**
 * Creates an in-memory kill switch registry for testing.
 */
export function createInMemoryKillSwitchRegistry(): KillSwitchRegistry {
  const records = new Map<string, KillSwitchRecord>();

  return Object.freeze({
    create(record: KillSwitchRecord): void {
      records.set(record.id, record);
    },

    get(id: string): KillSwitchRecord | undefined {
      return records.get(id);
    },

    list(): readonly KillSwitchRecord[] {
      return Object.freeze([...records.values()]);
    },

    update(
      id: string,
      patch: Partial<Pick<KillSwitchRecord, "status" | "reason" | "expiresAt">>,
    ): KillSwitchRecord | undefined {
      const existing = records.get(id);
      if (existing === undefined) {
        return undefined;
      }
      const updated: KillSwitchRecord = Object.freeze({
        ...existing,
        ...(patch.status !== undefined && { status: patch.status }),
        ...(patch.reason !== undefined && { reason: patch.reason }),
        ...(patch.expiresAt !== undefined && { expiresAt: patch.expiresAt }),
      });
      records.set(id, updated);
      return updated;
    },

    remove(id: string): boolean {
      return records.delete(id);
    },
  });
}

/**
 * Evaluation parameters for checking if a scope/entity is killed.
 */
export interface KillSwitchQuery {
  readonly scope: KillSwitchScope;
  readonly entityId: string | null;
  readonly now: Instant;
}

/**
 * Evaluates whether a given scope/entity is blocked by an active kill switch.
 * A switch blocks if:
 *  - Its status is "active"
 *  - Its scope matches the query scope
 *  - Its entityId is null (blocks all in that scope) or matches the query entityId
 *  - It has not expired (expiresAt is null or > now)
 */
export function isKilled(
  switches: readonly KillSwitchRecord[],
  query: KillSwitchQuery,
): boolean {
  return switches.some((sw) => killSwitchApplies(sw, query));
}

/**
 * Returns all kill switches that apply to the given query.
 */
export function findApplicableSwitches(
  switches: readonly KillSwitchRecord[],
  query: KillSwitchQuery,
): readonly KillSwitchRecord[] {
  return Object.freeze(switches.filter((sw) => killSwitchApplies(sw, query)));
}

function killSwitchApplies(sw: KillSwitchRecord, query: KillSwitchQuery): boolean {
  if (sw.status !== "active") {
    return false;
  }

  if (sw.scope !== query.scope) {
    return false;
  }

  if (sw.entityId !== null && sw.entityId !== query.entityId) {
    return false;
  }

  if (sw.expiresAt !== null && sw.expiresAt <= query.now) {
    return false;
  }

  return true;
}
