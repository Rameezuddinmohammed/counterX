import {
  createActorRecord,
  createAgentPublicKeyRecord,
  createRoleAssignmentRecord,
  createServiceIdentityRecord,
  createSupportGrantAuthorizationRecord,
  createSupportGrantRecord,
  isRoleKey,
  isSupportGrantRecord,
  isSupportPermission,
  type ActorRepository,
  type ActorRecord,
  type AgentPublicKeyRecord,
  type AgentPublicKeyRepository,
  type AuthorizedContext,
  type MerchantScopeRecord,
  type Permission,
  type RoleAssignmentInput,
  type RoleAssignmentRecord,
  type RoleAssignmentRepository,
  type ServiceIdentityRecord,
  type ServiceIdentityRepository,
  type SupportGrantRecord,
  type SupportGrantAuthorizationInput,
  type SupportGrantRepository,
  type TenantScopeRepository,
  type WalletScopeRecord,
} from "@counter/authorization";
import {
  createExternalReference,
  instantFromEpochMilliseconds,
  isEnvironment,
  merchantScope,
  parseCounterId,
  platformScope,
  scopesEqual,
  walletScope,
  type ActorKind,
  type ActorReference,
  type AgentId,
  type CounterId,
  type CounterIdKind,
  type Environment,
  type Instant,
  type KeyId,
  type MerchantId,
  type OperatorId,
  type Scope,
  type ServiceId,
  type SupportGrantId,
  type WalletId,
} from "@counter/domain";
import { DatabaseError } from "pg";
import type {
  ScopedDatabaseSession,
  ScopedTransactionManager,
} from "./scoped-transaction.js";

interface ScopeRow {
  environment: string;
  scope_id: string;
  created_at: Date;
}

interface ActorRow {
  environment: string;
  actor_kind: string;
  actor_id: string;
  owner_scope_kind: string;
  owner_scope_id: string;
  status: string;
  created_at: Date;
  disabled_at: Date | null;
}

interface RoleAssignmentRow {
  environment: string;
  actor_kind: string;
  actor_id: string;
  owner_scope_kind: string;
  owner_scope_id: string;
  role_key: string;
  assigned_by_kind: string;
  assigned_by_id: string;
  assigned_at: Date;
  revoked_at: Date | null;
}

interface AgentPublicKeyRow {
  environment: string;
  owner_scope_id: string;
  key_id: string;
  agent_id: string;
  algorithm: string;
  public_key_base64url: string;
  created_at: Date;
  not_before: Date;
  expires_at: Date | null;
  revoked_at: Date | null;
}

interface ServiceIdentityRow {
  environment: string;
  owner_scope_kind: string;
  owner_scope_id: string;
  service_id: string;
  binding_source: string;
  binding_value: string;
  status: string;
  created_at: Date;
  disabled_at: Date | null;
}

interface SupportGrantRow {
  support_grant_id: string;
  environment: string;
  target_scope_kind: string;
  target_scope_id: string;
  operator_id: string;
  reason: string;
  authorization_kind: string;
  authorized_by: string;
  authorized_at: Date;
  authorization_reference_source: string;
  authorization_reference_value: string;
  issued_at: Date;
  valid_from: Date;
  expires_at: Date;
  revoked_at: Date | null;
  revoked_by: string | null;
  permissions: string[];
}

interface ScopeFields {
  readonly environment: Environment;
  readonly kind: Scope["kind"];
  readonly id: string;
}

