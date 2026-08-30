/**
 * InMemorySecureKeyStore - test and pilot implementation of the wallet-domain
 * SecureKeyStore interface.
 *
 * Stores Ed25519 key pairs in an internal Map. Private keys are held in
 * private fields and are never exposed through any public method, property,
 * toString(), toJSON(), or error message (ADR-0006).
 */

import * as ed from "@noble/ed25519";
import type {
  SecureKeyStore,
  PublicKeyDescriptor,
  GeneratedKeyResult,
} from "./secure-key-store.js";

// ---------------------------------------------------------------------------
// Internal key entry (private, never exposed)
// ---------------------------------------------------------------------------

interface InternalKeyEntry {
  readonly privateKey: Uint8Array;
  readonly publicKey: Uint8Array;
  readonly scope: string;
  status: "active" | "revoked";
  readonly createdAt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateKeyId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return `wk-${btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

// ---------------------------------------------------------------------------
// InMemorySecureKeyStore
// ---------------------------------------------------------------------------

export class InMemorySecureKeyStore implements SecureKeyStore {
  readonly #keys = new Map<string, InternalKeyEntry>();
  #locked = false;
  readonly #credential: string;

  /**
   * @param credential - The credential required to unlock the store.
   *   Defaults to "default-credential" for testing convenience.
   */
  constructor(credential: string = "default-credential") {
    this.#credential = credential;
  }

  public async generateKey(scope: string): Promise<GeneratedKeyResult> {
    const privateKey = ed.utils.randomPrivateKey();
    const publicKey = await ed.getPublicKeyAsync(privateKey);
    const keyId = generateKeyId();

    const entry: InternalKeyEntry = {
      privateKey,
      publicKey,
      scope,
      status: "active",
      createdAt: new Date().toISOString(),
    };

    this.#keys.set(keyId, entry);

    return { keyId, publicKey: new Uint8Array(publicKey) };
  }

  public async getPublicDescriptor(keyId: string): Promise<PublicKeyDescriptor | undefined> {
    const entry = this.#keys.get(keyId);
    if (!entry) {
      return undefined;
    }

    return {
      keyId,
      publicKey: new Uint8Array(entry.publicKey),
      algorithm: "Ed25519",
      status: entry.status,
    };
  }

  public async sign(keyId: string, data: Uint8Array): Promise<Uint8Array> {
    if (this.#locked) {
      throw new Error("SecureKeyStore is locked");
    }

    const entry = this.#keys.get(keyId);
    if (!entry) {
      throw new Error("Key not found");
    }

    if (entry.status === "revoked") {
      throw new Error("Key has been revoked");
    }

    return ed.signAsync(data, entry.privateKey);
  }

  public async revokeKey(keyId: string): Promise<void> {
    const entry = this.#keys.get(keyId);
    if (!entry) {
      throw new Error("Key not found");
    }
    entry.status = "revoked";
  }

  public lockStore(): void {
    this.#locked = true;
  }

  public unlockStore(credential: string): void {
    if (credential !== this.#credential) {
      throw new Error("Invalid credential");
    }
    this.#locked = false;
  }

  public isLocked(): boolean {
    return this.#locked;
  }

  /**
   * Never includes private key material.
   */
  public toString(): string {
    return `InMemorySecureKeyStore(keys=${this.#keys.size}, locked=${this.#locked})`;
  }

  /**
   * Never includes private key material.
   */
  public toJSON(): object {
    const descriptors: Array<{ keyId: string; status: string; scope: string }> = [];
    for (const [keyId, entry] of this.#keys) {
      descriptors.push({ keyId, status: entry.status, scope: entry.scope });
    }
    return {
      type: "InMemorySecureKeyStore",
      keyCount: this.#keys.size,
      locked: this.#locked,
      keys: descriptors,
    };
  }
}
