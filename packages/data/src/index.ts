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
  PostgresStepLedger,
  PostgresKillSwitchStore,
  KILL_SWITCH_SCOPES,
} from "./runtime-repositories.js";
export type {
  AsyncIdempotencyStore,
  AsyncOutboxRepository,
  AsyncInboxRepository,
  AsyncJobRepository,
  AsyncStepLedger,
  StepLedgerEntry,
  AsyncKillSwitchStore,
  KillSwitchScope,
  KillSwitchRow,
  KillSwitchActivateInput,
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
export { PostgresPolicyStore } from "./policy-store.js";
export type { PolicyConfigEntry, PolicySetResult } from "./policy-store.js";

export { PostgresQuoteStore } from "./quote-store.js";
export type { QuoteRecord, StoredQuote } from "./quote-store.js";

export { PostgresRecurringMandateReadStore } from "./recurring-mandate-read-store.js";
export type { RecurringMandateReadResult } from "./recurring-mandate-read-store.js";
export { PostgresPaymentConnectionReadStore } from "./payment-connection-read-store.js";
export type { PaymentConnectionReadResult } from "./payment-connection-read-store.js";
export { PostgresRevocationStore } from "./revocation-store.js";
export { PostgresMandateRepository } from "./mandate-repository.js";
export { PostgresCtpKeyRegistry } from "./ctp-key-registry.js";
export { policyConfigs } from "./policy-schema.js";

export { PostgresReceiptStore } from "./receipt-store.js";

export { PostgresCursorStore } from "./catalog-cursor-store.js";

export {
  PostgresProductRepository,
  PostgresVariantRepository,
  PostgresPriceRepository,
  PostgresInventoryRepository,
} from "./catalog-repositories.js";

export { PostgresSpendLedger, DEFAULT_SPEND_LIMIT_CONFIG } from "./spend-ledger.js";
export type {
  SpendLimitConfig,
  ReserveSpendRequest,
  ReserveSpendOutcome,
  ReserveDenyCode,
} from "./spend-ledger.js";

export { PostgresWalletBalanceStore } from "./wallet-balance-store.js";
export type {
  TopUpRequest,
  TopUpOutcome,
  DebitRequest,
  DebitOutcome,
  DebitDenyCode,
} from "./wallet-balance-store.js";
