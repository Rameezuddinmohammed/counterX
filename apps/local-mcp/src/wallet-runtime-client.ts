/**
 * Minimal wallet-scoped HTTP client to control-plane-api — Phase 2 of the
 * remote-MCP plan (notifications backbone). Serves notifications.list/
 * invoices.get (tools/read-tools.ts), reading the real
 * GET /control/v1/wallets/:walletId/notifications route
 * (apps/control-plane-api/src/buyer-notification-routes.ts).
 *
 * Deliberately much simpler than HttpMerchantRuntimeClient
 * (@counter/wallet-application): no manifest-verification step (there is
 * no merchant capability manifest to verify for a wallet's own read of its
 * own data), just an authenticated GET with a timeout. Same bearer-token
 * shape as HttpMerchantRuntimeClient — control-plane-api's default JWT
 * audience is the SAME "https://api.counter.dev" resource agent-runtime
 * uses (see apps/control-plane-api/src/index.ts's AUTH_AUDIENCE default),
 * so a wallet's existing COUNTER_RUNTIME_AUTH_TOKEN (main-real.ts) is
 * valid here too, once minted — see that file's own docs for the current,
 * separately-tracked gap in minting one at all.
 */

export interface WalletNotification {
  readonly id: string;
  readonly notificationType: string;
  readonly transactionId: string | undefined;
  readonly payload: unknown;
  readonly createdAt: string;
}

export interface WalletNotificationsResult {
  readonly walletId: string;
  readonly notifications: readonly WalletNotification[];
  readonly total: number;
}

export type WalletClientErrorKind =
  | "network"
  | "timeout"
  | "unauthorized"
  | "server_error"
  | "not_found";

export interface WalletClientError {
  readonly kind: WalletClientErrorKind;
  readonly message: string;
}

export type WalletClientResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: WalletClientError };

export interface WalletRuntimeClient {
  listNotifications(
    walletId: string,
    options?: { readonly limit?: number; readonly notificationType?: string },
  ): Promise<WalletClientResult<WalletNotificationsResult>>;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class HttpWalletRuntimeClient implements WalletRuntimeClient {
  readonly #baseUrl: string;
  readonly #authToken: string;
  readonly #timeoutMs: number;

  constructor(baseUrl: string, authToken: string, timeoutMs = DEFAULT_TIMEOUT_MS) {
    this.#baseUrl = baseUrl;
    this.#authToken = authToken;
    this.#timeoutMs = timeoutMs;
  }

  async listNotifications(
    walletId: string,
    options: { readonly limit?: number; readonly notificationType?: string } = {},
  ): Promise<WalletClientResult<WalletNotificationsResult>> {
    const query = new URLSearchParams();
    if (options.limit !== undefined) query.set("limit", String(options.limit));
    if (options.notificationType !== undefined) query.set("type", options.notificationType);
    const suffix = query.toString().length > 0 ? `?${query.toString()}` : "";
    const url = `${this.#baseUrl}/control/v1/wallets/${encodeURIComponent(walletId)}/notifications${suffix}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${this.#authToken}` },
        signal: controller.signal,
      });

      if (response.status === 401 || response.status === 403) {
        return { ok: false, error: { kind: "unauthorized", message: "Unauthorized" } };
      }
      if (response.status === 404) {
        return { ok: false, error: { kind: "not_found", message: "Wallet not found" } };
      }
      if (!response.ok) {
        return { ok: false, error: { kind: "server_error", message: `HTTP ${response.status}` } };
      }

      const body = (await response.json()) as WalletNotificationsResult;
      return { ok: true, value: body };
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "AbortError") {
        return { ok: false, error: { kind: "timeout", message: "Request timed out" } };
      }
      return { ok: false, error: { kind: "network", message: "Network request failed" } };
    } finally {
      clearTimeout(timer);
    }
  }
}
