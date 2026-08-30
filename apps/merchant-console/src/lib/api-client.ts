/**
 * Typed API client for the Merchant Console.
 *
 * This module defines the port interface for communicating with the
 * control-plane-api. The actual HTTP transport is injected at runtime;
 * tests supply a mock implementation. This follows the port/adapter pattern
 * used throughout the Counter codebase.
 */

import type {
  AuditEntry,
  BusinessBasicsRequest,
  Finding,
  InvitationStatus,
  KillSwitchState,
  ManifestStatus,
  ManualCatalogItem,
  ManualCatalogItemRequest,
  MappingPreview,
  MerchantApplicationStatus,
  MerchantPolicyConfig,
  PolicySimulationResult,
  ProvisionMerchantApplicationResponse,
  RazorpayConnectRequest,
  RazorpayStatus,
  ReadinessStatus,
  ShopifyConnectionStatus,
  ShopifySetupStatus,
  SuspensionStatus,
  Transaction,
  WizardManifest,
  WizardPaymentConnectionStatus,
  WizardReadinessSummary,
} from "./types.js";

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "RATE_LIMITED"
  | "SERVER_ERROR"
  | "NETWORK_ERROR";

export interface ApiError {
  readonly code: ApiErrorCode;
  readonly message: string;
  readonly retryable: boolean;
}

export type ApiResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: ApiError };

// ---------------------------------------------------------------------------
// Auth token management
// ---------------------------------------------------------------------------

export interface AuthTokenProvider {
  /** Returns the current bearer token, refreshing if necessary. */
  getToken(): Promise<string>;
  /** Invalidates the current token (e.g., on 401). */
  invalidate(): void;
}

// ---------------------------------------------------------------------------
// Request/Response types
// ---------------------------------------------------------------------------

export interface AcceptInvitationRequest {
  readonly merchantId: string;
  readonly acceptedBy: string;
}

export interface RunPolicySimulationRequest {
  readonly merchantId: string;
  readonly scenarioName: string;
  readonly parameters?: Record<string, unknown>;
}

export interface RunReadinessCheckRequest {
  readonly merchantId: string;
  readonly scenarioId?: string;
}

export interface ActivateManifestRequest {
  readonly merchantId: string;
  readonly manifestId: string;
}

export interface ToggleKillSwitchRequest {
  readonly switchId: string;
  readonly active: boolean;
  readonly reason: string;
  readonly actorId: string;
}

export interface SuspendMerchantRequest {
  readonly merchantId: string;
  readonly reason: string;
  readonly actorId: string;
}

export interface InitiateOffboardingRequest {
  readonly merchantId: string;
  readonly actorId: string;
}

export interface ExportAuditRequest {
  readonly merchantId: string;
  readonly fromDate: string;
  readonly toDate: string;
  readonly format: "json" | "csv";
}

export interface ListOptions {
  readonly limit?: number;
  readonly offset?: number;
}

// ---------------------------------------------------------------------------
// MerchantApiClient port interface
// ---------------------------------------------------------------------------

/**
 * Port interface for the merchant console API client.
 *
 * Implementations handle the actual HTTP transport and error mapping.
 * The console screens depend only on this interface.
 */
export interface MerchantApiClient {
  // Invitation & Lifecycle
  getInvitation(merchantId: string): Promise<ApiResult<InvitationStatus>>;
  acceptInvitation(req: AcceptInvitationRequest): Promise<ApiResult<InvitationStatus>>;

  // Merchant Application (REAL self-serve onboarding wizard, Steps 0-2)
  /** POST /merchant-applications/provision — idempotent, self-authorizing (see the route's own header). */
  provisionMerchantApplication(): Promise<ApiResult<ProvisionMerchantApplicationResponse>>;
  getMerchantApplication(merchantId: string): Promise<ApiResult<MerchantApplicationStatus>>;
  updateBusinessBasics(
    merchantId: string,
    req: BusinessBasicsRequest,
  ): Promise<ApiResult<MerchantApplicationStatus>>;
  listManualCatalogItems(merchantId: string): Promise<ApiResult<readonly ManualCatalogItem[]>>;
  addManualCatalogItem(
    merchantId: string,
    req: ManualCatalogItemRequest,
  ): Promise<ApiResult<ManualCatalogItem>>;
  markCatalogConnected(merchantId: string): Promise<ApiResult<MerchantApplicationStatus>>;
  /** Step 3: catalog review confirmation (MAPPING -> VERIFYING). See merchant-application-store.ts's confirmCatalog docs. */
  confirmCatalog(merchantId: string): Promise<ApiResult<MerchantApplicationStatus>>;

