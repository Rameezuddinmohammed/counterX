import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  authorize,
  createActorContext,
  createJobAuthorizationEnvelope,
  createMerchantScopeRecord,
  createSupportGrantRecord,
  createWalletScopeRecord,
  parseJobAuthorizationEnvelope,
  reauthorizeJob,
  type ActorContext,
  type AuthorizedContext,
  type Permission,
  type SupportGrantRecord,
} from "@counter/authorization";
import {
  createCounterId,
  createExternalReference,
  instantFromEpochMilliseconds,
  merchantScope,
  platformScope,
  walletScope,
  type CounterId,
  type CounterIdKind,
  type Environment,
  type Instant,
  type MerchantId,
} from "@counter/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DatabaseSession } from "./database.js";
import { PostgresDatabase } from "./database.js";
import { PostgresIdentityRepositories } from "./identity-repositories.js";
import { loadMigrations, MigrationRunner } from "./migrations.js";
import { ScopedTransactionManager } from "./scoped-transaction.js";

const testDatabaseUrl = process.env["TEST_DATABASE_URL"]?.trim() || undefined;
const databaseDescribe = testDatabaseUrl === undefined ? describe.skip : describe;
const migrationsDirectory = fileURLToPath(new URL("../migrations", import.meta.url));
const fixtureNowMilliseconds = Date.now();
const fixtureNow = instant(fixtureNowMilliseconds);
const fixtureCreatedAt = new Date(fixtureNowMilliseconds - 4 * 60 * 60 * 1_000);
const databaseHookTimeout = 30_000;

const ids = Object.freeze({
  merchantA: counterId("merchant", 1),
  merchantB: counterId("merchant", 2),
  walletA: counterId("wallet", 3),
  walletB: counterId("wallet", 4),
  merchantUserA: counterId("merchant-user", 5),
  merchantUserB: counterId("merchant-user", 6),
  walletUserA: counterId("wallet-user", 7),
  walletUserB: counterId("wallet-user", 8),
  serviceA: counterId("service", 9),
  serviceB: counterId("service", 10),
  operator: counterId("operator", 11),
  approvingOperator: counterId("operator", 12),
  nonexistentMerchantUser: counterId("merchant-user", 13),
  activeSupportGrant: counterId("support-grant", 14),
  futureSupportGrant: counterId("support-grant", 15),
  expiredSupportGrant: counterId("support-grant", 16),
  revokedSupportGrant: counterId("support-grant", 17),
  merchantCorrelation: counterId("correlation", 18),
  supportCorrelation: counterId("correlation", 19),
  jobCorrelation: counterId("correlation", 20),
  cleanupCorrelation: counterId("correlation", 21),
  deniedInsertActor: counterId("merchant-user", 22),
  assignmentActor: counterId("merchant-user", 23),
  provisionedMerchant: counterId("merchant", 24),
  provisionedWallet: counterId("wallet", 25),
  wrongEnvironmentMerchant: counterId("merchant", 26),
  forbiddenMutationActor: counterId("merchant-user", 27),
  oneWaySupportGrant: counterId("support-grant", 28),
  wrongTargetMerchant: counterId("merchant", 29),
  walletService: counterId("service", 40),
  platformService: counterId("service", 41),
  preRevokedSupportGrant: counterId("support-grant", 42),
});

const claimNames = [
  "counter.environment",
  "counter.actor_kind",
  "counter.actor_id",
  "counter.assurance",
  "counter.scope_kind",
  "counter.scope_id",
  "counter.permission",
  "counter.support_grant_id",
  "counter.correlation_id",
] as const;
type ClaimName = (typeof claimNames)[number];
type TransactionClaims = Partial<Record<ClaimName, string>>;

const requiredTenantClaimNames = [
  "counter.environment",
  "counter.actor_kind",
  "counter.actor_id",
  "counter.assurance",
  "counter.scope_kind",
  "counter.scope_id",
  "counter.permission",
] as const satisfies readonly ClaimName[];

const deniedWriteActorIds = requiredTenantClaimNames.map((_, index) =>
  counterId("merchant-user", 30 + index),
);

// Migrations 12-16 added 7 more RLS-enabled+forced, no-policy tables since
// this list was last updated — verified against each migration's .up.sql
// (ENABLE + FORCE ROW LEVEL SECURITY, no CREATE POLICY) before adding here.
// Migration 18 (catalog-sync-storage) added 5 more, same pattern. Migration
// 19 (wallet-revocations-and-mandates) added 2 more (wallet.mandates,
// wallet.revocations), same pattern - verified directly against 0019's
// .up.sql before adding here. Order matters: the query below sorts by
// relation_name (schema.table).
const protectedRelations = [
  "identity.actor_role_assignments",
  "identity.actors",
  "identity.agent_public_keys",
  "identity.scope_registry",
  "identity.service_identities",
  "identity.support_grant_authorization_permissions",
  "identity.support_grant_authorizations",
  "identity.support_grant_events",
  "identity.support_grant_permissions",
  "identity.support_grants",
  "identity.wallet_setup_tokens",
  "identity.wallet_users",
  "merchant.capability_manifests",
  "merchant.catalog_inventory",
  "merchant.catalog_prices",
  "merchant.catalog_products",
  "merchant.catalog_sync_cursors",
  "merchant.catalog_variants",
  "merchant.manual_catalog_items",
  "merchant.onboarding_applications",
  "merchant.payment_connections",
  "merchant.scopes",
  "merchant.shopify_connections",
  "merchant.shopify_oauth_states",
  "wallet.mandates",
  "wallet.recurring_payment_mandates",
  "wallet.revocations",
  "wallet.scopes",
] as const;

const expectedPolicyNames = [
  "actor_roles_insert",
  "actor_roles_select",
  "actor_roles_update",
  "actors_insert",
  "actors_select",
  "actors_update",
  "agent_keys_insert",
  "agent_keys_select",
  "agent_keys_update",
  "merchant_scopes_insert",
  "merchant_scopes_select",
  "scope_registry_insert",
  "scope_registry_select",
  "service_identities_insert",
  "service_identities_select",
  "service_identities_update",
  "support_grant_authorization_permissions_insert",
  "support_grant_authorization_permissions_select",
  "support_grant_authorizations_insert",
  "support_grant_authorizations_select",
  "support_grant_events_insert",
  "support_grant_events_select",
  "support_grant_permissions_insert",
  "support_grant_permissions_select",
  "support_grants_insert",
  "support_grants_select",
  "support_grants_update",
  "wallet_scopes_insert",
  "wallet_scopes_select",
] as const;

const securityDefinerFunctionSignatures = [
  "identity.access_scope_claim_matches(platform.counter_environment,text,text)",
  "identity.current_actor_has_authority(platform.counter_environment,text,text)",
  "identity.operator_platform_claim(platform.counter_environment,text)",
  "identity.operator_scope_bootstrap_claim(platform.counter_environment,text,text)",
  "identity.require_registered_owner_scope()",
  "identity.require_support_grant_permission()",
] as const;

const runtimeFunctionSignatures = [
  "identity.access_scope_claim_matches(platform.counter_environment,text,text)",
  "identity.is_counter_id(text,text)",
  "identity.operator_platform_claim(platform.counter_environment,text)",
  "identity.operator_scope_bootstrap_claim(platform.counter_environment,text,text)",
  "identity.permission_claim_in(text[])",
] as const;

const allIdentityFunctionSignatures = [
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
  "identity.require_support_grant_permission()",
  "identity.scope_claim_matches(platform.counter_environment,text,text)",
] as const;

const inspectedFunctionSignatures = [...allIdentityFunctionSignatures].sort();