export class PostgresIdentityRepositories
  implements
    TenantScopeRepository,
    ActorRepository,
    RoleAssignmentRepository,
    AgentPublicKeyRepository,
    ServiceIdentityRepository,
    SupportGrantRepository
{
  constructor(private readonly transactions: ScopedTransactionManager) {}

  private async repositoryTransaction<PermissionType extends Permission, Result>(
    context: AuthorizedContext<PermissionType>,
    operation: (session: ScopedDatabaseSession<PermissionType>) => Promise<Result>,
  ): Promise<Result> {
    try {
      return await this.transactions.transaction(context, operation);
    } catch (error: unknown) {
      if (
        isIdentityWritePermission(context.authorizedPermission) &&
        isNormalizedPostgresWriteFailure(error)
      ) {
        throw rejectedPersistenceWrite();
      }
      throw error;
    }
  }

  findMerchantScope(
    context: AuthorizedContext<"identity.scope.read">,
    merchantId: MerchantId,
  ): Promise<MerchantScopeRecord | undefined> {
    return this.repositoryTransaction(context, async (session) => {
      const result = await session.query<ScopeRow>(
        `SELECT environment, merchant_id AS scope_id, created_at
         FROM merchant.scopes
         WHERE environment = $1 AND merchant_id = $2`,
        [context.environment, merchantId],
      );
      const row = result.rows[0];
      if (row === undefined) {
        return undefined;
      }
      const environment = environmentFrom(row.environment);
      return Object.freeze({
        scope: merchantScope(environment, idFrom(row.scope_id, "merchant")),
        createdAt: instantFromDate(row.created_at),
      });
    });
  }

  findWalletScope(
    context: AuthorizedContext<"identity.scope.read">,
    walletId: WalletId,
  ): Promise<WalletScopeRecord | undefined> {
    return this.repositoryTransaction(context, async (session) => {
      const result = await session.query<ScopeRow>(
        `SELECT environment, wallet_id AS scope_id, created_at
         FROM wallet.scopes
         WHERE environment = $1 AND wallet_id = $2`,
        [context.environment, walletId],
      );
      const row = result.rows[0];
      if (row === undefined) {
        return undefined;
      }
      const environment = environmentFrom(row.environment);
      return Object.freeze({
        scope: walletScope(environment, idFrom(row.scope_id, "wallet")),
        createdAt: instantFromDate(row.created_at),
      });
    });
  }

  createMerchantScope(
    context: AuthorizedContext<"identity.scope.manage">,
    record: MerchantScopeRecord,
  ): Promise<void> {
    assertOwns(context, record.scope);
    return this.repositoryTransaction(context, async (session) => {
      await session.query(
        `INSERT INTO identity.scope_registry (environment, scope_kind, scope_id, created_at)
         VALUES ($1, 'merchant', $2, $3)`,
        [record.scope.environment, record.scope.merchantId, asDate(record.createdAt)],
      );
      await session.query(
        `INSERT INTO merchant.scopes (environment, merchant_id, created_at)
         VALUES ($1, $2, $3)`,
        [record.scope.environment, record.scope.merchantId, asDate(record.createdAt)],
      );
    });
  }

  createWalletScope(
    context: AuthorizedContext<"identity.scope.manage">,
    record: WalletScopeRecord,
  ): Promise<void> {
    assertOwns(context, record.scope);
    return this.repositoryTransaction(context, async (session) => {
      await session.query(
        `INSERT INTO identity.scope_registry (environment, scope_kind, scope_id, created_at)
         VALUES ($1, 'wallet', $2, $3)`,
        [record.scope.environment, record.scope.walletId, asDate(record.createdAt)],
      );
      await session.query(
        `INSERT INTO wallet.scopes (environment, wallet_id, created_at)
         VALUES ($1, $2, $3)`,
        [record.scope.environment, record.scope.walletId, asDate(record.createdAt)],
      );
    });
  }

  findActorByReference(
    context: AuthorizedContext<"identity.actor.read">,
    actor: ActorReference,
  ): Promise<ActorRecord | undefined> {
    return this.repositoryTransaction(context, async (session) => {
      const result = await session.query<ActorRow>(
        `SELECT environment, actor_kind, actor_id, owner_scope_kind, owner_scope_id,
                status, created_at, disabled_at
         FROM identity.actors
         WHERE environment = $1 AND actor_kind = $2 AND actor_id = $3`,
        [context.environment, actor.kind, actor.id],
      );
      return result.rows[0] === undefined ? undefined : actorRecordFrom(result.rows[0]);
    });
  }

  createActor(
    context: AuthorizedContext<"identity.actor.manage">,
    record: ActorRecord,
  ): Promise<void> {
    const validated = unwrapRecord(createActorRecord(record));
    assertOwns(context, validated.scope);
    const owner = scopeFields(validated.scope);
    return this.repositoryTransaction(context, async (session) => {
      await session.query(
        `INSERT INTO identity.actors (
           environment, actor_kind, actor_id, owner_scope_kind, owner_scope_id,
           status, created_at, disabled_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          validated.environment,
          validated.actor.kind,
          validated.actor.id,
          owner.kind,
          owner.id,
          validated.status,
          asDate(validated.createdAt),
          optionalDate(validated.disabledAt),
        ],
      );
    });
  }

  disableActor(
    context: AuthorizedContext<"identity.actor.manage">,
    actor: ActorReference,
    disabledAt: Instant,
  ): Promise<boolean> {
    return this.repositoryTransaction(context, async (session) => {
      const result = await session.query(
        `UPDATE identity.actors
         SET status = 'suspended', disabled_at = $4
         WHERE environment = $1 AND actor_kind = $2 AND actor_id = $3 AND status = 'active'`,
        [context.environment, actor.kind, actor.id, asDate(disabledAt)],
      );
      return (result.rowCount ?? 0) > 0;
    });
  }

  listRolesForActor(
    context: AuthorizedContext<"identity.role.read">,
    actor: ActorReference,
  ): Promise<readonly RoleAssignmentRecord[]> {
    return this.repositoryTransaction(context, async (session) => {
      const result = await session.query<RoleAssignmentRow>(
        `SELECT environment, actor_kind, actor_id, owner_scope_kind, owner_scope_id,
                role_key, assigned_by_kind, assigned_by_id, assigned_at, revoked_at
         FROM identity.actor_role_assignments
         WHERE environment = $1 AND actor_kind = $2 AND actor_id = $3
         ORDER BY assigned_at, role_key`,
        [context.environment, actor.kind, actor.id],
      );
      return Object.freeze(result.rows.map(roleAssignmentFrom));
    });
  }

  assignRoles(
    context: AuthorizedContext<"identity.role.assign">,
    assignment: RoleAssignmentInput,
  ): Promise<void> {
    const validated = unwrapRecord(
      createRoleAssignmentRecord({ ...assignment, assignedBy: context.actor }),
    );
    assertOwns(context, validated.scope);
    const owner = scopeFields(validated.scope);
    return this.repositoryTransaction(context, async (session) => {
      for (const role of validated.roles) {
        await session.query(
          `INSERT INTO identity.actor_role_assignments (
             environment, actor_kind, actor_id, owner_scope_kind, owner_scope_id,
             role_key, assigned_by_kind, assigned_by_id, assigned_at, revoked_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            validated.environment,
            validated.actor.kind,
            validated.actor.id,
            owner.kind,
            owner.id,
            role,
            context.actor.kind,
            context.actor.id,
            asDate(validated.assignedAt),
            optionalDate(validated.revokedAt),
          ],
        );
      }
    });
  }

  revokeRoles(
    context: AuthorizedContext<"identity.role.assign">,
    actor: ActorReference,
    revokedAt: Instant,
  ): Promise<boolean> {
    return this.repositoryTransaction(context, async (session) => {
      const result = await session.query(
        `UPDATE identity.actor_role_assignments
         SET revoked_at = $4
         WHERE environment = $1 AND actor_kind = $2 AND actor_id = $3 AND revoked_at IS NULL`,
        [context.environment, actor.kind, actor.id, asDate(revokedAt)],
      );
      return (result.rowCount ?? 0) > 0;
    });
  }

  listAgentKeys(
    context: AuthorizedContext<"identity.agent_key.read">,
    agentId: AgentId,
  ): Promise<readonly AgentPublicKeyRecord[]> {
    return this.repositoryTransaction(context, async (session) => {
      const result = await session.query<AgentPublicKeyRow>(
        `${agentPublicKeySelect}
         WHERE environment = $1 AND agent_id = $2
         ORDER BY created_at, key_id`,
        [context.environment, agentId],
      );
      return Object.freeze(result.rows.map(agentPublicKeyFrom));
    });
  }

  createAgentKey(
    context: AuthorizedContext<"identity.agent_key.manage">,
    record: AgentPublicKeyRecord,
  ): Promise<void> {
    const validated = unwrapRecord(createAgentPublicKeyRecord(record));
    assertOwns(context, validated.scope);
    return this.repositoryTransaction(context, async (session) => {
      await session.query(
        `INSERT INTO identity.agent_public_keys (
           environment, owner_scope_id, key_id, agent_id, algorithm,
           public_key_base64url, created_at, not_before, expires_at, revoked_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          validated.environment,
          validated.scope.walletId,
          validated.keyId,
          validated.agentId,
          validated.algorithm,
          validated.publicKeyBase64Url,
          asDate(validated.createdAt),
          asDate(validated.notBefore),
          optionalDate(validated.expiresAt),
          optionalDate(validated.revokedAt),
        ],
      );
    });
  }

  revokeAgentKey(
    context: AuthorizedContext<"identity.agent_key.manage">,
    keyId: KeyId,
    revokedAt: Instant,
  ): Promise<boolean> {
    return this.repositoryTransaction(context, async (session) => {
      const result = await session.query(
        `UPDATE identity.agent_public_keys
         SET revoked_at = $3
         WHERE environment = $1 AND key_id = $2 AND revoked_at IS NULL`,
        [context.environment, keyId, asDate(revokedAt)],
      );
      return (result.rowCount ?? 0) > 0;
    });
  }

  createService(
    context: AuthorizedContext<"identity.service_identity.manage">,
    record: ServiceIdentityRecord,
  ): Promise<void> {
    const validated = unwrapRecord(createServiceIdentityRecord(record));
    assertOwns(context, validated.scope);
    const owner = scopeFields(validated.scope);
    return this.repositoryTransaction(context, async (session) => {
      await session.query(
        `INSERT INTO identity.service_identities (
           environment, owner_scope_kind, owner_scope_id, service_id,
           binding_source, binding_value, status, created_at, disabled_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          validated.environment,
          owner.kind,
          owner.id,
          validated.serviceId,
          validated.authenticationBinding.source,
          validated.authenticationBinding.value,
          validated.status,
          asDate(validated.createdAt),
          optionalDate(validated.disabledAt),
        ],
      );
    });
  }

  disableService(
    context: AuthorizedContext<"identity.service_identity.manage">,
    serviceId: ServiceId,
    disabledAt: Instant,
  ): Promise<boolean> {
    return this.repositoryTransaction(context, async (session) => {
      const result = await session.query(
        `UPDATE identity.service_identities
         SET status = 'suspended', disabled_at = $3
         WHERE environment = $1 AND service_id = $2 AND status = 'active'`,
        [context.environment, serviceId, asDate(disabledAt)],
      );
      return (result.rowCount ?? 0) > 0;
    });
  }

  listSupportGrantsForOperator(
    context: AuthorizedContext<"identity.support_grant.read">,
    operatorId: OperatorId,
  ): Promise<readonly SupportGrantRecord[]> {
    return this.repositoryTransaction(context, async (session) => {
      const result = await session.query<SupportGrantRow>(
        `${supportGrantSelect}
         WHERE grant_record.environment = $1 AND grant_record.operator_id = $2
         GROUP BY grant_record.support_grant_id
         ORDER BY grant_record.issued_at, grant_record.support_grant_id`,
        [context.environment, operatorId],
      );
      return Object.freeze(result.rows.map(supportGrantFrom));
    });
  }

  authorizeSupportGrant(
    context: AuthorizedContext<"identity.support_grant.issue">,
    authorization: SupportGrantAuthorizationInput,
  ): Promise<void> {
    if (
      context.actor.kind !== "operator" ||
      context.effectiveScope.kind !== "platform" ||
      context.environment !== authorization.environment
    ) {
      throw unauthorizedPersistence();
    }
    const fullAuthorization =
      authorization.authorization.kind === "approved"
        ? {
            kind: "approved" as const,
            authorizedBy: context.actor.id,
            authorizedAt: authorization.authorization.authorizedAt,
            approvalReference: authorization.authorization.approvalReference,
          }
        : {
            kind: "incident" as const,
            authorizedBy: context.actor.id,
            authorizedAt: authorization.authorization.authorizedAt,
            incidentReference: authorization.authorization.incidentReference,
          };
    const validated = unwrapRecord(
      createSupportGrantAuthorizationRecord({
        ...authorization,
        authorization: fullAuthorization,
      }),
    );
    const target = scopeFields(validated.targetScope);
    const authorizationReference =
      validated.authorization.kind === "approved"
        ? validated.authorization.approvalReference
        : validated.authorization.incidentReference;

    return this.repositoryTransaction(context, async (session) => {
      await session.query(
        `INSERT INTO identity.support_grant_authorizations (
           support_grant_id, environment, target_scope_kind, target_scope_id, operator_id,
           reason, authorization_kind, authorized_by, authorized_at,
           authorization_reference_source, authorization_reference_value,
           valid_from, expires_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
         )`,
        [
          validated.supportGrantId,
          validated.environment,
          target.kind,
          target.id,
          validated.operatorId,
          validated.reason,
          validated.authorization.kind,
          validated.authorization.authorizedBy,
          asDate(validated.authorization.authorizedAt),
          authorizationReference.source,
          authorizationReference.value,
          asDate(validated.validFrom),
          asDate(validated.expiresAt),
        ],
      );
      await session.query(
        `INSERT INTO identity.support_grant_authorization_permissions (support_grant_id, permission_key)
         SELECT $1, permission_key
         FROM unnest($2::text[]) AS permission_key`,
        [validated.supportGrantId, validated.permissions],
      );
    });
  }

  issueSupportGrant(
    context: AuthorizedContext<"identity.support_grant.issue">,
    record: SupportGrantRecord,
  ): Promise<void> {
    if (
      !isSupportGrantRecord(record) ||
      context.actor.kind !== "operator" ||
      context.effectiveScope.kind !== "platform" ||
      context.environment !== record.environment ||
      context.actor.id !== record.operatorId
    ) {
      throw unauthorizedPersistence();
    }
    const target = scopeFields(record.targetScope);
    const authorizationReference =
      record.authorization.kind === "approved"
        ? record.authorization.approvalReference
        : record.authorization.incidentReference;

    return this.repositoryTransaction(context, async (session) => {
      await session.query(
        `INSERT INTO identity.support_grants (
           support_grant_id, environment, target_scope_kind, target_scope_id, operator_id,
           reason, authorization_kind, authorized_by, authorized_at,
           authorization_reference_source, authorization_reference_value,
           issued_at, valid_from, expires_at, revoked_at, revoked_by
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
         )`,
        [
          record.supportGrantId,
          record.environment,
          target.kind,
          target.id,
          record.operatorId,
          record.reason,
          record.authorization.kind,
          record.authorization.authorizedBy,
          asDate(record.authorization.authorizedAt),
          authorizationReference.source,
          authorizationReference.value,
          asDate(record.issuedAt),
          asDate(record.validFrom),
          asDate(record.expiresAt),
          optionalDate(record.revokedAt),
          record.revokedBy ?? null,
        ],
      );
      await session.query(
        `INSERT INTO identity.support_grant_permissions (support_grant_id, permission_key)
         SELECT $1, permission_key
         FROM unnest($2::text[]) AS permission_key`,
        [record.supportGrantId, record.permissions],
      );
      await session.query(
        `INSERT INTO identity.support_grant_events (
           support_grant_id, environment, target_scope_kind, target_scope_id,
           operator_id, action, correlation_id, occurred_at
         ) VALUES ($1, $2, $3, $4, $5, 'issued', $6, $7)`,
        [
          record.supportGrantId,
          record.environment,
          target.kind,
          target.id,
          record.operatorId,
          context.correlationId,
          asDate(record.issuedAt),
        ],
      );
    });
  }

  revokeSupportGrant(
    context: AuthorizedContext<"identity.support_grant.revoke">,
    supportGrantId: SupportGrantId,
    revokedAt: Instant,
  ): Promise<boolean> {
    if (context.actor.kind !== "operator" || context.effectiveScope.kind !== "platform") {
      throw unauthorizedPersistence();
    }
    const revokingOperatorId = context.actor.id;
    return this.repositoryTransaction(context, async (session) => {
      const result = await session.query<{
        environment: string;
        target_scope_kind: string;
        target_scope_id: string;
      }>(
        `UPDATE identity.support_grants
         SET revoked_at = $3, revoked_by = $4
         WHERE support_grant_id = $1 AND environment = $2 AND revoked_at IS NULL
         RETURNING environment, target_scope_kind, target_scope_id`,
        [supportGrantId, context.environment, asDate(revokedAt), revokingOperatorId],
      );
      const row = result.rows[0];
      if (row === undefined) {
        return false;
      }
      await session.query(
        `INSERT INTO identity.support_grant_events (
           support_grant_id, environment, target_scope_kind, target_scope_id,
           operator_id, action, correlation_id, occurred_at
         ) VALUES ($1, $2, $3, $4, $5, 'revoked', $6, $7)`,
        [
          supportGrantId,
          row.environment,
          row.target_scope_kind,
          row.target_scope_id,
          revokingOperatorId,
          context.correlationId,
          asDate(revokedAt),
        ],
      );
      return true;
    });
  }

  findAgentKeyById(
    context: AuthorizedContext<"identity.agent_key.read">,
    keyId: KeyId,
  ): Promise<AgentPublicKeyRecord | undefined> {
    return this.repositoryTransaction(context, async (session) => {
      const result = await session.query<AgentPublicKeyRow>(
        `${agentPublicKeySelect}
         WHERE environment = $1 AND key_id = $2`,
        [context.environment, keyId],
      );
      return result.rows[0] === undefined ? undefined : agentPublicKeyFrom(result.rows[0]);
    });
  }

  findServiceById(
    context: AuthorizedContext<"identity.service_identity.read">,
    serviceId: ServiceId,
  ): Promise<ServiceIdentityRecord | undefined> {
    return this.repositoryTransaction(context, async (session) => {
      const result = await session.query<ServiceIdentityRow>(
        `${serviceIdentitySelect}
         WHERE environment = $1 AND service_id = $2`,
        [context.environment, serviceId],
      );
      return result.rows[0] === undefined ? undefined : serviceIdentityFrom(result.rows[0]);
    });
  }

  findSupportGrantById(
    context: AuthorizedContext<"identity.support_grant.read">,
    supportGrantId: SupportGrantId,
  ): Promise<SupportGrantRecord | undefined> {
    return this.repositoryTransaction(context, async (session) => {
      const result = await session.query<SupportGrantRow>(
        `${supportGrantSelect}
         WHERE grant_record.support_grant_id = $1 AND grant_record.environment = $2
         GROUP BY grant_record.support_grant_id`,
        [supportGrantId, context.environment],
      );
      return result.rows[0] === undefined ? undefined : supportGrantFrom(result.rows[0]);
    });
  }
}

