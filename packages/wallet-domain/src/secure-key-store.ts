/**
 * SecureKeyStore port interface for wallet-domain.
 *
 * Abstracts secure Ed25519 key lifecycle: generation, signing, revocation,
 * and store-level lock/unlock semantics. Private key material MUST NEVER
 * be returned through any method on this interface (ADR-0006).
 *
 * Implementations may use OS key storage (Windows Credential Manager/DPAPI),
 * hardware-backed keystores (TEE/SE), or in-memory stores for testing.
 */

// ---------------------------------------------------------------------------
// Public Key Descriptor
// ---------------------------------------------------------------------------

/**
 * Describes a public key without revealing the private counterpart.
 */
export interface PublicKeyDescriptor {
  readonly keyId: string;
  readonly publicKey: Uint8Array;
  readonly algorithm: "Ed25519";
  readonly status: "active" | "revoked";
}

// ---------------------------------------------------------------------------
// Key Generation Result
// ---------------------------------------------------------------------------

/**
 * Result of key generation: the key ID and public key bytes only.
 * The private key is retained internally and never exposed.
 */
export interface GeneratedKeyResult {
  readonly keyId: string;
  readonly publicKey: Uint8Array;
}

// ---------------------------------------------------------------------------
// SecureKeyStore Interface
// ---------------------------------------------------------------------------

/**
 * Port for secure Ed25519 key operations in the wallet domain.
 *
 * Contract guarantees:
 * - Private keys are generated internally and never returned.
 * - sign() rejects when the store is locked or when the key is revoked.
 * - toString() and toJSON() implementations must not include key material.
 */
export interface SecureKeyStore {
  /**
   * Generates a new Ed25519 key pair for the given scope.
   * Stores the private key internally and returns only the public key.
   *
   * @param scope - A label for the key's intended use (e.g., "device-pairing", "agent-signing")
   */
  generateKey(scope: string): Promise<GeneratedKeyResult>;

  /**
   * Returns the public descriptor for a stored key, or undefined if not found.
   */
  getPublicDescriptor(keyId: string): Promise<PublicKeyDescriptor | undefined>;

  /**
   * Signs data using the key identified by keyId.
   * Rejects if the store is locked or the key is revoked.
   *
   * @throws Error if store is locked, key is revoked, or key is not found.
   */
  sign(keyId: string, data: Uint8Array): Promise<Uint8Array>;

  /**
   * Marks a key as revoked. Subsequent sign() calls with this key will reject.
   */
  revokeKey(keyId: string): Promise<void>;

  /**
   * Locks the entire store. All sign() operations will reject until unlocked.
   */
  lockStore(): void;

  /**
   * Unlocks the store with the given credential.
   *
   * @param credential - Authentication credential to unlock the store
   */
  unlockStore(credential: string): void;

  /**
   * Returns true if the store is currently locked.
   */
  isLocked(): boolean;
}