const supportGrantFixtures = [
  {
    supportGrantId: ids.activeSupportGrant,
    authorizedAt: new Date(fixtureNowMilliseconds - 70 * 60 * 1_000),
    issuedAt: new Date(fixtureNowMilliseconds - 65 * 60 * 1_000),
    validFrom: new Date(fixtureNowMilliseconds - 60 * 60 * 1_000),
    expiresAt: new Date(fixtureNowMilliseconds + 180 * 60 * 1_000),
    revokedAt: null,
    revokedBy: null,
  },
  {
    supportGrantId: ids.futureSupportGrant,
    authorizedAt: new Date(fixtureNowMilliseconds - 10 * 60 * 1_000),
    issuedAt: new Date(fixtureNowMilliseconds - 5 * 60 * 1_000),
    validFrom: new Date(fixtureNowMilliseconds + 120 * 60 * 1_000),
    expiresAt: new Date(fixtureNowMilliseconds + 180 * 60 * 1_000),
    revokedAt: null,
    revokedBy: null,
  },
  {
    supportGrantId: ids.expiredSupportGrant,
    authorizedAt: new Date(fixtureNowMilliseconds - 180 * 60 * 1_000),
    issuedAt: new Date(fixtureNowMilliseconds - 170 * 60 * 1_000),
    validFrom: new Date(fixtureNowMilliseconds - 160 * 60 * 1_000),
    expiresAt: new Date(fixtureNowMilliseconds - 60 * 60 * 1_000),
    revokedAt: null,
    revokedBy: null,
  },
  {
    supportGrantId: ids.revokedSupportGrant,
    authorizedAt: new Date(fixtureNowMilliseconds - 60 * 60 * 1_000),
    issuedAt: new Date(fixtureNowMilliseconds - 55 * 60 * 1_000),
    validFrom: new Date(fixtureNowMilliseconds - 50 * 60 * 1_000),
    expiresAt: new Date(fixtureNowMilliseconds + 120 * 60 * 1_000),
    revokedAt: new Date(fixtureNowMilliseconds - 10 * 60 * 1_000),
    revokedBy: ids.approvingOperator,
  },
  {
    supportGrantId: ids.oneWaySupportGrant,
    authorizedAt: new Date(fixtureNowMilliseconds - 45 * 60 * 1_000),
    issuedAt: new Date(fixtureNowMilliseconds - 40 * 60 * 1_000),
    validFrom: new Date(fixtureNowMilliseconds - 35 * 60 * 1_000),
    expiresAt: new Date(fixtureNowMilliseconds + 180 * 60 * 1_000),
    revokedAt: null,
    revokedBy: null,
  },
] as const;

