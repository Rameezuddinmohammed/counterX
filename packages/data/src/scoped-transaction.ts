import {
  isAuthorizedContext,
  type AuthorizedContext,
  type Permission,
} from "@counter/authorization";
import type { QueryResult, QueryResultRow } from "pg";
import type { DatabaseSession, TransactionalDatabase } from "./database.js";

const scopedSessionBrand: unique symbol = Symbol("ScopedDatabaseSession");

interface RuntimeRolePostureRow extends QueryResultRow {
  readonly is_session_role: boolean;
  readonly is_superuser: boolean;
  readonly bypasses_row_level_security: boolean;
  readonly can_login: boolean;
  readonly inherits_privileges: boolean;
  readonly can_set_role_to_unsafe_role: boolean;
}

export interface ScopedDatabaseSession<PermissionType extends Permission = Permission>
  extends DatabaseSession {
  readonly [scopedSessionBrand]: true;
  readonly context: AuthorizedContext<PermissionType>;
}

export class ScopedTransactionManager {
  constructor(private readonly database: TransactionalDatabase) {}

  async transaction<PermissionType extends Permission, Result>(
    context: AuthorizedContext<PermissionType>,
    operation: (session: ScopedDatabaseSession<PermissionType>) => Promise<Result>,
  ): Promise<Result> {
    if (!isAuthorizedContext(context)) {
      throw new Error("Scoped persistence requires an authorized context");
    }

    return await this.database.transaction(async (databaseSession) => {
      await assertRuntimeRolePosture(databaseSession);
      await establishTransactionClaims(databaseSession, context);
      if (context.supportGrantId !== undefined) {
        await recordSupportUse(databaseSession, context);
      }

      let active = true;
      const session: ScopedDatabaseSession<PermissionType> = Object.freeze({
        [scopedSessionBrand]: true as const,
        context,
        query<Row extends QueryResultRow = QueryResultRow>(
          text: string,
          values?: readonly unknown[],
        ): Promise<QueryResult<Row>> {
          if (!active) {
            return Promise.reject(new Error("Scoped database session is no longer active"));
          }
          return databaseSession.query<Row>(text, values);
        },
      });

      try {
        return await operation(session);
      } finally {
        active = false;
      }
    });
  }
}

export function scopeIdentifier(context: AuthorizedContext): string {
  switch (context.effectiveScope.kind) {
    case "merchant":
      return context.effectiveScope.merchantId;
    case "wallet":
      return context.effectiveScope.walletId;
    case "platform":
      return "platform";
  }
}

async function assertRuntimeRolePosture(session: DatabaseSession): Promise<void> {
  const result = await session.query<RuntimeRolePostureRow>(
    `SELECT
       current_user = session_user AS is_session_role,
       role_record.rolsuper AS is_superuser,
       role_record.rolbypassrls AS bypasses_row_level_security,
       role_record.rolcanlogin AS can_login,
       (
         role_record.rolinherit OR EXISTS (
           SELECT 1
           FROM pg_catalog.pg_roles AS inherited_role
           WHERE inherited_role.oid <> role_record.oid
             AND pg_catalog.pg_has_role(session_user, inherited_role.oid, 'USAGE')
         )
       ) AS inherits_privileges,
       EXISTS (
         SELECT 1
         FROM pg_catalog.pg_roles AS candidate
         WHERE candidate.oid <> role_record.oid
           AND (candidate.rolsuper OR candidate.rolbypassrls)
           AND pg_catalog.pg_has_role(session_user, candidate.oid, 'SET')
       ) AS can_set_role_to_unsafe_role
     FROM pg_catalog.pg_roles AS role_record
     WHERE role_record.rolname = current_user`,
  );
  const posture = result.rows[0];
  if (
    result.rows.length !== 1 ||
    posture === undefined ||
    posture.is_session_role !== true ||
    posture.is_superuser !== false ||
    posture.bypasses_row_level_security !== false ||
    posture.can_login !== true ||
    posture.inherits_privileges !== false ||
    posture.can_set_role_to_unsafe_role !== false
  ) {
    throw new Error("Scoped persistence requires a restricted PostgreSQL role");
  }
}

async function establishTransactionClaims(
  session: DatabaseSession,
  context: AuthorizedContext,
): Promise<void> {
  await session.query(
    `SELECT
       set_config('counter.environment', $1, true),
       set_config('counter.actor_kind', $2, true),
       set_config('counter.actor_id', $3, true),
       set_config('counter.assurance', $4, true),
       set_config('counter.scope_kind', $5, true),
       set_config('counter.scope_id', $6, true),
       set_config('counter.permission', $7, true),
       set_config('counter.support_grant_id', $8, true),
       set_config('counter.correlation_id', $9, true)`,
    [
      context.environment,
      context.actor.kind,
      context.actor.id,
      context.assurance,
      context.effectiveScope.kind,
      scopeIdentifier(context),
      context.authorizedPermission,
      context.supportGrantId ?? "",
      context.correlationId,
    ],
  );
}

async function recordSupportUse(
  session: DatabaseSession,
  context: AuthorizedContext,
): Promise<void> {
  await session.query(
    `INSERT INTO identity.support_grant_events (
       support_grant_id,
       environment,
       target_scope_kind,
       target_scope_id,
       operator_id,
       action,
       correlation_id
     )
     VALUES ($1, $2, $3, $4, $5, 'used', $6)`,
    [
      context.supportGrantId,
      context.environment,
      context.effectiveScope.kind,
      scopeIdentifier(context),
      context.actor.id,
      context.correlationId,
    ],
  );
}
