/**
 * Integration proof for PostgresVaultKeyRepository against the real
 * wallet.vault_keys table (migration 0023) — proves the SQL matches the live
 * schema, and that the cross-tenant guarantees VaultSecureKeyStore depends on
 * hold in real Postgres rather than only in the in-memory fake.
 *
 * SKIPPED unless TEST_DATABASE_URL or DATABASE_URL is present (mirrors the
 * other *.integration.test.ts gates). SAFETY: every row is written under a
 * UNIQUE per-run id (via createCounterId, real 128-bit entropy) and, in
 * afterAll, deletes ONLY those rows. It never truncates, drops, or migrates
 * the shared schema. No secret material is written — wallet.vault_keys holds
 * only key ownership pointers.
 */
import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createCounterId } from "@counter/domain";
import type { CounterId } from "@counter/domain";
import { vaultTransitKeyName } from "@counter/wallet-domain";
import { PostgresDatabase } from "./database.js";
import { PostgresVaultKeyRepository } from "./vault-key-repository.js";

const databaseUrl =
  process.env["TEST_DATABASE_URL"]?.trim() || process.env["DATABASE_URL"]?.trim() || undefined;
const databaseDescribe = databaseUrl === undefined ? describe.skip : describe;
const databaseHookTimeout = 30_000;

function freshId<Kind extends "wallet" | "key">(kind: Kind): CounterId<Kind> {
  const result = createCounterId(kind, randomBytes(16));
  if (!result.ok) {
    throw new Error(`Failed to generate a fresh ${kind} id`);
  }
  return result.value;
}

databaseDescribe("PostgresVaultKeyRepository (real Postgres)", () => {
  const database = new PostgresDatabase(databaseUrl as string);
  const repository = new PostgresVaultKeyRepository(database, "test");
  const writtenKeyIds: string[] = [];

  afterAll(async () => {
    for (const keyId of writtenKeyIds) {
      await database.query(
        `DELETE FROM wallet.vault_keys WHERE environment = 'test' AND key_id = $1`,
        [keyId],
      );
    }
  }, databaseHookTimeout);

  async function seedKey(tenantId: string, scope = "agent-signing"): Promise<string> {
    const keyId = freshId("key");
    writtenKeyIds.push(keyId);
    await repository.create({
      tenantId,
      keyId,
      vaultKeyName: vaultTransitKeyName(tenantId, keyId),
      scope,
    });
    return keyId;
  }

  it(
    "round-trips a key ownership record",
    async () => {
      const tenantId = freshId("wallet");
      const keyId = await seedKey(tenantId);

      const record = await repository.findByKeyId(keyId);
      expect(record).toEqual({
        tenantId,
        keyId,
        vaultKeyName: `${tenantId}.${keyId}`,
        scope: "agent-signing",
        status: "active",
      });
    },
    databaseHookTimeout,
  );

  it(
    "returns undefined for a key id that was never written",
    async () => {
      expect(await repository.findByKeyId(freshId("key"))).toBeUndefined();
    },
    databaseHookTimeout,
  );

  it(
    "revokes a key and keeps the revocation monotonic",
    async () => {
      const tenantId = freshId("wallet");
      const keyId = await seedKey(tenantId);

      expect(await repository.revoke(tenantId, keyId)).toBe(true);
      expect((await repository.findByKeyId(keyId))?.status).toBe("revoked");

      const firstRevokedAt = await readRevokedAt(keyId);
      expect(firstRevokedAt).not.toBeNull();

      // A repeat revoke succeeds (idempotent) but never rewrites history.
      expect(await repository.revoke(tenantId, keyId)).toBe(true);
      expect(await readRevokedAt(keyId)).toEqual(firstRevokedAt);
    },
    databaseHookTimeout,
  );

  it(
    "refuses to revoke another tenant's key, and reports it as no match",
    async () => {
      const owner = freshId("wallet");
      const attacker = freshId("wallet");
      const keyId = await seedKey(owner);

      expect(await repository.revoke(attacker, keyId)).toBe(false);
      // The owner's key is completely untouched.
      expect((await repository.findByKeyId(keyId))?.status).toBe("active");
      expect(await readRevokedAt(keyId)).toBeNull();
    },
    databaseHookTimeout,
  );

  it(
    "partitions by environment: a 'test' repository cannot see a 'local' row",
    async () => {
      const tenantId = freshId("wallet");
      const keyId = await seedKey(tenantId);

      const otherEnvironment = new PostgresVaultKeyRepository(database, "local");
      expect(await otherEnvironment.findByKeyId(keyId)).toBeUndefined();
      expect(await otherEnvironment.revoke(tenantId, keyId)).toBe(false);
    },
    databaseHookTimeout,
  );

  async function readRevokedAt(keyId: string): Promise<Date | null> {
    const result = await database.query<{ revoked_at: Date | null }>(
      `SELECT revoked_at FROM wallet.vault_keys WHERE environment = 'test' AND key_id = $1`,
      [keyId],
    );
    return result.rows[0]?.revoked_at ?? null;
  }
});