databaseDescribe("PostgreSQL row-level security", () => {
  if (testDatabaseUrl === undefined) {
    return;
  }

  const adminDatabase = new PostgresDatabase(testDatabaseUrl);
  const applicationRole = `counter_rls_${process.pid}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const applicationPassword = randomUUID();
  let applicationDatabase: PostgresDatabase | undefined;
  let roleCreated = false;
  let schemasManaged = false;
  let transactions: ScopedTransactionManager | undefined;
  let repositories: PostgresIdentityRepositories | undefined;

  beforeAll(async () => {
    await assertBootstrapRoleCanOwnFixtures(adminDatabase);
    schemasManaged = true;
    await dropApplicationSchemas(adminDatabase);

    const migrations = await loadMigrations(migrationsDirectory);
    const migrationStatus = await new MigrationRunner(adminDatabase, migrations).up();
    // Derived, not hardcoded — this exact literal went stale twice already.
    expect(migrationStatus.currentVersion).toBe(migrations.length);

    await createApplicationRole(adminDatabase, applicationRole, applicationPassword);
    roleCreated = true;
    await grantApplicationPrivileges(adminDatabase, applicationRole);
    await seedRlsFixtures(adminDatabase);

    const applicationDatabaseUrl = new URL(testDatabaseUrl);
    applicationDatabaseUrl.username = applicationRole;
    applicationDatabaseUrl.password = applicationPassword;
    applicationDatabase = new PostgresDatabase({
      connectionString: applicationDatabaseUrl.toString(),
      max: 1,
    });
    await assertApplicationRolePosture(applicationDatabase, applicationRole);
    transactions = new ScopedTransactionManager(applicationDatabase);
    repositories = new PostgresIdentityRepositories(transactions);
  }, databaseHookTimeout);

  afterAll(async () => {
    const cleanupErrors: unknown[] = [];
    const attempt = async (operation: () => Promise<unknown>): Promise<void> => {
      try {
        await operation();
      } catch (error) {
        cleanupErrors.push(error);
      }
    };

    const databaseToClose = applicationDatabase;
    if (databaseToClose !== undefined) {
      await attempt(async () => databaseToClose.close());
    }
    if (schemasManaged) {
      await attempt(async () => dropApplicationSchemas(adminDatabase));
    }
    if (roleCreated) {
      const quotedRole = quoteIdentifier(applicationRole);
      await attempt(async () => adminDatabase.query(`DROP OWNED BY ${quotedRole}`));
      await attempt(async () => adminDatabase.query(`DROP ROLE ${quotedRole}`));
    }
    await attempt(async () => adminDatabase.close());

    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, "PostgreSQL RLS test cleanup failed");
    }
  }, databaseHookTimeout);

  it("uses a no-bypass non-owner role with every forced policy", async () => {
    const database = requireApplicationDatabase(applicationDatabase);
    const posture = await database.query<{
      current_user: string;
      rolinherit: boolean;
      rolbypassrls: boolean;
      rolsuper: boolean;
    }>(
      `SELECT current_user,
              role.rolinherit,
              role.rolbypassrls,
              role.rolsuper
       FROM pg_roles role
       WHERE role.rolname = current_user`,
    );
    expect(posture.rows).toEqual([
      {
        current_user: applicationRole,
        rolinherit: false,
        rolbypassrls: false,
        rolsuper: false,
      },
    ]);

    const relations = await database.query<{
      owner_name: string;
      relation_name: string;
      relforcerowsecurity: boolean;
      relrowsecurity: boolean;
    }>(
      `SELECT owner.rolname AS owner_name,
              namespace.nspname || '.' || relation.relname AS relation_name,
              relation.relforcerowsecurity,
              relation.relrowsecurity
       FROM pg_class relation
       JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
       JOIN pg_roles owner ON owner.oid = relation.relowner
       WHERE relation.relrowsecurity
         AND namespace.nspname = ANY ($1::text[])
       ORDER BY relation_name`,
      [["identity", "merchant", "wallet"]],
    );
    expect(relations.rows.map((row) => row.relation_name)).toEqual([...protectedRelations]);
    expect(relations.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
    expect(relations.rows.every((row) => row.owner_name !== applicationRole)).toBe(true);

    const policies = await database.query<{ policyname: string }>(
      `SELECT policyname
       FROM pg_policies
       WHERE schemaname = ANY ($1::text[])
       ORDER BY policyname`,
      [["identity", "merchant", "wallet"]],
    );
    expect(policies.rows.map((row) => row.policyname)).toEqual([...expectedPolicyNames]);

    const functions = await database.query<{
      owner_can_bypass: boolean;
      public_execute: boolean;
      runtime_execute: boolean;
      security_definer: boolean;
      settings: string[] | null;
      signature: string;
    }>(
      `WITH requested(signature) AS (
         SELECT unnest($1::text[])
       )
       SELECT requested.signature,
              function_record.prosecdef AS security_definer,
              function_record.proconfig AS settings,
              owner.rolsuper OR owner.rolbypassrls AS owner_can_bypass,
              EXISTS (
                SELECT 1
                FROM pg_catalog.aclexplode(
                  COALESCE(
                    function_record.proacl,
                    pg_catalog.acldefault('f', function_record.proowner)
                  )
                ) privilege
                WHERE privilege.grantee = 0
                  AND privilege.privilege_type = 'EXECUTE'
              ) AS public_execute,
              pg_catalog.has_function_privilege(
                function_record.oid,
                'EXECUTE'
              ) AS runtime_execute
       FROM requested
       JOIN pg_catalog.pg_proc function_record
         ON function_record.oid = pg_catalog.to_regprocedure(requested.signature)
       JOIN pg_catalog.pg_roles owner ON owner.oid = function_record.proowner
       ORDER BY requested.signature`,
      [inspectedFunctionSignatures],
    );
    expect(functions.rows.map((row) => row.signature)).toEqual(inspectedFunctionSignatures);
    for (const functionPosture of functions.rows) {
      const isSecurityDefiner = securityDefinerFunctionSignatures.some(
        (signature) => signature === functionPosture.signature,
      );
      const isRuntimeCallable = runtimeFunctionSignatures.some(
        (signature) => signature === functionPosture.signature,
      );
      expect(functionPosture.public_execute).toBe(false);
      expect(functionPosture.runtime_execute).toBe(isRuntimeCallable);
      expect(functionPosture.security_definer).toBe(isSecurityDefiner);
      if (isSecurityDefiner) {
        expect(functionPosture.owner_can_bypass).toBe(true);
        expect(functionPosture.settings).toEqual([
          "search_path=pg_catalog, pg_temp",
          "row_security=off",
        ]);
      }
    }
  });

  it("denies reads and writes when tenant claims are missing", async () => {
    const database = requireApplicationDatabase(applicationDatabase);
    await expect(visibleActorIds(database, {})).resolves.toEqual([]);

    const completeReadClaims = merchantActorClaims(ids.merchantA, ids.merchantUserA);
    const completeWriteClaims = merchantActorClaims(
      ids.merchantA,
      ids.merchantUserA,
      "test",
      "identity.actor.manage",
    );
    for (const [index, omittedClaim] of requiredTenantClaimNames.entries()) {
      const incompleteReadClaims = Object.fromEntries(
        Object.entries(completeReadClaims).filter(([name]) => name !== omittedClaim),
      ) as TransactionClaims;
      await expect(
        visibleActorIds(database, incompleteReadClaims, "merchant_user"),
      ).resolves.toEqual([]);

      const incompleteWriteClaims = Object.fromEntries(
        Object.entries(completeWriteClaims).filter(([name]) => name !== omittedClaim),
      ) as TransactionClaims;
      const deniedActorId = deniedWriteActorIds[index];
      if (deniedActorId === undefined) {
        throw new Error("missing denied-write actor fixture");
      }
      await expect(
        withClaims(database, incompleteWriteClaims, async (session) =>
          session.query(
            `INSERT INTO identity.actors (
               environment, actor_kind, actor_id, owner_scope_kind, owner_scope_id,
               status, created_at, disabled_at
             ) VALUES ('test', 'merchant_user', $1, 'merchant', $2, 'active', $3, NULL)`,
            [deniedActorId, ids.merchantA, fixtureCreatedAt],
          ),
        ),
      ).rejects.toMatchObject({ code: "42501" });

      const hiddenUpdate = await withClaims(database, incompleteWriteClaims, async (session) =>
        session.query(
          `UPDATE identity.actors
             SET status = 'suspended', disabled_at = clock_timestamp()
             WHERE environment = 'test' AND actor_kind = 'service' AND actor_id = $1`,
          [ids.serviceA],
        ),
      );
      expect(hiddenUpdate.rowCount).toBe(0);
    }

    await expect(
      withClaims(database, {}, async (session) =>
        session.query(
          `INSERT INTO identity.actors (
             environment, actor_kind, actor_id, owner_scope_kind, owner_scope_id,
             status, created_at, disabled_at
           ) VALUES ('test', 'merchant_user', $1, 'merchant', $2, 'active', $3, NULL)`,
          [ids.deniedInsertActor, ids.merchantA, fixtureCreatedAt],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });

    const hiddenUpdate = await database.query(
      `UPDATE identity.actors
       SET status = 'suspended', disabled_at = clock_timestamp()
       WHERE environment = 'test' AND actor_id = $1`,
      [ids.merchantUserA],
    );
    expect(hiddenUpdate.rowCount).toBe(0);
  });

  it("isolates merchant A from merchant B in both directions", async () => {
    const database = requireApplicationDatabase(applicationDatabase);
    await expect(
      visibleActorIds(
        database,
        merchantActorClaims(ids.merchantA, ids.merchantUserA),
        "merchant_user",
      ),
    ).resolves.toEqual([ids.merchantUserA]);
    await expect(
      visibleActorIds(
        database,
        merchantActorClaims(ids.merchantB, ids.merchantUserB),
        "merchant_user",
      ),
    ).resolves.toEqual([ids.merchantUserB]);
  });

  it("isolates Wallet A from Wallet B in both directions", async () => {
    const database = requireApplicationDatabase(applicationDatabase);
    await expect(
      visibleActorIds(database, walletActorClaims(ids.walletA, ids.walletUserA), "wallet_user"),
    ).resolves.toEqual([ids.walletUserA]);
    await expect(
      visibleActorIds(database, walletActorClaims(ids.walletB, ids.walletUserB), "wallet_user"),
    ).resolves.toEqual([ids.walletUserB]);
  });

  it("keeps merchant and Wallet scopes mutually invisible", async () => {
    const database = requireApplicationDatabase(applicationDatabase);
    await expect(
      actorExists(database, merchantActorClaims(ids.merchantA, ids.merchantUserA), ids.walletUserA),
    ).resolves.toBe(false);
    await expect(
      actorExists(database, walletActorClaims(ids.walletA, ids.walletUserA), ids.merchantUserA),
    ).resolves.toBe(false);
  });

  it("keeps identical opaque IDs isolated by environment", async () => {
    const database = requireApplicationDatabase(applicationDatabase);
    await expect(
      visibleActorEnvironments(
        database,
        merchantActorClaims(ids.merchantA, ids.merchantUserA, "test"),
        ids.merchantUserA,
      ),
    ).resolves.toEqual(["test"]);
    await expect(
      visibleActorEnvironments(
        database,
        merchantActorClaims(ids.merchantA, ids.merchantUserA, "sandbox"),
        ids.merchantUserA,
      ),
    ).resolves.toEqual(["sandbox"]);
  });

  it("revalidates suspended actors and revoked roles for stale claims", async () => {
    const database = requireApplicationDatabase(applicationDatabase);
    const claims = merchantActorClaims(ids.merchantA, ids.merchantUserA);
    await expect(visibleActorIds(database, claims, "merchant_user")).resolves.toEqual([
      ids.merchantUserA,
    ]);

    await adminDatabase.query(
      `UPDATE identity.actors
       SET status = 'suspended', disabled_at = clock_timestamp()
       WHERE environment = 'test'
         AND actor_kind = 'merchant_user'
         AND actor_id = $1`,
      [ids.merchantUserA],
    );
    try {
      await expect(visibleActorIds(database, claims, "merchant_user")).resolves.toEqual([]);
    } finally {
      await adminDatabase.query(
        `UPDATE identity.actors
         SET status = 'active', disabled_at = NULL
         WHERE environment = 'test'
           AND actor_kind = 'merchant_user'
           AND actor_id = $1`,
        [ids.merchantUserA],
      );
    }

    const manager = requireTransactions(transactions);
    const staleContext = merchantAuthorizedContext(
      "identity.actor.read",
      ids.merchantA,
      ids.merchantUserA,
    );
    await adminDatabase.query(
      `UPDATE identity.actor_role_assignments
       SET revoked_at = clock_timestamp()
       WHERE environment = 'test'
         AND actor_kind = 'merchant_user'
         AND actor_id = $1
         AND role_key = 'merchant.owner'
         AND revoked_at IS NULL`,
      [ids.merchantUserA],
    );
    try {
      const hidden = await manager.transaction(staleContext, async (session) =>
        session.query<{ actor_id: string }>(
          `SELECT actor_id
           FROM identity.actors
           WHERE actor_kind = 'merchant_user'
           ORDER BY actor_id`,
        ),
      );
      expect(hidden.rows).toEqual([]);
    } finally {
      await adminDatabase.query(
        `UPDATE identity.actor_role_assignments
         SET revoked_at = NULL
         WHERE environment = 'test'
           AND actor_kind = 'merchant_user'
           AND actor_id = $1
           AND role_key = 'merchant.owner'`,
        [ids.merchantUserA],
      );
    }
  });

  it("requires an active service identity for stale service contexts", async () => {
    const manager = requireTransactions(transactions);
    const serviceContext = serviceActorContext(ids.merchantA);
    const authorized = authorize(serviceContext, {
      permission: "identity.actor.read",
      environment: "test",
      scope: merchantScope("test", ids.merchantA),
      at: fixtureNow,
    });
    if (!authorized.ok) {
      throw new Error("service fixture authorization was rejected");
    }

    await adminDatabase.query(
      `UPDATE identity.service_identities
       SET status = 'suspended', disabled_at = clock_timestamp()
       WHERE environment = 'test' AND service_id = $1`,
      [ids.serviceA],
    );
    try {
      const hidden = await manager.transaction(authorized.value, async (session) =>
        session.query<{ actor_id: string }>(
          `SELECT actor_id
           FROM identity.actors
           WHERE actor_kind = 'merchant_user'
           ORDER BY actor_id`,
        ),
      );
      expect(hidden.rows).toEqual([]);
    } finally {
      await adminDatabase.query(
        `UPDATE identity.service_identities
         SET status = 'active', disabled_at = NULL
         WHERE environment = 'test' AND service_id = $1`,
        [ids.serviceA],
      );
    }
  });

  it("accepts service.identity assignments for merchant, wallet, and platform homes", async () => {
    const assignments = await adminDatabase.query<{
      actor_id: string;
      owner_scope_kind: string;
    }>(
      `SELECT actor_id, owner_scope_kind
       FROM identity.actor_role_assignments
       WHERE environment = 'test'
         AND actor_id = ANY ($1::text[])
         AND role_key = 'service.identity'
       ORDER BY owner_scope_kind`,
      [[ids.serviceA, ids.walletService, ids.platformService]],
    );
    expect(assignments.rows).toEqual([
      { actor_id: ids.serviceA, owner_scope_kind: "merchant" },
      { actor_id: ids.platformService, owner_scope_kind: "platform" },
      { actor_id: ids.walletService, owner_scope_kind: "wallet" },
    ]);
  });

  it("requires an active platform.operator assignment for tenant support", async () => {
    const database = requireApplicationDatabase(applicationDatabase);
    const claims = operatorClaims(ids.activeSupportGrant);
    await expect(visibleActorIds(database, claims, "merchant_user")).resolves.toEqual([
      ids.merchantUserA,
    ]);

    await adminDatabase.query(
      `UPDATE identity.actor_role_assignments
       SET revoked_at = clock_timestamp()
       WHERE environment = 'test'
         AND actor_kind = 'operator'
         AND actor_id = $1
         AND role_key = 'platform.operator'
         AND revoked_at IS NULL`,
      [ids.operator],
    );
    try {
      await expect(visibleActorIds(database, claims, "merchant_user")).resolves.toEqual([]);
    } finally {
      await adminDatabase.query(
        `UPDATE identity.actor_role_assignments
         SET revoked_at = NULL
         WHERE environment = 'test'
           AND actor_kind = 'operator'
           AND actor_id = $1
           AND role_key = 'platform.operator'`,
        [ids.operator],
      );
    }
  });

  it("returns identical absence for guessed existing and nonexistent actor IDs", async () => {
    const repository = requireRepositories(repositories);
    const context = merchantAuthorizedContext(
      "identity.actor.read",
      ids.merchantA,
      ids.merchantUserA,
    );

    const guessedExisting = await repository.findActorByReference(context, {
      kind: "merchant_user",
      id: ids.merchantUserB,
    });
    const guessedNonexistent = await repository.findActorByReference(context, {
      kind: "merchant_user",
      id: ids.nonexistentMerchantUser,
    });

    expect(guessedExisting).toBeUndefined();
    expect(guessedNonexistent).toBeUndefined();
    expect(guessedExisting).toBe(guessedNonexistent);
  });

  it("gives an operator no tenant access without exact active support", async () => {
    const database = requireApplicationDatabase(applicationDatabase);
    const unsupported = operatorClaims(ids.activeSupportGrant);
    await expect(
      visibleActorIds(
        database,
        { ...unsupported, "counter.support_grant_id": "" },
        "merchant_user",
      ),
    ).resolves.toEqual([]);
    await expect(
      visibleActorIds(
        database,
        {
          ...unsupported,
          "counter.support_grant_id": counterId("support-grant", 90),
        },
        "merchant_user",
      ),
    ).resolves.toEqual([]);
  });

  it("requires every active-support dimension and audits an exact supported read", async () => {
    const database = requireApplicationDatabase(applicationDatabase);
    const activeClaims = operatorClaims(ids.activeSupportGrant);
    await expect(visibleActorIds(database, activeClaims, "merchant_user")).resolves.toEqual([
      ids.merchantUserA,
    ]);

    const deniedClaims: TransactionClaims[] = [
      { ...activeClaims, "counter.support_grant_id": ids.futureSupportGrant },
      { ...activeClaims, "counter.support_grant_id": ids.expiredSupportGrant },
      { ...activeClaims, "counter.support_grant_id": ids.revokedSupportGrant },
      { ...activeClaims, "counter.actor_id": ids.approvingOperator },
      { ...activeClaims, "counter.environment": "sandbox" },
      { ...activeClaims, "counter.scope_id": ids.merchantB },
    ];
    for (const claims of deniedClaims) {
      await expect(visibleActorIds(database, claims, "merchant_user")).resolves.toEqual([]);
    }
    await expect(
      visibleServiceIds(database, {
        ...activeClaims,
        "counter.permission": "identity.service_identity.read",
      }),
    ).resolves.toEqual([]);
    await expect(
      visibleActorIds(
        database,
        {
          ...activeClaims,
          "counter.scope_kind": "wallet",
          "counter.scope_id": ids.walletA,
        },
        "wallet_user",
      ),
    ).resolves.toEqual([]);

    const manager = requireTransactions(transactions);
    const supportContext = operatorSupportedReadContext();
    const rows = await manager.transaction(supportContext, async (session) =>
      session.query<{ actor_id: string }>(
        `SELECT actor_id
         FROM identity.actors
         WHERE actor_kind = 'merchant_user'
         ORDER BY actor_id`,
      ),
    );
    expect(rows.rows.map((row) => row.actor_id)).toEqual([ids.merchantUserA]);

    const audit = await adminDatabase.query<{
      action: string;
      correlation_id: string;
      operator_id: string;
      target_scope_id: string;
    }>(
      `SELECT action, correlation_id, operator_id, target_scope_id
       FROM identity.support_grant_events
       WHERE support_grant_id = $1 AND correlation_id = $2`,
      [ids.activeSupportGrant, ids.supportCorrelation],
    );
    expect(audit.rows).toEqual([
      {
        action: "used",
        correlation_id: ids.supportCorrelation,
        operator_id: ids.operator,
        target_scope_id: ids.merchantA,
      },
    ]);
  });

  it("allows step-up platform authority to provision exact scopes without ambient tenant access", async () => {
    const manager = requireTransactions(transactions);
    const repository = requireRepositories(repositories);
    const operator = createActorContext({
      actor: { kind: "operator", id: ids.operator },
      environment: "test",
      scope: platformScope("test"),
      assurance: "step_up",
      roles: ["platform.operator"],
      correlationId: ids.supportCorrelation,
    });
    if (!operator.ok) {
      throw new Error("operator provisioning ActorContext fixture was rejected");
    }

    const merchantTarget = merchantScope("test", ids.provisionedMerchant);
    const merchantAuthorization = authorize(operator.value, {
      permission: "identity.scope.manage",
      environment: "test",
      scope: merchantTarget,
      at: fixtureNow,
    });
    if (!merchantAuthorization.ok) {
      throw new Error("merchant provisioning authorization fixture was rejected");
    }
    const walletTarget = walletScope("test", ids.provisionedWallet);
    const walletAuthorization = authorize(operator.value, {
      permission: "identity.scope.manage",
      environment: "test",
      scope: walletTarget,
      at: fixtureNow,
    });
    if (!walletAuthorization.ok) {
      throw new Error("wallet provisioning authorization fixture was rejected");
    }

    await repository.createMerchantScope(
      merchantAuthorization.value,
      createMerchantScopeRecord(merchantTarget, fixtureNow),
    );
    await repository.createWalletScope(
      walletAuthorization.value,
      createWalletScopeRecord(walletTarget, fixtureNow),
    );

    const provisioned = await adminDatabase.query<{ scope_id: string }>(
      `SELECT scope_id
       FROM identity.scope_registry
       WHERE environment = 'test' AND scope_id = ANY ($1::text[])
       ORDER BY scope_id`,
      [[ids.provisionedMerchant, ids.provisionedWallet]],
    );
    expect(provisioned.rows.map((row) => row.scope_id)).toEqual(
      [ids.provisionedMerchant, ids.provisionedWallet].sort(),
    );

    for (const [context, scopeId] of [
      [merchantAuthorization.value, ids.provisionedMerchant],
      [walletAuthorization.value, ids.provisionedWallet],
    ] as const) {
      const hidden = await manager.transaction(context, async (session) =>
        session.query<{ scope_id: string }>(
          `SELECT scope_id
           FROM identity.scope_registry
           WHERE scope_id = $1`,
          [scopeId],
        ),
      );
      expect(hidden.rows).toEqual([]);
    }

    await expect(
      manager.transaction(merchantAuthorization.value, async (session) =>
        session.query(
          `INSERT INTO identity.actors (
             environment, actor_kind, actor_id, owner_scope_kind, owner_scope_id,
             status, created_at, disabled_at
           ) VALUES ('test', 'merchant_user', $1, 'merchant', $2, 'active', $3, NULL)`,
          [ids.forbiddenMutationActor, ids.provisionedMerchant, fixtureCreatedAt],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });

    await expect(
      manager.transaction(merchantAuthorization.value, async (session) =>
        session.query(
          `INSERT INTO identity.scope_registry (
             environment, scope_kind, scope_id, created_at
           ) VALUES ('test', 'merchant', $1, $2)`,
          [ids.wrongTargetMerchant, fixtureCreatedAt],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });

    await expect(
      manager.transaction(merchantAuthorization.value, async (session) =>
        session.query(
          `INSERT INTO identity.scope_registry (
             environment, scope_kind, scope_id, created_at
           ) VALUES ('sandbox', 'merchant', $1, $2)`,
          [ids.wrongEnvironmentMerchant, fixtureCreatedAt],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("enforces role compatibility and runtime assignment attribution", async () => {
    const database = requireApplicationDatabase(applicationDatabase);
    try {
      await withClaims(
        database,
        merchantActorClaims(ids.merchantA, ids.merchantUserA, "test", "identity.actor.manage"),
        async (session) =>
          session.query(
            `INSERT INTO identity.actors (
               environment, actor_kind, actor_id, owner_scope_kind, owner_scope_id,
               status, created_at, disabled_at
             ) VALUES ('test', 'merchant_user', $1, 'merchant', $2, 'active', $3, NULL)`,
            [ids.assignmentActor, ids.merchantA, fixtureCreatedAt],
          ),
      );

      const insertAssignment = async (
        roleKey: string,
        assignedByKind: string,
        assignedById: string,
      ): Promise<unknown> =>
        withClaims(
          database,
          merchantActorClaims(ids.merchantA, ids.merchantUserA, "test", "identity.role.assign"),
          async (session) =>
            session.query(
              `INSERT INTO identity.actor_role_assignments (
                 environment, actor_kind, actor_id, owner_scope_kind, owner_scope_id,
                 role_key, assigned_by_kind, assigned_by_id, assigned_at, revoked_at
               ) VALUES (
                 'test', 'merchant_user', $1, 'merchant', $2,
                 $3, $4, $5, $6, NULL
               )`,
              [
                ids.assignmentActor,
                ids.merchantA,
                roleKey,
                assignedByKind,
                assignedById,
                fixtureCreatedAt,
              ],
            ),
        );

      await expect(
        insertAssignment("wallet.owner", "merchant_user", ids.merchantUserA),
      ).rejects.toMatchObject({
        code: "23514",
        message: "assigned role is incompatible with actor kind or owner scope",
      });
      await expect(
        insertAssignment("merchant.read_only", "wallet_user", ids.walletUserA),
      ).rejects.toMatchObject({
        code: "23514",
        message: "role assignment attribution must match current actor claims",
      });

      await insertAssignment("merchant.read_only", "merchant_user", ids.merchantUserA);
      const attribution = await adminDatabase.query<{
        assigned_by_id: string;
        assigned_by_kind: string;
      }>(
        `SELECT assigned_by_kind, assigned_by_id
         FROM identity.actor_role_assignments
         WHERE environment = 'test'
           AND actor_kind = 'merchant_user'
           AND actor_id = $1
           AND role_key = 'merchant.read_only'`,
        [ids.assignmentActor],
      );
      expect(attribution.rows).toEqual([
        {
          assigned_by_kind: "merchant_user",
          assigned_by_id: ids.merchantUserA,
        },
      ]);
    } finally {
      await adminDatabase.query(
        `DELETE FROM identity.actor_role_assignments
         WHERE environment = 'test'
           AND actor_kind = 'merchant_user'
           AND actor_id = $1`,
        [ids.assignmentActor],
      );
      await adminDatabase.query(
        `DELETE FROM identity.actors
         WHERE environment = 'test'
           AND actor_kind = 'merchant_user'
           AND actor_id = $1`,
        [ids.assignmentActor],
      );
    }
  });

  it("allows support revocation once and rejects clearing or rewriting it", async () => {
    const database = requireApplicationDatabase(applicationDatabase);
    const preRevoked = supportGrantFixtures[4];
    await expect(
      withClaims(
        database,
        platformOperatorClaims("identity.support_grant.issue"),
        async (session) =>
          session.query(
            `INSERT INTO identity.support_grants (
               support_grant_id, environment, target_scope_kind, target_scope_id,
               operator_id, reason, authorization_kind, authorized_by, authorized_at,
               authorization_reference_source, authorization_reference_value,
               issued_at, valid_from, expires_at, revoked_at, revoked_by
             ) VALUES (
               $1, 'test', 'merchant', $2,
               $3, 'customer_request', 'approved', $4, $5,
               'support-ticket', 'SYNTHETIC-PRE-REVOKED',
               $6, $7, $8, $9, $4
             )`,
            [
              ids.preRevokedSupportGrant,
              ids.merchantA,
              ids.operator,
              ids.approvingOperator,
              preRevoked.authorizedAt,
              preRevoked.issuedAt,
              preRevoked.validFrom,
              preRevoked.expiresAt,
              new Date(fixtureNowMilliseconds),
            ],
          ),
      ),
    ).rejects.toMatchObject({
      code: "23514",
      message: "support grant must be issued unrevoked under runtime RLS",
    });

    const claims = platformOperatorClaims("identity.support_grant.revoke");
    const revokedAt = new Date(fixtureNowMilliseconds + 1_000);

    await expect(
      withClaims(database, claims, async (session) =>
        session.query(
          `UPDATE identity.support_grants
           SET revoked_at = $2, revoked_by = $3
           WHERE support_grant_id = $1`,
          [ids.oneWaySupportGrant, revokedAt, ids.approvingOperator],
        ),
      ),
    ).rejects.toMatchObject({
      code: "23514",
      message: "support grant revocation attribution must match current operator claims",
    });

    const revoked = await withClaims(database, claims, async (session) =>
      session.query(
        `UPDATE identity.support_grants
         SET revoked_at = $2, revoked_by = $3
         WHERE support_grant_id = $1`,
        [ids.oneWaySupportGrant, revokedAt, ids.operator],
      ),
    );
    expect(revoked.rowCount).toBe(1);

    const persisted = await adminDatabase.query<{
      revoked_at: Date;
      revoked_by: string;
    }>(
      `SELECT revoked_at, revoked_by
       FROM identity.support_grants
       WHERE support_grant_id = $1`,
      [ids.oneWaySupportGrant],
    );
    expect(persisted.rows).toEqual([{ revoked_at: revokedAt, revoked_by: ids.operator }]);

    const forbiddenUpdates = [
      { revokedAt: null, revokedBy: null },
      { revokedAt: new Date(revokedAt.getTime() + 1_000), revokedBy: ids.operator },
      { revokedAt, revokedBy: ids.approvingOperator },
    ] as const;
    for (const forbidden of forbiddenUpdates) {
      await expect(
        withClaims(database, claims, async (session) =>
          session.query(
            `UPDATE identity.support_grants
             SET revoked_at = $2, revoked_by = $3
             WHERE support_grant_id = $1`,
            [ids.oneWaySupportGrant, forbidden.revokedAt, forbidden.revokedBy],
          ),
        ),
      ).rejects.toMatchObject({
        code: "23514",
        message: "support grant revocation cannot be cleared or rewritten",
      });
    }
  });

  it("re-authorizes job/service scope exactly before restoring database claims", async () => {
    const manager = requireTransactions(transactions);
    const serviceContext = serviceActorContext(ids.merchantA);
    const authorized = authorize(serviceContext, {
      permission: "identity.actor.read",
      environment: "test",
      scope: merchantScope("test", ids.merchantA),
      at: fixtureNow,
    });
    if (!authorized.ok) {
      throw new Error("service fixture authorization was rejected");
    }

    const envelope = createJobAuthorizationEnvelope(authorized.value);
    if (!envelope.ok) {
      throw new Error("job authorization envelope was rejected");
    }
    const parsed = parseJobAuthorizationEnvelope(
      JSON.parse(JSON.stringify(envelope.value)) as unknown,
    );
    if (!parsed.ok) {
      throw new Error("serialized job authorization envelope was rejected");
    }
    const reauthorized = reauthorizeJob(parsed.value, serviceContext, fixtureNow);
    if (!reauthorized.ok) {
      throw new Error("job authorization could not be re-established");
    }

    const visible = await manager.transaction(reauthorized.value, async (session) =>
      session.query<{ actor_id: string }>(
        `SELECT actor_id
         FROM identity.actors
         WHERE actor_kind = 'merchant_user'
         ORDER BY actor_id`,
      ),
    );
    expect(visible.rows.map((row) => row.actor_id)).toEqual([ids.merchantUserA]);

    const wrongScopeContext = serviceActorContext(ids.merchantB);
    expect(reauthorizeJob(parsed.value, wrongScopeContext, fixtureNow).ok).toBe(false);
  });

  it("allows mutable state changes but rejects ownership mutation", async () => {
    const database = requireApplicationDatabase(applicationDatabase);
    const claims = merchantActorClaims(
      ids.merchantA,
      ids.merchantUserA,
      "test",
      "identity.actor.manage",
    );

    const suspended = await withClaims(database, claims, async (session) =>
      session.query(
        `UPDATE identity.actors
         SET status = 'suspended', disabled_at = clock_timestamp()
         WHERE environment = 'test' AND actor_kind = 'service' AND actor_id = $1`,
        [ids.serviceA],
      ),
    );
    expect(suspended.rowCount).toBe(1);

    const reactivated = await withClaims(database, claims, async (session) =>
      session.query(
        `UPDATE identity.actors
         SET status = 'active', disabled_at = NULL
         WHERE environment = 'test' AND actor_kind = 'service' AND actor_id = $1`,
        [ids.serviceA],
      ),
    );
    expect(reactivated.rowCount).toBe(1);

    await expect(
      withClaims(database, claims, async (session) =>
        session.query(
          `UPDATE identity.actors
           SET owner_scope_id = $2
           WHERE environment = 'test' AND actor_kind = 'service' AND actor_id = $1`,
          [ids.serviceA, ids.merchantB],
        ),
      ),
    ).rejects.toMatchObject({
      code: "23514",
      message: "immutable identity ownership or evidence column cannot be changed",
    });
  });

  it("clears claims after commit and rollback before pool reuse", async () => {
    const database = requireApplicationDatabase(applicationDatabase);
    const manager = requireTransactions(transactions);
    const merchantAContext = merchantAuthorizedContext(
      "identity.actor.read",
      ids.merchantA,
      ids.merchantUserA,
      ids.cleanupCorrelation,
    );

    const merchantAVisible = await manager.transaction(merchantAContext, async (session) =>
      session.query<{ actor_id: string }>(
        `SELECT actor_id
         FROM identity.actors
         WHERE actor_kind = 'merchant_user'
         ORDER BY actor_id`,
      ),
    );
    expect(merchantAVisible.rows.map((row) => row.actor_id)).toEqual([ids.merchantUserA]);
    await expect(allClaimsAreClear(database)).resolves.toBe(true);
    await expect(visibleActorIds(database, {}, "merchant_user")).resolves.toEqual([]);

    await expect(
      manager.transaction(merchantAContext, async (session) => {
        await session.query("SELECT actor_id FROM identity.actors");
        throw new Error("synthetic rollback");
      }),
    ).rejects.toThrow("synthetic rollback");
    await expect(allClaimsAreClear(database)).resolves.toBe(true);
    await expect(visibleActorIds(database, {}, "merchant_user")).resolves.toEqual([]);

    const merchantBContext = merchantAuthorizedContext(
      "identity.actor.read",
      ids.merchantB,
      ids.merchantUserB,
      ids.cleanupCorrelation,
    );
    const merchantBVisible = await manager.transaction(merchantBContext, async (session) =>
      session.query<{ actor_id: string }>(
        `SELECT actor_id
         FROM identity.actors
         WHERE actor_kind = 'merchant_user'
         ORDER BY actor_id`,
      ),
    );
    expect(merchantBVisible.rows.map((row) => row.actor_id)).toEqual([ids.merchantUserB]);
    await expect(allClaimsAreClear(database)).resolves.toBe(true);
  });
});

async function assertBootstrapRoleCanOwnFixtures(database: PostgresDatabase): Promise<void> {
  const result = await database.query<{
    rolbypassrls: boolean;
    rolcreaterole: boolean;
    rolsuper: boolean;
  }>(
    `SELECT rolbypassrls, rolcreaterole, rolsuper
     FROM pg_roles
     WHERE rolname = current_user`,
  );
  const role = result.rows[0];
  if (role === undefined || !role.rolcreaterole || (!role.rolsuper && !role.rolbypassrls)) {
    throw new Error(
      [
        "TEST_DATABASE_URL must use an isolated bootstrap role with CREATEROLE",
        "and SUPERUSER or BYPASSRLS so forced-RLS fixtures can be provisioned safely",
      ].join(" "),
    );
  }
}

async function createApplicationRole(
  database: PostgresDatabase,
  roleName: string,
  password: string,
): Promise<void> {
  await database.query(
    `CREATE ROLE ${quoteIdentifier(roleName)} WITH
       LOGIN
       PASSWORD ${quoteLiteral(password)}
       NOSUPERUSER
       NOCREATEDB
       NOCREATEROLE
       NOINHERIT
       NOREPLICATION
       NOBYPASSRLS`,
  );
}

async function grantApplicationPrivileges(
  database: PostgresDatabase,
  roleName: string,
): Promise<void> {
  const databaseName = await database.query<{ database_name: string }>(
    "SELECT current_database() AS database_name",
  );
  const currentDatabase = databaseName.rows[0]?.database_name;
  if (currentDatabase === undefined) {
    throw new Error("Could not determine the PostgreSQL test database name");
  }
  const quotedRole = quoteIdentifier(roleName);
  await database.query(
    `GRANT CONNECT ON DATABASE ${quoteIdentifier(currentDatabase)} TO ${quotedRole}`,
  );
  await database.query(
    `GRANT USAGE ON SCHEMA platform, identity, merchant, wallet TO ${quotedRole}`,
  );
  await database.query(`GRANT USAGE ON TYPE platform.counter_environment TO ${quotedRole}`);
  await database.query(
    `GRANT SELECT ON
       identity.permissions,
       identity.roles,
       identity.role_permissions
     TO ${quotedRole}`,
  );
  await database.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON
       identity.scope_registry,
       identity.actors,
       identity.actor_role_assignments,
       identity.agent_public_keys,
       identity.service_identities,
       identity.support_grants,
       identity.support_grant_permissions,
       identity.support_grant_events,
       merchant.scopes,
       wallet.scopes
     TO ${quotedRole}`,
  );
  await database.query(
    `GRANT USAGE, SELECT ON SEQUENCE
       identity.actor_role_assignments_assignment_id_seq,
       identity.support_grant_events_event_id_seq
     TO ${quotedRole}`,
  );
  await database.query(
    `GRANT EXECUTE ON FUNCTION
       identity.is_counter_id(text, text),
       identity.permission_claim_in(text[]),
       identity.operator_platform_claim(platform.counter_environment, text),
       identity.operator_scope_bootstrap_claim(
         platform.counter_environment,
         text,
         text
       ),
       identity.access_scope_claim_matches(platform.counter_environment, text, text)
     TO ${quotedRole}`,
  );
}