const agentPublicKeySelect = `SELECT environment, owner_scope_id, key_id, agent_id, algorithm,
  public_key_base64url, created_at, not_before, expires_at, revoked_at
  FROM identity.agent_public_keys`;

const serviceIdentitySelect = `SELECT environment, owner_scope_kind, owner_scope_id, service_id,
  binding_source, binding_value, status, created_at, disabled_at
  FROM identity.service_identities`;

const supportGrantSelect = `SELECT
  grant_record.support_grant_id,
  grant_record.environment,
  grant_record.target_scope_kind,
  grant_record.target_scope_id,
  grant_record.operator_id,
  grant_record.reason,
  grant_record.authorization_kind,
  grant_record.authorized_by,
  grant_record.authorized_at,
  grant_record.authorization_reference_source,
  grant_record.authorization_reference_value,
  grant_record.issued_at,
  grant_record.valid_from,
  grant_record.expires_at,
  grant_record.revoked_at,
  grant_record.revoked_by,
  ARRAY_AGG(grant_permission.permission_key ORDER BY grant_permission.permission_key) AS permissions
FROM identity.support_grants grant_record
JOIN identity.support_grant_permissions grant_permission
  ON grant_permission.support_grant_id = grant_record.support_grant_id`;

function actorRecordFrom(row: ActorRow): ActorRecord {
  const environment = environmentFrom(row.environment);
  const record = {
    actor: actorFrom(row.actor_kind, row.actor_id),
    environment,
    scope: scopeFrom(environment, row.owner_scope_kind, row.owner_scope_id),
    status: identityStatusFrom(row.status),
    createdAt: instantFromDate(row.created_at),
    ...(row.disabled_at === null ? {} : { disabledAt: instantFromDate(row.disabled_at) }),
  };
  return unwrapRecord(createActorRecord(record));
}

