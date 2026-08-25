/**
 * Wallet client module providing typed access to wallet application services.
 *
 * This module provides a typed client interface for the wallet console to
 * interact with wallet application services. In production, these would
 * call the control-plane-api or agent-runtime. For the pilot console,
 * they return structured data suitable for rendering.
 */

// ---------------------------------------------------------------------------
// Wallet Status
// ---------------------------------------------------------------------------

export type WalletStatus = "active" | "locked" | "suspended" | "closed";

export interface WalletOverview {
  readonly walletId: string;
  readonly status: WalletStatus;
  readonly createdAt: string;
  readonly deviceCount: number;
  readonly activeMandates: number;
  readonly pendingApprovals: number;
  readonly recentTransactions: number;
}

// ---------------------------------------------------------------------------
// Client Error
// ---------------------------------------------------------------------------

export interface WalletClientError {
  readonly kind: "client_error";
  readonly reason: string;
}

export type ClientResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: WalletClientError };

// ---------------------------------------------------------------------------
// Wallet Client
// ---------------------------------------------------------------------------

export interface WalletClient {
  getOverview(walletId: string): ClientResult<WalletOverview>;
  getStatus(walletId: string): ClientResult<WalletStatus>;
}

// ---------------------------------------------------------------------------
// Mock Wallet Client (for pilot console rendering)
// ---------------------------------------------------------------------------

export class MockWalletClient implements WalletClient {
  readonly #overviews = new Map<string, WalletOverview>();

  /**
   * Seeds a wallet overview for testing/rendering.
   */
  seed(overview: WalletOverview): void {
    this.#overviews.set(overview.walletId, overview);
  }

  getOverview(walletId: string): ClientResult<WalletOverview> {
    const overview = this.#overviews.get(walletId);
    if (!overview) {
      return {
        ok: false,
        error: { kind: "client_error", reason: `Wallet ${walletId} not found` },
      };
    }
    return { ok: true, value: overview };
  }

  getStatus(walletId: string): ClientResult<WalletStatus> {
    const overview = this.#overviews.get(walletId);
    if (!overview) {
      return {
        ok: false,
        error: { kind: "client_error", reason: `Wallet ${walletId} not found` },
      };
    }
    return { ok: true, value: overview.status };
  }
}

/**
 * Creates a default mock wallet client pre-seeded with pilot data.
 */
export function createPilotWalletClient(): MockWalletClient {
  const client = new MockWalletClient();
  client.seed({
    walletId: "wlt-pilot-001",
    status: "active",
    createdAt: "2025-01-01T00:00:00.000Z",
    deviceCount: 2,
    activeMandates: 3,
    pendingApprovals: 1,
    recentTransactions: 12,
  });
  return client;
}