async function assertApplicationRolePosture(
  database: PostgresDatabase,
  expectedRole: string,
): Promise<void> {
  const result = await database.query<{
    current_user: string;
    rolinherit: boolean;
    rolbypassrls: boolean;
    rolsuper: boolean;
  }>(
    `SELECT current_user, role.rolinherit, role.rolbypassrls, role.rolsuper
     FROM pg_roles role
     WHERE role.rolname = current_user`,
  );
  const role = result.rows[0];
  if (
    role === undefined ||
    role.current_user !== expectedRole ||
    role.rolsuper ||
    role.rolbypassrls ||
    role.rolinherit
  ) {
    throw new Error("RLS tests require the temporary NOSUPERUSER NOBYPASSRLS NOINHERIT role");
  }
}

async function seedRlsFixtures(database: PostgresDatabase): Promise<void> {
  await database.transaction(async (session) => {
    const scopes = [
      { environment: "test", kind: "merchant", id: ids.merchantA },
      { environment: "test", kind: "merchant", id: ids.merchantB },
      { environment: "test", kind: "wallet", id: ids.walletA },
      { environment: "test", kind: "wallet", id: ids.walletB },
      { environment: "sandbox", kind: "merchant", id: ids.merchantA },
    ] as const;
    for (const scope of scopes) {
      await session.query(
        `INSERT INTO identity.scope_registry (environment, scope_kind, scope_id, created_at)
         VALUES ($1, $2, $3, $4)`,
        [scope.environment, scope.kind, scope.id, fixtureCreatedAt],
      );
      if (scope.kind === "merchant") {
        await session.query(
          `INSERT INTO merchant.scopes (environment, merchant_id, created_at)
           VALUES ($1, $2, $3)`,
          [scope.environment, scope.id, fixtureCreatedAt],
        );
      } else {
        await session.query(
          `INSERT INTO wallet.scopes (environment, wallet_id, created_at)
           VALUES ($1, $2, $3)`,
          [scope.environment, scope.id, fixtureCreatedAt],
        );
      }
    }

    const actors = [
      {
        environment: "test",
        kind: "merchant_user",
        id: ids.merchantUserA,
        scopeKind: "merchant",
        scopeId: ids.merchantA,
      },
      {
        environment: "test",
        kind: "merchant_user",
        id: ids.merchantUserB,
        scopeKind: "merchant",
        scopeId: ids.merchantB,
      },
      {
        environment: "test",
        kind: "wallet_user",
        id: ids.walletUserA,
        scopeKind: "wallet",
        scopeId: ids.walletA,
      },
      {
        environment: "test",
        kind: "wallet_user",
        id: ids.walletUserB,
        scopeKind: "wallet",
        scopeId: ids.walletB,
      },
      {
        environment: "sandbox",
        kind: "merchant_user",
        id: ids.merchantUserA,
        scopeKind: "merchant",
        scopeId: ids.merchantA,
      },
      {
        environment: "test",
        kind: "service",
        id: ids.serviceA,
        scopeKind: "merchant",
        scopeId: ids.merchantA,
      },
      {
        environment: "test",
        kind: "service",
        id: ids.serviceB,
        scopeKind: "merchant",
        scopeId: ids.merchantB,
      },
      {
        environment: "test",
        kind: "service",
        id: ids.walletService,
        scopeKind: "wallet",
        scopeId: ids.walletA,
      },
      {
        environment: "test",
        kind: "service",
        id: ids.platformService,
        scopeKind: "platform",
        scopeId: "platform",
      },
      {
        environment: "test",
        kind: "operator",
        id: ids.operator,
        scopeKind: "platform",
        scopeId: "platform",
      },
      {
        environment: "test",
        kind: "operator",
        id: ids.approvingOperator,
        scopeKind: "platform",
        scopeId: "platform",
      },
    ] as const;
    for (const actor of actors) {
      await session.query(
        `INSERT INTO identity.actors (
           environment, actor_kind, actor_id, owner_scope_kind, owner_scope_id,
           status, created_at, disabled_at
         ) VALUES ($1, $2, $3, $4, $5, 'active', $6, NULL)`,
        [actor.environment, actor.kind, actor.id, actor.scopeKind, actor.scopeId, fixtureCreatedAt],
      );
    }

    await session.query(
      `INSERT INTO identity.service_identities (
         environment, owner_scope_kind, owner_scope_id, actor_kind, service_id,
         binding_source, binding_value, status, created_at, disabled_at
       ) VALUES
         ('test', 'merchant', $1, 'service', $2, 'workload', 'synthetic-service-a',
          'active', $3, NULL),
         ('test', 'merchant', $4, 'service', $5, 'workload', 'synthetic-service-b',
          'active', $3, NULL),
         ('test', 'wallet', $6, 'service', $7, 'workload', 'synthetic-wallet-service',
          'active', $3, NULL),
         ('test', 'platform', 'platform', 'service', $8, 'workload',
          'synthetic-platform-service', 'active', $3, NULL)`,
      [
        ids.merchantA,
        ids.serviceA,
        fixtureCreatedAt,
        ids.merchantB,
        ids.serviceB,
        ids.walletA,
        ids.walletService,
        ids.platformService,
      ],
    );

    const assignments = [
      {
        environment: "test",
        actorKind: "merchant_user",
        actorId: ids.merchantUserA,
        scopeKind: "merchant",
        scopeId: ids.merchantA,
        role: "merchant.owner",
      },
      {
        environment: "test",
        actorKind: "merchant_user",
        actorId: ids.merchantUserB,
        scopeKind: "merchant",
        scopeId: ids.merchantB,
        role: "merchant.owner",
      },
      {
        environment: "test",
        actorKind: "wallet_user",
        actorId: ids.walletUserA,
        scopeKind: "wallet",
        scopeId: ids.walletA,
        role: "wallet.owner",
      },
      {
        environment: "test",
        actorKind: "wallet_user",
        actorId: ids.walletUserB,
        scopeKind: "wallet",
        scopeId: ids.walletB,
        role: "wallet.owner",
      },
      {
        environment: "sandbox",
        actorKind: "merchant_user",
        actorId: ids.merchantUserA,
        scopeKind: "merchant",
        scopeId: ids.merchantA,
        role: "merchant.owner",
      },
      {
        environment: "test",
        actorKind: "service",
        actorId: ids.serviceA,
        scopeKind: "merchant",
        scopeId: ids.merchantA,
        role: "service.identity",
      },
      {
        environment: "test",
        actorKind: "service",
        actorId: ids.serviceB,
        scopeKind: "merchant",
        scopeId: ids.merchantB,
        role: "service.identity",
      },
      {
        environment: "test",
        actorKind: "service",
        actorId: ids.walletService,
        scopeKind: "wallet",
        scopeId: ids.walletA,
        role: "service.identity",
      },
      {
        environment: "test",
        actorKind: "service",
        actorId: ids.platformService,
        scopeKind: "platform",
        scopeId: "platform",
        role: "service.identity",
      },
      {
        environment: "test",
        actorKind: "operator",
        actorId: ids.operator,
        scopeKind: "platform",
        scopeId: "platform",
        role: "platform.operator",
      },
    ] as const;
    for (const assignment of assignments) {
      await session.query(
        `INSERT INTO identity.actor_role_assignments (
           environment, actor_kind, actor_id, owner_scope_kind, owner_scope_id,
           role_key, assigned_by_kind, assigned_by_id, assigned_at, revoked_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $2, $3, $7, NULL)`,
        [
          assignment.environment,
          assignment.actorKind,
          assignment.actorId,
          assignment.scopeKind,
          assignment.scopeId,
          assignment.role,
          fixtureCreatedAt,
        ],
      );
    }

    for (const grant of supportGrantFixtures) {
      await session.query(
        `INSERT INTO identity.support_grants (
           support_grant_id, environment, target_scope_kind, target_scope_id, operator_id,
           reason, authorization_kind, authorized_by, authorized_at,
           authorization_reference_source, authorization_reference_value,
           issued_at, valid_from, expires_at, revoked_at, revoked_by
         ) VALUES (
           $1, 'test', 'merchant', $2, $3,
           'customer_request', 'approved', $4, $5,
           'support-ticket', 'SYNTHETIC-RLS',
           $6, $7, $8, $9, $10
         )`,
        [
          grant.supportGrantId,
          ids.merchantA,
          ids.operator,
          ids.approvingOperator,
          grant.authorizedAt,
          grant.issuedAt,
          grant.validFrom,
          grant.expiresAt,
          grant.revokedAt,
          grant.revokedBy,
        ],
      );
      await session.query(
        `INSERT INTO identity.support_grant_permissions (support_grant_id, permission_key)
         VALUES ($1, 'identity.actor.read')`,
        [grant.supportGrantId],
      );
    }
  });
}

