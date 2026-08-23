/**
 * CounterTestAgentRegistry - in-memory test implementation of AgentRegistry.
 *
 * Supports:
 * - Registration with proof-of-possession (agent signs a challenge to prove key ownership)
 * - Key rotation (new key replaces old, old key marked as rotated)
 * - Agent revocation (monotonic)
 * - Key revocation (individual key revocation)
 * - Historical key queries (isKeyActive at a point in time)
 */

import {
  type Result,
  ok,
  err,
  createCanonicalError,
  type Instant,
  compareInstants,
} from "@counter/domain";
import {
  type CtpEnvironment,
  InMemoryKeyRegistry,

  verifyEnvelope,
  type CtpEnvelope,
  type AgentRegistrationPayload,
} from "@counter/trust-protocol";
import type { AgentRecord, AgentRegistry, AgentKeyHistoryEntry } from "./agent-registry.js";
import type { CtpAssuranceLevel } from "./assurance-policy.js";

// ---------------------------------------------------------------------------
// Registration Input
// ---------------------------------------------------------------------------

export interface AgentRegistrationInput {
  readonly agentId: string;
  readonly principalId: string;
  readonly walletId: string;
  readonly agentUri: string;
  readonly kid: string;
  readonly publicKey: string;
  readonly environment: CtpEnvironment;
  readonly assuranceLevel: CtpAssuranceLevel;
  readonly registeredAt: Instant;
  /** Signed envelope proving possession of the private key. */
  readonly proofOfPossession: CtpEnvelope<AgentRegistrationPayload>;
}

// ---------------------------------------------------------------------------
// Key Rotation Input
// ---------------------------------------------------------------------------

export interface KeyRotationInput {
  readonly agentId: string;
  readonly newKid: string;
  readonly newPublicKey: string;
  readonly environment: CtpEnvironment;
  readonly rotatedAt: Instant;
  /** Proof of possession for the new key. */
  readonly proofOfPossession: CtpEnvelope<AgentRegistrationPayload>;
}

// ---------------------------------------------------------------------------
// Internal Mutable Agent State
// ---------------------------------------------------------------------------

interface MutableAgentState {
  agentId: string;
  principalId: string;
  walletId: string;
  agentUri: string;
  currentKid: string;
  publicKey: string;
  status: "active" | "suspended" | "revoked";
  registeredAt: Instant;
  revokedAt?: Instant;
  environment: CtpEnvironment;
  assuranceLevel: CtpAssuranceLevel;
  keyHistory: MutableKeyEntry[];
}

interface MutableKeyEntry {
  kid: string;
  publicKey: string;
  status: "active" | "rotated" | "revoked";
  registeredAt: Instant;
  rotatedAt?: Instant;
  revokedAt?: Instant;
  rotatedTo?: string;
}

// ---------------------------------------------------------------------------
// CounterTestAgentRegistry Implementation
// ---------------------------------------------------------------------------

export class CounterTestAgentRegistry implements AgentRegistry {
  readonly #agents: Map<string, MutableAgentState> = new Map();

  /**
   * Registers a new agent with proof-of-possession verification.
   * The proof envelope must be signed with the key being registered.
   */
  public async register(input: AgentRegistrationInput): Promise<Result<AgentRecord>> {
    // Check if agent already exists
    const existing = this.#agents.get(this.#key(input.agentId, input.environment));
    if (existing !== undefined) {
      return err(
        createCanonicalError({
          category: "conflict",
          code: "CONFLICT",
          message: "Agent is already registered",
        }),
      );
    }

    // Verify proof of possession
    const popResult = await this.#verifyProofOfPossession(
      input.proofOfPossession,
      input.kid,
      input.publicKey,
      input.registeredAt,
    );
    if (!popResult.ok) {
      return popResult;
    }

    // Store the agent
    const keyEntry: MutableKeyEntry = {
      kid: input.kid,
      publicKey: input.publicKey,
      status: "active",
      registeredAt: input.registeredAt,
    };

    const state: MutableAgentState = {
      agentId: input.agentId,
      principalId: input.principalId,
      walletId: input.walletId,
      agentUri: input.agentUri,
      currentKid: input.kid,
      publicKey: input.publicKey,
      status: "active",
      registeredAt: input.registeredAt,
      environment: input.environment,
      assuranceLevel: input.assuranceLevel,
      keyHistory: [keyEntry],
    };

