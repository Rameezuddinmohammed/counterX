import { describe, expect, it } from "vitest";
import { ExportService, InMemoryWalletDataStore } from "./export-service.js";
import type { CounterId } from "@counter/domain";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WALLET_ID = "wlt-export-001" as CounterId<"wallet">;
const PRINCIPAL_ID = "actor-export-001" as CounterId<"actor">;

function createExportService() {
  const dataStore = new InMemoryWalletDataStore();
  const service = new ExportService(dataStore);
  return { service, dataStore };
}

function seedData(dataStore: InMemoryWalletDataStore) {
  dataStore.addTransaction(WALLET_ID, {
    transactionId: "tx-001",
    merchantId: "merchant-001",
    amount: "10000",
    currency: "INR",
    timestamp: "2025-01-01T00:00:00.000Z",
    status: "completed",
  });
  dataStore.addMandate(WALLET_ID, {
    mandateId: "mnd-001",
    agentId: "agent-001",
    status: "active",
    createdAt: "2025-01-01T00:00:00.000Z",
  });
  dataStore.addDevice(WALLET_ID, {
    deviceId: "dev-001",
    status: "paired",
    pairedAt: "2025-01-01T00:00:00.000Z",
  });
  dataStore.addPolicy(WALLET_ID, {
    versionId: "pol-v1",
    createdAt: "2025-01-01T00:00:00.000Z",
    constraints: { maxAmount: 50000 },
  });
  dataStore.addAuditEntry(WALLET_ID, {
    entryId: "audit-001",
    action: "wallet_created",
    timestamp: "2025-01-01T00:00:00.000Z",
    principalId: PRINCIPAL_ID,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ExportService", () => {
  describe("data export", () => {
    it("produces complete JSON data dump", () => {
      const { service, dataStore } = createExportService();
      seedData(dataStore);

      const result = service.exportData(WALLET_ID, PRINCIPAL_ID);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.walletId).toBe(WALLET_ID);
        expect(result.value.principalId).toBe(PRINCIPAL_ID);
        expect(result.value.exportedAt).toBeTruthy();
        expect(result.value.transactions).toHaveLength(1);
        expect(result.value.transactions[0]!.transactionId).toBe("tx-001");
        expect(result.value.mandates).toHaveLength(1);
        expect(result.value.devices).toHaveLength(1);
        expect(result.value.policies).toHaveLength(1);
        expect(result.value.auditTrail).toHaveLength(1);
      }
    });

    it("returns empty arrays for wallet with no data", () => {
      const { service } = createExportService();

      const result = service.exportData(WALLET_ID, PRINCIPAL_ID);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.transactions).toHaveLength(0);
        expect(result.value.mandates).toHaveLength(0);
      }
    });
  });

  describe("retention hold", () => {
    it("places a retention hold on the wallet", () => {
      const { service } = createExportService();

      const result = service.placeRetentionHold(WALLET_ID, PRINCIPAL_ID, "Legal requirement");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.walletId).toBe(WALLET_ID);
        expect(result.value.reason).toBe("Legal requirement");
        expect(result.value.holdId).toBeTruthy();
      }
      expect(service.hasRetentionHold(WALLET_ID)).toBe(true);
    });

    it("prevents deletion when hold is active", () => {
      const { service, dataStore } = createExportService();
      seedData(dataStore);

      service.placeRetentionHold(WALLET_ID, PRINCIPAL_ID, "Legal hold");
      const result = service.deleteAndAnonymize(WALLET_ID);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.reason).toContain("active retention hold");
      }
    });

    it("allows deletion after hold is removed", () => {
      const { service, dataStore } = createExportService();
      seedData(dataStore);

      const holdResult = service.placeRetentionHold(WALLET_ID, PRINCIPAL_ID, "Temp hold");
      expect(holdResult.ok).toBe(true);
      if (holdResult.ok) {
        service.removeRetentionHold(holdResult.value.holdId);
      }

      const deleteResult = service.deleteAndAnonymize(WALLET_ID);
      expect(deleteResult.ok).toBe(true);
    });

    it("returns error when removing non-existent hold", () => {
      const { service } = createExportService();

      const result = service.removeRetentionHold("nonexistent-hold");
      expect(result.ok).toBe(false);
    });
  });

  describe("deletion/anonymization", () => {
    it("scrubs PII but retains audit trail", () => {
      const { service, dataStore } = createExportService();
      seedData(dataStore);

      const result = service.deleteAndAnonymize(WALLET_ID);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.deleted).toBe(true);
        expect(result.value.auditTrailRetained).toBe(true);
      }

      // PII is gone
      expect(dataStore.getTransactions(WALLET_ID)).toHaveLength(0);
      expect(dataStore.getMandates(WALLET_ID)).toHaveLength(0);
      expect(dataStore.getDevices(WALLET_ID)).toHaveLength(0);
      expect(dataStore.getPolicies(WALLET_ID)).toHaveLength(0);

      // Audit trail still present
      expect(dataStore.getAuditTrail(WALLET_ID)).toHaveLength(1);
      expect(dataStore.isDeleted(WALLET_ID)).toBe(true);
    });
  });

  describe("closure receipt", () => {
    it("generates CTP-signed closure receipt envelope", () => {
      const { service } = createExportService();

      const result = service.generateClosureReceipt(
        WALLET_ID,
        PRINCIPAL_ID,
        "User requested closure",
        true,
        true,
        "test-kid-001",
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        const envelope = result.value;
        expect(envelope.type).toBe("counter.revocation.v1");
        expect(envelope.issuer).toContain(WALLET_ID);
        expect(envelope.payload.wallet_id).toBe(WALLET_ID);
        expect(envelope.payload.closed_by).toBe(PRINCIPAL_ID);
        expect(envelope.payload.reason).toBe("User requested closure");
        expect(envelope.payload.data_exported).toBe(true);
        expect(envelope.payload.data_deleted).toBe(true);
        expect(envelope.payload.version).toBe("1");
      }
    });
  });
});