function roleAssignmentFrom(row: RoleAssignmentRow): RoleAssignmentRecord {
  const environment = environmentFrom(row.environment);
  if (!isRoleKey(row.role_key)) {
    throw corruptRecord();
  }
  const record = {
    actor: actorFrom(row.actor_kind, row.actor_id),
    environment,
    scope: scopeFrom(environment, row.owner_scope_kind, row.owner_scope_id),
    roles: [row.role_key],
    assignedBy: actorFrom(row.assigned_by_kind, row.assigned_by_id),
    assignedAt: instantFromDate(row.assigned_at),
    ...(row.revoked_at === null ? {} : { revokedAt: instantFromDate(row.revoked_at) }),
  };
  return unwrapRecord(createRoleAssignmentRecord(record));
}

function agentPublicKeyFrom(row: AgentPublicKeyRow): AgentPublicKeyRecord {
  const environment = environmentFrom(row.environment);
  if (row.algorithm !== "Ed25519") {
    throw corruptRecord();
  }
  const record = {
    keyId: idFrom(row.key_id, "key"),
    agentId: idFrom(row.agent_id, "agent"),
    environment,
    scope: walletScope(environment, idFrom(row.owner_scope_id, "wallet")),
    algorithm: "Ed25519" as const,
    publicKeyBase64Url: row.public_key_base64url,
    createdAt: instantFromDate(row.created_at),
    notBefore: instantFromDate(row.not_before),
    ...(row.expires_at === null ? {} : { expiresAt: instantFromDate(row.expires_at) }),
    ...(row.revoked_at === null ? {} : { revokedAt: instantFromDate(row.revoked_at) }),
  };
  return unwrapRecord(createAgentPublicKeyRecord(record));
}

