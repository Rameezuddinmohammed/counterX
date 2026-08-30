/**
 * PRIORITY 3 — Tenant/environment isolation proven THROUGH Postgres RLS.
 *
 * NON-DESTRUCTIVE variant of the RLS proof, safe to run against the shared live
 * database: it NEVER drops or migrates the schema. It creates a DEDICATED
 * restricted (NOSUPERUSER / NOBYPASSRLS / NOINHERIT / LOGIN) role at runtime
 * from the admin connection, seeds ONLY its own uniquely-keyed identity rows
 * (two isolated merchants A and B, each with an owner actor + role assignment),
 * connects AS the restricted role, and drives scoped transactions by setting the
 * `counter.*` claims Postgres RLS reads. It then asserts, with RLS actually
 * enforced by Postgres (proven by asserting the login role's posture):
 *   - merchant A's claims see ONLY A's actor, NEVER B's (and vice versa);
 *   - a guessed cross-tenant id returns not-found (zero rows) under A's claims;
 *   - a sandbox-environment identity is invisible to a test-environment claim
 *     even for the same opaque id (sandbox/test cannot cross-authorize).
 *
 * Finally it deletes ONLY its own seeded rows and drops ONLY its own role.
 *
 * SKIPPED unless TEST_DATABASE_URL (which, per the task, may point at the live
 * DB precisely because this test is non-destructive) is present AND the login
 * role can create the restricted role (CREATEROLE + super/bypassrls to own the
 * seed). If the login role cannot create roles the suite skips with a clear
 * reason rather than failing.
 */
import { randomUUID } from "node:crypto";

import {
  createCounterId,
  type CounterId,
  type CounterIdKind,
  type MerchantId,
} from "@counter/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DatabaseSession } from "./database.js";
import { PostgresDatabase } from "./database.js";

const testDatabaseUrl = process.env["TEST_DATABASE_URL"]?.trim() || undefined;
const databaseDescribe = testDatabaseUrl === undefined ? describe.skip : describe;
const hookTimeout = 45_000;

// Unique per-run ids so the seed never collides with real data or other runs.
const runSalt = (Math.abs(hashString(`${process.pid}-${randomUUID()}`)) % 200) + 50;
const ids = Object.freeze({
  merchantA: counterId("merchant", runSalt),
  merchantB: counterId("merchant", runSalt + 1),
  ownerA: counterId("merchant-user", runSalt + 2),
  ownerB: counterId("merchant-user", runSalt + 3),
  sandboxOwnerA: counterId("merchant-user", runSalt + 4),
});
const createdAt = new Date(Date.now() - 60 * 60 * 1000);

const claimNames = [
  "counter.environment",
  "counter.actor_kind",
  "counter.actor_id",
  "counter.assurance",
  "counter.scope_kind",
  "counter.scope_id",
  "counter.permission",
] as const;
type ClaimName = (typeof claimNames)[number];
type Claims = Partial<Record<ClaimName, string>>;

function merchantClaims(
  merchantId: MerchantId,
  actorId: CounterId<"merchant-user">,
  environment = "test",
): Claims {
  return {
    "counter.environment": environment,
    "counter.actor_kind": "merchant_user",
    "counter.actor_id": actorId,
    "counter.assurance": "multi_factor",
    "counter.scope_kind": "merchant",
    "counter.scope_id": merchantId,
    "counter.permission": "identity.actor.read",
  };
}

