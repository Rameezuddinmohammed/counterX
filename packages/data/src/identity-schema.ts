import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { counterEnvironment } from "./schema.js";

export const identitySchema = pgSchema("identity");
export const merchantSchema = pgSchema("merchant");
export const walletSchema = pgSchema("wallet");

export const scopeRegistry = identitySchema.table(
  "scope_registry",
  {
    environment: counterEnvironment("environment").notNull(),
    scopeKind: text("scope_kind").notNull(),
    scopeId: text("scope_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.environment, table.scopeKind, table.scopeId] }),
    check("scope_registry_kind", sql`${table.scopeKind} IN ('merchant', 'wallet')`),
  ],
);

export const merchantScopes = merchantSchema.table(
  "scopes",
  {
    environment: counterEnvironment("environment").notNull(),
    scopeKind: text("scope_kind").notNull().default("merchant"),
    merchantId: text("merchant_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.environment, table.merchantId] }),
    foreignKey({
      columns: [table.environment, table.scopeKind, table.merchantId],
      foreignColumns: [
        scopeRegistry.environment,
        scopeRegistry.scopeKind,
        scopeRegistry.scopeId,
      ],
      name: "merchant_scopes_registry_fk",
    }),
    check("merchant_scopes_kind", sql`${table.scopeKind} = 'merchant'`),
  ],
);

export const walletScopes = walletSchema.table(
  "scopes",
  {
    environment: counterEnvironment("environment").notNull(),
    scopeKind: text("scope_kind").notNull().default("wallet"),
    walletId: text("wallet_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.environment, table.walletId] }),
    foreignKey({
      columns: [table.environment, table.scopeKind, table.walletId],
      foreignColumns: [
        scopeRegistry.environment,
        scopeRegistry.scopeKind,
        scopeRegistry.scopeId,
      ],
      name: "wallet_scopes_registry_fk",
    }),
    check("wallet_scopes_kind", sql`${table.scopeKind} = 'wallet'`),
  ],
);

export const permissions = identitySchema.table("permissions", {
  permissionKey: text("permission_key").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .default(sql`clock_timestamp()`),
});

export const roles = identitySchema.table("roles", {
  roleKey: text("role_key").primaryKey(),
  actorKind: text("actor_kind").notNull(),
  scopeKind: text("scope_kind").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .default(sql`clock_timestamp()`),
});

export const rolePermissions = identitySchema.table(
  "role_permissions",
  {
    roleKey: text("role_key")
      .notNull()
      .references(() => roles.roleKey),
    permissionKey: text("permission_key")
      .notNull()
      .references(() => permissions.permissionKey),
  },
  (table) => [primaryKey({ columns: [table.roleKey, table.permissionKey] })],
);

export const actors = identitySchema.table(
  "actors",
  {
    environment: counterEnvironment("environment").notNull(),
    actorKind: text("actor_kind").notNull(),
    actorId: text("actor_id").notNull(),
    ownerScopeKind: text("owner_scope_kind").notNull(),
    ownerScopeId: text("owner_scope_id").notNull(),
    status: text("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
    disabledAt: timestamp("disabled_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    primaryKey({ columns: [table.environment, table.actorKind, table.actorId] }),
    uniqueIndex("actors_owner_identity_unique").on(
      table.environment,
      table.actorKind,
      table.actorId,
      table.ownerScopeKind,
      table.ownerScopeId,
    ),
    check(
      "actors_status",
      sql`${table.status} IN ('active', 'suspended', 'revoked')`,
    ),
  ],
);

export const actorRoleAssignments = identitySchema.table(
  "actor_role_assignments",
  {
    assignmentId: bigint("assignment_id", { mode: "bigint" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    environment: counterEnvironment("environment").notNull(),
    actorKind: text("actor_kind").notNull(),
    actorId: text("actor_id").notNull(),
    ownerScopeKind: text("owner_scope_kind").notNull(),
    ownerScopeId: text("owner_scope_id").notNull(),
    roleKey: text("role_key")
      .notNull()
      .references(() => roles.roleKey),
    assignedByKind: text("assigned_by_kind").notNull(),
    assignedById: text("assigned_by_id").notNull(),
    assignedAt: timestamp("assigned_at", { withTimezone: true, mode: "date" }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    foreignKey({
      columns: [
        table.environment,
        table.actorKind,
        table.actorId,
        table.ownerScopeKind,
        table.ownerScopeId,
      ],
      foreignColumns: [
        actors.environment,
        actors.actorKind,
        actors.actorId,
        actors.ownerScopeKind,
        actors.ownerScopeId,
      ],
      name: "actor_role_assignments_actor_fk",
    }),
    uniqueIndex("actor_role_assignments_active_unique")
      .on(
        table.environment,
        table.actorKind,
        table.actorId,
        table.ownerScopeKind,
        table.ownerScopeId,
        table.roleKey,
      )
      .where(sql`${table.revokedAt} IS NULL`),
  ],
);

export const agentPublicKeys = identitySchema.table(
  "agent_public_keys",
  {
    environment: counterEnvironment("environment").notNull(),
    ownerScopeKind: text("owner_scope_kind").notNull().default("wallet"),
    ownerScopeId: text("owner_scope_id").notNull(),
    keyId: text("key_id").notNull(),
    actorKind: text("actor_kind").notNull().default("registered_agent"),
    agentId: text("agent_id").notNull(),
    algorithm: text("algorithm").notNull(),
    publicKeyBase64Url: text("public_key_base64url").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
    notBefore: timestamp("not_before", { withTimezone: true, mode: "date" }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    primaryKey({ columns: [table.environment, table.keyId] }),
    foreignKey({
      columns: [table.environment, table.ownerScopeKind, table.ownerScopeId],
      foreignColumns: [
        scopeRegistry.environment,
        scopeRegistry.scopeKind,
        scopeRegistry.scopeId,
      ],
      name: "agent_public_keys_scope_fk",
    }),
    foreignKey({
      columns: [
        table.environment,
        table.actorKind,
        table.agentId,
        table.ownerScopeKind,
        table.ownerScopeId,
      ],
      foreignColumns: [
        actors.environment,
        actors.actorKind,
        actors.actorId,
        actors.ownerScopeKind,
        actors.ownerScopeId,
      ],
      name: "agent_public_keys_actor_fk",
    }),
    check("agent_public_keys_algorithm", sql`${table.algorithm} = 'Ed25519'`),
  ],
);

export const serviceIdentities = identitySchema.table(
  "service_identities",
  {
    environment: counterEnvironment("environment").notNull(),
    ownerScopeKind: text("owner_scope_kind").notNull(),
    ownerScopeId: text("owner_scope_id").notNull(),
    actorKind: text("actor_kind").notNull().default("service"),
    serviceId: text("service_id").notNull(),
    bindingSource: text("binding_source").notNull(),
    bindingValue: text("binding_value").notNull(),
    status: text("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
    disabledAt: timestamp("disabled_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    primaryKey({ columns: [table.environment, table.serviceId] }),
    uniqueIndex("service_identities_binding_unique").on(
      table.environment,
      table.bindingSource,
      table.bindingValue,
    ),
    foreignKey({
      columns: [
        table.environment,
        table.actorKind,
        table.serviceId,
        table.ownerScopeKind,
        table.ownerScopeId,
      ],
      foreignColumns: [
        actors.environment,
        actors.actorKind,
        actors.actorId,
        actors.ownerScopeKind,
        actors.ownerScopeId,
      ],
      name: "service_identities_actor_fk",
    }),
  ],
);

export const supportGrants = identitySchema.table(
  "support_grants",
  {
    supportGrantId: text("support_grant_id").primaryKey(),
    environment: counterEnvironment("environment").notNull(),
    targetScopeKind: text("target_scope_kind").notNull(),
    targetScopeId: text("target_scope_id").notNull(),
    operatorId: text("operator_id").notNull(),
    reason: text("reason").notNull(),
    authorizationKind: text("authorization_kind").notNull(),
    authorizedBy: text("authorized_by").notNull(),
    authorizedAt: timestamp("authorized_at", { withTimezone: true, mode: "date" }).notNull(),
    authorizationReferenceSource: text("authorization_reference_source").notNull(),
    authorizationReferenceValue: text("authorization_reference_value").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true, mode: "date" }).notNull(),
    validFrom: timestamp("valid_from", { withTimezone: true, mode: "date" }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    revokedBy: text("revoked_by"),
  },
  (table) => [
    foreignKey({
      columns: [table.environment, table.targetScopeKind, table.targetScopeId],
      foreignColumns: [
        scopeRegistry.environment,
        scopeRegistry.scopeKind,
        scopeRegistry.scopeId,
      ],
      name: "support_grants_target_scope_fk",
    }),
  ],
);

export const supportGrantPermissions = identitySchema.table(
  "support_grant_permissions",
  {
    supportGrantId: text("support_grant_id")
      .notNull()
      .references(() => supportGrants.supportGrantId),
    permissionKey: text("permission_key")
      .notNull()
      .references(() => permissions.permissionKey),
  },
  (table) => [primaryKey({ columns: [table.supportGrantId, table.permissionKey] })],
);

export const supportGrantEvents = identitySchema.table("support_grant_events", {
  eventId: bigint("event_id", { mode: "bigint" })
    .primaryKey()
    .generatedAlwaysAsIdentity(),
  supportGrantId: text("support_grant_id").references(() => supportGrants.supportGrantId),
  environment: counterEnvironment("environment").notNull(),
  targetScopeKind: text("target_scope_kind").notNull(),
  targetScopeId: text("target_scope_id").notNull(),
  operatorId: text("operator_id").notNull(),
  action: text("action").notNull(),
  correlationId: text("correlation_id").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" })
    .notNull()
    .default(sql`clock_timestamp()`),
});

export const supportGrantAuthorizations = identitySchema.table(
  "support_grant_authorizations",
  {
    supportGrantId: text("support_grant_id").primaryKey(),
    environment: counterEnvironment("environment").notNull(),
    targetScopeKind: text("target_scope_kind").notNull(),
    targetScopeId: text("target_scope_id").notNull(),
    operatorId: text("operator_id").notNull(),
    reason: text("reason").notNull(),
    authorizationKind: text("authorization_kind").notNull(),
    authorizedBy: text("authorized_by").notNull(),
    authorizedAt: timestamp("authorized_at", { withTimezone: true, mode: "date" }).notNull(),
    authorizationReferenceSource: text("authorization_reference_source").notNull(),
    authorizationReferenceValue: text("authorization_reference_value").notNull(),
    validFrom: timestamp("valid_from", { withTimezone: true, mode: "date" }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.environment, table.targetScopeKind, table.targetScopeId],
      foreignColumns: [
        scopeRegistry.environment,
        scopeRegistry.scopeKind,
        scopeRegistry.scopeId,
      ],
      name: "support_grant_authorizations_target_scope_fk",
    }),
  ],
);

export const supportGrantAuthorizationPermissions = identitySchema.table(
  "support_grant_authorization_permissions",
  {
    supportGrantId: text("support_grant_id")
      .notNull()
      .references(() => supportGrantAuthorizations.supportGrantId),
    permissionKey: text("permission_key")
      .notNull()
      .references(() => permissions.permissionKey),
  },
  (table) => [primaryKey({ columns: [table.supportGrantId, table.permissionKey] })],
);
