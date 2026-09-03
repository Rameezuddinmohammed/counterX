/**
 * VaultSecureKeyStore — the multi-tenant, server-side implementation of the
 * wallet-domain SecureKeyStore interface, backed by HashiCorp Vault's
 * Transit secrets engine (key type `ed25519`).
 *
 * WHY THIS EXISTS (Phase 3, remote MCP transport). FileSecureKeyStore is
 * single-owner by construction: one process, one buyer, one on-disk
 * encrypted key file, unlocked by that buyer's own passphrase. The remote
 * (HTTP-transport) MCP server inverts that — buyers connect to ONE hosted
 * Counter MCP URL, so one running service must hold signing keys for MANY
 * buyers and resolve "which buyer's key" per authenticated request. That
 * makes cross-tenant key confusion the single most dangerous failure mode
 * in the whole transport, so it is defended structurally here:
 *
 *   1. Private key material never exists in this process AT ALL. Transit
 *      keys are created with `exportable: false` — Vault will USE a key to
 *      sign but will never hand back the private bytes, to us or anyone.
 *      There is no in-memory secret to leak, log, or serialize.
 *   2. One instance per authenticated buyer/session, closing over a single
 *      `tenantId` for its whole lifetime. It is never shared across buyers.
 *   3. Every keyId is checked against a DURABLE record of who owns it
 *      (VaultKeyRepository, backed by wallet.vault_keys — see
 *      packages/data/src/vault-key-repository.ts) before this store will
 *      sign, describe, or revoke with it. The caller is never trusted to
 *      assert ownership. An instance built for tenant A cannot reach
 *      tenant B's key even given B's exact keyId.
 *
 * Existence-hiding: a keyId that belongs to another tenant is reported
 * EXACTLY as a keyId that does not exist — `undefined` from
 * getPublicDescriptor(), `Error("Key not found")` from sign()/revokeKey().
 * The error never says which of the two it was. This is the same
 * 404-not-403 rule the rest of the system applies to cross-tenant lookups.
 *
 * Vault Transit HTTP surface used (verified against a real Vault 1.17.6
 * dev server, not just documentation):
 *   - POST {addr}/v1/transit/keys/{name}   {"type":"ed25519","exportable":false}
 *   - GET  {addr}/v1/transit/keys/{name}   -> .data.keys[latest].public_key (base64 raw 32 bytes)
 *   - POST {addr}/v1/transit/sign/{name}   {"input":"<base64 message>"}
 *                                          -> .data.signature "vault:v1:<base64 64-byte sig>"
 * All authenticated with the `X-Vault-Token` header. Vault does NOT prehash
 * for ed25519 — it signs the exact input bytes, which matches this repo's
 * `Signer.sign(message)` convention (packages/trust-protocol/src/sign.ts
 * signs canonical bytes directly). Signatures produced here verify with
 * `@noble/ed25519.verifyAsync()` bit-for-bit, no translation.
 *
 * OPERATIONAL PREREQUISITE: the Transit engine must already be mounted at
 * `transit/` in the target Vault (it is NOT mounted by default, not even in
 * dev mode — `POST /v1/sys/mounts/transit {"type":"transit"}`). This store
 * deliberately does not mount it: mounting is a privileged, one-time
 * provisioning step, not something a per-session object should do.
 *
 * ADR-0001 note: this package imports no frameworks, database drivers,
 * cloud SDKs, or adapters. Vault is reached over plain `fetch` against its
 * documented HTTP API (no SDK), and durable storage is reached only through
 * an injected port (VaultKeyRepository) whose Postgres implementation lives
 * in @counter/data — the same port/adapter split MandateRepository uses.
 *
 * Like FileSecureKeyStore, no method, property, toString(), toJSON(), or
 * error message here exposes key material — and additionally, none exposes
 * the Vault token (ADR-0006).
 */

import { randomBytes } from "node:crypto";
import { createCounterId } from "@counter/domain";
import type {
  SecureKeyStore,
  PublicKeyDescriptor,
  GeneratedKeyResult,
} from "./secure-key-store.js";

// ---------------------------------------------------------------------------
// Durable key-ownership record (port)
// ---------------------------------------------------------------------------

export type VaultKeyStatus = "active" | "revoked";

/**
 * The durable record of a Vault-backed key: who owns it, which Transit key
 * name backs it, and whether it is still usable. Holds NO secret material —
 * it is a custody index, not a key store.
 */
