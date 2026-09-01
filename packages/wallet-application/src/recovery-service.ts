/**
 * Recovery service for wallet disaster recovery operations.
 *
 * Provides:
 * - Recovery lock: freezes all wallet operations
 * - Device revocation: revokes paired devices
 * - Key revocation: revokes keys via SecureKeyStore
 * - Mandate revocation: revokes active mandates via RevocationService
 * - Re-registration: creates new device pairing + new key generation
 */

import type { CounterId } from "@counter/domain";
import type { SecureKeyStore, GeneratedKeyResult } from "@counter/wallet-domain";
import type { WalletRevocationService } from "./revocation-service.js";
import type { PairingService } from "./device-pairing.js";
import type { PairingRequest } from "./device-pairing.js";

// ---------------------------------------------------------------------------
// Recovery Lock State
// ---------------------------------------------------------------------------

export interface RecoveryLockRecord {
  readonly walletId: CounterId<"wallet">;
  readonly lockedAt: string;
  readonly reason: string;
  readonly principalId: CounterId<"actor">;
}

// ---------------------------------------------------------------------------
// Recovery Error
// ---------------------------------------------------------------------------

export interface RecoveryError {
  readonly kind: "recovery_error";
  readonly reason: string;
}

export type RecoveryResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: RecoveryError };

// ---------------------------------------------------------------------------
// Re-registration Output
// ---------------------------------------------------------------------------

export interface ReRegistrationOutput {
  readonly newKeyId: string;
  readonly newPublicKey: Uint8Array;
  readonly pairingRequest: PairingRequest;
}

// ---------------------------------------------------------------------------
// RecoveryService
// ---------------------------------------------------------------------------

export class RecoveryService {
  readonly #keyStore: SecureKeyStore;
  readonly #revocationService: WalletRevocationService;
  readonly #pairingService: PairingService;
  readonly #locks = new Map<string, RecoveryLockRecord>();
  readonly #clock: () => string;

  constructor(
    keyStore: SecureKeyStore,
    revocationService: WalletRevocationService,
    pairingService: PairingService,
    clock?: () => string,
  ) {
    this.#keyStore = keyStore;
    this.#revocationService = revocationService;
    this.#pairingService = pairingService;
    this.#clock = clock ?? (() => new Date().toISOString());
  }

  /**
   * Activates recovery lock, freezing all wallet operations.
   * Locks the key store and records the lock event.
   */
  activateRecoveryLock(
    walletId: CounterId<"wallet">,
    principalId: CounterId<"actor">,
    reason: string,
  ): RecoveryResult<RecoveryLockRecord> {
    if (this.#locks.has(walletId)) {
      return {
        ok: false,
        error: { kind: "recovery_error", reason: "Wallet is already under recovery lock" },
      };
    }

    // Lock the key store to prevent any signing operations
    this.#keyStore.lockStore();

    const record: RecoveryLockRecord = {
      walletId,
      lockedAt: this.#clock(),
      reason,
      principalId,
    };

    this.#locks.set(walletId, record);

    return { ok: true, value: record };
  }

  /**
   * Checks whether a wallet is currently under recovery lock.
   */
  isLocked(walletId: CounterId<"wallet">): boolean {
    return this.#locks.has(walletId);
  }

  /**
   * Gets the recovery lock record for a wallet.
   */
  getLock(walletId: CounterId<"wallet">): RecoveryLockRecord | undefined {
    return this.#locks.get(walletId);
  }

  /**
   * Revokes a device by revoking the device scope in the revocation service.
   */
  async revokeDevice(
    walletId: CounterId<"wallet">,
    principalId: CounterId<"actor">,
    deviceId: string,
    reason: string,
  ): Promise<RecoveryResult<{ revoked: true }>> {
    const result = await this.#revocationService.revoke({
      principalId,
      walletId,
      scopeType: "agent",
      scopeId: deviceId,
      reasonClass: "security_compromise",
      reason,
      correlationId: `recovery-device-${deviceId}`,
      kid: "recovery-key",
    });

    if (!result.ok) {
      return {
        ok: false,
        error: { kind: "recovery_error", reason: result.error.reason },
      };
    }

    return { ok: true, value: { revoked: true } };
  }

  /**
   * Revokes a key via the SecureKeyStore interface.
   */
  async revokeKey(keyId: string): Promise<RecoveryResult<{ revoked: true }>> {
    try {
      await this.#keyStore.revokeKey(keyId);
      return { ok: true, value: { revoked: true } };
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error revoking key";
      return {
        ok: false,
        error: { kind: "recovery_error", reason: message },
      };
    }
  }

  /**
   * Revokes an active mandate via the revocation service.
   */
  async revokeMandate(
    walletId: CounterId<"wallet">,
    principalId: CounterId<"actor">,
    mandateId: CounterId<"mandate">,
    reason: string,
  ): Promise<RecoveryResult<{ revoked: true }>> {
    const result = await this.#revocationService.revoke({
      principalId,
      walletId,
      scopeType: "mandate",
      scopeId: mandateId,
      reasonClass: "security_compromise",
      reason,
      correlationId: `recovery-mandate-${mandateId}`,
      kid: "recovery-key",
    });

    if (!result.ok) {
      return {
        ok: false,
        error: { kind: "recovery_error", reason: result.error.reason },
      };
    }

    return { ok: true, value: { revoked: true } };
  }

  /**
   * Re-registration flow: generates a new key and creates a new pairing request.
   * This is used after recovery to re-establish a device binding.
   *
   * Requires the key store to be unlocked first (caller provides credential).
   */
  async reRegister(
    walletId: CounterId<"wallet">,
    principalId: CounterId<"actor">,
    credential: string,
  ): Promise<RecoveryResult<ReRegistrationOutput>> {
    // Unlock the key store for re-registration
    try {
      this.#keyStore.unlockStore(credential);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to unlock key store";
      return {
        ok: false,
        error: { kind: "recovery_error", reason: message },
      };
    }

    // Remove the recovery lock
    this.#locks.delete(walletId);

    // Generate a new key pair
    let keyResult: GeneratedKeyResult;
    try {
      keyResult = await this.#keyStore.generateKey("device-signing");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to generate new key";
      return {
        ok: false,
        error: { kind: "recovery_error", reason: message },
      };
    }

    // Create new pairing request for device re-binding
    const pairingRequest = this.#pairingService.createPairingRequest(walletId, principalId);

    return {
      ok: true,
      value: {
        newKeyId: keyResult.keyId,
        newPublicKey: keyResult.publicKey,
        pairingRequest,
      },
    };
  }
}