  // Step 4: own-gateway Razorpay payment connect. See merchant-payment-connection-store.ts's scope disclosure.
  connectRazorpay(
    merchantId: string,
    req: RazorpayConnectRequest,
  ): Promise<ApiResult<WizardPaymentConnectionStatus>>;
  getRazorpayConnection(merchantId: string): Promise<ApiResult<WizardPaymentConnectionStatus>>;

  // Step 5: readiness check (auto-transitions VERIFYING -> SANDBOX_READY when ready).
  getWizardReadiness(merchantId: string): Promise<ApiResult<WizardReadinessSummary>>;

  // Step 6: manifest confirmation.
  confirmWizardManifest(merchantId: string): Promise<ApiResult<WizardManifest>>;
  getWizardManifest(merchantId: string): Promise<ApiResult<WizardManifest>>;

  // Shopify Setup
  getShopifyStatus(merchantId: string): Promise<ApiResult<ShopifySetupStatus>>;
  /** The REAL self-serve OAuth connection status — see ShopifyConnectionStatus's docs. */
  getShopifyConnectionStatus(merchantId: string): Promise<ApiResult<ShopifyConnectionStatus>>;

  // Mapping
  getMappingPreview(merchantId: string): Promise<ApiResult<MappingPreview>>;

  // Policy Simulation
  runPolicySimulation(req: RunPolicySimulationRequest): Promise<ApiResult<PolicySimulationResult>>;
  getLastSimulation(merchantId: string): Promise<ApiResult<PolicySimulationResult | null>>;

  // Policy Configuration (real backend — GET /merchants/:merchantId/policy).
  // Returns null (not an error) when the merchant has no policy configured
  // yet, mirroring control-plane-api's 404 "No policy configured" response.
  getPolicyConfig(merchantId: string): Promise<ApiResult<MerchantPolicyConfig | null>>;

  // Razorpay
  getRazorpayStatus(merchantId: string): Promise<ApiResult<RazorpayStatus>>;

  // Readiness
  getReadinessStatus(merchantId: string): Promise<ApiResult<ReadinessStatus>>;
  runReadinessCheck(req: RunReadinessCheckRequest): Promise<ApiResult<ReadinessStatus>>;

  // Manifest
  getManifestStatus(merchantId: string): Promise<ApiResult<ManifestStatus>>;
  activateManifest(req: ActivateManifestRequest): Promise<ApiResult<ManifestStatus>>;

  // Transactions
  listTransactions(
    merchantId: string,
    opts?: ListOptions,
  ): Promise<ApiResult<readonly Transaction[]>>;
  getTransaction(transactionId: string): Promise<ApiResult<Transaction>>;

  // Findings
  listFindings(merchantId: string, opts?: ListOptions): Promise<ApiResult<readonly Finding[]>>;

  // Kill Switches
  listKillSwitches(merchantId: string): Promise<ApiResult<readonly KillSwitchState[]>>;
  toggleKillSwitch(req: ToggleKillSwitchRequest): Promise<ApiResult<KillSwitchState>>;

  // Audit
  listAuditEntries(
    merchantId: string,
    opts?: ListOptions,
  ): Promise<ApiResult<readonly AuditEntry[]>>;
  exportAudit(req: ExportAuditRequest): Promise<ApiResult<{ readonly downloadUrl: string }>>;

