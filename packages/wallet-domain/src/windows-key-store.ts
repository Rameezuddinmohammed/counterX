/**
 * WindowsSecureKeyStore - Windows platform adapter stub.
 *
 * For the pilot phase, this implementation delegates to InMemorySecureKeyStore
 * internally. In production, it will use:
 * - Windows Credential Manager for key metadata storage
 * - DPAPI (Data Protection API) for private key encryption at rest
 * - Optionally Windows Hello / TPM 2.0 for hardware-bound key protection
 *
 * TODO: Production OS-specific implementation:
 * - Replace InMemorySecureKeyStore with native Win32 calls via N-API addon
 * - Use CNG (Cryptography Next Generation) for Ed25519 key generation
 * - Store encrypted private keys in Windows Credential Manager
 * - Bind unlock to Windows Hello authentication
 * - Implement secure memory wiping on lock
 * - Use VirtualLock() to prevent key material from being paged to disk
 */

import type {
  SecureKeyStore,
  PublicKeyDescriptor,
  GeneratedKeyResult,
} from "./secure-key-store.js";
import { InMemorySecureKeyStore } from "./in-memory-key-store.js";

// ---------------------------------------------------------------------------
// WindowsSecureKeyStore
// ---------------------------------------------------------------------------

export class WindowsSecureKeyStore implements SecureKeyStore {
  readonly #inner: InMemorySecureKeyStore;

  /**
   * @param credential - Credential for the underlying store.
   *   In production, this would be validated against Windows Hello / DPAPI.
   */
  constructor(credential: string = "default-credential") {
    // TODO: Replace with Windows Credential Manager / DPAPI integration
    this.#inner = new InMemorySecureKeyStore(credential);
  }

  public async generateKey(scope: string): Promise<GeneratedKeyResult> {
    // TODO: Use CNG NCryptCreatePersistedKey with NCRYPT_ECDSA_P256_ALGORITHM
    // or Ed25519 via a custom provider, storing in Windows key storage
    return this.#inner.generateKey(scope);
  }

  public async getPublicDescriptor(keyId: string): Promise<PublicKeyDescriptor | undefined> {
    // TODO: Read from Windows Credential Manager metadata
    return this.#inner.getPublicDescriptor(keyId);
  }

  public async sign(keyId: string, data: Uint8Array): Promise<Uint8Array> {
    // TODO: Use NCryptSignHash with the persisted key handle
    // Requires Windows Hello authentication if hardware-bound
    return this.#inner.sign(keyId, data);
  }

  public async revokeKey(keyId: string): Promise<void> {
    // TODO: Mark key as revoked in Credential Manager, optionally delete private material
    return this.#inner.revokeKey(keyId);
  }

  public lockStore(): void {
    // TODO: Wipe decrypted key material from memory, require re-authentication
    this.#inner.lockStore();
  }

  public unlockStore(credential: string): void {
    // TODO: Validate against Windows Hello / DPAPI before unlocking
    this.#inner.unlockStore(credential);
  }

  public isLocked(): boolean {
    return this.#inner.isLocked();
  }

  public toString(): string {
    return `WindowsSecureKeyStore(locked=${this.isLocked()})`;
  }

  public toJSON(): object {
    return {
      type: "WindowsSecureKeyStore",
      platform: "win32",
      locked: this.isLocked(),
      backend: "pilot-in-memory",
      // TODO: Report actual Windows Credential Manager status in production
    };
  }
}
