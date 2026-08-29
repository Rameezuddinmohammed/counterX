/**
 * DB-gated integration tests for PostgresPolicyStore.
 *
 * Skipped when TEST_DATABASE_URL is unset (matching the repository convention
 * in rls.integration.test.ts / migrations.integration.test.ts). Runs the full
 * migration set (including 0006-merchant-policy-configs) before exercising the
 * store.
 */
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresDatabase } from "./database.js";
import { loadMigrations, MigrationRunner } from "./migrations.js";
import { PostgresPolicyStore } from "./policy-store.js";

const testDatabaseUrl = process.env["TEST_DATABASE_URL"]?.trim() || undefined;
const databaseDescribe = testDatabaseUrl === undefined ? describe.skip : describe;
const migrationsDirectory = fileURLToPath(new URL("../migrations", import.meta.url));
const databaseHookTimeout = 30_000;

databaseDescribe("PostgresPolicyStore", () => {
  if (testDatabaseUrl === undefined) {
    return;
  }

  const database = new PostgresDatabase(testDatabaseUrl);
  const store = new PostgresPolicyStore(database, "local");

  beforeAll(async () => {
    const migrations = await loadMigrations(migrationsDirectory);
    await new MigrationRunner(database, migrations).up();
  }, databaseHookTimeout);

  afterAll(async () => {
    await database.close();
  });

  it("round-trips a config and increments the version", async () => {
    const merchantId = `ctr_merchant_${randomUUID().replaceAll("-", "").slice(0, 22)}`;
    const config = { policyVersion: "1.0.0", rules: [{ ruleId: "r1" }] };

    const empty = await store.get(merchantId);
    expect(empty.ok).toBe(true);
    if (empty.ok) {
      expect(empty.value).toBeUndefined();
    }

    const first = await store.set(merchantId, config, undefined);
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.value.success).toBe(true);
      expect(first.value.currentVersion).toBe(1);
    }

    const read = await store.get(merchantId);
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.value?.version).toBe(1);
      expect(read.value?.config).toEqual(config);
    }

    const second = await store.set(merchantId, { policyVersion: "2.0.0", rules: [] }, 1);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.value.success).toBe(true);
      expect(second.value.currentVersion).toBe(2);
    }
  });

  it("rejects a write with a stale expectedVersion (optimistic concurrency)", async () => {
    const merchantId = `ctr_merchant_${randomUUID().replaceAll("-", "").slice(0, 22)}`;

    const first = await store.set(merchantId, { policyVersion: "1.0.0", rules: [] }, undefined);
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.value.currentVersion).toBe(1);
    }

    // Stale writer believes version is still 0.
    const stale = await store.set(merchantId, { policyVersion: "bad", rules: [] }, 0);
    expect(stale.ok).toBe(true);
    if (stale.ok) {
      expect(stale.value.success).toBe(false);
      expect(stale.value.currentVersion).toBe(1);
    }

    // The stale write must not have mutated the stored config.
    const read = await store.get(merchantId);
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.value?.version).toBe(1);
      expect((read.value?.config as { policyVersion: string }).policyVersion).toBe("1.0.0");
    }
  });
});
