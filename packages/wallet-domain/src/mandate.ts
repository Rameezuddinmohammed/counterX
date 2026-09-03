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
  findById(mandateId: CounterId<"mandate">): Promise<WalletMandate | undefined>;
  findByWallet(walletId: CounterId<"wallet">): Promise<readonly WalletMandate[]>;
  findByAgent(agentId: CounterId<"agent">): Promise<readonly WalletMandate[]>;
  findActive(walletId: CounterId<"wallet">): Promise<readonly WalletMandate[]>;
  /**
   * Mandates bound to a given payment-authorization reference (e.g. a
   * RecurringMandateSummary.referenceId) — the join point that lets a
   * revoked provider mandate cascade to every Counter-native mandate issued
   * against it.
   */
  findByPaymentReference(paymentReferenceId: string): Promise<readonly WalletMandate[]>;
  save(mandate: WalletMandate): Promise<void>;
  updateStatus(mandateId: CounterId<"mandate">, status: MandateStatus): Promise<void>;
}

// ---------------------------------------------------------------------------
// In-Memory Mandate Repository
// ---------------------------------------------------------------------------

/**
 * In-memory implementation of MandateRepository.
 */
export class InMemoryMandateRepository implements MandateRepository {
  readonly #mandates = new Map<string, WalletMandate>();

  async findById(mandateId: CounterId<"mandate">): Promise<WalletMandate | undefined> {
    return this.#mandates.get(mandateId);
  }

  async findByWallet(walletId: CounterId<"wallet">): Promise<readonly WalletMandate[]> {
    return [...this.#mandates.values()].filter((m) => m.walletId === walletId);
  }

  async findByAgent(agentId: CounterId<"agent">): Promise<readonly WalletMandate[]> {
    return [...this.#mandates.values()].filter((m) => m.agentId === agentId);
  }

  async findActive(walletId: CounterId<"wallet">): Promise<readonly WalletMandate[]> {
    return [...this.#mandates.values()].filter(
      (m) => m.walletId === walletId && m.status === "active",
    );
  }

  async findByPaymentReference(paymentReferenceId: string): Promise<readonly WalletMandate[]> {
    return [...this.#mandates.values()].filter((m) => m.paymentReferenceId === paymentReferenceId);
  }

  async save(mandate: WalletMandate): Promise<void> {
    this.#mandates.set(mandate.mandateId, mandate);
  }

  async updateStatus(mandateId: CounterId<"mandate">, status: MandateStatus): Promise<void> {
    const existing = this.#mandates.get(mandateId);
    if (existing) {
      this.#mandates.set(mandateId, { ...existing, status });
    }
  }
}
