/**
 * Kill switch evaluation for the checkout orchestrator.
 *
 * Checks merchant, wallet, and global kill switches before finalization.
 * When any kill switch is active, the checkout must not proceed to
 * external effects (Shopify finalization, payment capture, etc.).
 */

import type { Environment, Instant, MerchantId, WalletId } from "@counter/domain";
import type { KillSwitchPort, KillSwitchScope, KillSwitchStatus } from "./checkout-types.js";

// ─── Kill Switch Entry ───────────────────────────────────────────────────────

export interface KillSwitchEntry {
  readonly scope: KillSwitchScope;
  readonly key: string;
  readonly reason: string;
  readonly activatedAt: Instant;
  readonly active: boolean;
}

// ─── Kill Switch Store Interface ─────────────────────────────────────────────

/**
 * Port interface for the underlying kill switch storage.
 */
export interface KillSwitchStore {
  get(scope: KillSwitchScope, key: string): KillSwitchEntry | undefined;
  set(entry: KillSwitchEntry): void;
  remove(scope: KillSwitchScope, key: string): void;
}

// ─── In-Memory Kill Switch Store ─────────────────────────────────────────────

/**
 * In-memory implementation of kill switch storage for test environments.
 */
export class InMemoryKillSwitchStore implements KillSwitchStore {
  readonly #entries: Map<string, KillSwitchEntry>;

  public constructor() {
    this.#entries = new Map();
  }

  public get(scope: KillSwitchScope, key: string): KillSwitchEntry | undefined {
    return this.#entries.get(`${scope}:${key}`);
  }

  public set(entry: KillSwitchEntry): void {
    this.#entries.set(`${entry.scope}:${entry.key}`, entry);
  }

  public remove(scope: KillSwitchScope, key: string): void {
    this.#entries.delete(`${scope}:${key}`);
  }
}

// ─── Kill Switch Evaluator ───────────────────────────────────────────────────

/**
 * Evaluates kill switches for a given wallet, merchant, and environment.
 *
 * Checks in priority order:
 * 1. Global kill switch
 * 2. Merchant-scoped kill switch
 * 3. Wallet-scoped kill switch
 *
 * Returns the first active kill switch found, or inactive status if none.
 */
export class KillSwitchEvaluator implements KillSwitchPort {
  readonly #store: KillSwitchStore;

  public constructor(store: KillSwitchStore) {
    this.#store = store;
  }

  public evaluate(params: {
    readonly walletId: WalletId;
    readonly merchantId: MerchantId;
    readonly environment: Environment;
  }): KillSwitchStatus {
    // 1. Global kill switch
    const globalSwitch = this.#store.get("global", "all");
    if (globalSwitch !== undefined && globalSwitch.active) {
      return Object.freeze({
        active: true,
        scope: "global" as KillSwitchScope,
        reason: globalSwitch.reason,
        activatedAt: globalSwitch.activatedAt,
      });
    }

    // 2. Merchant-scoped kill switch
    const merchantSwitch = this.#store.get("merchant", params.merchantId);
    if (merchantSwitch !== undefined && merchantSwitch.active) {
      return Object.freeze({
        active: true,
        scope: "merchant" as KillSwitchScope,
        reason: merchantSwitch.reason,
        activatedAt: merchantSwitch.activatedAt,
      });
    }

    // 3. Wallet-scoped kill switch
    const walletSwitch = this.#store.get("wallet", params.walletId);
    if (walletSwitch !== undefined && walletSwitch.active) {
      return Object.freeze({
        active: true,
        scope: "wallet" as KillSwitchScope,
        reason: walletSwitch.reason,
        activatedAt: walletSwitch.activatedAt,
      });
    }

    return Object.freeze({ active: false, scope: "global" as KillSwitchScope });
  }
}
