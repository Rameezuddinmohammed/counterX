/**
 * Mandate domain types for Counter wallet.
 *
 * A Mandate is a CTP signed envelope (counter.mandate.v1) that binds:
 * - A principal (wallet owner) to an agent (MCP)
 * - Specific constraints from the buyer policy
 * - A payment authorization reference
 * - A validity window with revocation support
 *
 * Mandates are issued ONLY from fresh stepped-up consent attestations.
 * They cannot be self-issued by agents or MCPs.
 */

import type { CounterId } from "@counter/domain";
import type { BuyerPolicyConstraints } from "./buyer-policy.js";

// ---------------------------------------------------------------------------
// Mandate Status
// ---------------------------------------------------------------------------

export const MANDATE_STATUSES = ["active", "revoked", "expired"] as const;

export type MandateStatus = (typeof MANDATE_STATUSES)[number];

const mandateStatusSet: ReadonlySet<string> = new Set(MANDATE_STATUSES);

export function isMandateStatus(value: unknown): value is MandateStatus {
  return typeof value === "string" && mandateStatusSet.has(value);
}

// ---------------------------------------------------------------------------
// Wallet Mandate
// ---------------------------------------------------------------------------

/**
 * A mandate binding an agent to act within bounded constraints on behalf
 * of a principal's wallet. References a consent attestation by digest.
 */
export interface WalletMandate {
  readonly mandateId: CounterId<"mandate">;
  readonly walletId: CounterId<"wallet">;
  readonly principalId: CounterId<"actor">;
  readonly agentId: CounterId<"agent">;
  readonly kid: string;
  readonly constraints: BuyerPolicyConstraints;
  readonly paymentReferenceId: string;
  readonly validFrom: string;
  readonly validUntil: string;
  readonly issuedAt: string;
  readonly consentAttestationDigest: string;
  readonly status: MandateStatus;
  readonly revocationLocator: string;
  readonly policyVersionId: string;
}

// ---------------------------------------------------------------------------
// Mandate Repository
// ---------------------------------------------------------------------------

/**
 * Repository port for wallet mandates.
 */
export interface MandateRepository {
  findById(mandateId: CounterId<"mandate">): WalletMandate | undefined;
  findByWallet(walletId: CounterId<"wallet">): readonly WalletMandate[];
  findByAgent(agentId: CounterId<"agent">): readonly WalletMandate[];
  findActive(walletId: CounterId<"wallet">): readonly WalletMandate[];
  save(mandate: WalletMandate): void;
  updateStatus(mandateId: CounterId<"mandate">, status: MandateStatus): void;
}

// ---------------------------------------------------------------------------
// In-Memory Mandate Repository
// ---------------------------------------------------------------------------

/**
 * In-memory implementation of MandateRepository.
 */
export class InMemoryMandateRepository implements MandateRepository {
  readonly #mandates = new Map<string, WalletMandate>();

  findById(mandateId: CounterId<"mandate">): WalletMandate | undefined {
    return this.#mandates.get(mandateId);
  }

  findByWallet(walletId: CounterId<"wallet">): readonly WalletMandate[] {
    return [...this.#mandates.values()].filter((m) => m.walletId === walletId);
  }

  findByAgent(agentId: CounterId<"agent">): readonly WalletMandate[] {
    return [...this.#mandates.values()].filter((m) => m.agentId === agentId);
  }

  findActive(walletId: CounterId<"wallet">): readonly WalletMandate[] {
    return [...this.#mandates.values()].filter(
      (m) => m.walletId === walletId && m.status === "active",
    );
  }

  save(mandate: WalletMandate): void {
    this.#mandates.set(mandate.mandateId, mandate);
  }

  updateStatus(mandateId: CounterId<"mandate">, status: MandateStatus): void {
    const existing = this.#mandates.get(mandateId);
    if (existing) {
      this.#mandates.set(mandateId, { ...existing, status });
    }
  }
}
