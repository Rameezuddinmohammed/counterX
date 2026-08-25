/**
 * Buyer policy repository and version store.
 *
 * Policies are immutable by version - each change creates a new version,
 * never overwriting. Historical versions are always preserved for audit.
 */

import type { CounterId } from "@counter/domain";
import type { BuyerPolicyVersion } from "./buyer-policy.js";

// ---------------------------------------------------------------------------
// Repository Interface
// ---------------------------------------------------------------------------

/**
 * BuyerPolicyRepository: persistence port for buyer policy versions.
 */
export interface BuyerPolicyRepository {
  /**
   * Gets the current (latest) policy version for a wallet.
   */
  getCurrentVersion(walletId: CounterId<"wallet">): BuyerPolicyVersion | undefined;

  /**
   * Gets a specific policy version by its version ID.
   */
  getVersion(versionId: string): BuyerPolicyVersion | undefined;

  /**
   * Gets the full version history for a wallet, ordered newest first.
   */
  getVersionHistory(walletId: CounterId<"wallet">): readonly BuyerPolicyVersion[];

  /**
   * Saves a new policy version. The version must be immutable once saved.
   */
  save(version: BuyerPolicyVersion): void;
}

// ---------------------------------------------------------------------------
// In-Memory Implementation
// ---------------------------------------------------------------------------

/**
 * In-memory implementation of BuyerPolicyRepository.
 * Suitable for testing and pilot environments.
 */
export class InMemoryBuyerPolicyRepository implements BuyerPolicyRepository {
  readonly #versions = new Map<string, BuyerPolicyVersion>();
  readonly #walletVersions = new Map<string, string[]>();

  getCurrentVersion(walletId: CounterId<"wallet">): BuyerPolicyVersion | undefined {
    const history = this.#walletVersions.get(walletId);
    if (!history || history.length === 0) return undefined;
    const latestId = history[history.length - 1];
    if (latestId === undefined) return undefined;
    return this.#versions.get(latestId);
  }

  getVersion(versionId: string): BuyerPolicyVersion | undefined {
    return this.#versions.get(versionId);
  }

  getVersionHistory(walletId: CounterId<"wallet">): readonly BuyerPolicyVersion[] {
    const history = this.#walletVersions.get(walletId);
    if (!history) return [];
    // Newest first
    return history
      .slice()
      .reverse()
      .map((id) => this.#versions.get(id))
      .filter((v): v is BuyerPolicyVersion => v !== undefined);
  }

  save(version: BuyerPolicyVersion): void {
    this.#versions.set(version.versionId, version);
    const existing = this.#walletVersions.get(version.walletId);
    if (existing) {
      existing.push(version.versionId);
    } else {
      this.#walletVersions.set(version.walletId, [version.versionId]);
    }
  }
}