function serviceIdentityFrom(row: ServiceIdentityRow): ServiceIdentityRecord {
  const environment = environmentFrom(row.environment);
  const binding = createExternalReference(row.binding_source, row.binding_value);
  if (!binding.ok) {
    throw corruptRecord();
  }
  const record = {
    serviceId: idFrom(row.service_id, "service"),
    environment,
    scope: scopeFrom(environment, row.owner_scope_kind, row.owner_scope_id),
    authenticationBinding: binding.value,
    status: identityStatusFrom(row.status),
    createdAt: instantFromDate(row.created_at),
    ...(row.disabled_at === null ? {} : { disabledAt: instantFromDate(row.disabled_at) }),
  };
  return unwrapRecord(createServiceIdentityRecord(record));
}

function supportGrantFrom(row: SupportGrantRow): SupportGrantRecord {
  const environment = environmentFrom(row.environment);
  const authorizationReference = createExternalReference(
    row.authorization_reference_source,
    row.authorization_reference_value,
  );
  if (!authorizationReference.ok || !row.permissions.every(isSupportPermission)) {
    throw corruptRecord();
  }
  const authorization =
    row.authorization_kind === "approved"
      ? {
          kind: "approved" as const,
          authorizedBy: idFrom(row.authorized_by, "operator"),
          authorizedAt: instantFromDate(row.authorized_at),
          approvalReference: authorizationReference.value,
        }
      : row.authorization_kind === "incident"
        ? {
            kind: "incident" as const,
            authorizedBy: idFrom(row.authorized_by, "operator"),
            authorizedAt: instantFromDate(row.authorized_at),
            incidentReference: authorizationReference.value,
          }
        : undefined;
  if (authorization === undefined) {
    throw corruptRecord();
  }
  const record = {
    supportGrantId: idFrom(row.support_grant_id, "support-grant"),
    operatorId: idFrom(row.operator_id, "operator"),
    environment,
    targetScope: tenantScopeFrom(environment, row.target_scope_kind, row.target_scope_id),
    permissions: row.permissions,
    reason: supportReasonFrom(row.reason),
    authorization,
    issuedAt: instantFromDate(row.issued_at),
    validFrom: instantFromDate(row.valid_from),
    expiresAt: instantFromDate(row.expires_at),
    ...(row.revoked_at === null ? {} : { revokedAt: instantFromDate(row.revoked_at) }),
    ...(row.revoked_by === null ? {} : { revokedBy: idFrom(row.revoked_by, "operator") }),
  };
  return unwrapRecord(createSupportGrantRecord(record));
}