databaseDescribe("PostgreSQL RLS tenant isolation (non-destructive, live-DB-safe)", () => {
  if (testDatabaseUrl === undefined) {
    return;
  }

  const admin = new PostgresDatabase(testDatabaseUrl);
  const roleName = `counter_tenant_${process.pid}_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  const rolePassword = randomUUID();
  let appDatabase: PostgresDatabase | undefined;
  let roleCreated = false;
  let seeded = false;
  let skipReason: string | undefined;

  beforeAll(async () => {
    // The login role must be able to create the restricted role and own the
    // seed (super or bypassrls). If not, skip cleanly.
    const posture = await admin.query<{
      rolcreaterole: boolean;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(`SELECT rolcreaterole, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`);
    const p = posture.rows[0];
    if (p === undefined || !p.rolcreaterole || (!p.rolsuper && !p.rolbypassrls)) {
      skipReason =
        "login role lacks CREATEROLE + SUPER/BYPASSRLS; cannot run non-destructive RLS proof";
      return;
    }

    await createRestrictedRole(admin, roleName, rolePassword);
    roleCreated = true;
    await grantReadPrivileges(admin, roleName);

    await seedTenantFixtures(admin);
    seeded = true;

    const appUrl = new URL(testDatabaseUrl);
    // Supabase's connection pooler routes by a tenant/project ref embedded in
    // the username as `<role>.<projectRef>`. The CREATE ROLE above created the
    // bare role name; preserve the admin username's project-ref suffix (if any)
    // so the pooler can still route the connection to this project.
    const adminUser = decodeURIComponent(appUrl.username);
    const dotIndex = adminUser.indexOf(".");
    const projectRefSuffix = dotIndex >= 0 ? adminUser.slice(dotIndex) : "";
    appUrl.username = `${roleName}${projectRefSuffix}`;
    appUrl.password = rolePassword;
    appDatabase = new PostgresDatabase({ connectionString: appUrl.toString(), max: 1 });
  }, hookTimeout);

  afterAll(async () => {
    const errors: unknown[] = [];
    const attempt = async (op: () => Promise<unknown>): Promise<void> => {
      try {
        await op();
      } catch (error) {
        errors.push(error);
      }
    };
    if (appDatabase !== undefined) {
      await attempt(async () => appDatabase!.close());
    }
    if (seeded) {
      // Delete ONLY this run's own rows.
      await attempt(async () =>
        admin.query(
          `DELETE FROM identity.actor_role_assignments WHERE actor_id = ANY($1::text[])`,
          [[ids.ownerA, ids.ownerB, ids.sandboxOwnerA]],
        ),
      );
      await attempt(async () =>
        admin.query(`DELETE FROM identity.actors WHERE actor_id = ANY($1::text[])`, [
          [ids.ownerA, ids.ownerB, ids.sandboxOwnerA],
        ]),
      );
      await attempt(async () =>
        admin.query(`DELETE FROM merchant.scopes WHERE merchant_id = ANY($1::text[])`, [
          [ids.merchantA, ids.merchantB],
        ]),
      );
      await attempt(async () =>
        admin.query(`DELETE FROM identity.scope_registry WHERE scope_id = ANY($1::text[])`, [
          [ids.merchantA, ids.merchantB],
        ]),
      );
    }
    if (roleCreated) {
      const quoted = quoteIdentifier(roleName);
      // The role owns no objects (only holds GRANTs). REVOKE every privilege
      // we granted so DROP ROLE has no remaining dependencies. Using explicit
      // REVOKEs (not DROP OWNED BY) because the non-superuser admin login on the
      // pooler cannot DROP OWNED objects but can revoke its own grants.
      await attempt(async () => revokeReadPrivileges(admin, roleName));
      await attempt(async () => admin.query(`DROP ROLE ${quoted}`));
    }
    await attempt(async () => admin.close());
    if (errors.length > 0) {
      const detail = errors.map((e) => (e instanceof Error ? e.message : String(e))).join(" | ");
      throw new AggregateError(errors, `tenant-isolation cleanup failed: ${detail}`);
    }
  }, hookTimeout);

  it("uses a genuine no-bypass restricted login role (so RLS is truly enforced)", async () => {
    if (skipReason !== undefined) return; // skipped: insufficient login-role privileges
    const database = requireDb(appDatabase);
    const posture = await database.query<{
      current_user: string;
      rolbypassrls: boolean;
      rolsuper: boolean;
      rolinherit: boolean;
    }>(
      `SELECT current_user, rolbypassrls, rolsuper, rolinherit
       FROM pg_roles WHERE rolname = current_user`,
    );
    expect(posture.rows[0]).toMatchObject({
      current_user: roleName,
      rolbypassrls: false,
      rolsuper: false,
      rolinherit: false,
    });
  });

  it("isolates merchant A from merchant B in both directions", async () => {
    if (skipReason !== undefined) return;
    const database = requireDb(appDatabase);
    await expect(
      visibleOwners(database, merchantClaims(ids.merchantA, ids.ownerA)),
    ).resolves.toEqual([ids.ownerA]);
    await expect(
      visibleOwners(database, merchantClaims(ids.merchantB, ids.ownerB)),
    ).resolves.toEqual([ids.ownerB]);
  });

  it("returns not-found for a guessed cross-tenant id", async () => {
    if (skipReason !== undefined) return;
    const database = requireDb(appDatabase);
    // Under A's claims, B's owner id (a "guessed" cross-tenant id) is invisible.
    await expect(
      actorVisible(database, merchantClaims(ids.merchantA, ids.ownerA), ids.ownerB),
    ).resolves.toBe(false);
    await expect(
      actorVisible(database, merchantClaims(ids.merchantB, ids.ownerB), ids.ownerA),
    ).resolves.toBe(false);
  });

  it("keeps identical opaque ids isolated across environments (sandbox cannot cross-authorize test)", async () => {
    if (skipReason !== undefined) return;
    const database = requireDb(appDatabase);
    // The sandbox owner is invisible to a test-environment claim for the same merchant.
    await expect(
      environmentsFor(
        database,
        merchantClaims(ids.merchantA, ids.ownerA, "test"),
        ids.sandboxOwnerA,
      ),
    ).resolves.toEqual([]);
    // And visible to its own sandbox claim.
    await expect(
      environmentsFor(
        database,
        merchantClaims(ids.merchantA, ids.sandboxOwnerA, "sandbox"),
        ids.sandboxOwnerA,
      ),
    ).resolves.toEqual(["sandbox"]);
  });

  // ─── helpers bound to this suite ───────────────────────────────────────────

  async function seedTenantFixtures(database: PostgresDatabase): Promise<void> {
    await database.transaction(async (session) => {
      const scopes = [
        { environment: "test", id: ids.merchantA },
        { environment: "test", id: ids.merchantB },
        { environment: "sandbox", id: ids.merchantA },
      ] as const;
      for (const scope of scopes) {
        await session.query(
          `INSERT INTO identity.scope_registry (environment, scope_kind, scope_id, created_at)
           VALUES ($1, 'merchant', $2, $3)
           ON CONFLICT DO NOTHING`,
          [scope.environment, scope.id, createdAt],
        );
        await session.query(
          `INSERT INTO merchant.scopes (environment, merchant_id, created_at)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [scope.environment, scope.id, createdAt],
        );
      }
      const actors = [
        { env: "test", id: ids.ownerA, scope: ids.merchantA },
        { env: "test", id: ids.ownerB, scope: ids.merchantB },
        { env: "sandbox", id: ids.sandboxOwnerA, scope: ids.merchantA },
      ] as const;
      for (const actor of actors) {
        await session.query(
          `INSERT INTO identity.actors (
             environment, actor_kind, actor_id, owner_scope_kind, owner_scope_id,
             status, created_at, disabled_at
           ) VALUES ($1, 'merchant_user', $2, 'merchant', $3, 'active', $4, NULL)`,
          [actor.env, actor.id, actor.scope, createdAt],
        );
        await session.query(
          `INSERT INTO identity.actor_role_assignments (
             environment, actor_kind, actor_id, owner_scope_kind, owner_scope_id,
             role_key, assigned_by_kind, assigned_by_id, assigned_at, revoked_at
           ) VALUES ($1, 'merchant_user', $2, 'merchant', $3, 'merchant.owner',
             'merchant_user', $2, $4, NULL)`,
          [actor.env, actor.id, actor.scope, createdAt],
        );
      }
    });
  }
});