export interface VaultKeyRecord {
  readonly tenantId: string;
  readonly keyId: string;
  readonly vaultKeyName: string;
  readonly scope: string;
  readonly status: VaultKeyStatus;
}

/** Fields supplied when first recording a key; status always starts "active". */
export interface CreateVaultKeyInput {
  readonly tenantId: string;
  readonly keyId: string;
  readonly vaultKeyName: string;
  readonly scope: string;
}

/**
 * Repository port for Vault key ownership records. Implemented durably by
 * PostgresVaultKeyRepository (@counter/data) and in memory below.
 *
 * `findByKeyId` deliberately does NOT filter by tenant: it returns the row
 * including its `tenantId` so the CALLER performs the ownership comparison.
 * That keeps the tenant check visible at the security boundary
 * (VaultSecureKeyStore) instead of hidden in a WHERE clause. `revoke` then
 * filters by tenant as well, as defense in depth.
 */
export interface VaultKeyRepository {
  create(input: CreateVaultKeyInput): Promise<void>;
  findByKeyId(keyId: string): Promise<VaultKeyRecord | undefined>;
  /**
   * Marks a key revoked, but ONLY if it belongs to `tenantId`. Returns false
   * when no row matched — a wrong-tenant revoke is indistinguishable from a
   * missing key, and must never silently "succeed" against nothing.
   * Idempotent: revoking an already-revoked key returns true and preserves
   * the original revocation time (revocation is monotonic).
   */
  revoke(tenantId: string, keyId: string): Promise<boolean>;
}

/**
 * In-memory VaultKeyRepository, mirroring InMemoryMandateRepository's role:
 * for tests and local development only. Nothing durable, so a restart loses
 * the ownership index and the (still-existing) Vault keys become
 * unreachable — never use this in a deployed remote MCP server.
 */
export class InMemoryVaultKeyRepository implements VaultKeyRepository {
  readonly #records = new Map<string, VaultKeyRecord>();

  async create(input: CreateVaultKeyInput): Promise<void> {
    this.#records.set(input.keyId, { ...input, status: "active" });
  }

  async findByKeyId(keyId: string): Promise<VaultKeyRecord | undefined> {
    return this.#records.get(keyId);
  }

  async revoke(tenantId: string, keyId: string): Promise<boolean> {
    const existing = this.#records.get(keyId);
    if (existing === undefined || existing.tenantId !== tenantId) {
      return false;
    }
    this.#records.set(keyId, { ...existing, status: "revoked" });
    return true;
  }
}

// ---------------------------------------------------------------------------
// Vault Transit wire shapes
// ---------------------------------------------------------------------------

interface VaultReadKeyResponse {
  readonly data?: {
    readonly latest_version?: number;
    readonly keys?: Record<string, { readonly public_key?: string } | undefined>;
  };
}

interface VaultSignResponse {
  readonly data?: { readonly signature?: string };
}

const ED25519_PUBLIC_KEY_BYTES = 32;
const ED25519_SIGNATURE_BYTES = 64;
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Composes the Vault Transit key name for a tenant's key.
 *
 * Tenant-prefixed so one tenant's keys are grouped and auditable in Vault's
 * own path structure (and so a Vault ACL policy can glob
 * `transit/keys/<tenantId>.*` per tenant later).
 *
 * The separator is "." and NOT "/" — verified against a real Vault 1.17.6:
 * a nested name like `<tenant>/<keyId>` is rejected with HTTP 404, because
 * Vault's Transit path pattern matches key names against a generic-name
 * regex that permits word characters, "-" and "." but NOT a path separator.
 * "." is unambiguous here because Counter ids are base64url (letters,
 * digits, "-", "_") and never contain a dot.
 */
export function vaultTransitKeyName(tenantId: string, keyId: string): string {
  return `${tenantId}.${keyId}`;
}

// ---------------------------------------------------------------------------
// VaultSecureKeyStore
// ---------------------------------------------------------------------------

export interface VaultSecureKeyStoreOptions {
  /** Base Vault address, e.g. "https://counter-vault.fly.dev" (no trailing slash needed). */
  readonly vaultAddr: string;
  /** Vault token for the X-Vault-Token header. Never logged or serialized. */
  readonly vaultToken: string;
  /** The ONE tenant this instance may ever act for (a wallet or agent id). */
  readonly tenantId: string;
  /** Durable ownership index. Injected so this is unit-testable with a fake. */
  readonly repository: VaultKeyRepository;
  /** Injectable for tests; defaults to the global fetch. */
  readonly fetchImpl?: typeof fetch;
  /** Per-request timeout; defaults to 10s. */
  readonly timeoutMs?: number;
}

