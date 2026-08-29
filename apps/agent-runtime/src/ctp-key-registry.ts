/**
 * Server-side CTP key resolution for verifying a buyer agent's signed
 * purchase-intent envelopes.
 *
 * Reads directly from the existing, already-durable `identity.agent_public_keys`
 * table (see packages/data/src/identity-repositories.ts) rather than going
 * through the RBAC-gated PostgresIdentityRepositories: key resolution is the
 * cryptographic primitive that ESTABLISHES trust in a request, so it can't
 * itself depend on an AuthorizedContext derived from that same
 * not-yet-verified request. @counter/trust-protocol's InMemoryKeyRegistry
 * follows the same shape (resolve(kid), no actor/context parameter).
 *
 * SECURITY: reads only public key material and metadata. Never touches a
 * private key.
 */

import type { Environment } from "@counter/domain";
import type { TransactionalDatabase } from "@counter/data";
import type { KeyRecord, KeyRegistry, KeyStatus } from "@counter/trust-protocol";

interface AgentPublicKeyRow {
  readonly owner_scope_id: string;
  readonly public_key_base64url: string;
  readonly created_at: Date;
  readonly not_before: Date;
  readonly expires_at: Date | null;
  readonly revoked_at: Date | null;
}

const FAR_FUTURE_VALID_UNTIL = "2099-12-31T23:59:59.999Z";

function resolveStatus(row: AgentPublicKeyRow, now: Date): KeyStatus {
  if (row.revoked_at !== null) {
    return "revoked";
  }
  if (row.expires_at !== null && row.expires_at.getTime() < now.getTime()) {
    return "expired";
  }
  return "active";
}

export class PostgresCtpKeyRegistry implements KeyRegistry {
  constructor(
    private readonly database: TransactionalDatabase,
    private readonly environment: Environment,
  ) {}

  async resolve(kid: string): Promise<KeyRecord | undefined> {
    const result = await this.database.query<AgentPublicKeyRow>(
      `SELECT owner_scope_id, public_key_base64url, created_at, not_before, expires_at, revoked_at
         FROM identity.agent_public_keys
        WHERE environment = $1 AND key_id = $2`,
      [this.environment, kid],
    );
    const row = result.rows[0];
    if (row === undefined) {
      return undefined;
    }

    return Object.freeze({
      kid,
      use: "sign" as const,
      alg: "EdDSA" as const,
      publicKey: row.public_key_base64url,
      status: resolveStatus(row, new Date()),
      validFrom: row.not_before.toISOString(),
      validUntil: row.expires_at?.toISOString() ?? FAR_FUTURE_VALID_UNTIL,
      issuer: `counter://wallet/${row.owner_scope_id}`,
    });
  }
}