function merchantActorClaims(
  merchantId: MerchantId,
  actorId: CounterId<"merchant-user">,
  environment: Environment = "test",
  permission = "identity.actor.read",
): TransactionClaims {
  return {
    "counter.environment": environment,
    "counter.actor_kind": "merchant_user",
    "counter.actor_id": actorId,
    "counter.assurance": "multi_factor",
    "counter.scope_kind": "merchant",
    "counter.scope_id": merchantId,
    "counter.permission": permission,
    "counter.support_grant_id": "",
    "counter.correlation_id": ids.merchantCorrelation,
  };
}

function walletActorClaims(
  walletId: CounterId<"wallet">,
  actorId: CounterId<"wallet-user">,
): TransactionClaims {
  return {
    "counter.environment": "test",
    "counter.actor_kind": "wallet_user",
    "counter.actor_id": actorId,
    "counter.assurance": "multi_factor",
    "counter.scope_kind": "wallet",
    "counter.scope_id": walletId,
    "counter.permission": "identity.actor.read",
    "counter.support_grant_id": "",
    "counter.correlation_id": ids.merchantCorrelation,
  };
}

function operatorClaims(supportGrantId: CounterId<"support-grant">): TransactionClaims {
  return {
    "counter.environment": "test",
    "counter.actor_kind": "operator",
    "counter.actor_id": ids.operator,
    "counter.assurance": "multi_factor",
    "counter.scope_kind": "merchant",
    "counter.scope_id": ids.merchantA,
    "counter.permission": "identity.actor.read",
    "counter.support_grant_id": supportGrantId,
    "counter.correlation_id": ids.supportCorrelation,
  };
}

