/**
 * FileSecureKeyStore — a real, persistent (not in-memory-only) implementation
 * of the wallet-domain SecureKeyStore interface.
 *
 * Private key material is encrypted at rest (AES-256-GCM, with the encryption
 * key derived from an unlock passphrase via scrypt) and persisted to a single
 * JSON file. This is the deliberately simple "test mode first" key custody
 * chosen for the first real signed-purchase phase — genuine OS-native secure
 * storage (Windows Credential Manager/DPAPI, packages/wallet-domain/src/
 * windows-key-store.ts) is the later, real-money-phase upgrade; do not
 * repurpose that stub for this phase, and do not repurpose this file store
 * for that later one.
 *
 * Private keys are held in private fields and are never exposed through any
 * public method, property, toString(), toJSON(), or error message (ADR-0006).
 */

import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";
import { join } from "node:path";
import * as ed from "@noble/ed25519";
import { createCounterId } from "@counter/domain";
import type { SecureKeyStore, PublicKeyDescriptor, GeneratedKeyResult } from "./secure-key-store.js";

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

/** On-disk (encrypted) file shape. */
interface EncryptedFile {
  readonly salt: string;
  readonly iv: string;
  readonly authTag: string;
  readonly ciphertext: string;
}

/** Plaintext shape encrypted into the file (base64-encoded key bytes). */
interface PlaintextKeyRecord {
  readonly keyId: string;
  readonly privateKey: string;
  readonly publicKey: string;
  readonly scope: string;
  readonly status: "active" | "revoked";
  readonly createdAt: string;
}

const SCRYPT_KEY_LENGTH = 32;
const GCM_IV_LENGTH = 12;
const SALT_LENGTH = 16;

export function defaultWalletKeyStorePath(): string {
  return join(homedir(), ".counter", "wallet-keys.enc.json");
}

// ---------------------------------------------------------------------------
// FileSecureKeyStore
// ---------------------------------------------------------------------------

export class FileSecureKeyStore implements SecureKeyStore {
  readonly #filePath: string;
  readonly #keys = new Map<string, InternalKeyEntry>();
  #locked = true;
  #derivedKey: Buffer | undefined;
  #salt: Buffer | undefined;

  public constructor(filePath: string = defaultWalletKeyStorePath()) {
    this.#filePath = filePath;
  }

  public async generateKey(scope: string): Promise<GeneratedKeyResult> {
    this.#assertUnlocked();
    const privateKey = ed.utils.randomPrivateKey();
    const publicKey = await ed.getPublicKeyAsync(privateKey);

    const keyIdResult = createCounterId("key", randomBytes(16));
    if (!keyIdResult.ok) {
      throw new Error("Failed to derive a key id");
    }
    const keyId = keyIdResult.value as unknown as string;

    this.#keys.set(keyId, {
      privateKey,
      publicKey,
      scope,
      status: "active",
      createdAt: new Date().toISOString(),
    });
    this.#persist();

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
    this.#assertUnlocked();
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
    this.#assertUnlocked();
    const entry = this.#keys.get(keyId);
    if (!entry) {
      throw new Error("Key not found");
    }
    entry.status = "revoked";
    this.#persist();
  }

  public lockStore(): void {
    this.#locked = true;
    this.#derivedKey = undefined;
    this.#keys.clear();
  }

  /**
   * Unlocks the store with the given passphrase. Synchronous, per the
   * SecureKeyStore contract. When the on-disk file already exists, this
   * derives the decryption key from `credential` and decrypts it — a wrong
   * passphrase surfaces as "Invalid credential", never a raw crypto error.
   * When no file exists yet (first run), this just adopts the passphrase for
   * future encryption; there is nothing to decrypt.
   */
  public unlockStore(credential: string): void {
    if (!existsSync(this.#filePath)) {
      this.#salt = randomBytes(SALT_LENGTH);
      this.#derivedKey = scryptSync(credential, this.#salt, SCRYPT_KEY_LENGTH);
      this.#keys.clear();
      this.#locked = false;
      return;
    }

    const raw = readFileSync(this.#filePath, "utf8");
    const file = JSON.parse(raw) as EncryptedFile;
    const salt = Buffer.from(file.salt, "base64");
    const derivedKey = scryptSync(credential, salt, SCRYPT_KEY_LENGTH);

    let plaintext: string;
    try {
      const decipher = createDecipheriv("aes-256-gcm", derivedKey, Buffer.from(file.iv, "base64"));
      decipher.setAuthTag(Buffer.from(file.authTag, "base64"));
      plaintext = Buffer.concat([
        decipher.update(Buffer.from(file.ciphertext, "base64")),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw new Error("Invalid credential");
    }

    const records = JSON.parse(plaintext) as readonly PlaintextKeyRecord[];
    this.#keys.clear();
    for (const record of records) {
      this.#keys.set(record.keyId, {
        privateKey: Buffer.from(record.privateKey, "base64"),
        publicKey: Buffer.from(record.publicKey, "base64"),
        scope: record.scope,
        status: record.status,
        createdAt: record.createdAt,
      });
    }

    this.#salt = salt;
    this.#derivedKey = derivedKey;
    this.#locked = false;
  }

  public isLocked(): boolean {
    return this.#locked;
  }

  #assertUnlocked(): void {
    if (this.#locked || this.#derivedKey === undefined) {
      throw new Error("SecureKeyStore is locked");
    }
  }

  /** Re-encrypts the full in-memory key set and writes it to disk. */
  #persist(): void {
    if (this.#derivedKey === undefined || this.#salt === undefined) {
      throw new Error("SecureKeyStore is locked");
    }
    const records: PlaintextKeyRecord[] = [];
    for (const [keyId, entry] of this.#keys) {
      records.push({
        keyId,
        privateKey: Buffer.from(entry.privateKey).toString("base64"),
        publicKey: Buffer.from(entry.publicKey).toString("base64"),
        scope: entry.scope,
        status: entry.status,
        createdAt: entry.createdAt,
      });
    }
    const plaintext = Buffer.from(JSON.stringify(records), "utf8");

    const iv = randomBytes(GCM_IV_LENGTH);
    const cipher = createCipheriv("aes-256-gcm", this.#derivedKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const file: EncryptedFile = {
      salt: this.#salt.toString("base64"),
      iv: iv.toString("base64"),
      authTag: authTag.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };

    mkdirSync(dirname(this.#filePath), { recursive: true });
    writeFileSync(this.#filePath, JSON.stringify(file), { mode: 0o600 });
  }

  /**
   * Never includes private key material.
   */
  public toString(): string {
    return `FileSecureKeyStore(path=${this.#filePath}, keys=${this.#keys.size}, locked=${this.#locked})`;
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
      type: "FileSecureKeyStore",
      filePath: this.#filePath,
      keyCount: this.#keys.size,
      locked: this.#locked,
      keys: descriptors,
    };
  }
}