export class VaultSecureKeyStore implements SecureKeyStore {
  readonly #vaultAddr: string;
  readonly #vaultToken: string;
  readonly #tenantId: string;
  readonly #repository: VaultKeyRepository;
  readonly #fetchImpl: typeof fetch;
  readonly #timeoutMs: number;

  public constructor(options: VaultSecureKeyStoreOptions) {
    // Fail closed at construction rather than at first signature: a store
    // built without an address, token, or tenant could otherwise look
    // healthy right up until it is asked to move money.
    if (options.vaultAddr.trim().length === 0) {
      throw new Error("VaultSecureKeyStore requires a Vault address");
    }
    if (options.vaultToken.length === 0) {
      throw new Error("VaultSecureKeyStore requires a Vault token");
    }
    if (options.tenantId.trim().length === 0) {
      throw new Error("VaultSecureKeyStore requires a tenant id");
    }

    this.#vaultAddr = options.vaultAddr.trim().replace(/\/+$/u, "");
    this.#vaultToken = options.vaultToken;
    this.#tenantId = options.tenantId;
    this.#repository = options.repository;
    this.#fetchImpl = options.fetchImpl ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  public async generateKey(scope: string): Promise<GeneratedKeyResult> {
    const keyIdResult = createCounterId("key", randomBytes(16));
    if (!keyIdResult.ok) {
      throw new Error("Failed to derive a key id");
    }
    const keyId = keyIdResult.value as unknown as string;
    const vaultKeyName = vaultTransitKeyName(this.#tenantId, keyId);

    // Vault first, ownership record second. If the record write fails, the
    // orphaned Transit key is inert — unreachable through this store,
    // because reachability is decided by the record. The reverse order
    // would leave a record pointing at a key that does not exist, which
    // fails later and less obviously. Either way this method throws rather
    // than reporting a key the caller cannot actually use.
    await this.#vaultRequest("POST", `/v1/transit/keys/${encodePathSegment(vaultKeyName)}`, {
      type: "ed25519",
      exportable: false,
    });

    const publicKey = await this.#readPublicKey(vaultKeyName);
    await this.#repository.create({ tenantId: this.#tenantId, keyId, vaultKeyName, scope });