function platformOperatorClaims(permission: string): TransactionClaims {
  return {
    "counter.environment": "test",
    "counter.actor_kind": "operator",
    "counter.actor_id": ids.operator,
    "counter.assurance": permission === "identity.support_grant.read" ? "multi_factor" : "step_up",
    "counter.scope_kind": "platform",
    "counter.scope_id": "platform",
    "counter.permission": permission,
    "counter.support_grant_id": "",
    "counter.correlation_id": ids.supportCorrelation,
  };
}

async function withClaims<Result>(
  database: PostgresDatabase,
  claims: TransactionClaims,
  operation: (session: DatabaseSession) => Promise<Result>,
): Promise<Result> {
  return database.transaction(async (session) => {
    for (const setting of claimNames) {
      const value = claims[setting];
      if (value !== undefined) {
        await session.query("SELECT set_config($1, $2, true)", [setting, value]);
      }
    }
    return operation(session);
  });
}

async function visibleActorIds(
  database: PostgresDatabase,
  claims: TransactionClaims,
  actorKind?: string,
): Promise<string[]> {
  return withClaims(database, claims, async (session) => {
    const result = await session.query<{ actor_id: string }>(
      `SELECT actor_id
       FROM identity.actors
       WHERE ($1::text IS NULL OR actor_kind = $1)
       ORDER BY actor_id`,
      [actorKind ?? null],
    );
    return result.rows.map((row) => row.actor_id);
  });
}