async function withClaims<Result>(
  database: PostgresDatabase,
  claims: Claims,
  operation: (session: DatabaseSession) => Promise<Result>,
): Promise<Result> {
  return database.transaction(async (session) => {
    for (const name of claimNames) {
      const value = claims[name];
      if (value !== undefined) {
        await session.query("SELECT set_config($1, $2, true)", [name, value]);
      }
    }
    return operation(session);
  });
}

async function visibleOwners(database: PostgresDatabase, claims: Claims): Promise<string[]> {
  return withClaims(database, claims, async (session) => {
    const result = await session.query<{ actor_id: string }>(
      `SELECT actor_id FROM identity.actors WHERE actor_kind = 'merchant_user' ORDER BY actor_id`,
    );
    return result.rows.map((row) => row.actor_id);
  });
}

async function actorVisible(
  database: PostgresDatabase,
  claims: Claims,
  actorId: string,
): Promise<boolean> {
  return withClaims(database, claims, async (session) => {
    const result = await session.query(`SELECT 1 FROM identity.actors WHERE actor_id = $1`, [
      actorId,
    ]);
    return result.rowCount === 1;
  });
}

async function environmentsFor(
  database: PostgresDatabase,
  claims: Claims,
  actorId: string,
): Promise<string[]> {
  return withClaims(database, claims, async (session) => {
    const result = await session.query<{ environment: string }>(
      `SELECT environment::text AS environment FROM identity.actors WHERE actor_id = $1 ORDER BY environment`,
      [actorId],
    );
    return result.rows.map((row) => row.environment);
  });
}

