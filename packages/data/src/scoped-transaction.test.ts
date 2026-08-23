import {
  authorize,
  createActorContext,
  type AuthorizedContext,
  type RoleAssignmentInput,
} from "@counter/authorization";
import {
  createCounterId,
  instantFromEpochMilliseconds,
  merchantScope,
  platformScope,
  type CounterId,
  type CounterIdKind,
  type Instant,
} from "@counter/domain";
import { DatabaseError, type QueryResult, type QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";
import type { DatabaseSession, TransactionalDatabase } from "./database.js";
import { PostgresIdentityRepositories } from "./identity-repositories.js";
import { ScopedTransactionManager, type ScopedDatabaseSession } from "./scoped-transaction.js";

interface RecordedCall {
  readonly text: string;
  readonly values: readonly unknown[];
}

interface RuntimeRolePostureRow extends QueryResultRow {
  readonly is_session_role: boolean;
  readonly is_superuser: boolean;
  readonly bypasses_row_level_security: boolean;
  readonly can_login: boolean;
  readonly inherits_privileges: boolean;
  readonly can_set_role_to_unsafe_role: boolean;
}

interface SupportGrantRevocationRow extends QueryResultRow {
  readonly environment: string;
  readonly target_scope_kind: string;
  readonly target_scope_id: string;
}

interface RecordingDatabaseOptions {
  readonly posture?: RuntimeRolePostureRow | null;
  readonly operationFailure?: DatabaseError;
  readonly operationFailurePrefix?: string;
  readonly supportGrantRevocationRow?: SupportGrantRevocationRow;
}

class RecordingDatabase implements TransactionalDatabase {
  readonly calls: RecordedCall[] = [];
  readonly poolCalls: RecordedCall[] = [];
  private readonly posture: RuntimeRolePostureRow | null;
  private readonly operationFailure: DatabaseError | undefined;
  private readonly operationFailurePrefix: string;
  private readonly supportGrantRevocationRow: SupportGrantRevocationRow | undefined;

  constructor(options: RecordingDatabaseOptions = {}) {
    this.posture = options.posture === undefined ? safeRuntimeRolePosture() : options.posture;
    this.operationFailure = options.operationFailure;
    this.operationFailurePrefix = options.operationFailurePrefix ?? "INSERT INTO test_write";
    this.supportGrantRevocationRow = options.supportGrantRevocationRow;
  }

  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<Row>> {
    this.poolCalls.push(recordedCall(text, values));
    return Promise.reject(new Error("Scoped transactions must use their checked-out session"));
  }

  transaction<Result>(operation: (session: DatabaseSession) => Promise<Result>): Promise<Result> {
    const session: DatabaseSession = {
      query: <Row extends QueryResultRow = QueryResultRow>(
        text: string,
        values: readonly unknown[] = [],
      ): Promise<QueryResult<Row>> => this.recordQuery<Row>(text, values),
    };
    return operation(session);
  }

  private recordQuery<Row extends QueryResultRow>(
    text: string,
    values: readonly unknown[],
  ): Promise<QueryResult<Row>> {
    this.calls.push(recordedCall(text, values));
    if (text.includes("FROM pg_catalog.pg_roles AS role_record")) {
      const rows = this.posture === null ? [] : [this.posture];
      return Promise.resolve(resultWithRows(rows) as unknown as QueryResult<Row>);
    }
    if (text.startsWith(this.operationFailurePrefix) && this.operationFailure !== undefined) {
      return Promise.reject(this.operationFailure);
    }
    if (
      text.startsWith("UPDATE identity.support_grants") &&
      this.supportGrantRevocationRow !== undefined
    ) {
      return Promise.resolve(
        resultWithRows([this.supportGrantRevocationRow]) as unknown as QueryResult<Row>,
      );
    }
    return Promise.resolve(emptyResult<Row>());
  }
}

const unsafePostures: ReadonlyArray<
  readonly [description: string, override: Partial<RuntimeRolePostureRow>]
> = [
  ["SUPERUSER", { is_superuser: true }],
  ["BYPASSRLS", { bypasses_row_level_security: true }],
  ["LOGIN-disabled", { can_login: false }],
  ["INHERIT", { inherits_privileges: true }],
  ["a changed session role", { is_session_role: false }],
  ["SET ROLE access to an unsafe role", { can_set_role_to_unsafe_role: true }],
];

const normalizedPostgresCodes = ["23503", "23505", "23514", "42501"] as const;

describe("ScopedTransactionManager", () => {
  it("checks the transaction role before establishing the fixed claim vocabulary", async () => {
    const database = new RecordingDatabase();
    const manager = new ScopedTransactionManager(database);
    const context = authorizedMerchantContext();

    await manager.transaction(context, async (session) => {
      expect(session.context).toBe(context);
      await session.query("SELECT 1");
    });

    expect(database.poolCalls).toHaveLength(0);
    expect(database.calls).toHaveLength(3);
    expect(database.calls[0]?.text).toContain("FROM pg_catalog.pg_roles AS role_record");
    expect(database.calls[0]?.text).toContain(
      "pg_catalog.pg_has_role(session_user, inherited_role.oid, 'USAGE')",
    );
    expect(database.calls[0]?.text).toContain(
      "pg_catalog.pg_has_role(session_user, candidate.oid, 'SET')",
    );
    expect(database.calls[1]?.text).toContain("set_config('counter.environment', $1, true)");
    expect(database.calls[1]?.text).toContain("set_config('counter.assurance', $4, true)");
    expect(database.calls[1]?.text).toContain("set_config('counter.permission', $7, true)");
    expect(database.calls[1]?.values).toEqual([
      "test",
      "merchant_user",
      context.actor.id,
      "multi_factor",
      "merchant",
      context.effectiveScope.kind === "merchant"
        ? context.effectiveScope.merchantId
        : "unexpected",
      "identity.actor.read",
      "",
      context.correlationId,
    ]);
  });

  it.each(unsafePostures)("rejects %s runtime role posture", async (_description, override) => {
    const database = new RecordingDatabase({
      posture: { ...safeRuntimeRolePosture(), ...override },
    });
    const manager = new ScopedTransactionManager(database);

    await expect(
      manager.transaction(authorizedMerchantContext(), () => Promise.resolve()),
    ).rejects.toThrow("requires a restricted PostgreSQL role");
    expect(database.calls).toHaveLength(1);
    expect(database.calls[0]?.text).not.toContain("set_config");
  });

  it("fails closed when the current runtime role cannot be inspected", async () => {
    const database = new RecordingDatabase({ posture: null });
    const manager = new ScopedTransactionManager(database);

    await expect(
      manager.transaction(authorizedMerchantContext(), () => Promise.resolve()),
    ).rejects.toThrow("requires a restricted PostgreSQL role");
    expect(database.calls).toHaveLength(1);
  });

  it("preserves database failures below the repository boundary", async () => {
    const rawError = postgresError("23505");
    const database = new RecordingDatabase({ operationFailure: rawError });
    const manager = new ScopedTransactionManager(database);

    await expect(
      manager.transaction(authorizedMerchantContext(), (session) =>
        session.query("INSERT INTO test_write (value) VALUES (1)"),
      ),
    ).rejects.toBe(rawError);
  });

  it("invalidates an escaped scoped session when its transaction ends", async () => {
    const database = new RecordingDatabase();
    const manager = new ScopedTransactionManager(database);
    let escaped: ScopedDatabaseSession<"identity.actor.read"> | undefined;

    await manager.transaction(authorizedMerchantContext(), (session) => {
      escaped = session;
      return Promise.resolve();
    });

    expect(escaped).toBeDefined();
    await expect(escaped?.query("SELECT 1")).rejects.toThrow("no longer active");
  });

  it("rejects objects that did not come from authorization", async () => {
    const database = new RecordingDatabase();
    const manager = new ScopedTransactionManager(database);
    const forged = Object.freeze({}) as AuthorizedContext<"identity.actor.read">;

    await expect(manager.transaction(forged, () => Promise.resolve(undefined))).rejects.toThrow(
      "requires an authorized context",
    );
    expect(database.calls).toHaveLength(0);
    expect(database.poolCalls).toHaveLength(0);
  });
});

describe("PostgresIdentityRepositories", () => {
  it.each(normalizedPostgresCodes)(
    "normalizes PostgreSQL %s write failures without database details",
    async (code) => {
      const context = authorizedMerchantRoleContext();
      const rawError = postgresError(code);
      const database = new RecordingDatabase({
        operationFailure: rawError,
        operationFailurePrefix: "INSERT INTO identity.actor_role_assignments",
      });
      const repositories = new PostgresIdentityRepositories(
        new ScopedTransactionManager(database),
      );
      let caught: unknown;

      try {
        await repositories.assignRoles(context, roleAssignment(context));
      } catch (error: unknown) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(Error);
      expect(caught).toMatchObject({ message: "Identity persistence write rejected" });
      expect(caught).not.toHaveProperty("code");
      expect(String(caught)).not.toContain("secret_constraint");
      expect(String(caught)).not.toContain("identity.secret_table");
    },
  );

  it("does not normalize PostgreSQL read failures", async () => {
    const rawError = postgresError("42501");
    const database = new RecordingDatabase({
      operationFailure: rawError,
      operationFailurePrefix: "SELECT environment, merchant_id AS scope_id",
    });
    const repositories = new PostgresIdentityRepositories(
      new ScopedTransactionManager(database),
    );

    await expect(
      repositories.findMerchantScope(
        authorizedMerchantScopeContext(),
        counterId("merchant", 1),
      ),
    ).rejects.toBe(rawError);
  });

  it("persists role-assignment attribution from the authorized actor", async () => {
    const context = authorizedMerchantRoleContext();
    const assignment = roleAssignment(context);
    const database = new RecordingDatabase();
    const repositories = new PostgresIdentityRepositories(
      new ScopedTransactionManager(database),
    );

    await repositories.assignRoles(context, assignment);

    const write = database.calls.find((call) =>
      call.text.includes("INSERT INTO identity.actor_role_assignments"),
    );
    expect(assignment).not.toHaveProperty("assignedBy");
    expect(write?.values.slice(6, 8)).toEqual([context.actor.kind, context.actor.id]);
  });

  it("persists support revocation attribution from the authorized actor", async () => {
    const context = authorizedOperatorContext();
    const database = new RecordingDatabase({
      supportGrantRevocationRow: {
        environment: "test",
        target_scope_kind: "merchant",
        target_scope_id: counterId("merchant", 1),
      },
    });
    const repositories = new PostgresIdentityRepositories(
      new ScopedTransactionManager(database),
    );

    await expect(
      repositories.revokeSupportGrant(
        context,
        counterId("support-grant", 8),
        testInstant(),
      ),
    ).resolves.toBe(true);

    const update = database.calls.find((call) =>
      call.text.startsWith("UPDATE identity.support_grants"),
    );
    const event = database.calls.find((call) =>
      call.text.startsWith("INSERT INTO identity.support_grant_events"),
    );
    expect(update?.values[3]).toBe(context.actor.id);
    expect(event?.values[4]).toBe(context.actor.id);
  });
});

function authorizedMerchantContext(): AuthorizedContext<"identity.actor.read"> {
  const scope = merchantScope("test", counterId("merchant", 1));
  const actorContext = createActorContext({
    actor: { kind: "merchant_user", id: counterId("merchant-user", 2) },
    environment: "test",
    scope,
    assurance: "multi_factor",
    roles: ["merchant.owner"],
    correlationId: counterId("correlation", 3),
  });
  if (!actorContext.ok) {
    throw new Error("test ActorContext was rejected");
  }
  const at = instantFromEpochMilliseconds(1_750_000_000_000);
  if (!at.ok) {
    throw new Error("test Instant was rejected");
  }
  const authorized = authorize(actorContext.value, {
    permission: "identity.actor.read",
    environment: "test",
    scope,
    at: at.value,
  });
  if (!authorized.ok) {
    throw new Error("test authorization was rejected");
  }
  return authorized.value;
}

function authorizedMerchantScopeContext(): AuthorizedContext<"identity.scope.read"> {
  const scope = merchantScope("test", counterId("merchant", 1));
  const actorContext = createActorContext({
    actor: { kind: "merchant_user", id: counterId("merchant-user", 2) },
    environment: "test",
    scope,
    assurance: "multi_factor",
    roles: ["merchant.owner"],
    correlationId: counterId("correlation", 3),
  });
  if (!actorContext.ok) {
    throw new Error("test ActorContext was rejected");
  }
  const authorized = authorize(actorContext.value, {
    permission: "identity.scope.read",
    environment: "test",
    scope,
    at: testInstant(),
  });
  if (!authorized.ok) {
    throw new Error("test scope-read authorization was rejected");
  }
  return authorized.value;
}

function authorizedMerchantRoleContext(): AuthorizedContext<"identity.role.assign"> {
  const scope = merchantScope("test", counterId("merchant", 1));
  const actorContext = createActorContext({
    actor: { kind: "merchant_user", id: counterId("merchant-user", 2) },
    environment: "test",
    scope,
    assurance: "multi_factor",
    roles: ["merchant.owner"],
    correlationId: counterId("correlation", 3),
  });
  if (!actorContext.ok) {
    throw new Error("test ActorContext was rejected");
  }
  const authorized = authorize(actorContext.value, {
    permission: "identity.role.assign",
    environment: "test",
    scope,
    at: testInstant(),
  });
  if (!authorized.ok) {
    throw new Error("test role-assignment authorization was rejected");
  }
  return authorized.value;
}

function authorizedOperatorContext(): AuthorizedContext<"identity.support_grant.revoke"> {
  const scope = platformScope("test");
  const actorContext = createActorContext({
    actor: { kind: "operator", id: counterId("operator", 2) },
    environment: "test",
    scope,
    assurance: "step_up",
    roles: ["platform.operator"],
    correlationId: counterId("correlation", 3),
  });
  if (!actorContext.ok) {
    throw new Error("test operator ActorContext was rejected");
  }
  const authorized = authorize(actorContext.value, {
    permission: "identity.support_grant.revoke",
    environment: "test",
    scope,
    at: testInstant(),
  });
  if (!authorized.ok) {
    throw new Error("test support-revocation authorization was rejected");
  }
  return authorized.value;
}

function roleAssignment(
  context: AuthorizedContext<"identity.role.assign">,
): RoleAssignmentInput {
  if (context.effectiveScope.kind !== "merchant") {
    throw new Error("test role-assignment context was not merchant-scoped");
  }
  return {
    actor: { kind: "merchant_user", id: counterId("merchant-user", 4) },
    environment: context.environment,
    scope: context.effectiveScope,
    roles: ["merchant.admin"],
    assignedAt: testInstant(),
  };
}

function testInstant(): Instant {
  const result = instantFromEpochMilliseconds(1_750_000_000_000);
  if (!result.ok) {
    throw new Error("test Instant was rejected");
  }
  return result.value;
}

function safeRuntimeRolePosture(): RuntimeRolePostureRow {
  return {
    is_session_role: true,
    is_superuser: false,
    bypasses_row_level_security: false,
    can_login: true,
    inherits_privileges: false,
    can_set_role_to_unsafe_role: false,
  };
}

function postgresError(code: string): DatabaseError {
  return Object.assign(new DatabaseError("raw database detail for secret_constraint", 0, "error"), {
    code,
    constraint: "secret_constraint",
    table: "identity.secret_table",
  });
}

function counterId<Kind extends CounterIdKind>(kind: Kind, seed: number): CounterId<Kind> {
  const result = createCounterId(kind, new Uint8Array(16).fill(seed));
  if (!result.ok) {
    throw new Error("test ID was rejected");
  }
  return result.value;
}

function recordedCall(text: string, values: readonly unknown[]): RecordedCall {
  return Object.freeze({ text, values: Object.freeze([...values]) });
}

function resultWithRows<Row extends QueryResultRow>(rows: Row[]): QueryResult<Row> {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows,
  };
}

function emptyResult<Row extends QueryResultRow>(): QueryResult<Row> {
  return resultWithRows<Row>([]);
}
