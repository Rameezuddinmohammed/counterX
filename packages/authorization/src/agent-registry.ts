/**
 * AgentRegistry port interface.
 *
 * Resolves agent records by identity and checks whether a key is active
 * at a given point in time. Used by the CTP authority verification pipeline.
 */

import type { Instant } from "@counter/domain";
import type { CtpEnvironment } from "@counter/trust-protocol";
import type { CtpAssuranceLevel } from "./assurance-policy.js";

// ---------------------------------------------------------------------------
// Agent Record
// ---------------------------------------------------------------------------

export type AgentStatus = "active" | "suspended" | "revoked";

export interface AgentKeyHistoryEntry {
  readonly kid: string;
  readonly publicKey: string;
  readonly status: "active" | "rotated" | "revoked";
  readonly registeredAt: Instant;
  readonly rotatedAt?: Instant;
  readonly revokedAt?: Instant;
  readonly rotatedTo?: string;
}

export interface AgentRecord {
  readonly agentId: string;
  readonly principalId: string;
  readonly walletId: string;
  readonly agentUri: string;
  readonly currentKid: string;
  readonly publicKey: string;
  readonly status: AgentStatus;
  readonly registeredAt: Instant;
  readonly revokedAt?: Instant;
  readonly environment: CtpEnvironment;
  readonly assuranceLevel: CtpAssuranceLevel;
  readonly keyHistory: readonly AgentKeyHistoryEntry[];
}

// ---------------------------------------------------------------------------
// AgentRegistry Port
// ---------------------------------------------------------------------------

/**
 * Port for resolving agent records and checking key status.
 * Implementations may be in-memory (tests), database-backed, or service-backed.
 */
export interface AgentRegistry {
  /**
   * Resolves an agent by ID and environment.
   * Returns undefined if the agent is not found.
   */
  resolve(agentId: string, environment: CtpEnvironment): Promise<AgentRecord | undefined>;

  /**
   * Checks if a specific key (kid) is active for a given agent at a point in time.
   * A key is active if it is not revoked, not rotated, and within its validity period.
   */
  isKeyActive(agentId: string, kid: string, at: Instant): Promise<boolean>;
}
