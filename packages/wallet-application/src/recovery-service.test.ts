import { describe, expect, it } from "vitest";
import { RecoveryService } from "./recovery-service.js";
import { WalletRevocationService, InMemoryRevocationStore } from "./revocation-service.js";
import { InMemorySecureKeyStore, InMemoryMandateRepository } from "@counter/wallet-domain";
import { PairingService } from "./device-pairing.js";
import type { CounterId } from "@counter/domain";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WALLET_ID = "wlt-test-recovery-001" as CounterId<"wallet">;
const PRINCIPAL_ID = "actor-recovery-001" as CounterId<"actor">;
const DEVICE_ID = "device-001";
const MANDATE_ID = "mnd-test-001" as CounterId<"mandate">;

function createRecoveryService() {
  const keyStore = new InMemorySecureKeyStore("test-credential");
  const revocationStore = new InMemoryRevocationStore();
  const mandateRepo = new InMemoryMandateRepository();
  const revocationService = new WalletRevocationService(revocationStore, mandateRepo);
  const pairingService = new PairingService();

  const service = new RecoveryService(keyStore, revocationService, pairingService);

  return { service, keyStore, revocationStore, mandateRepo, revocationService, pairingService };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RecoveryService", () => {
  describe("recovery lock", () => {
    it("activates recovery lock and freezes operations", () => {
      const { service, keyStore } = createRecoveryService();

      const result = service.activateRecoveryLock(WALLET_ID, PRINCIPAL_ID, "Suspected compromise");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.walletId).toBe(WALLET_ID);
        expect(result.value.principalId).toBe(PRINCIPAL_ID);
        expect(result.value.reason).toBe("Suspected compromise");
        expect(result.value.lockedAt).toBeTruthy();
      }
      expect(service.isLocked(WALLET_ID)).toBe(true);
      expect(keyStore.isLocked()).toBe(true);
    });

    it("prevents double-locking the same wallet", () => {
      const { service } = createRecoveryService();

      service.activateRecoveryLock(WALLET_ID, PRINCIPAL_ID, "First lock");
      const result = service.activateRecoveryLock(WALLET_ID, PRINCIPAL_ID, "Second lock");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.reason).toContain("already under recovery lock");
      }
    });

    it("returns lock record via getLock", () => {
      const { service } = createRecoveryService();

      service.activateRecoveryLock(WALLET_ID, PRINCIPAL_ID, "Test lock");

      const lock = service.getLock(WALLET_ID);
      expect(lock).toBeDefined();
      expect(lock?.walletId).toBe(WALLET_ID);
    });

    it("reports unlocked wallet as not locked", () => {
      const { service } = createRecoveryService();

      expect(service.isLocked(WALLET_ID)).toBe(false);
      expect(service.getLock(WALLET_ID)).toBeUndefined();
    });
  });

  describe("device revocation", () => {
    it("revokes a device via the revocation service", () => {
      const { service, revocationStore } = createRecoveryService();

      const result = service.revokeDevice(WALLET_ID, PRINCIPAL_ID, DEVICE_ID, "Lost device");

      expect(result.ok).toBe(true);
      expect(revocationStore.isRevoked("agent", DEVICE_ID)).toBe(true);
    });
  });

  describe("key revocation", () => {
    it("revokes a key via the key store", async () => {
      const { service, keyStore } = createRecoveryService();

      const generated = await keyStore.generateKey("test-scope");
      const result = await service.revokeKey(generated.keyId);

      expect(result.ok).toBe(true);
      const descriptor = await keyStore.getPublicDescriptor(generated.keyId);
      expect(descriptor?.status).toBe("revoked");
    });

    it("returns error for non-existent key", async () => {
      const { service } = createRecoveryService();

      const result = await service.revokeKey("nonexistent-key");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("recovery_error");
      }
    });
  });

  describe("mandate revocation", () => {
    it("revokes a mandate via the revocation service", () => {
      const { service, revocationStore } = createRecoveryService();

      const result = service.revokeMandate(
        WALLET_ID,
        PRINCIPAL_ID,
        MANDATE_ID,
        "Compromised mandate",
      );

      expect(result.ok).toBe(true);
      expect(revocationStore.isRevoked("mandate", MANDATE_ID)).toBe(true);
    });
  });

  describe("re-registration", () => {
    it("creates new device pairing and key after recovery", async () => {
      const { service } = createRecoveryService();

      // First lock the wallet
      service.activateRecoveryLock(WALLET_ID, PRINCIPAL_ID, "Recovery needed");
      expect(service.isLocked(WALLET_ID)).toBe(true);

      // Re-register with valid credential
      const result = await service.reRegister(WALLET_ID, PRINCIPAL_ID, "test-credential");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.newKeyId).toBeTruthy();
        expect(result.value.newPublicKey).toBeInstanceOf(Uint8Array);
        expect(result.value.newPublicKey.length).toBe(32); // Ed25519 public key
        expect(result.value.pairingRequest.walletId).toBe(WALLET_ID);
        expect(result.value.pairingRequest.principalId).toBe(PRINCIPAL_ID);
        expect(result.value.pairingRequest.status).toBe("pending");
      }

      // Lock should be released
      expect(service.isLocked(WALLET_ID)).toBe(false);
    });

    it("fails re-registration with invalid credential", async () => {
      const { service } = createRecoveryService();

      service.activateRecoveryLock(WALLET_ID, PRINCIPAL_ID, "Recovery needed");

      const result = await service.reRegister(WALLET_ID, PRINCIPAL_ID, "wrong-credential");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("recovery_error");
        expect(result.error.reason).toContain("Invalid credential");
      }
    });
  });
});