    return { keyId, publicKey };
  }

  public async getPublicDescriptor(keyId: string): Promise<PublicKeyDescriptor | undefined> {
    const record = await this.#findOwnedRecord(keyId);
    if (record === undefined) {
      return undefined;
    }
    return {
      keyId,
      publicKey: await this.#readPublicKey(record.vaultKeyName),
      algorithm: "Ed25519",
      status: record.status,
    };
  }

  public async sign(keyId: string, data: Uint8Array): Promise<Uint8Array> {
    const record = await this.#findOwnedRecord(keyId);
    if (record === undefined) {
      // Missing key and another tenant's key are reported identically.
      throw new Error("Key not found");
    }
    if (record.status === "revoked") {
      throw new Error("Key has been revoked");
    }

    const response = await this.#vaultRequest<VaultSignResponse>(
      "POST",
      `/v1/transit/sign/${encodePathSegment(record.vaultKeyName)}`,
      { input: Buffer.from(data).toString("base64") },
    );

    const signature = response.data?.signature;
    if (typeof signature !== "string") {
      throw new Error("Vault returned no signature");
    }
    // Shaped "vault:v1:<base64 signature>" — the third segment is the raw
    // 64-byte Ed25519 signature.
    const encoded = signature.split(":")[2];
    if (encoded === undefined) {
      throw new Error("Vault returned a malformed signature");
    }
    const raw = Buffer.from(encoded, "base64");
    if (raw.byteLength !== ED25519_SIGNATURE_BYTES) {
      throw new Error("Vault returned a signature of unexpected length");
    }
    return new Uint8Array(raw);
  }

  public async revokeKey(keyId: string): Promise<void> {
    const record = await this.#findOwnedRecord(keyId);
    if (record === undefined) {
      throw new Error("Key not found");
    }
    // Defense in depth: the repository re-applies the tenant filter in its
    // own WHERE clause, so a revoke can never match another tenant's row
    // even if the check above were somehow bypassed.
    const revoked = await this.#repository.revoke(this.#tenantId, keyId);
    if (!revoked) {
      throw new Error("Key not found");
    }
    // The Vault Transit key is deliberately NOT deleted or mutated.
    // Revocation is enforced by the ownership record's status in sign()
    // above: Transit has no clean soft-revoke primitive, and irreversible
    // key deletion is out of scope. The key simply becomes unreachable.
  }

  /**
   * No-op. This store has no local-passphrase concept and is NEVER locked:
   * unlike FileSecureKeyStore (where the passphrase decrypts on-disk private
   * keys), there is no local secret to protect — the private key lives only
   * inside Vault. Authentication happens via OAuth BEFORE this object is
   * constructed, and one instance exists per already-authenticated session,
   * so "locked" has no meaning here. These three methods exist only to
   * satisfy the SecureKeyStore interface honestly; they are not an
   * unimplemented stub.
   */
  public lockStore(): void {
    // Intentionally empty — see the doc comment above.
  }

  /** No-op. See lockStore(). */
  public unlockStore(_credential: string): void {
    // Intentionally empty — see lockStore()'s doc comment.
  }

  /** Always false. See lockStore(). */
  public isLocked(): boolean {
    return false;
  }

  /**
   * Returns the ownership record ONLY if it exists AND belongs to this
   * instance's tenant. The single choke point for tenant isolation: every
   * public method that touches a keyId goes through here.
   */
  async #findOwnedRecord(keyId: string): Promise<VaultKeyRecord | undefined> {
    const record = await this.#repository.findByKeyId(keyId);
    if (record === undefined || record.tenantId !== this.#tenantId) {
      return undefined;
    }
    return record;
  }

  async #readPublicKey(vaultKeyName: string): Promise<Uint8Array> {
    const response = await this.#vaultRequest<VaultReadKeyResponse>(
      "GET",
      `/v1/transit/keys/${encodePathSegment(vaultKeyName)}`,
    );

    const versions = response.data?.keys;
    if (versions === undefined) {
      throw new Error("Vault returned no key material");
    }
    // Always the latest version; rotation is not used yet, but reading
    // `latest_version` keeps this correct if it ever is.
    const latest = response.data?.latest_version;
    const versionKey = latest === undefined ? highestVersionKey(versions) : String(latest);
    const encoded = versionKey === undefined ? undefined : versions[versionKey]?.public_key;
    if (typeof encoded !== "string") {
      throw new Error("Vault returned no public key for this key version");
    }

    const raw = Buffer.from(encoded, "base64");
    if (raw.byteLength !== ED25519_PUBLIC_KEY_BYTES) {
      throw new Error("Vault returned a public key of unexpected length");
    }
    return new Uint8Array(raw);
  }

  /**
   * One authenticated Vault call. Errors carry the HTTP status and the
   * operation, never the token and never a response body (which could echo
   * request content back into a log).
   */
  async #vaultRequest<Response>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetchImpl(`${this.#vaultAddr}${path}`, {
        method,
        headers: {
          "X-Vault-Token": this.#vaultToken,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Vault request failed (HTTP ${response.status})`);
      }
      // 204 No Content is a legitimate success for key creation.
      if (response.status === 204) {
        return {} as Response;
      }
      const text = await response.text();
      if (text.trim().length === 0) {
        return {} as Response;
      }
      return JSON.parse(text) as Response;
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Vault request timed out");
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Never includes key material or the Vault token.
   */
  public toString(): string {
    return `VaultSecureKeyStore(tenant=${this.#tenantId}, locked=false)`;
  }

  /**
   * Never includes key material or the Vault token.
   */
  public toJSON(): object {
    return {
      type: "VaultSecureKeyStore",
      tenantId: this.#tenantId,
      locked: false,
    };
  }
}

/**
 * Encodes one Vault path segment. Counter ids are base64url and the "."
 * separator is safe, so in practice this is a no-op — it exists so a
 * malformed tenant id can never smuggle a "/" or "?" into the Vault path
 * and address a different key or endpoint.
 */
function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

/** Highest numeric version key present, used only if latest_version is absent. */
function highestVersionKey(versions: Record<string, unknown>): string | undefined {
  let highest: number | undefined;
  for (const key of Object.keys(versions)) {
    const parsed = Number.parseInt(key, 10);
    if (Number.isInteger(parsed) && (highest === undefined || parsed > highest)) {
      highest = parsed;
    }
  }
  return highest === undefined ? undefined : String(highest);
}
