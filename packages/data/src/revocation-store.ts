/**
 * Durable, Postgres-backed RevocationStore
 * (packages/wallet-application/src/revocation-service.ts's port).
 * WalletRevocationService has a real, tested cascade/evidence pipeline but
 * nothing durable backed it anywhere in the real system before this — not
 * even apps/local-mcp's "most real" entrypoint, which disclosed
 * InMemoryRevocationStore as an explicit known limitation. See migration
 * 0018's header for the full rationale.
 *
 * Monotonic by construction: `save()` uses INSERT ... ON CONFLICT DO NOTHING
 * against the (environment, scope_type, scope_id) primary key — a second
 * revoke() for an already-revoked scope never overwrites the first record.
 * The application layer (WalletRevocationService.revoke()) already checks
 * isRevoked() before calling save(), so this is defense-in-depth against a
 * race between that check and the write, not the primary correctness
 * mechanism.
 */
import type { Environment } from "@counter/domain";
import type {
  RevocationRecord,
  RevocationReasonClass,
  RevocationScopeType,
  RevocationStore,
} from "@counter/wallet-application";
import type { TransactionalDatabase } from "./database.js";

interface RevocationRow {
  revocation_id: string;
  scope_type: RevocationScopeType;
  scope_id: string;
  effective_time: Date;
  reason_class: RevocationReasonClass;
  reason: string | null;
  replacement_id: string | null;
  sequence: number;
  principal_id: string;
  created_at: Date;
}

const REVOCATION_ROW_COLUMNS = `revocation_id, scope_type, scope_id, effective_time,
       reason_class, reason, replacement_id, sequence, principal_id, created_at`;

function toRecord(row: RevocationRow): RevocationRecord {
  return {
    revocationId: row.revocation_id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    effectiveTime: row.effective_time.toISOString(),
    reasonClass: row.reason_class,
    reason: row.reason ?? undefined,
    replacementId: row.replacement_id ?? undefined,
    sequence: row.sequence,
    createdAt: row.created_at.toISOString(),
    principalId: row.principal_id,
  };
}

export class PostgresRevocationStore implements RevocationStore {
  constructor(
    private readonly database: TransactionalDatabase,
    private readonly environment: Environment,
  ) {}

  async isRevoked(scopeType: RevocationScopeType, scopeId: string): Promise<boolean> {
    const result = await this.database.query(
      `SELECT 1 FROM wallet.revocations WHERE environment = $1 AND scope_type = $2 AND scope_id = $3`,
      [this.environment, scopeType, scopeId],
    );
    return result.rows.length > 0;
  }

  async getRevocation(
    scopeType: RevocationScopeType,
    scopeId: string,
  ): Promise<RevocationRecord | undefined> {
    const result = await this.database.query<RevocationRow>(
      `SELECT ${REVOCATION_ROW_COLUMNS} FROM wallet.revocations
        WHERE environment = $1 AND scope_type = $2 AND scope_id = $3`,
      [this.environment, scopeType, scopeId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toRecord(row);
  }

  async getRevocationsForScope(
    scopeType: RevocationScopeType,
  ): Promise<readonly RevocationRecord[]> {
    const result = await this.database.query<RevocationRow>(
      `SELECT ${REVOCATION_ROW_COLUMNS} FROM wallet.revocations
        WHERE environment = $1 AND scope_type = $2
        ORDER BY created_at ASC`,
      [this.environment, scopeType],
    );
    return result.rows.map(toRecord);
  }

  async save(record: RevocationRecord): Promise<void> {
    await this.database.query(
      `INSERT INTO wallet.revocations
         (environment, revocation_id, scope_type, scope_id, effective_time,
          reason_class, reason, replacement_id, sequence, principal_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (environment, scope_type, scope_id) DO NOTHING`,
      [
        this.environment,
        record.revocationId,
        record.scopeType,
        record.scopeId,
        record.effectiveTime,
        record.reasonClass,
        record.reason ?? null,
        record.replacementId ?? null,
        record.sequence,
        record.principalId,
      ],
    );
  }

  async getSequence(scopeType: RevocationScopeType, scopeId: string): Promise<number> {
    const result = await this.database.query<{ sequence: number }>(
      `SELECT sequence FROM wallet.revocations
        WHERE environment = $1 AND scope_type = $2 AND scope_id = $3`,
      [this.environment, scopeType, scopeId],
    );
    return result.rows[0]?.sequence ?? 0;
  }
}