    this.#agents.set(this.#key(input.agentId, input.environment), state);
    return ok(this.#toRecord(state));
  }

  /**
   * Rotates an agent's key. The old key is marked as rotated and the new
   * key becomes the current active key. Requires proof of possession for
   * the new key.
   */
  public async rotateKey(input: KeyRotationInput): Promise<Result<AgentRecord>> {
    const state = this.#agents.get(this.#key(input.agentId, input.environment));
    if (state === undefined) {
      return err(
        createCanonicalError({
          category: "authentication",
          code: "UNAUTHENTICATED",
          message: "Agent not found",
        }),
      );
    }

    if (state.status === "revoked") {
      return err(
        createCanonicalError({
          category: "authorization",
          code: "UNAUTHORIZED",
          message: "Cannot rotate key for a revoked agent",
        }),
      );
    }

    // Verify proof of possession for the new key
    const popResult = await this.#verifyProofOfPossession(
      input.proofOfPossession,
      input.newKid,
      input.newPublicKey,
      input.rotatedAt,
    );
    if (!popResult.ok) {
      return popResult;
    }

    // Mark old key as rotated
    const oldKey = state.keyHistory.find((k) => k.kid === state.currentKid);
    if (oldKey !== undefined) {
      oldKey.status = "rotated";
      oldKey.rotatedAt = input.rotatedAt;
      oldKey.rotatedTo = input.newKid;
    }

    // Add new key
    const newKeyEntry: MutableKeyEntry = {
      kid: input.newKid,
      publicKey: input.newPublicKey,
      status: "active",
      registeredAt: input.rotatedAt,
    };
    state.keyHistory.push(newKeyEntry);
    state.currentKid = input.newKid;
    state.publicKey = input.newPublicKey;

    return ok(this.#toRecord(state));
  }

  /**
   * Revokes an agent. Monotonic: once revoked, always revoked.
   */
  public async revokeAgent(
    agentId: string,
    environment: CtpEnvironment,
    revokedAt: Instant,
  ): Promise<Result<void>> {
    const state = this.#agents.get(this.#key(agentId, environment));
    if (state === undefined) {
      return err(
        createCanonicalError({
          category: "authentication",
          code: "UNAUTHENTICATED",
          message: "Agent not found",
        }),
      );
    }

    if (state.status === "revoked") {
      // Idempotent: already revoked
      return ok(undefined);
    }

    state.status = "revoked";
    state.revokedAt = revokedAt;

    // Revoke all active keys
    for (const key of state.keyHistory) {
      if (key.status === "active") {
        key.status = "revoked";
        key.revokedAt = revokedAt;
      }
    }

    return ok(undefined);
  }

  /**
   * Revokes a specific key for an agent. Monotonic: once revoked, always revoked.
   */
  public async revokeKey(
    agentId: string,
    kid: string,
    environment: CtpEnvironment,
    revokedAt: Instant,
  ): Promise<Result<void>> {
    const state = this.#agents.get(this.#key(agentId, environment));
    if (state === undefined) {
      return err(
        createCanonicalError({
          category: "authentication",
          code: "UNAUTHENTICATED",
          message: "Agent not found",
        }),
      );
    }

    const keyEntry = state.keyHistory.find((k) => k.kid === kid);
    if (keyEntry === undefined) {
      return err(
        createCanonicalError({
          category: "authentication",
          code: "UNAUTHENTICATED",
          message: "Key not found",
        }),
      );
    }

    if (keyEntry.status === "revoked") {
      // Idempotent
      return ok(undefined);
    }

    keyEntry.status = "revoked";
    keyEntry.revokedAt = revokedAt;

    return ok(undefined);
  }

  // -------------------------------------------------------------------------
  // AgentRegistry interface
  // -------------------------------------------------------------------------

  public async resolve(
    agentId: string,
    environment: CtpEnvironment,
  ): Promise<AgentRecord | undefined> {
    const state = this.#agents.get(this.#key(agentId, environment));
    if (state === undefined) {
      return undefined;
    }
    return this.#toRecord(state);
  }

