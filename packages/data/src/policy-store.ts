/**
 * Async PostgreSQL implementation of the merchant policy config store.
 *
 * Persists an opaque JSON policy `config` keyed by (environment, merchant_id)
 * with a monotonically increasing integer `version` and optimistic-concurrency
 * semantics. The config is stored verbatim; the caller owns its shape.
 *
 * NOTE: consistent with the runtime repositories, the SQL hardcodes
 * environment='local'. This keeps every durable artifact in a single logical
 * environment partition for the current single-tenant deployment; broadening
 * to a per-request environment is a follow-up.
 */

import {
  type CanonicalError,
  type Result,
  createCanonicalError,
  err,
  ok,
} from "@counter/domain";
import type { TransactionalDatabase } from "./database.js";

export interface PolicyConfigEntry {
  readonly config: unknown;
  readonly version: number;
}

export interface PolicySetResult {
  readonly success: boolean;
  readonly currentVersion: number;
}

interface PolicyConfigRow {
  version: number;
  config: unknown;
}

export class PostgresPolicyStore {
  constructor(private readonly database: TransactionalDatabase) {}

  async get(merchantId: string): Promise<Result<PolicyConfigEntry | undefined, CanonicalError>> {
    const result = await this.database.query<PolicyConfigRow>(
      `SELECT version, config FROM merchant.policy_configs
       WHERE environment = 'local' AND merchant_id = $1`,
      [merchantId],
    );

    const row = result.rows[0];
    if (row === undefined) {
      return ok(undefined);
    }

    return ok(Object.freeze({ config: row.config, version: row.version }));
  }

  /**
   * Conditionally persists a policy config. When expectedVersion is provided
   * the write succeeds only if the current stored version matches; otherwise a
   * {success:false} outcome is returned along with the current version so the
   * caller can surface an optimistic-concurrency conflict.
   */
  async set(
    merchantId: string,
    config: unknown,
    expectedVersion: number | undefined,
  ): Promise<Result<PolicySetResult, CanonicalError>> {
    if (config === undefined) {
      return err(
        createCanonicalError({
          category: "validation",
          code: "INVALID_FORMAT",
          message: "policy config must not be undefined",
        }),
      );
    }

    return this.database.transaction(async (session) => {
      const existingResult = await session.query<PolicyConfigRow>(
        `SELECT version, config FROM merchant.policy_configs
         WHERE environment = 'local' AND merchant_id = $1
         FOR UPDATE`,
        [merchantId],
      );

      const existing = existingResult.rows[0];
      const currentVersion = existing?.version ?? 0;

      if (expectedVersion !== undefined && expectedVersion !== currentVersion) {
        return ok({ success: false, currentVersion });
      }

      const newVersion = currentVersion + 1;
      const serialized = JSON.stringify(config);

      if (existing === undefined) {
        await session.query(
          `INSERT INTO merchant.policy_configs (environment, merchant_id, version, config)
           VALUES ('local', $1, $2, $3)`,
          [merchantId, newVersion, serialized],
        );
      } else {
        await session.query(
          `UPDATE merchant.policy_configs
           SET version = $2, config = $3, updated_at = clock_timestamp()
           WHERE environment = 'local' AND merchant_id = $1`,
          [merchantId, newVersion, serialized],
        );
      }

      return ok({ success: true, currentVersion: newVersion });
    });
  }
}
