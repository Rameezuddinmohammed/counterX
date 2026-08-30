/**
 * SecureKeyStore conformance test harness.
 *
 * Verifies that SecureKeyStore implementations satisfy the security contract:
 * - Key generation produces valid Ed25519 public keys (32 bytes)
 * - sign() produces signatures verifiable with the corresponding public key
 * - sign() rejects when the store is locked
 * - sign() rejects with a revoked key
 * - getPublicDescriptor returns undefined for unknown keyId
 * - Key material never appears in toString(), JSON.stringify(), or error messages
 * - Multiple keys in the same store are scoped correctly
 * - Lock/unlock cycle works correctly
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as ed from "@noble/ed25519";
import { InMemorySecureKeyStore } from "./in-memory-key-store.js";
import { WindowsSecureKeyStore } from "./windows-key-store.js";

// ---------------------------------------------------------------------------
// Conformance harness - runs against concrete implementations that have
// toString() and toJSON() methods.
// ---------------------------------------------------------------------------

function runConformanceSuite(
  name: string,
  createStore: () => InMemorySecureKeyStore | WindowsSecureKeyStore,
): void {
  describe(`${name} conformance`, () => {
    let store: InMemorySecureKeyStore | WindowsSecureKeyStore;

    beforeEach(() => {
      store = createStore();
    });

    describe("key generation", () => {
      it("produces a valid Ed25519 public key (32 bytes)", async () => {
        const result = await store.generateKey("test-scope");
        expect(result.publicKey).toBeInstanceOf(Uint8Array);
        expect(result.publicKey.byteLength).toBe(32);
      });

      it("produces unique key IDs", async () => {
        const key1 = await store.generateKey("scope-a");
        const key2 = await store.generateKey("scope-b");
        expect(key1.keyId).not.toBe(key2.keyId);
      });

      it("returns a non-empty keyId string", async () => {
        const result = await store.generateKey("my-scope");
        expect(typeof result.keyId).toBe("string");
        expect(result.keyId.length).toBeGreaterThan(0);
      });
    });

    describe("getPublicDescriptor", () => {
      it("returns descriptor for an existing key", async () => {
        const { keyId, publicKey } = await store.generateKey("test");
        const descriptor = await store.getPublicDescriptor(keyId);
        expect(descriptor).toBeDefined();
        expect(descriptor!.keyId).toBe(keyId);
        expect(descriptor!.publicKey).toEqual(publicKey);
        expect(descriptor!.algorithm).toBe("Ed25519");
        expect(descriptor!.status).toBe("active");
      });

      it("returns undefined for unknown keyId", async () => {
        const descriptor = await store.getPublicDescriptor("nonexistent-key-id");
        expect(descriptor).toBeUndefined();
      });

      it("shows revoked status after revocation", async () => {
        const { keyId } = await store.generateKey("test");
        await store.revokeKey(keyId);
        const descriptor = await store.getPublicDescriptor(keyId);
        expect(descriptor).toBeDefined();
        expect(descriptor!.status).toBe("revoked");
      });
    });

    describe("signing", () => {
      it("produces signatures that verify with ed25519.verifyAsync", async () => {
        const { keyId, publicKey } = await store.generateKey("signing-test");
        const data = new TextEncoder().encode("hello world");
        const signature = await store.sign(keyId, data);

        expect(signature).toBeInstanceOf(Uint8Array);
        expect(signature.byteLength).toBe(64); // Ed25519 signature is 64 bytes

        const valid = await ed.verifyAsync(signature, data, publicKey);
        expect(valid).toBe(true);
      });

      it("produces different signatures for different data", async () => {
        const { keyId } = await store.generateKey("test");
        const data1 = new TextEncoder().encode("message one");
        const data2 = new TextEncoder().encode("message two");
        const sig1 = await store.sign(keyId, data1);
        const sig2 = await store.sign(keyId, data2);
        expect(sig1).not.toEqual(sig2);
      });

      it("rejects when store is locked", async () => {
        const { keyId } = await store.generateKey("test");
        store.lockStore();
        const data = new TextEncoder().encode("test data");
        await expect(store.sign(keyId, data)).rejects.toThrow("locked");
      });

      it("rejects with revoked key", async () => {
        const { keyId } = await store.generateKey("test");
        await store.revokeKey(keyId);
        const data = new TextEncoder().encode("test data");
        await expect(store.sign(keyId, data)).rejects.toThrow("revoked");
      });

      it("throws for non-existent key", async () => {
        const data = new TextEncoder().encode("test data");
        await expect(store.sign("no-such-key", data)).rejects.toThrow();
      });
    });

    describe("lock/unlock cycle", () => {
      it("starts unlocked", () => {
        expect(store.isLocked()).toBe(false);
      });

      it("lockStore sets locked state", () => {
        store.lockStore();
        expect(store.isLocked()).toBe(true);
      });

      it("unlockStore with correct credential unlocks", () => {
        store.lockStore();
        expect(store.isLocked()).toBe(true);
        store.unlockStore("default-credential");
        expect(store.isLocked()).toBe(false);
      });

      it("unlockStore with wrong credential throws", () => {
        store.lockStore();
        expect(() => store.unlockStore("wrong-credential")).toThrow("Invalid credential");
      });

      it("sign succeeds after unlock", async () => {
        const { keyId, publicKey } = await store.generateKey("test");
        const data = new TextEncoder().encode("cycle test");

        // Lock, attempt sign, unlock, sign again
        store.lockStore();
        await expect(store.sign(keyId, data)).rejects.toThrow("locked");

        store.unlockStore("default-credential");
        const signature = await store.sign(keyId, data);
        const valid = await ed.verifyAsync(signature, data, publicKey);
        expect(valid).toBe(true);
      });
    });

    describe("multiple keys", () => {
      it("supports multiple keys with different scopes", async () => {
        const key1 = await store.generateKey("scope-a");
        const key2 = await store.generateKey("scope-b");
        const data = new TextEncoder().encode("multi-key test");

        const sig1 = await store.sign(key1.keyId, data);
        const sig2 = await store.sign(key2.keyId, data);

        // Each signature verifies with its own public key
        expect(await ed.verifyAsync(sig1, data, key1.publicKey)).toBe(true);
        expect(await ed.verifyAsync(sig2, data, key2.publicKey)).toBe(true);

        // Cross-verification fails
        expect(await ed.verifyAsync(sig1, data, key2.publicKey)).toBe(false);
        expect(await ed.verifyAsync(sig2, data, key1.publicKey)).toBe(false);
      });

      it("revoking one key does not affect another", async () => {
        const key1 = await store.generateKey("scope-a");
        const key2 = await store.generateKey("scope-b");
        const data = new TextEncoder().encode("isolation test");

        await store.revokeKey(key1.keyId);

        await expect(store.sign(key1.keyId, data)).rejects.toThrow("revoked");
        const sig2 = await store.sign(key2.keyId, data);
        expect(await ed.verifyAsync(sig2, data, key2.publicKey)).toBe(true);
      });
    });

    describe("key material never exposed", () => {
      it("toString() does not contain private key bytes", async () => {
        await store.generateKey("secret-scope");
        const str = String(store);
        expect(str).not.toContain("privateKey");
        expect(str).not.toContain("private");
      });

      it("JSON.stringify() does not contain private key material", async () => {
        await store.generateKey("secret-scope");
        const json = JSON.stringify(store);
        expect(json).not.toContain("privateKey");
        expect(json).not.toContain("private");
      });

      it("error messages do not contain key material on locked store", async () => {
        const { keyId } = await store.generateKey("test");
        store.lockStore();
        try {
          await store.sign(keyId, new Uint8Array([1, 2, 3]));
          expect.fail("should have thrown");
        } catch (e: unknown) {
          const message = (e as Error).message;
          expect(message).not.toContain("privateKey");
          expect(message).not.toContain("0x");
        }
      });

      it("error messages do not contain key material on revoked key", async () => {
        const { keyId } = await store.generateKey("test");
        await store.revokeKey(keyId);
        try {
          await store.sign(keyId, new Uint8Array([1, 2, 3]));
          expect.fail("should have thrown");
        } catch (e: unknown) {
          const message = (e as Error).message;
          expect(message).not.toContain("privateKey");
          expect(message).not.toContain("0x");
        }
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Run conformance suite against both implementations
// ---------------------------------------------------------------------------

runConformanceSuite(
  "InMemorySecureKeyStore",
  () => new InMemorySecureKeyStore("default-credential"),
);
runConformanceSuite("WindowsSecureKeyStore", () => new WindowsSecureKeyStore("default-credential"));