  public async isKeyActive(agentId: string, kid: string, at: Instant): Promise<boolean> {
    // Search all environments for this agent
    for (const state of this.#agents.values()) {
      if (state.agentId !== agentId) {
        continue;
      }

      const keyEntry = state.keyHistory.find((k) => k.kid === kid);
      if (keyEntry === undefined) {
        continue;
      }

      // Check if agent itself is revoked before this time
      if (state.status === "revoked" && state.revokedAt !== undefined) {
        if (compareInstants(at, state.revokedAt) >= 0) {
          return false;
        }
      }

      // Key must have been registered at or before the query time
      if (compareInstants(at, keyEntry.registeredAt) < 0) {
        return false;
      }

      // Key must not be revoked at this time
      if (keyEntry.status === "revoked" && keyEntry.revokedAt !== undefined) {
        if (compareInstants(at, keyEntry.revokedAt) >= 0) {
          return false;
        }
      }

      // Key must not be rotated at this time
      if (keyEntry.status === "rotated" && keyEntry.rotatedAt !== undefined) {
        if (compareInstants(at, keyEntry.rotatedAt) >= 0) {
          return false;
        }
      }

      return true;
    }

    return false;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  #key(agentId: string, environment: CtpEnvironment): string {
    return `${environment}:${agentId}`;
  }

  #toRecord(state: MutableAgentState): AgentRecord {
    const keyHistory: AgentKeyHistoryEntry[] = state.keyHistory.map((k) =>
      Object.freeze({
        kid: k.kid,
        publicKey: k.publicKey,
        status: k.status,
        registeredAt: k.registeredAt,
        ...(k.rotatedAt !== undefined ? { rotatedAt: k.rotatedAt } : {}),
        ...(k.revokedAt !== undefined ? { revokedAt: k.revokedAt } : {}),
        ...(k.rotatedTo !== undefined ? { rotatedTo: k.rotatedTo } : {}),
      }),
    );

    const record: AgentRecord = {
      agentId: state.agentId,
      principalId: state.principalId,
      walletId: state.walletId,
      agentUri: state.agentUri,
      currentKid: state.currentKid,
      publicKey: state.publicKey,
      status: state.status,
      registeredAt: state.registeredAt,
      environment: state.environment,
      assuranceLevel: state.assuranceLevel,
      keyHistory: Object.freeze(keyHistory),
      ...(state.revokedAt !== undefined ? { revokedAt: state.revokedAt } : {}),
    };

    return Object.freeze(record);
  }

  async #verifyProofOfPossession(
    envelope: CtpEnvelope<AgentRegistrationPayload>,
    expectedKid: string,
    publicKey: string,
    currentTime: Instant,
  ): Promise<Result<void>> {
    // Verify that the envelope is signed with the expected kid
    if (envelope.signature.kid !== expectedKid) {
      return err(
        createCanonicalError({
          category: "authentication",
          code: "UNAUTHENTICATED",
          message: "Proof of possession kid does not match registration kid",
        }),
      );
    }

    // Create a temporary key registry for verification
    const keyRegistry = new InMemoryKeyRegistry([
      {
        kid: expectedKid,
        use: "sign",
        alg: "EdDSA",
        publicKey,
        status: "active",
        validFrom: "2000-01-01T00:00:00.000Z",
        validUntil: "2099-12-31T23:59:59.999Z",
        issuer: envelope.issuer,
      },
    ]);

    const currentTimeIso = new Date(currentTime).toISOString();
    const verifyResult = await verifyEnvelope(envelope, {
      keyRegistry,
      currentTime: currentTimeIso,
    });

    if (!verifyResult.ok) {
      return err(
        createCanonicalError({
          category: "authentication",
          code: "UNAUTHENTICATED",
          message: "Proof of possession signature verification failed",
        }),
      );
    }

    // Verify envelope type is agent registration
    if (envelope.type !== "counter.agent-registration.v1") {
      return err(
        createCanonicalError({
          category: "validation",
          code: "UNSUPPORTED_VALUE",
          message: "Proof of possession must be an agent-registration envelope",
        }),
      );
    }

    return ok(undefined);
  }
}
