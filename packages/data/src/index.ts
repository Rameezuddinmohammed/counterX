export const PACKAGE_NAME = "@counter/data";

export { PostgresDatabase } from "./database.js";
export type { DatabaseSession, TransactionalDatabase } from "./database.js";
export { PostgresIdentityRepositories } from "./identity-repositories.js";
export {
  actorRoleAssignments,
  actors,
  agentPublicKeys,
  identitySchema,
  merchantSchema,
  merchantScopes,
  permissions,
  rolePermissions,
  roles,
  scopeRegistry,
  serviceIdentities,
  supportGrantAuthorizationPermissions,
  supportGrantAuthorizations,
  supportGrantEvents,
  supportGrantPermissions,
  supportGrants,
  walletSchema,
  walletScopes,
} from "./identity-schema.js";
export { ScopedTransactionManager, scopeIdentifier } from "./scoped-transaction.js";
export type { ScopedDatabaseSession } from "./scoped-transaction.js";
export {
  createBackup,
  createBackupCommand,
  createRestoreCommand,
  restoreBackup,
} from "./database-tools.js";
export type { BackupOptions, PostgresCommand, RestoreOptions } from "./database-tools.js";
export { applySyntheticSeed, loadMigrations, MigrationRunner } from "./migrations.js";
export type { AppliedMigration, Migration, MigrationStatus } from "./migrations.js";
export {
  counterEnvironment,
  environmentRegistry,
  platformSchema,
  schemaVersions,
  syntheticFixtures,
} from "./schema.js";
export {
  PostgresIdempotencyStore,
  PostgresOutboxRepository,
  PostgresInboxRepository,
  PostgresJobRepository,
} from "./runtime-repositories.js";
export type {
  AsyncIdempotencyStore,
  AsyncOutboxRepository,
  AsyncInboxRepository,
  AsyncJobRepository,
} from "./runtime-repositories.js";
export {
  idempotencyKeys,
  workflowIntents,
  outboxEvents,
  inboxEvents,
  jobs,
  jobAttempts,
  runtimeSchema,
} from "./runtime-schema.js";