  // Suspension & Offboarding
  getSuspensionStatus(merchantId: string): Promise<ApiResult<SuspensionStatus>>;
  suspendMerchant(req: SuspendMerchantRequest): Promise<ApiResult<SuspensionStatus>>;
  initiateOffboarding(req: InitiateOffboardingRequest): Promise<ApiResult<SuspensionStatus>>;
}

// ---------------------------------------------------------------------------
// Factory for creating API client (runtime injection point)
// ---------------------------------------------------------------------------

export interface ApiClientConfig {
  readonly baseUrl: string;
  readonly tokenProvider: AuthTokenProvider;
  readonly timeout?: number;
}

/**
 * Creates a concrete MerchantApiClient.
 *
 * In production this uses fetch against the control-plane-api.
 * In tests, inject a mock implementation directly.
 */
export function createApiClient(config: ApiClientConfig): MerchantApiClient {
  const { baseUrl, tokenProvider, timeout = 30_000 } = config;

  async function request<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
    try {
      const token = await tokenProvider.getToken();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: body ? JSON.stringify(body) : null,
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (response.status === 401) {
        tokenProvider.invalidate();
        return {
          ok: false,
          error: { code: "UNAUTHORIZED", message: "Token expired or invalid", retryable: true },
        };
      }
      if (response.status === 403) {
        return {
          ok: false,
          error: { code: "FORBIDDEN", message: "Access denied", retryable: false },
        };
      }
      if (response.status === 404) {
        return {
          ok: false,
          error: { code: "NOT_FOUND", message: "Resource not found", retryable: false },
        };
      }
      if (response.status === 429) {
        return {
          ok: false,
          error: { code: "RATE_LIMITED", message: "Too many requests", retryable: true },
        };
      }
      if (!response.ok) {
        return {
          ok: false,
          error: {
            code: "SERVER_ERROR",
            message: `HTTP ${response.status}`,
            retryable: response.status >= 500,
          },
        };
      }

      const data = (await response.json()) as T;
      return { ok: true, data };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown network error";
      return { ok: false, error: { code: "NETWORK_ERROR", message, retryable: true } };
    }
  }

  const client: MerchantApiClient = {
    getInvitation: (merchantId) =>
      request<InvitationStatus>("GET", `/merchants/${merchantId}/invitation`),
    acceptInvitation: (req) =>
      request<InvitationStatus>("POST", `/merchants/${req.merchantId}/invitation/accept`, req),
    provisionMerchantApplication: () =>
      request<ProvisionMerchantApplicationResponse>("POST", `/merchant-applications/provision`),
    getMerchantApplication: (merchantId) =>
      request<MerchantApplicationStatus>("GET", `/merchant-applications/${merchantId}`),
    updateBusinessBasics: (merchantId, req) =>
      request<MerchantApplicationStatus>(
        "PATCH",
        `/merchant-applications/${merchantId}/business-basics`,
        req,
      ),
    listManualCatalogItems: async (merchantId) => {
      const result = await request<{ readonly items: readonly ManualCatalogItem[] }>(
        "GET",
        `/merchant-applications/${merchantId}/manual-catalog-items`,
      );
      if (!result.ok) return result;
      return { ok: true, data: result.data.items };
    },
    addManualCatalogItem: (merchantId, req) =>
      request<ManualCatalogItem>(
        "POST",
        `/merchant-applications/${merchantId}/manual-catalog-items`,
        req,
      ),
    markCatalogConnected: (merchantId) =>
      request<MerchantApplicationStatus>(
        "POST",
        `/merchant-applications/${merchantId}/catalog-connected`,
      ),
    confirmCatalog: (merchantId) =>
      request<MerchantApplicationStatus>(
        "POST",
        `/merchant-applications/${merchantId}/catalog/confirm`,
      ),
    connectRazorpay: (merchantId, req) =>
      request<WizardPaymentConnectionStatus>(
        "POST",
        `/merchant-applications/${merchantId}/payment-connection`,
        req,
      ),
    getRazorpayConnection: (merchantId) =>
      request<WizardPaymentConnectionStatus>(
        "GET",
        `/merchant-applications/${merchantId}/payment-connection`,
      ),
    getWizardReadiness: (merchantId) =>
      request<WizardReadinessSummary>("GET", `/merchant-applications/${merchantId}/readiness`),
    confirmWizardManifest: (merchantId) =>
      request<WizardManifest>("POST", `/merchant-applications/${merchantId}/manifest`),
    getWizardManifest: (merchantId) =>
      request<WizardManifest>("GET", `/merchant-applications/${merchantId}/manifest`),
    getShopifyStatus: (merchantId) =>
      request<ShopifySetupStatus>("GET", `/merchants/${merchantId}/shopify`),
    getShopifyConnectionStatus: (merchantId) =>
      request<ShopifyConnectionStatus>("GET", `/merchants/${merchantId}/shopify/connection`),
    getMappingPreview: (merchantId) =>
      request<MappingPreview>("GET", `/merchants/${merchantId}/mapping`),
    runPolicySimulation: (req) =>
      request<PolicySimulationResult>("POST", `/merchants/${req.merchantId}/policy/simulate`, req),
    getLastSimulation: (merchantId) =>
      request<PolicySimulationResult | null>("GET", `/merchants/${merchantId}/policy/simulation`),
    getPolicyConfig: async (merchantId) => {
      const result = await request<{
        readonly merchantId: string;
        readonly policy: MerchantPolicyConfig;
        readonly correlationId: string;
      }>("GET", `/merchants/${merchantId}/policy`);
      if (!result.ok) {
        // No policy configured yet is an expected, non-error state — not a
        // failure the UI should surface as "could not load".
        if (result.error.code === "NOT_FOUND") {
          return { ok: true, data: null };
        }
        return result;
      }
      return { ok: true, data: result.data.policy };
    },
    getRazorpayStatus: (merchantId) =>
      request<RazorpayStatus>("GET", `/merchants/${merchantId}/razorpay`),
    getReadinessStatus: (merchantId) =>
      request<ReadinessStatus>("GET", `/merchants/${merchantId}/readiness`),
    runReadinessCheck: (req) =>
      request<ReadinessStatus>("POST", `/merchants/${req.merchantId}/readiness/run`, req),
    getManifestStatus: (merchantId) =>
      request<ManifestStatus>("GET", `/merchants/${merchantId}/manifest`),
    activateManifest: (req) =>
      request<ManifestStatus>("POST", `/merchants/${req.manifestId}/activate`, req),
    listTransactions: (merchantId, opts) =>
      request<readonly Transaction[]>(
        "GET",
        `/merchants/${merchantId}/transactions?limit=${opts?.limit ?? 50}&offset=${opts?.offset ?? 0}`,
      ),
    getTransaction: (transactionId) =>
      request<Transaction>("GET", `/transactions/${transactionId}`),
    listFindings: (merchantId, opts) =>
      request<readonly Finding[]>(
        "GET",
        `/merchants/${merchantId}/findings?limit=${opts?.limit ?? 50}&offset=${opts?.offset ?? 0}`,
      ),
    listKillSwitches: (merchantId) =>
      request<readonly KillSwitchState[]>("GET", `/merchants/${merchantId}/killswitches`),
    toggleKillSwitch: (req) =>
      request<KillSwitchState>("POST", `/killswitches/${req.switchId}/toggle`, req),
    listAuditEntries: (merchantId, opts) =>
      request<readonly AuditEntry[]>(
        "GET",
        `/merchants/${merchantId}/audit?limit=${opts?.limit ?? 100}&offset=${opts?.offset ?? 0}`,
      ),
    exportAudit: (req) =>
      request<{ readonly downloadUrl: string }>(
        "POST",
        `/merchants/${req.merchantId}/audit/export`,
        req,
      ),
    getSuspensionStatus: (merchantId) =>
      request<SuspensionStatus>("GET", `/merchants/${merchantId}/suspension`),
    suspendMerchant: (req) =>
      request<SuspensionStatus>("POST", `/merchants/${req.merchantId}/suspend`, req),
    initiateOffboarding: (req) =>
      request<SuspensionStatus>("POST", `/merchants/${req.merchantId}/offboard`, req),
  };

  return Object.freeze(client);
}
