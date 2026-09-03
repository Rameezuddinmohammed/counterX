/**
 * Unit tests for VaultSecureKeyStore.
 *
 * The Vault HTTP layer is faithfully mocked (exact request paths, exact
 * `vault:v1:<base64>` signature envelope, exact `data.keys["1"].public_key`
 * read shape) AND the fake signs with a REAL Ed25519 keypair, so the
 * signature assertions below are genuine `@noble/ed25519.verifyAsync()`
 * verifications, not "the mock returned what the mock was told to return".
 *
 * The same class was additionally exercised against a real HashiCorp Vault
 * 1.17.6 dev server (Transit engine, ed25519, exportable=false) by hand —
 * that proof is not committed because it needs a downloaded Vault binary
 * that CI does not have. What that run established and this file encodes:
 * Vault's raw 64-byte signature verifies with @noble/ed25519 bit-for-bit,
 * and Transit key names may NOT contain "/" (hence vaultTransitKeyName's
 * "." separator).
 */
import { describe, expect, it } from "vitest";
import * as ed from "@noble/ed25519";
import { InMemoryVaultKeyRepository, VaultSecureKeyStore } from "./vault-key-store.js";
import type { VaultKeyRepository } from "./vault-key-store.js";

const VAULT_ADDR = "http://vault.test:8200";
const VAULT_TOKEN = "test-vault-token-never-logged";
const TENANT_A = "ctr_wallet_heYUlPKiGc1wwE23UCZENw";
const TENANT_B = "ctr_wallet_vK-wpQwg1l1GHkC37iCfsw";

/** The store only ever sends string bodies; anything else is a test bug. */
function readJsonBody<T>(init: Parameters<typeof fetch>[1]): T {
  const body = init?.body;
  return JSON.parse(typeof body === "string" ? body : "{}") as T;
}

interface FakeVaultCall {
  readonly method: string;
  readonly path: string;
  readonly token: string | null;
}

/**
 * An in-process stand-in for Vault's Transit engine that holds REAL Ed25519
 * keypairs. Private keys never leave it, mirroring exportable=false.
 */
class FakeVault {
  readonly calls: FakeVaultCall[] = [];
  readonly #privateKeys = new Map<string, Uint8Array>();
  #failNextWithStatus: number | undefined;

  failNextRequest(status: number): void {
    this.#failNextWithStatus = status;
  }

  hasKey(name: string): boolean {
    return this.#privateKeys.has(name);
  }

  get fetch(): typeof fetch {
    return async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ): Promise<Response> => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      );
      const method = init?.method ?? "GET";
      const headers = new Headers(init?.headers);
      this.calls.push({
        method,
        path: url.pathname,
        token: headers.get("X-Vault-Token"),
      });

      if (this.#failNextWithStatus !== undefined) {
        const status = this.#failNextWithStatus;
        this.#failNextWithStatus = undefined;
        return new Response(JSON.stringify({ errors: ["permission denied"] }), { status });
      }

      const createMatch = /^\/v1\/transit\/keys\/(?<name>.+)$/u.exec(url.pathname);
      const signMatch = /^\/v1\/transit\/sign\/(?<name>.+)$/u.exec(url.pathname);

      if (signMatch?.groups?.["name"] !== undefined && method === "POST") {
        const name = decodeURIComponent(signMatch.groups["name"]);
        const privateKey = this.#privateKeys.get(name);
        if (privateKey === undefined) {
          return new Response(JSON.stringify({ errors: ["encryption key not found"] }), {
            status: 400,
          });
        }
        const body = readJsonBody<{ input?: string }>(init);
        const message = Buffer.from(body.input ?? "", "base64");
        const signature = await ed.signAsync(new Uint8Array(message), privateKey);
        return Response.json({
          data: { signature: `vault:v1:${Buffer.from(signature).toString("base64")}` },
        });
      }

      if (createMatch?.groups?.["name"] !== undefined) {
        const name = decodeURIComponent(createMatch.groups["name"]);
        if (method === "POST") {
          const body = readJsonBody<{ type?: string; exportable?: boolean }>(init);
          if (body.type !== "ed25519" || body.exportable !== false) {
            return new Response(JSON.stringify({ errors: ["unexpected key policy"] }), {
              status: 400,
            });
          }
          this.#privateKeys.set(name, ed.utils.randomPrivateKey());
          return new Response(null, { status: 204 });
        }
        const privateKey = this.#privateKeys.get(name);
        if (privateKey === undefined) {
          return new Response(null, { status: 404 });
        }
        const publicKey = await ed.getPublicKeyAsync(privateKey);
        return Response.json({
          data: {
            latest_version: 1,
            keys: { "1": { public_key: Buffer.from(publicKey).toString("base64") } },
          },
        });
      }

      return new Response(null, { status: 404 });
    };
  }
}