async function visibleServiceIds(
  database: PostgresDatabase,
  claims: TransactionClaims,
): Promise<string[]> {
  return withClaims(database, claims, async (session) => {
    const result = await session.query<{ service_id: string }>(
      `SELECT service_id
       FROM identity.service_identities
       ORDER BY service_id`,
    );
    return result.rows.map((row) => row.service_id);
  });
}

async function actorExists(
  database: PostgresDatabase,
  claims: TransactionClaims,
  actorId: string,
): Promise<boolean> {
  return withClaims(database, claims, async (session) => {
    const result = await session.query("SELECT 1 FROM identity.actors WHERE actor_id = $1", [
      actorId,
    ]);
    return result.rowCount === 1;
  });
}

async function visibleActorEnvironments(
  database: PostgresDatabase,
  claims: TransactionClaims,
  actorId: string,
): Promise<string[]> {
  return withClaims(database, claims, async (session) => {
    const result = await session.query<{ environment: string }>(
      `SELECT environment::text AS environment
       FROM identity.actors
       WHERE actor_id = $1
       ORDER BY environment`,
      [actorId],
    );
    return result.rows.map((row) => row.environment);
  });
}

async function allClaimsAreClear(database: PostgresDatabase): Promise<boolean> {
  const result = await database.query<Record<ClaimName, string | null>>(
    `SELECT
       NULLIF(current_setting('counter.environment', true), '') AS "counter.environment",
       NULLIF(current_setting('counter.actor_kind', true), '') AS "counter.actor_kind",
       NULLIF(current_setting('counter.actor_id', true), '') AS "counter.actor_id",
       NULLIF(current_setting('counter.assurance', true), '') AS "counter.assurance",
       NULLIF(current_setting('counter.scope_kind', true), '') AS "counter.scope_kind",
       NULLIF(current_setting('counter.scope_id', true), '') AS "counter.scope_id",
       NULLIF(current_setting('counter.permission', true), '') AS "counter.permission",
       NULLIF(current_setting('counter.support_grant_id', true), '') AS "counter.support_grant_id",
       NULLIF(current_setting('counter.correlation_id', true), '') AS "counter.correlation_id"`,
  );
  const row = result.rows[0];
  return row !== undefined && claimNames.every((claim) => row[claim] === null);
}