function scopeFields(scope: Scope): ScopeFields {
  switch (scope.kind) {
    case "merchant":
      return { environment: scope.environment, kind: "merchant", id: scope.merchantId };
    case "wallet":
      return { environment: scope.environment, kind: "wallet", id: scope.walletId };
    case "platform":
      return { environment: scope.environment, kind: "platform", id: "platform" };
  }
}

function scopeFrom(
  environment: Environment,
  kind: string,
  id: string,
): Scope {
  switch (kind) {
    case "merchant":
      return merchantScope(environment, idFrom(id, "merchant"));
    case "wallet":
      return walletScope(environment, idFrom(id, "wallet"));
    case "platform":
      if (id !== "platform") {
        throw corruptRecord();
      }
      return platformScope(environment);
    default:
      throw corruptRecord();
  }
}

function tenantScopeFrom(
  environment: Environment,
  kind: string,
  id: string,
): Exclude<Scope, { kind: "platform" }> {
  const scope = scopeFrom(environment, kind, id);
  if (scope.kind === "platform") {
    throw corruptRecord();
  }
  return scope;
}

function actorFrom(kind: string, id: string): ActorReference {
  switch (kind as ActorKind) {
    case "merchant_user":
      return { kind: "merchant_user", id: idFrom(id, "merchant-user") };
    case "wallet_user":
      return { kind: "wallet_user", id: idFrom(id, "wallet-user") };
    case "registered_agent":
      return { kind: "registered_agent", id: idFrom(id, "agent") };
    case "operator":
      return { kind: "operator", id: idFrom(id, "operator") };
    case "service":
      return { kind: "service", id: idFrom(id, "service") };
    default:
      throw corruptRecord();
  }
}