async function createRestrictedRole(
  database: PostgresDatabase,
  roleName: string,
  password: string,
): Promise<void> {
  await database.query(
    `CREATE ROLE ${quoteIdentifier(roleName)} WITH
       LOGIN PASSWORD ${quoteLiteral(password)}
       NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`,
  );
}

async function grantReadPrivileges(database: PostgresDatabase, roleName: string): Promise<void> {
  const dbName = (
    await database.query<{ database_name: string }>("SELECT current_database() AS database_name")
  ).rows[0]?.database_name;
  if (dbName === undefined) throw new Error("could not resolve database name");
  const quoted = quoteIdentifier(roleName);
  await database.query(`GRANT CONNECT ON DATABASE ${quoteIdentifier(dbName)} TO ${quoted}`);
  await database.query(`GRANT USAGE ON SCHEMA platform, identity, merchant, wallet TO ${quoted}`);
  await database.query(`GRANT USAGE ON TYPE platform.counter_environment TO ${quoted}`);
  await database.query(
    `GRANT SELECT ON identity.permissions, identity.roles, identity.role_permissions TO ${quoted}`,
  );
  await database.query(
    `GRANT SELECT ON
       identity.scope_registry, identity.actors, identity.actor_role_assignments,
       merchant.scopes, wallet.scopes TO ${quoted}`,
  );
  await database.query(
    `GRANT EXECUTE ON FUNCTION
       identity.is_counter_id(text, text),
       identity.permission_claim_in(text[]),
       identity.operator_platform_claim(platform.counter_environment, text),
       identity.operator_scope_bootstrap_claim(platform.counter_environment, text, text),
       identity.access_scope_claim_matches(platform.counter_environment, text, text)
     TO ${quoted}`,
  );
}

async function revokeReadPrivileges(database: PostgresDatabase, roleName: string): Promise<void> {
  const dbName = (
    await database.query<{ database_name: string }>("SELECT current_database() AS database_name")
  ).rows[0]?.database_name;
  const quoted = quoteIdentifier(roleName);
  await database.query(
    `REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA platform, identity, merchant, wallet FROM ${quoted}`,
  );
  await database.query(`REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA identity FROM ${quoted}`);
  await database.query(`REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA identity FROM ${quoted}`);
  await database.query(`REVOKE USAGE ON TYPE platform.counter_environment FROM ${quoted}`);
  await database.query(
    `REVOKE ALL PRIVILEGES ON SCHEMA platform, identity, merchant, wallet FROM ${quoted}`,
  );
  if (dbName !== undefined) {
    await database.query(
      `REVOKE ALL PRIVILEGES ON DATABASE ${quoteIdentifier(dbName)} FROM ${quoted}`,
    );
  }
}

function requireDb(database: PostgresDatabase | undefined): PostgresDatabase {
  if (database === undefined) throw new Error("application database not initialized");
  return database;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
function counterId<Kind extends CounterIdKind>(kind: Kind, seed: number): CounterId<Kind> {
  const result = createCounterId(kind, new Uint8Array(16).fill(seed % 256));
  if (!result.ok) throw new Error(`could not create ${kind} id`);
  return result.value;
}
function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}
