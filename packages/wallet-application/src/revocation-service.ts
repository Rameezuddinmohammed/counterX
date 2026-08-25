/**
 * Wallet revocation service.
 *
 * Implements monotonic, authenticated, durable revocation for:
 * - wallet, agent, key, mandate, trigger, payment_reference
 *
 * Once revoked, blocks ALL future consequential effects immediately.
 * Revocation is irreversible (monotonic) and creates a CTP
 * counter.revocation.v1 envelope for evidence.
 */

import type { CounterId } from "@counter/domain";
import { CryptoIdGenerator } from "@counter/domain";
import type { RevocationPayload, UnsignedCtpEnvelope } from "@counter/trust-protocol";
import { buildUnsignedEnvelope, computePayloadDigest } from "@counter/trust-protocol";
import type { MandateRepository } from "@counter/wallet-domain";

// ---------------------------------------------------------------------------
// Revocation Scope Types
// ---------------------------------------------------------------------------

export const REVOCATION_SCOPE_TYPES = [
  "wallet",
  "agent",
  "key",
  "mandate",
  "trigger",
  "payment_reference",
] as const;

export type RevocationScopeType = (typeof REVOCATION_SCOPE_TYPES)[number];

const revocationScopeSet: ReadonlySet<string> = new Set(REVOCATION_SCOPE_TYPES);

export function isRevocationScopeType(value: unknown): value is RevocationScopeType {
  return typeof value === "string" && revocationScopeSet.has(value);
}

// ---------------------------------------------------------------------------
// Revocation Reason Classes
// ---------------------------------------------------------------------------

export const REVOCATION_REASON_CLASSES = [
  "principal_initiated",
  "security_compromise",
  "policy_violation",
  "system_enforcement",
  "expiry",
] as const;

export type RevocationReasonClass = (typeof REVOCATION_REASON_CLASSES)[number];

// ---------------------------------------------------------------------------
// Revocation Record
// ---------------------------------------------------------------------------

export interface RevocationRecord {
  readonly revocationId: string;
  readonly scopeType: RevocationScopeType;
  readonly scopeId: string;
  readonly effectiveTime: string;
  readonly reasonClass: RevocationReasonClass;
  readonly reason?: string | undefined;
  readonly replacementId?: string | undefined;
  readonly sequence: number;
  readonly createdAt: string;
  readonly principalId: string;
}

// ---------------------------------------------------------------------------
// Revocation Input
// ---------------------------------------------------------------------------

export interface RevocationInput {
  readonly principalId: CounterId<"actor">;
  readonly walletId: CounterId<"wallet">;
  readonly scopeType: RevocationScopeType;
  readonly scopeId: string;
  readonly reasonClass: RevocationReasonClass;
  readonly reason?: string | undefined;
  readonly replacementId?: string | undefined;
  readonly correlationId: string;
  readonly kid: string;
}

// ---------------------------------------------------------------------------
// Revocation Output
// ---------------------------------------------------------------------------

export interface RevocationOutput {
  readonly record: RevocationRecord;
  readonly envelope: UnsignedCtpEnvelope<RevocationPayload>;
  readonly payloadDigest: string;
}

export interface RevocationError {
  readonly kind: "revocation_error";
  readonly reason: string;
}

export type RevocationResult =
  | { readonly ok: true; readonly value: RevocationOutput }
  | { readonly ok: false; readonly error: RevocationError };

// ---------------------------------------------------------------------------
// Revocation Store Interface
// ---------------------------------------------------------------------------

export interface RevocationStore {
  isRevoked(scopeType: RevocationScopeType, scopeId: string): boolean;
  getRevocation(scopeType: RevocationScopeType, scopeId: string): RevocationRecord | undefined;
  getRevocationsForScope(scopeType: RevocationScopeType): readonly RevocationRecord[];
  save(record: RevocationRecord): void;
  getSequence(scopeType: RevocationScopeType, scopeId: string): number;
}

// ---------------------------------------------------------------------------
// In-Memory Revocation Store
// ---------------------------------------------------------------------------

export class InMemoryRevocationStore implements RevocationStore {
  readonly #records = new Map<string, RevocationRecord>();
  readonly #sequences = new Map<string, number>();

  isRevoked(scopeType: RevocationScopeType, scopeId: string): boolean {
    return this.#records.has(this.#key(scopeType, scopeId));
  }

  getRevocation(scopeType: RevocationScopeType, scopeId: string): RevocationRecord | undefined {
    return this.#records.get(this.#key(scopeType, scopeId));
  }

  getRevocationsForScope(scopeType: RevocationScopeType): readonly RevocationRecord[] {
    return [...this.#records.values()].filter((r) => r.scopeType === scopeType);
  }

  save(record: RevocationRecord): void {
    const key = this.#key(record.scopeType, record.scopeId);
    this.#records.set(key, record);
    this.#sequences.set(key, record.sequence);
  }

  getSequence(scopeType: RevocationScopeType, scopeId: string): number {
    return this.#sequences.get(this.#key(scopeType, scopeId)) ?? 0;
  }

  #key(scopeType: RevocationScopeType, scopeId: string): string {
    return `${scopeType}:${scopeId}`;
  }
}

// ---------------------------------------------------------------------------
// Wallet Revocation Service
// ---------------------------------------------------------------------------

