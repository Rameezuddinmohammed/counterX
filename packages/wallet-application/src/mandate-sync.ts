/**
 * Mandate sync service.
 *
 * Local fetch/verify/cache of mandates with freshness tracking.
 * Conservative stale behavior: if mandate freshness cannot be verified,
 * deny rather than allow (fail closed).
 */

import type { CounterId } from "@counter/domain";
import type { WalletMandate, MandateRepository } from "@counter/wallet-domain";

// ---------------------------------------------------------------------------
// Freshness Status
// ---------------------------------------------------------------------------

export const FRESHNESS_STATUSES = ["fresh", "stale", "unknown"] as const;

export type FreshnessStatus = (typeof FRESHNESS_STATUSES)[number];

// ---------------------------------------------------------------------------
// Cached Mandate Entry
// ---------------------------------------------------------------------------

export interface CachedMandate {
  readonly mandate: WalletMandate;
  readonly cachedAt: string;
  readonly freshness: FreshnessStatus;
  readonly lastVerifiedAt: string;
}

// ---------------------------------------------------------------------------
// Sync Result
// ---------------------------------------------------------------------------

export interface MandateSyncResult {
  readonly ok: boolean;
  readonly mandate?: WalletMandate | undefined;
  readonly freshness: FreshnessStatus;
  readonly reason?: string | undefined;
}

// ---------------------------------------------------------------------------
// Mandate Sync Service
// ---------------------------------------------------------------------------

/**
 * MandateSyncService provides local fetch/verify/cache of mandates.
 *
 * Conservative behavior: if freshness cannot be verified, deny.
 * Stale mandates are not usable until re-verified.
 */
export class MandateSyncService {
  readonly #repo: MandateRepository;
  readonly #cache = new Map<string, CachedMandate>();
  readonly #maxStalenessMs: number;

  constructor(repo: MandateRepository, maxStalenessMs?: number) {
    this.#repo = repo;
    // Default: 60 seconds staleness threshold
    this.#maxStalenessMs = maxStalenessMs ?? 60_000;
  }

  /**
   * Fetches a mandate with freshness verification.
   * Returns the mandate only if it is fresh and valid.
   * Fails closed: stale or unverifiable mandates are denied.
   */
  async fetchMandate(mandateId: CounterId<"mandate">, now?: string): Promise<MandateSyncResult> {
    const currentTime = now ?? new Date().toISOString();

    // Check cache first
    const cached = this.#cache.get(mandateId);
    if (cached) {
      const freshness = this.#assessFreshness(cached, currentTime);
      if (freshness === "fresh") {
        // Verify mandate is still active
        if (cached.mandate.status !== "active") {
          return {
            ok: false,
            freshness: "fresh",
            reason: `Mandate status is '${cached.mandate.status}' - not active`,
          };
        }
        // Check expiry
        if (currentTime >= cached.mandate.validUntil) {
          return {
            ok: false,
            freshness: "fresh",
            reason: "Mandate has expired",
          };
        }
        return { ok: true, mandate: cached.mandate, freshness: "fresh" };
      }
      // Stale - fail closed
      if (freshness === "stale") {
        return {
          ok: false,
          freshness: "stale",
          reason: "Mandate freshness cannot be verified (cache is stale) - denied for safety",
        };
      }
    }

    // No cache - fetch from repository
    const mandate = await this.#repo.findById(mandateId);
    if (!mandate) {
      return {
        ok: false,
        freshness: "unknown",
        reason: "Mandate not found",
      };
    }

    // Verify status
    if (mandate.status !== "active") {
      return {
        ok: false,
        freshness: "fresh",
        reason: `Mandate status is '${mandate.status}' - not active`,
      };
    }

    // Check expiry
    if (currentTime >= mandate.validUntil) {
      return {
        ok: false,
        freshness: "fresh",
        reason: "Mandate has expired",
      };
    }

    // Cache the result
    this.#cache.set(mandateId, {
      mandate,
      cachedAt: currentTime,
      freshness: "fresh",
      lastVerifiedAt: currentTime,
    });

    return { ok: true, mandate, freshness: "fresh" };
  }

  /**
   * Invalidates the cache entry for a specific mandate.
   * Called when a revocation is received.
   */
  invalidate(mandateId: CounterId<"mandate">): void {
    this.#cache.delete(mandateId);
  }

  /**
   * Invalidates all cache entries for a wallet.
   */
  invalidateWallet(walletId: CounterId<"wallet">): void {
    for (const [id, cached] of this.#cache) {
      if (cached.mandate.walletId === walletId) {
        this.#cache.delete(id);
      }
    }
  }

  /**
   * Refreshes a cached mandate from the repository.
   */
  async refresh(mandateId: CounterId<"mandate">, now?: string): Promise<MandateSyncResult> {
    this.#cache.delete(mandateId);
    return this.fetchMandate(mandateId, now);
  }

  #assessFreshness(cached: CachedMandate, currentTime: string): FreshnessStatus {
    const lastVerified = new Date(cached.lastVerifiedAt).getTime();
    const current = new Date(currentTime).getTime();

    if (Number.isNaN(lastVerified) || Number.isNaN(current)) {
      return "unknown";
    }

    const ageMs = current - lastVerified;
    if (ageMs <= this.#maxStalenessMs) {
      return "fresh";
    }

    return "stale";
  }
}
