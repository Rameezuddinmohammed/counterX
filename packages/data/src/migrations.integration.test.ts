import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PostgresDatabase } from "./database.js";
import { applySyntheticSeed, loadMigrations, MigrationRunner } from "./migrations.js";

const testDatabaseUrl = process.env["TEST_DATABASE_URL"]?.trim() || undefined;
const databaseDescribe = testDatabaseUrl === undefined ? describe.skip : describe;
const migrationsDirectory = fileURLToPath(new URL("../migrations", import.meta.url));
const testSeedPath = fileURLToPath(new URL("../seeds/test.sql", import.meta.url));
const protectedRelations = [
  ["identity", "scope_registry"],
  ["merchant", "scopes"],
  ["wallet", "scopes"],
  ["identity", "actors"],
  ["identity", "actor_role_assignments"],
  ["identity", "agent_public_keys"],
  ["identity", "service_identities"],
  ["identity", "support_grants"],
  ["identity", "support_grant_permissions"],
  ["identity", "support_grant_events"],
  ["identity", "support_grant_authorizations"],
  ["identity", "support_grant_authorization_permissions"],
] as const;

const identityFunctionSignatures = [
  "identity.access_scope_claim_matches(platform.counter_environment,text,text)",
  "identity.assurance_claim_permits(text)",
  "identity.current_actor_has_authority(platform.counter_environment,text,text)",
  "identity.enforce_actor_role_assignment()",
  "identity.enforce_support_grant_revocation()",
  "identity.is_counter_id(text,text)",
  "identity.operator_platform_claim(platform.counter_environment,text)",
  "identity.operator_scope_bootstrap_claim(platform.counter_environment,text,text)",
  "identity.permission_claim_in(text[])",
  "identity.reject_column_changes()",
  "identity.reject_event_mutation()",
  "identity.require_registered_owner_scope()",
  "identity.require_support_grant_authorization_permission()",
  "identity.require_support_grant_permission()",
  "identity.scope_claim_matches(platform.counter_environment,text,text)",
] as const;

