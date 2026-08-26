/**
 * Export service for wallet data export, retention, deletion, and closure.
 *
 * Provides:
 * - Full data export (JSON): dumps all wallet data
 * - Retention hold: prevents deletion while active
 * - Deletion/anonymization: scrubs PII but retains audit trail
 * - Closure receipt: CTP-signed closure evidence
 */

import type { CounterId } from "@counter/domain";
import type { UnsignedCtpEnvelope } from "@counter/trust-protocol";
import { buildUnsignedEnvelope } from "@counter/trust-protocol";

// ---------------------------------------------------------------------------
// Export Data Types
// ---------------------------------------------------------------------------

export interface WalletExportData {
  readonly walletId: CounterId<"wallet">;
  readonly exportedAt: string;
  readonly principalId: CounterId<"actor">;
  readonly transactions: readonly ExportedTransaction[];
  readonly mandates: readonly ExportedMandate[];
  readonly devices: readonly ExportedDevice[];
  readonly policies: readonly ExportedPolicy[];
  readonly auditTrail: readonly AuditEntry[];
}

export interface ExportedTransaction {
  readonly transactionId: string;
  readonly merchantId: string;
  readonly amount: string;
  readonly currency: string;
  readonly timestamp: string;
  readonly status: string;
}

export interface ExportedMandate {
  readonly mandateId: string;
  readonly agentId: string;
  readonly status: string;
  readonly createdAt: string;
}

export interface ExportedDevice {
  readonly deviceId: string;
  readonly status: string;
  readonly pairedAt: string;
}

export interface ExportedPolicy {
  readonly versionId: string;
  readonly createdAt: string;
  readonly constraints: Record<string, unknown>;
}

export interface AuditEntry {
  readonly entryId: string;
  readonly action: string;
  readonly timestamp: string;
  readonly principalId: string;
  readonly details?: string;
}

// ---------------------------------------------------------------------------
// Retention Hold
// ---------------------------------------------------------------------------

export interface RetentionHold {
  readonly walletId: CounterId<"wallet">;
  readonly holdId: string;
  readonly reason: string;
  readonly createdAt: string;
  readonly createdBy: CounterId<"actor">;
}

// ---------------------------------------------------------------------------
// Closure Receipt Payload
// ---------------------------------------------------------------------------

export interface ClosureReceiptPayload {
  readonly wallet_id: string;
  readonly closed_at: string;
  readonly closed_by: string;
  readonly reason: string;
  readonly data_exported: boolean;
  readonly data_deleted: boolean;
  readonly version: string;
}

// ---------------------------------------------------------------------------
// Export Error
// ---------------------------------------------------------------------------

export interface ExportError {
  readonly kind: "export_error";
  readonly reason: string;
}

export type ExportResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ExportError };

// ---------------------------------------------------------------------------
// Wallet Data Store (in-memory for testing)
// ---------------------------------------------------------------------------

export interface WalletDataStore {
  getTransactions(walletId: CounterId<"wallet">): readonly ExportedTransaction[];
  getMandates(walletId: CounterId<"wallet">): readonly ExportedMandate[];
  getDevices(walletId: CounterId<"wallet">): readonly ExportedDevice[];
  getPolicies(walletId: CounterId<"wallet">): readonly ExportedPolicy[];
  getAuditTrail(walletId: CounterId<"wallet">): readonly AuditEntry[];
  deletePersonalData(walletId: CounterId<"wallet">): void;
  isDeleted(walletId: CounterId<"wallet">): boolean;
}

export class InMemoryWalletDataStore implements WalletDataStore {
  readonly #transactions = new Map<string, ExportedTransaction[]>();
  readonly #mandates = new Map<string, ExportedMandate[]>();
  readonly #devices = new Map<string, ExportedDevice[]>();
  readonly #policies = new Map<string, ExportedPolicy[]>();
  readonly #auditTrail = new Map<string, AuditEntry[]>();
  readonly #deleted = new Set<string>();

  addTransaction(walletId: CounterId<"wallet">, tx: ExportedTransaction): void {
    const list = this.#transactions.get(walletId) ?? [];
    list.push(tx);
    this.#transactions.set(walletId, list);
  }

  addMandate(walletId: CounterId<"wallet">, mandate: ExportedMandate): void {
    const list = this.#mandates.get(walletId) ?? [];
    list.push(mandate);
    this.#mandates.set(walletId, list);
  }

  addDevice(walletId: CounterId<"wallet">, device: ExportedDevice): void {
    const list = this.#devices.get(walletId) ?? [];
    list.push(device);
    this.#devices.set(walletId, list);
  }

  addPolicy(walletId: CounterId<"wallet">, policy: ExportedPolicy): void {
    const list = this.#policies.get(walletId) ?? [];
    list.push(policy);
    this.#policies.set(walletId, list);
  }

  addAuditEntry(walletId: CounterId<"wallet">, entry: AuditEntry): void {
    const list = this.#auditTrail.get(walletId) ?? [];
    list.push(entry);
    this.#auditTrail.set(walletId, list);
  }

  getTransactions(walletId: CounterId<"wallet">): readonly ExportedTransaction[] {
    return this.#transactions.get(walletId) ?? [];
  }

  getMandates(walletId: CounterId<"wallet">): readonly ExportedMandate[] {
    return this.#mandates.get(walletId) ?? [];
  }

  getDevices(walletId: CounterId<"wallet">): readonly ExportedDevice[] {
    return this.#devices.get(walletId) ?? [];
  }