function makeStore(options: {
  tenantId: string;
  vault: FakeVault;
  repository: VaultKeyRepository;
}): VaultSecureKeyStore {
  return new VaultSecureKeyStore({
    vaultAddr: VAULT_ADDR,
    vaultToken: VAULT_TOKEN,
    tenantId: options.tenantId,
    repository: options.repository,
    fetchImpl: options.vault.fetch,
  });
}

describe("VaultSecureKeyStore", () => {
  it("generates a Vault-backed key and returns a real 32-byte public key", async () => {
    const vault = new FakeVault();
    const repository = new InMemoryVaultKeyRepository();
    const store = makeStore({ tenantId: TENANT_A, vault, repository });

    const { keyId, publicKey } = await store.generateKey("agent-signing");

    expect(keyId).toMatch(/^ctr_key_/u);
    expect(publicKey).toBeInstanceOf(Uint8Array);
    expect(publicKey.byteLength).toBe(32);

    // The Transit key is named <tenantId>.<keyId> — tenant-prefixed and
    // dot-separated (a "/" is rejected by real Vault).
    expect(vault.hasKey(`${TENANT_A}.${keyId}`)).toBe(true);

    const record = await repository.findByKeyId(keyId);
    expect(record).toEqual({
      tenantId: TENANT_A,
      keyId,
      vaultKeyName: `${TENANT_A}.${keyId}`,
      scope: "agent-signing",
      status: "active",
    });

    // Every Vault call carried the token header.
    expect(vault.calls.length).toBeGreaterThan(0);
    for (const call of vault.calls) {
      expect(call.token).toBe(VAULT_TOKEN);
    }
  });

  it("produces signatures that verify with @noble/ed25519", async () => {
    const vault = new FakeVault();
    const repository = new InMemoryVaultKeyRepository();
    const store = makeStore({ tenantId: TENANT_A, vault, repository });

    const { keyId, publicKey } = await store.generateKey("agent-signing");
    const message = new TextEncoder().encode('{"counter":"canonical-bytes"}');

    const signature = await store.sign(keyId, message);

    expect(signature.byteLength).toBe(64);
    expect(await ed.verifyAsync(signature, message, publicKey)).toBe(true);
    // Wrong message must not verify — proves we are not verifying a constant.
    const tampered = new TextEncoder().encode('{"counter":"canonical-byte5"}');
    expect(await ed.verifyAsync(signature, tampered, publicKey)).toBe(false);
  });

  it("returns a public descriptor whose key matches what signing proves", async () => {
    const vault = new FakeVault();
    const repository = new InMemoryVaultKeyRepository();
    const store = makeStore({ tenantId: TENANT_A, vault, repository });

    const { keyId } = await store.generateKey("device-pairing");
    const descriptor = await store.getPublicDescriptor(keyId);

    expect(descriptor?.keyId).toBe(keyId);
    expect(descriptor?.algorithm).toBe("Ed25519");
    expect(descriptor?.status).toBe("active");

    const message = new TextEncoder().encode("descriptor-round-trip");
    const signature = await store.sign(keyId, message);
    expect(await ed.verifyAsync(signature, message, descriptor?.publicKey as Uint8Array)).toBe(
      true,
    );
  });

  it("rejects signing with a revoked key and reports it as revoked", async () => {
    const vault = new FakeVault();
    const repository = new InMemoryVaultKeyRepository();
    const store = makeStore({ tenantId: TENANT_A, vault, repository });

    const { keyId } = await store.generateKey("agent-signing");
    await store.revokeKey(keyId);

    await expect(store.sign(keyId, new Uint8Array([1, 2, 3]))).rejects.toThrow(
      "Key has been revoked",
    );
    expect((await store.getPublicDescriptor(keyId))?.status).toBe("revoked");
    // The Vault key itself is deliberately left intact.
    expect(vault.hasKey(`${TENANT_A}.${keyId}`)).toBe(true);
  });

  it("revokes monotonically: a second revoke succeeds and stays revoked", async () => {
    const vault = new FakeVault();
    const repository = new InMemoryVaultKeyRepository();
    const store = makeStore({ tenantId: TENANT_A, vault, repository });

    const { keyId } = await store.generateKey("agent-signing");
    await store.revokeKey(keyId);
    await expect(store.revokeKey(keyId)).resolves.toBeUndefined();
    expect((await repository.findByKeyId(keyId))?.status).toBe("revoked");
  });

  // -------------------------------------------------------------------------
  // Tenant isolation — the security-critical behaviour of this class.
  // -------------------------------------------------------------------------

  describe("tenant isolation", () => {
    it("treats another tenant's keyId as not found, and never touches Vault", async () => {
      const vault = new FakeVault();
      const repository = new InMemoryVaultKeyRepository();

      const storeA = makeStore({ tenantId: TENANT_A, vault, repository });
      const { keyId: keyOfA, publicKey: publicKeyOfA } = await storeA.generateKey("agent-signing");

      // A DIFFERENT authenticated session, same process, same repository.
      const storeB = makeStore({ tenantId: TENANT_B, vault, repository });
      const callsBefore = vault.calls.length;

      // Existence-hiding: undefined, not an error that reveals the key exists.
      expect(await storeB.getPublicDescriptor(keyOfA)).toBeUndefined();

      // "Key not found" — the SAME message an unknown key produces, never
      // "forbidden" and never anything that says the key belongs to someone.
      await expect(storeB.sign(keyOfA, new Uint8Array([9, 9, 9]))).rejects.toThrow("Key not found");
      await expect(storeB.revokeKey(keyOfA)).rejects.toThrow("Key not found");

      // Vault was never contacted on tenant B's behalf for tenant A's key:
      // the isolation check happens before any signing request is issued.
      expect(vault.calls.length).toBe(callsBefore);

      // Tenant A's key is untouched and still usable.
      const record = await repository.findByKeyId(keyOfA);
      expect(record?.status).toBe("active");
      expect(record?.tenantId).toBe(TENANT_A);
      const message = new TextEncoder().encode("still-mine");
      expect(await ed.verifyAsync(await storeA.sign(keyOfA, message), message, publicKeyOfA)).toBe(
        true,
      );
    });

    it("gives the same not-found answer for a keyId that never existed", async () => {
      const vault = new FakeVault();
      const store = makeStore({
        tenantId: TENANT_A,
        vault,
        repository: new InMemoryVaultKeyRepository(),
      });

      expect(await store.getPublicDescriptor("ctr_key_AAAAAAAAAAAAAAAAAAAAAA")).toBeUndefined();
      await expect(
        store.sign("ctr_key_AAAAAAAAAAAAAAAAAAAAAA", new Uint8Array([1])),
      ).rejects.toThrow("Key not found");
      await expect(store.revokeKey("ctr_key_AAAAAAAAAAAAAAAAAAAAAA")).rejects.toThrow(
        "Key not found",
      );
    });

    it("does not let a repository that ignores the tenant filter widen access", async () => {
      // A deliberately broken repository whose revoke() forgets to check the
      // tenant. The store's own pre-check must still stop a cross-tenant
      // revoke — defense in depth, both layers checked independently.
      const vault = new FakeVault();
      const inner = new InMemoryVaultKeyRepository();
      const sloppy: VaultKeyRepository = {
        create: (input) => inner.create(input),
        findByKeyId: (keyId) => inner.findByKeyId(keyId),
        revoke: async (_tenantId, keyId) => {
          const record = await inner.findByKeyId(keyId);
          if (record === undefined) return false;
          await inner.revoke(record.tenantId, keyId);
          return true;
        },
      };

      const storeA = makeStore({ tenantId: TENANT_A, vault, repository: sloppy });
      const { keyId } = await storeA.generateKey("agent-signing");

      const storeB = makeStore({ tenantId: TENANT_B, vault, repository: sloppy });
      await expect(storeB.revokeKey(keyId)).rejects.toThrow("Key not found");
      expect((await inner.findByKeyId(keyId))?.status).toBe("active");
    });
  });

  // -------------------------------------------------------------------------
  // Lock semantics and failure handling
  // -------------------------------------------------------------------------

  it("is never locked, and lock/unlock are honest no-ops", async () => {
    const vault = new FakeVault();
    const store = makeStore({
      tenantId: TENANT_A,
      vault,
      repository: new InMemoryVaultKeyRepository(),
    });

    expect(store.isLocked()).toBe(false);
    store.lockStore();
    expect(store.isLocked()).toBe(false);
    store.unlockStore("irrelevant-passphrase");
    expect(store.isLocked()).toBe(false);

    // Signing still works after lockStore() — there is no local secret to lock.
    const { keyId, publicKey } = await store.generateKey("agent-signing");
    store.lockStore();
    const message = new TextEncoder().encode("after-lock");
    expect(await ed.verifyAsync(await store.sign(keyId, message), message, publicKey)).toBe(true);
  });

  it("fails loudly on a Vault error without leaking the token", async () => {
    const vault = new FakeVault();
    const repository = new InMemoryVaultKeyRepository();
    const store = makeStore({ tenantId: TENANT_A, vault, repository });
    const { keyId } = await store.generateKey("agent-signing");

    vault.failNextRequest(403);
    let caught: unknown;
    try {
      await store.sign(keyId, new Uint8Array([1, 2, 3]));
    } catch (error: unknown) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("403");
    expect((caught as Error).message).not.toContain(VAULT_TOKEN);
  });

  it("never exposes the Vault token through toString()/toJSON()", async () => {
    const vault = new FakeVault();
    const store = makeStore({
      tenantId: TENANT_A,
      vault,
      repository: new InMemoryVaultKeyRepository(),
    });

    expect(store.toString()).not.toContain(VAULT_TOKEN);
    expect(JSON.stringify(store)).not.toContain(VAULT_TOKEN);
    expect(store.toString()).toContain(TENANT_A);
  });

  it("fails closed when constructed without an address, token, or tenant", () => {
    const repository = new InMemoryVaultKeyRepository();
    expect(
      () =>
        new VaultSecureKeyStore({
          vaultAddr: "  ",
          vaultToken: VAULT_TOKEN,
          tenantId: TENANT_A,
          repository,
        }),
    ).toThrow("Vault address");
    expect(
      () =>
        new VaultSecureKeyStore({
          vaultAddr: VAULT_ADDR,
          vaultToken: "",
          tenantId: TENANT_A,
          repository,
        }),
    ).toThrow("Vault token");
    expect(
      () =>
        new VaultSecureKeyStore({
          vaultAddr: VAULT_ADDR,
          vaultToken: VAULT_TOKEN,
          tenantId: "",
          repository,
        }),
    ).toThrow("tenant id");
  });
});