databaseDescribe("PostgreSQL migration lifecycle", () => {
  if (testDatabaseUrl === undefined) {
    return;
  }

  const database = new PostgresDatabase(testDatabaseUrl);

  beforeEach(async () => {
    await dropApplicationSchemas(database);
  });

  afterAll(async () => {
    try {
      await dropApplicationSchemas(database);
    } finally {
      await database.close();
    }
  });

  it("upgrades version 2 to 3, rolls version 3 back, and restores the latest schema", async () => {
    const migrations = await loadMigrations(migrationsDirectory);
    const runner = new MigrationRunner(database, migrations);

    const empty = await runner.status();
    expect(empty.currentVersion).toBe(0);
    expect(empty.latestVersion).toBe(9);
    expect(empty.pending.map((migration) => migration.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);

    const firstVersion = await runner.up(1);
    expect(firstVersion.currentVersion).toBe(1);
    await expect(tableExists(database, "platform", "environment_registry")).resolves.toBe(true);
    await expect(tableExists(database, "platform", "synthetic_fixtures")).resolves.toBe(false);

    const previousVersion = await runner.up(2);
    expect(previousVersion.currentVersion).toBe(2);
    expect(previousVersion.applied.map((migration) => migration.version)).toEqual([1, 2]);
    await expect(tableExists(database, "platform", "synthetic_fixtures")).resolves.toBe(true);
    await expect(schemaExists(database, "identity")).resolves.toBe(false);
    await expect(schemaExists(database, "merchant")).resolves.toBe(false);
    await expect(schemaExists(database, "wallet")).resolves.toBe(false);

    const upgraded = await runner.up(4);
    expect(upgraded.currentVersion).toBe(4);
    expect(upgraded.pending.map((migration) => migration.version)).toEqual([5, 6, 7, 8, 9]);
    expect(upgraded.applied.map(({ version, name }) => ({ version, name }))).toEqual([
      { version: 1, name: "environment-registry" },
      { version: 2, name: "synthetic-fixtures" },
      { version: 3, name: "identity-tenancy-scope" },
      { version: 4, name: "support-grant-authorizations" },
    ]);
    await expect(schemaExists(database, "identity")).resolves.toBe(true);
    await expect(schemaExists(database, "merchant")).resolves.toBe(true);
    await expect(schemaExists(database, "wallet")).resolves.toBe(true);
    await expect(forcedRlsRelations(database)).resolves.toEqual(
      protectedRelations.map(([schema, table]) => `${schema}.${table}`).sort(),
    );
    await expect(identityFunctions(database)).resolves.toEqual([...identityFunctionSignatures]);

    await applySyntheticSeed(database, testSeedPath);
    await applySyntheticSeed(database, testSeedPath);
    const fixtures = await database.query<{
      classification: string;
      environment: string;
      synthetic: boolean;
    }>(
      `SELECT classification, environment, (payload ->> 'synthetic')::boolean AS synthetic
       FROM platform.synthetic_fixtures`,
    );
    expect(fixtures.rows).toEqual([
      { classification: "synthetic", environment: "test", synthetic: true },
    ]);

    const rolledBackToPrevious = await runner.down(2);
    expect(rolledBackToPrevious.currentVersion).toBe(2);
    expect(rolledBackToPrevious.applied.map((migration) => migration.version)).toEqual([1, 2]);
    await expect(tableExists(database, "platform", "environment_registry")).resolves.toBe(true);
    await expect(tableExists(database, "platform", "synthetic_fixtures")).resolves.toBe(true);
    await expect(schemaExists(database, "identity")).resolves.toBe(false);
    await expect(schemaExists(database, "merchant")).resolves.toBe(false);
    await expect(schemaExists(database, "wallet")).resolves.toBe(false);
    await expect(identityFunctions(database)).resolves.toEqual([]);

    const reappliedThird = await runner.up(3);
    expect(reappliedThird.currentVersion).toBe(3);
    // support_grant_authorizations / support_grant_authorization_permissions and
    // identity.require_support_grant_authorization_permission() are created by migration 4
    // and must not appear yet at version 3.
    await expect(forcedRlsRelations(database)).resolves.toHaveLength(protectedRelations.length - 2);
    await expect(identityFunctions(database)).resolves.toEqual(
      identityFunctionSignatures.filter(
        (signature) => signature !== "identity.require_support_grant_authorization_permission()",
      ),
    );

    const rolledBackOne = await runner.down(1);
    expect(rolledBackOne.currentVersion).toBe(1);
    await expect(tableExists(database, "platform", "environment_registry")).resolves.toBe(true);
    await expect(tableExists(database, "platform", "synthetic_fixtures")).resolves.toBe(false);
    await expect(schemaExists(database, "identity")).resolves.toBe(false);

    const rolledBackAll = await runner.down(0);
    expect(rolledBackAll.currentVersion).toBe(0);
    await expect(tableExists(database, "platform", "environment_registry")).resolves.toBe(false);

    const restored = await runner.up();
    expect(restored.currentVersion).toBe(9);
    expect(restored.applied.map((migration) => migration.version)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    await expect(forcedRlsRelations(database)).resolves.toHaveLength(protectedRelations.length);
    await expect(identityFunctions(database)).resolves.toEqual([...identityFunctionSignatures]);
  });

  it("refuses to erase unexpected later objects during version 3 rollback", async () => {
    const migrations = await loadMigrations(migrationsDirectory);
    const runner = new MigrationRunner(database, migrations);
    await runner.up(3);
    await database.query(
      `CREATE TABLE identity.unexpected_later_object (
         id integer PRIMARY KEY
       )`,
    );

    await expect(runner.down(2)).rejects.toMatchObject({ code: "2BP01" });
    const unchanged = await runner.status();
    expect(unchanged.currentVersion).toBe(3);
    await expect(tableExists(database, "identity", "unexpected_later_object")).resolves.toBe(true);
    await expect(tableExists(database, "identity", "actors")).resolves.toBe(true);
    // Only migrations 1-3 are applied here; identity.require_support_grant_authorization_permission()
    // is created by migration 4 (support-grant-authorizations) and must not appear yet.
    await expect(identityFunctions(database)).resolves.toEqual(
      identityFunctionSignatures.filter(
        (signature) => signature !== "identity.require_support_grant_authorization_permission()",
      ),
    );

    await database.query("DROP TABLE identity.unexpected_later_object");
    const rolledBack = await runner.down(2);
    expect(rolledBack.currentVersion).toBe(2);
    await expect(schemaExists(database, "identity")).resolves.toBe(false);
    await expect(identityFunctions(database)).resolves.toEqual([]);
  });
});

async function dropApplicationSchemas(database: PostgresDatabase): Promise<void> {
  await database.query(`
    DROP SCHEMA IF EXISTS wallet CASCADE;
    DROP SCHEMA IF EXISTS merchant CASCADE;
    DROP SCHEMA IF EXISTS identity CASCADE;
    DROP SCHEMA IF EXISTS runtime CASCADE;
    DROP SCHEMA IF EXISTS platform CASCADE;
  `);
}

async function schemaExists(database: PostgresDatabase, schemaName: string): Promise<boolean> {
  const result = await database.query<{ exists: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = $1) AS exists",
    [schemaName],
  );
  return result.rows[0]?.exists ?? false;
}

async function tableExists(
  database: PostgresDatabase,
  schemaName: string,
  tableName: string,
): Promise<boolean> {
  const result = await database.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.tables
       WHERE table_schema = $1 AND table_name = $2
     ) AS exists`,
    [schemaName, tableName],
  );
  return result.rows[0]?.exists ?? false;
}

async function forcedRlsRelations(database: PostgresDatabase): Promise<string[]> {
  const result = await database.query<{ relation: string }>(
    `SELECT namespace.nspname || '.' || relation.relname AS relation
     FROM pg_class relation
     JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = ANY ($1::text[])
       AND relation.relrowsecurity
       AND relation.relforcerowsecurity
     ORDER BY relation`,
    [["identity", "merchant", "wallet"]],
  );
  return result.rows.map((row) => row.relation);
}

async function identityFunctions(database: PostgresDatabase): Promise<string[]> {
  const result = await database.query<{ signature: string }>(
    `SELECT function_record.oid::pg_catalog.regprocedure::text AS signature
     FROM pg_catalog.pg_proc function_record
     JOIN pg_catalog.pg_namespace namespace
       ON namespace.oid = function_record.pronamespace
     WHERE namespace.nspname = 'identity'
     ORDER BY signature`,
  );
  return result.rows.map((row) => row.signature);
}
