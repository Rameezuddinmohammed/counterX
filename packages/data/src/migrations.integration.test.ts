import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PostgresDatabase } from "./database.js";
import { applySyntheticSeed, loadMigrations, MigrationRunner } from "./migrations.js";

const testDatabaseUrl = process.env["TEST_DATABASE_URL"]?.trim() || undefined;
const databaseDescribe = testDatabaseUrl === undefined ? describe.skip : describe;
const migrationsDirectory = fileURLToPath(new URL("../migrations", import.meta.url));
const testSeedPath = fileURLToPath(new URL("../seeds/test.sql", import.meta.url));
// The full set as of migration 4 (identity-tenancy-scope + support-grant-
// authorizations). This exact set held unchanged all the way through
// migration 10 (nothing after 4 added a new RLS-protected table), so a
// single shared constant used to double as "the v4 set" AND "the latest
// set" below — until migration 11 (wallet-user-onboarding) added two more.
// Kept split into two constants now so a future migration that adds another
// RLS table only needs to update protectedRelationsAtLatest, not silently
// desync the v3/v4 assertions above it.
const protectedRelationsAtV4 = [
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

// Migrations 12-16 (recurring-payment-mandates, shopify-connections,
// merchant-onboarding-applications, merchant-onboarding-payment-and-manifest)
// each added RLS-enabled+forced tables with zero policies, same direct-SQL
// trust boundary as wallet_setup_tokens/wallet_users below — verified against
// each migration's .up.sql (ENABLE + FORCE ROW LEVEL SECURITY, no
// CREATE POLICY) before adding here, not just padding the count to match CI.
// Migration 18 (catalog-sync-storage) added 5 more, same pattern, same
// verification discipline. runtime.receipts (migration 17) is deliberately
// NOT here - it lives in the runtime schema, which this RLS check doesn't
// query, and (matching every other runtime.* table) doesn't use RLS at all.
const protectedRelationsAtLatest = [
  ...protectedRelationsAtV4,
  ["identity", "wallet_setup_tokens"],
  ["identity", "wallet_users"],
  ["merchant", "capability_manifests"],
  ["merchant", "catalog_inventory"],
  ["merchant", "catalog_prices"],
  ["merchant", "catalog_products"],
  ["merchant", "catalog_sync_cursors"],
  ["merchant", "catalog_variants"],
  ["merchant", "manual_catalog_items"],
  ["merchant", "onboarding_applications"],
  ["merchant", "payment_connections"],
  ["merchant", "shopify_connections"],
  ["merchant", "shopify_oauth_states"],
  ["wallet", "recurring_payment_mandates"],
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
    // Derived from the actual migrations directory rather than hardcoded, so
    // adding a new migration file cannot silently desync this expectation
    // (this exact staleness bug bit two assertions before this fix).
    const latest = migrations.length;
    const allVersions = Array.from({ length: latest }, (_, index) => index + 1);

    const empty = await runner.status();
    expect(empty.currentVersion).toBe(0);
    expect(empty.latestVersion).toBe(latest);
    expect(empty.pending.map((migration) => migration.version)).toEqual(allVersions);

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
    expect(upgraded.pending.map((migration) => migration.version)).toEqual(allVersions.slice(4));
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
      protectedRelationsAtV4.map(([schema, table]) => `${schema}.${table}`).sort(),
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
    await expect(forcedRlsRelations(database)).resolves.toHaveLength(
      protectedRelationsAtV4.length - 2,
    );
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
    expect(restored.currentVersion).toBe(latest);
    expect(restored.applied.map((migration) => migration.version)).toEqual(allVersions);
    await expect(forcedRlsRelations(database)).resolves.toHaveLength(
      protectedRelationsAtLatest.length,
    );
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
