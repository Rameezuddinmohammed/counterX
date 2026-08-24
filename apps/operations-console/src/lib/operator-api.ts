/**
 * Merchant-scoped operator API types and extended client.
 *
 * Provides typed interfaces for merchant operations available to
 * platform operators through the operations console.
 * All implementations are stubs returning frozen empty/mock data.
 */

// ─── Types ─────────────────────────────────────────────────────────────────────

/**
 * Transaction status within the operator view.
 */
export type TransactionStatus =
  | "pending"
  | "authorized"
  | "captured"
  | "voided"
  | "refunded"
  | "failed"
  | "retrying";

/**
 * Operator-facing transaction summary.
 */
export interface MerchantTransaction {
  readonly id: string;
  readonly merchantId: string;
  readonly amount: number;
  readonly currency: string;
  readonly status: TransactionStatus;
  readonly providerId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly errorCode?: string;
  readonly errorMessage?: string;
}

/**
 * Detailed transaction view for operator drill-down.
 */
export interface TransactionDetail {
  readonly id: string;
  readonly merchantId: string;
  readonly amount: number;
  readonly currency: string;
  readonly status: TransactionStatus;
  readonly providerId: string;
  readonly providerReference?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly attempts: number;
  readonly lastAttemptAt?: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly auditTrail: readonly AuditEntry[];
}

/**
 * An audit log entry for a transaction or merchant action.
 */
export interface AuditEntry {
  readonly timestamp: string;
  readonly action: string;
  readonly operatorId: string;
  readonly detail: string;
}

/**
 * Filters for listing merchant transactions.
 */
export interface TransactionFilters {
  readonly status?: TransactionStatus;
  readonly from?: string;
  readonly to?: string;
  readonly minAmount?: number;
  readonly maxAmount?: number;
  readonly providerId?: string;
}

/**
 * Support access grant configuration.
 */
export interface SupportAccessConfig {
  readonly operatorId: string;
  readonly permissions: readonly string[];
  readonly reason: string;
  readonly durationMinutes: number;
}

/**
 * Date range for audit log exports.
 */
export interface DateRange {
  readonly from: string;
  readonly to: string;
}

/**
 * Result of an operator action.
 */
export interface OperatorActionResult {
  readonly success: boolean;
  readonly message: string;
  readonly timestamp: string;
}

/**
 * Exported audit log entries.
 */
export interface AuditLogExport {
  readonly merchantId: string;
  readonly dateRange: DateRange;
  readonly entries: readonly AuditEntry[];
  readonly exportedAt: string;
}

// ─── Client Interface ───────────────────────────────────────────────────────────

/**
 * Merchant-scoped operator API client interface.
 */
export interface MerchantOperatorApi {
  listMerchantTransactions(
    merchantId: string,
    filters?: TransactionFilters,
  ): Promise<readonly MerchantTransaction[]>;
  getTransactionDetail(txId: string): Promise<TransactionDetail | null>;
  retryTransaction(txId: string): Promise<OperatorActionResult>;
  voidTransaction(txId: string): Promise<OperatorActionResult>;
  issueRefund(txId: string, amount: number): Promise<OperatorActionResult>;
  suspendMerchant(merchantId: string, reason: string): Promise<OperatorActionResult>;
  grantSupportAccess(
    merchantId: string,
    grantConfig: SupportAccessConfig,
  ): Promise<OperatorActionResult>;
  exportAuditLog(merchantId: string, dateRange: DateRange): Promise<AuditLogExport>;
}

// ─── Stub Implementation ────────────────────────────────────────────────────────

function makeActionResult(message: string): OperatorActionResult {
  return Object.freeze({
    success: true,
    message,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Creates a stub merchant operator API client.
 * Replace with real HTTP calls when control-plane-api endpoints are available.
 */
export function createMerchantOperatorApi(): MerchantOperatorApi {
  return Object.freeze({
    listMerchantTransactions(
      _merchantId: string,
      _filters?: TransactionFilters,
    ): Promise<readonly MerchantTransaction[]> {
      return Promise.resolve(Object.freeze([]));
    },

    getTransactionDetail(_txId: string): Promise<TransactionDetail | null> {
      return Promise.resolve(null);
    },

    retryTransaction(_txId: string): Promise<OperatorActionResult> {
      return Promise.resolve(makeActionResult("Transaction retry initiated"));
    },

    voidTransaction(_txId: string): Promise<OperatorActionResult> {
      return Promise.resolve(makeActionResult("Transaction voided"));
    },

    issueRefund(_txId: string, _amount: number): Promise<OperatorActionResult> {
      return Promise.resolve(makeActionResult("Refund issued"));
    },

    suspendMerchant(_merchantId: string, _reason: string): Promise<OperatorActionResult> {
      return Promise.resolve(makeActionResult("Merchant suspended"));
    },

    grantSupportAccess(
      _merchantId: string,
      _grantConfig: SupportAccessConfig,
    ): Promise<OperatorActionResult> {
      return Promise.resolve(makeActionResult("Support access granted"));
    },

    exportAuditLog(merchantId: string, dateRange: DateRange): Promise<AuditLogExport> {
      return Promise.resolve(
        Object.freeze({
          merchantId,
          dateRange: Object.freeze(dateRange),
          entries: Object.freeze([]),
          exportedAt: new Date().toISOString(),
        }),
      );
    },
  });
}
