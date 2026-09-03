/**
 * Durable, Postgres-backed VaultKeyRepository
 * (packages/wallet-domain/src/vault-key-store.ts's port).
 *
 * Backs the remote (HTTP-transport) MCP server's multi-tenant signing-key
 * custody: VaultSecureKeyStore holds no key material and no ownership state
 * of its own, so THIS table (wallet.vault_keys, migration 0023) is what
 * decides which buyer owns which Vault Transit key and whether that key is
 * still usable. If a row is missing or belongs to a different tenant, the
 * key is unreachable — that is the entire tenant-isolation mechanism for
 * remote signing, not a cache in front of one.
 *
 * SECURITY: this table stores NO secret material. Private keys are created
 * inside Vault with exportable=false and never leave it; a row here is only
 * a pointer (which tenant, which Vault key name, active or revoked).
 *
 * `findByKeyId` intentionally does not filter by tenant — it returns the
 * owning tenantId so the security check happens visibly at the boundary
 * (VaultSecureKeyStore). `revoke` DOES filter by tenant in its WHERE clause
 * as defense in depth, and reports whether a row actually matched so a
 * wrong-tenant revoke can never silently succeed against zero rows.
 */
import type { Environment } from "@counter/domain";
import type {
  CreateVaultKeyInput,
  VaultKeyRecord,
  VaultKeyRepository,
  VaultKeyStatus,
} from "@counter/wallet-domain";
import type { TransactionalDatabase } from "./database.js";

interface VaultKeyRow {
  tenant_id: string;
  key_id: string;
  vault_key_name: string;
  scope: string;
  status: VaultKeyStatus;
}

const VAULT_KEY_ROW_COLUMNS = `tenant_id, key_id, vault_key_name, scope, status`;

function toRecord(row: VaultKeyRow): VaultKeyRecord {
  return {
    tenantId: row.tenant_id,
    keyId: row.key_id,
    vaultKeyName: row.vault_key_name,
    scope: row.scope,
    status: row.status,
  };
}

export class PostgresVaultKeyRepository implements VaultKeyRepository {
  constructor(
    private readonly database: TransactionalDatabase,
    private readonly environment: Environment,
  ) {}

  async create(input: CreateVaultKeyInput): Promise<void> {
    await this.database.query(
      `INSERT INTO wallet.vault_keys
         (environment, tenant_id, key_id, vault_key_name, scope, status)
       VALUES ($1, $2, $3, $4, $5, 'active')`,
      [this.environment, input.tenantId, input.keyId, input.vaultKeyName, input.scope],
    );
  }

  async findByKeyId(keyId: string): Promise<VaultKeyRecord | undefined> {
    const result = await this.database.query<VaultKeyRow>(
      `SELECT ${VAULT_KEY_ROW_COLUMNS} FROM wallet.vault_keys
        WHERE environment = $1 AND key_id = $2`,
      [this.environment, keyId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toRecord(row);
  }

  /**
   * Monotonic: revoked_at keeps its ORIGINAL value on a repeat revoke
   * (COALESCE), so re-revoking is idempotent and never rewrites history.
   * Returns false when no row matched — missing key and wrong-tenant key
   * are deliberately indistinguishable to the caller.
   */
  async revoke(tenantId: string, keyId: string): Promise<boolean> {
    const result = await this.database.query(
      `UPDATE wallet.vault_keys
          SET status = 'revoked',
              revoked_at = COALESCE(revoked_at, clock_timestamp())
        WHERE environment = $1 AND tenant_id = $2 AND key_id = $3`,
      [this.environment, tenantId, keyId],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