function environmentFrom(value: string): Environment {
  if (!isEnvironment(value)) {
    throw corruptRecord();
  }
  return value;
}

function identityStatusFrom(value: string): ActorRecord["status"] {
  if (value !== "active" && value !== "suspended" && value !== "revoked") {
    throw corruptRecord();
  }
  return value;
}

function supportReasonFrom(value: string): SupportGrantRecord["reason"] {
  if (
    value !== "customer_request" &&
    value !== "incident_response" &&
    value !== "security_investigation" &&
    value !== "regulatory_support"
  ) {
    throw corruptRecord();
  }
  return value;
}

function idFrom<Kind extends CounterIdKind>(value: string, kind: Kind): CounterId<Kind> {
  const result = parseCounterId(value, kind);
  if (!result.ok) {
    throw corruptRecord();
  }
  return result.value;
}

function instantFromDate(value: Date): Instant {
  const result = instantFromEpochMilliseconds(value.getTime());
  if (!result.ok) {
    throw corruptRecord();
  }
  return result.value;
}

function asDate(value: Instant): Date {
  return new Date(value);
}

function optionalDate(value: Instant | undefined): Date | null {
  return value === undefined ? null : asDate(value);
}

function assertOwns(context: AuthorizedContext, scope: Scope): void {
  if (context.environment !== scope.environment || !scopesEqual(context.effectiveScope, scope)) {
    throw unauthorizedPersistence();
  }
}

function unwrapRecord<Value>(result: { readonly ok: true; readonly value: Value } | { readonly ok: false }): Value {
  if (!result.ok) {
    throw corruptRecord();
  }
  return result.value;
}

function isIdentityWritePermission(permission: Permission): boolean {
  switch (permission) {
    case "identity.scope.manage":
    case "identity.actor.manage":
    case "identity.role.assign":
    case "identity.agent_key.manage":
    case "identity.service_identity.manage":
    case "identity.support_grant.issue":
    case "identity.support_grant.revoke":
      return true;
    default:
      return false;
  }
}

function isNormalizedPostgresWriteFailure(error: unknown): error is DatabaseError {
  return (
    error instanceof DatabaseError &&
    (error.code === "23503" ||
      error.code === "23505" ||
      error.code === "23514" ||
      error.code === "42501")
  );
}

function rejectedPersistenceWrite(): Error {
  return new Error("Identity persistence write rejected");
}

function unauthorizedPersistence(): Error {
  return new Error("Scoped persistence rejected the operation");
}

function corruptRecord(): Error {
  return new Error("Persisted identity record violates canonical invariants");
}