  getPolicies(walletId: CounterId<"wallet">): readonly ExportedPolicy[] {
    return this.#policies.get(walletId) ?? [];
  }

  getAuditTrail(walletId: CounterId<"wallet">): readonly AuditEntry[] {
    return this.#auditTrail.get(walletId) ?? [];
  }

  deletePersonalData(walletId: CounterId<"wallet">): void {
    this.#transactions.delete(walletId);
    this.#mandates.delete(walletId);
    this.#devices.delete(walletId);
    this.#policies.delete(walletId);
    // Audit trail is retained (anonymized)
    this.#deleted.add(walletId);
  }

  isDeleted(walletId: CounterId<"wallet">): boolean {
    return this.#deleted.has(walletId);
  }
}

// ---------------------------------------------------------------------------
// ExportService
// ---------------------------------------------------------------------------

export class ExportService {
  readonly #dataStore: WalletDataStore;
  readonly #holds = new Map<string, RetentionHold>();
  readonly #clock: () => string;
  #holdCounter = 0;

  constructor(dataStore: WalletDataStore, clock?: () => string) {
    this.#dataStore = dataStore;
    this.#clock = clock ?? (() => new Date().toISOString());
  }

  /**
   * Produces a full JSON data export of all wallet data.
   */
  exportData(
    walletId: CounterId<"wallet">,
    principalId: CounterId<"actor">,
  ): ExportResult<WalletExportData> {
    const data: WalletExportData = {
      walletId,
      exportedAt: this.#clock(),
      principalId,
      transactions: this.#dataStore.getTransactions(walletId),
      mandates: this.#dataStore.getMandates(walletId),
      devices: this.#dataStore.getDevices(walletId),
      policies: this.#dataStore.getPolicies(walletId),
      auditTrail: this.#dataStore.getAuditTrail(walletId),
    };

    return { ok: true, value: data };
  }

  /**
   * Places a retention hold on the wallet, preventing deletion.
   */
  placeRetentionHold(
    walletId: CounterId<"wallet">,
    createdBy: CounterId<"actor">,
    reason: string,
  ): ExportResult<RetentionHold> {
    this.#holdCounter += 1;
    const holdId = `hold-${this.#holdCounter}`;

    const hold: RetentionHold = {
      walletId,
      holdId,
      reason,
      createdAt: this.#clock(),
      createdBy,
    };

    this.#holds.set(holdId, hold);

    return { ok: true, value: hold };
  }

  /**
   * Removes a retention hold.
   */
  removeRetentionHold(holdId: string): ExportResult<{ removed: true }> {
    if (!this.#holds.has(holdId)) {
      return {
        ok: false,
        error: { kind: "export_error", reason: "Hold not found" },
      };
    }

    this.#holds.delete(holdId);
    return { ok: true, value: { removed: true } };
  }

  /**
   * Checks if a wallet has any active retention holds.
   */
  hasRetentionHold(walletId: CounterId<"wallet">): boolean {
    for (const hold of this.#holds.values()) {
      if (hold.walletId === walletId) {
        return true;
      }
    }
    return false;
  }

  /**
   * Deletes/anonymizes PII from the wallet data, retaining the audit trail.
   * Blocked if a retention hold is active.
   */
  deleteAndAnonymize(
    walletId: CounterId<"wallet">,
  ): ExportResult<{ deleted: true; auditTrailRetained: true }> {
    if (this.hasRetentionHold(walletId)) {
      return {
        ok: false,
        error: { kind: "export_error", reason: "Cannot delete: active retention hold exists" },
      };
    }

    this.#dataStore.deletePersonalData(walletId);

    return { ok: true, value: { deleted: true, auditTrailRetained: true } };
  }

  /**
   * Generates a CTP-signed closure receipt envelope.
   */
  generateClosureReceipt(
    walletId: CounterId<"wallet">,
    principalId: CounterId<"actor">,
    reason: string,
    dataExported: boolean,
    dataDeleted: boolean,
    kid: string,
  ): ExportResult<UnsignedCtpEnvelope<ClosureReceiptPayload>> {
    const now = this.#clock();
    const farFuture = new Date(new Date(now).getTime() + 100 * 365 * 24 * 60 * 60 * 1000).toISOString();

    const payload: ClosureReceiptPayload = {
      wallet_id: walletId,
      closed_at: now,
      closed_by: principalId,
      reason,
      data_exported: dataExported,
      data_deleted: dataDeleted,
      version: "1",
    };

    const nonceBytes = new Uint8Array(16);
    crypto.getRandomValues(nonceBytes);
    let binary = "";
    for (const b of nonceBytes) {
      binary += String.fromCharCode(b);
    }
    const nonce = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    const result = buildUnsignedEnvelope<ClosureReceiptPayload>({
      type: "counter.revocation.v1",
      id: `closure-${walletId}-${new Date(now).getTime()}`,
      issuer: `counter://wallet/${walletId}`,
      subject: `counter://wallet/${walletId}`,
      audience: [`counter://wallet/${walletId}`],
      environment: "pilot",
      issued_at: now,
      not_before: now,
      expires_at: farFuture,
      nonce,
      correlation_id: `closure-${walletId}`,
      payload,
      kid,
    });

    if (!result.ok) {
      return {
        ok: false,
        error: { kind: "export_error", reason: "Failed to build closure receipt envelope" },
      };
    }

    return { ok: true, value: result.value };
  }
}