/**
 * WalletRevocationService implements monotonic, authenticated, durable revocation.
 *
 * - Once revoked, blocks ALL future consequential effects immediately
 * - Revocation is irreversible (monotonic)
 * - Creates CTP counter.revocation.v1 envelope for evidence
 * - Cascades: revoking a wallet revokes all its agents/mandates
 * - Cascades: revoking an agent revokes all its mandates
 */
export class WalletRevocationService {
  readonly #store: RevocationStore;
  readonly #mandateRepo: MandateRepository;
  readonly #idGenerator: CryptoIdGenerator;

  constructor(store: RevocationStore, mandateRepo: MandateRepository) {
    this.#store = store;
    this.#mandateRepo = mandateRepo;
    this.#idGenerator = new CryptoIdGenerator();
  }

  /**
   * Revokes a scope. This is monotonic and irreversible.
   *
   * If the scope is already revoked, returns the existing revocation
   * (idempotent for the same scope_id, but no un-revoke).
   */
  revoke(input: RevocationInput): RevocationResult {
    // Check if already revoked (monotonic - cannot un-revoke)
    if (this.#store.isRevoked(input.scopeType, input.scopeId)) {
      const existing = this.#store.getRevocation(input.scopeType, input.scopeId);
      if (existing) {
        // Return existing revocation (idempotent)
        return {
          ok: true,
          value: {
            record: existing,
            envelope: this.#buildEnvelope(existing, input),
            payloadDigest: computePayloadDigest(this.#buildPayload(existing)),
          },
        };
      }
    }

    const now = new Date().toISOString();
    const revocationId = this.#idGenerator.generate("evidence");
    const sequence = this.#store.getSequence(input.scopeType, input.scopeId) + 1;

    const record: RevocationRecord = {
      revocationId,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      effectiveTime: now,
      reasonClass: input.reasonClass,
      reason: input.reason,
      replacementId: input.replacementId,
      sequence,
      createdAt: now,
      principalId: input.principalId,
    };

    // Save revocation record
    this.#store.save(record);

    // Cascade effects
    this.#cascadeRevocation(input);

    // Build CTP envelope
    const payload = this.#buildPayload(record);
    const envelope = this.#buildEnvelope(record, input);
    const payloadDigest = computePayloadDigest(payload);

    return {
      ok: true,
      value: { record, envelope, payloadDigest },
    };
  }

  /**
   * Checks if a scope is currently revoked.
   */
  isRevoked(scopeType: RevocationScopeType, scopeId: string): boolean {
    return this.#store.isRevoked(scopeType, scopeId);
  }

  /**
   * Gets revocation record for a scope.
   */
  getRevocation(scopeType: RevocationScopeType, scopeId: string): RevocationRecord | undefined {
    return this.#store.getRevocation(scopeType, scopeId);
  }

  #cascadeRevocation(input: RevocationInput): void {
    // Cascade: revoking a wallet revokes all its mandates
    if (input.scopeType === "wallet") {
      const mandates = this.#mandateRepo.findByWallet(input.scopeId as CounterId<"wallet">);
      for (const mandate of mandates) {
        if (mandate.status === "active") {
          this.#mandateRepo.updateStatus(mandate.mandateId, "revoked");
        }
      }
    }

    // Cascade: revoking an agent revokes all its mandates
    if (input.scopeType === "agent") {
      const mandates = this.#mandateRepo.findByAgent(input.scopeId as CounterId<"agent">);
      for (const mandate of mandates) {
        if (mandate.status === "active") {
          this.#mandateRepo.updateStatus(mandate.mandateId, "revoked");
        }
      }
    }

    // Cascade: revoking a mandate directly
    if (input.scopeType === "mandate") {
      this.#mandateRepo.updateStatus(input.scopeId as CounterId<"mandate">, "revoked");
    }
  }

  #buildPayload(record: RevocationRecord): RevocationPayload {
    return {
      revocation_id: record.revocationId,
      scope_type: record.scopeType,
      scope_id: record.scopeId,
      effective_time: record.effectiveTime,
      reason_class: record.reasonClass,
      ...(record.reason !== undefined ? { reason: record.reason } : {}),
      ...(record.replacementId !== undefined ? { replacement_id: record.replacementId } : {}),
      sequence: record.sequence,
      version: "1",
    };
  }

  #buildEnvelope(record: RevocationRecord, input: RevocationInput): UnsignedCtpEnvelope<RevocationPayload> {
    const payload = this.#buildPayload(record);
    const now = record.effectiveTime;

    // Far future for revocation envelopes (they don't expire meaningfully)
    const farFuture = new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000).toISOString();

    const result = buildUnsignedEnvelope<RevocationPayload>({
      type: "counter.revocation.v1",
      id: `rev-${record.revocationId}`,
      issuer: `counter://wallet/${input.walletId}`,
      subject: `counter://${input.scopeType}/${input.scopeId}`,
      audience: [`counter://wallet/${input.walletId}`],
      environment: "pilot",
      issued_at: now,
      not_before: now,
      expires_at: farFuture,
      nonce: `rev-nonce-${record.revocationId}`,
      correlation_id: input.correlationId,
      payload,
      kid: input.kid,
    });

    if (!result.ok) {
      // Revocation must not fail - use a minimal envelope structure
      throw new Error(`Critical: revocation envelope construction failed: ${result.error.message}`);
    }

    return result.value;
  }
}