function merchantAuthorizedContext<PermissionType extends Permission>(
  permission: PermissionType,
  merchantId: MerchantId,
  actorId: CounterId<"merchant-user">,
  correlationId: CounterId<"correlation"> = ids.merchantCorrelation,
): AuthorizedContext<PermissionType> {
  const scope = merchantScope("test", merchantId);
  const actor = createActorContext({
    actor: { kind: "merchant_user", id: actorId },
    environment: "test",
    scope,
    assurance: "multi_factor",
    roles: ["merchant.owner"],
    correlationId,
  });
  if (!actor.ok) {
    throw new Error("merchant ActorContext fixture was rejected");
  }
  const authorized = authorize(actor.value, {
    permission,
    environment: "test",
    scope,
    at: fixtureNow,
  });
  if (!authorized.ok) {
    throw new Error("merchant authorization fixture was rejected");
  }
  return authorized.value;
}

function serviceActorContext(merchantId: MerchantId): ActorContext {
  const result = createActorContext({
    actor: { kind: "service", id: ids.serviceA },
    environment: "test",
    scope: merchantScope("test", merchantId),
    assurance: "service_authenticated",
    roles: ["service.identity"],
    correlationId: ids.jobCorrelation,
  });
  if (!result.ok) {
    throw new Error("service ActorContext fixture was rejected");
  }
  return result.value;
}

function operatorSupportedReadContext(): AuthorizedContext<"identity.actor.read"> {
  const supportGrant = activeSupportGrantRecord();
  const actor = createActorContext({
    actor: { kind: "operator", id: ids.operator },
    environment: "test",
    scope: platformScope("test"),
    assurance: "multi_factor",
    roles: ["platform.operator"],
    correlationId: ids.supportCorrelation,
    supportGrant,
  });
  if (!actor.ok) {
    throw new Error("operator ActorContext fixture was rejected");
  }
  const authorized = authorize(actor.value, {
    permission: "identity.actor.read",
    environment: "test",
    scope: merchantScope("test", ids.merchantA),
    at: fixtureNow,
  });
  if (!authorized.ok) {
    throw new Error("supported operator authorization fixture was rejected");
  }
  return authorized.value;
}

function activeSupportGrantRecord(): SupportGrantRecord {
  const approvalReference = createExternalReference("support-ticket", "SYNTHETIC-RLS");
  if (!approvalReference.ok) {
    throw new Error("support approval reference fixture was rejected");
  }
  const active = supportGrantFixtures[0];
  const result = createSupportGrantRecord({
    supportGrantId: active.supportGrantId,
    operatorId: ids.operator,
    environment: "test",
    targetScope: merchantScope("test", ids.merchantA),
    permissions: ["identity.actor.read"],
    reason: "customer_request",
    authorization: {
      kind: "approved",
      authorizedBy: ids.approvingOperator,
      authorizedAt: instant(active.authorizedAt.getTime()),
      approvalReference: approvalReference.value,
    },
    issuedAt: instant(active.issuedAt.getTime()),
    validFrom: instant(active.validFrom.getTime()),
    expiresAt: instant(active.expiresAt.getTime()),
  });
  if (!result.ok) {
    throw new Error("active support grant fixture was rejected");
  }
  return result.value;
}

function requireApplicationDatabase(database: PostgresDatabase | undefined): PostgresDatabase {
  if (database === undefined) {
    throw new Error("application database was not initialized");
  }
  return database;
}

function requireTransactions(
  manager: ScopedTransactionManager | undefined,
): ScopedTransactionManager {
  if (manager === undefined) {
    throw new Error("scoped transaction manager was not initialized");
  }
  return manager;
}

function requireRepositories(
  value: PostgresIdentityRepositories | undefined,
): PostgresIdentityRepositories {
  if (value === undefined) {
    throw new Error("identity repositories were not initialized");
  }
  return value;
}

async function dropApplicationSchemas(database: PostgresDatabase): Promise<void> {
  await database.query(`
    DROP SCHEMA IF EXISTS wallet CASCADE;
    DROP SCHEMA IF EXISTS merchant CASCADE;
    DROP SCHEMA IF EXISTS identity CASCADE;
    DROP SCHEMA IF EXISTS runtime CASCADE;
    DROP SCHEMA IF EXISTS platform CASCADE;
  `);
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function counterId<Kind extends CounterIdKind>(kind: Kind, seed: number): CounterId<Kind> {
  const result = createCounterId(kind, new Uint8Array(16).fill(seed));
  if (!result.ok) {
    throw new Error(`Could not create ${kind} integration-test ID`);
  }
  return result.value;
}

function instant(milliseconds: number): Instant {
  const result = instantFromEpochMilliseconds(milliseconds);
  if (!result.ok) {
    throw new Error("Could not create integration-test Instant");
  }
  return result.value;
}
