/**
 * Durable transaction projection persistence for the worker.
 *
 * A transaction receipt is evidence of an outcome, but it is not the spine used
 * by the Merchant Console. This adapter writes that spine to
 * runtime.workflow_intents before an external effect and advances its status
 * only after the worker has authoritative terminal truth. The write is
 * idempotent on the existing (environment, transaction_id, command_type,
 * command_digest) key, so retries and process restarts do not create duplicate
 * console rows.
 *
 * SECURITY: authority context carries only scope, amount and timing metadata.
 * It must never contain payment credentials, PAN, CVV, UPI PIN, access tokens,
 * or private keys.
 */

import { sha256Digest, type Environment } from "@counter/domain";
import type { TransactionalDatabase } from "@counter/data";
import type {
  TransactionProjectionInput,
  TransactionProjectionStore,
} from "./transaction-lifecycle.js";

export type { TransactionProjectionInput, TransactionProjectionStore };

const COMMAND_TYPE = "transaction.lifecycle";

function commandDigest(input: TransactionProjectionInput): string {
  // Property order is deliberately fixed so retries derive the same digest.
  return sha256Digest(
    new TextEncoder().encode(
      JSON.stringify({
        transactionId: input.transactionId,
        amountMinor: input.amountMinor,
        currency: input.currency,
        authority: input.authority ?? null,
      }),
    ),
  );
}

function intentId(input: TransactionProjectionInput): string {
  return `workflow_${commandDigest(input).slice("sha256:".length)}`;
}

function authorityContext(input: TransactionProjectionInput): Record<string, unknown> {
  return {
    amountMinor: input.amountMinor,
    currency: input.currency,
    ...(input.authority ?? {}),
  };
}

/**
 * Postgres-backed transaction spine used by the worker. Bound to the same
 * resolved runtime `Environment` as every other durable repository (step
 * ledger, kill-switch store, spend ledger, policy store) so the console's
 * read model and the worker's writes always agree on partition.
 */
export class PostgresTransactionProjectionStore implements TransactionProjectionStore {
  constructor(
    private readonly database: TransactionalDatabase,
    private readonly environment: Environment,
    private readonly merchantId: string,
  ) {}

  async start(input: TransactionProjectionInput): Promise<void> {
    const digest = commandDigest(input);
    await this.database.query(
      `INSERT INTO runtime.workflow_intents (
         id, transaction_id, environment, scope_kind, scope_id, command_type,
         command_digest, authority_context, status, created_at
       ) VALUES ($1, $2, $3, 'merchant', $4, $5, $6, $7, 'executing', clock_timestamp())
       ON CONFLICT (environment, transaction_id, command_type, command_digest)
       DO UPDATE SET status = CASE
         WHEN runtime.workflow_intents.status = 'completed' THEN 'completed'
         ELSE 'executing'
       END`,
      [
        intentId(input),
        input.transactionId,
        this.environment,
        this.merchantId,
        COMMAND_TYPE,
        digest,
        JSON.stringify(authorityContext(input)),
      ],
    );
  }

  async complete(input: TransactionProjectionInput): Promise<void> {
    await this.updateStatus(input, "completed");
  }

  async fail(input: TransactionProjectionInput): Promise<void> {
    await this.updateStatus(input, "failed");
  }

  private async updateStatus(
    input: TransactionProjectionInput,
    status: "completed" | "failed",
  ): Promise<void> {
    const result = await this.database.query(
      `UPDATE runtime.workflow_intents
          SET status = $1
        WHERE environment = $2
          AND transaction_id = $3
          AND command_type = $4
          AND command_digest = $5`,
      [status, this.environment, input.transactionId, COMMAND_TYPE, commandDigest(input)],
    );
    if ((result.rowCount ?? 0) !== 1) {
      throw new Error(`Transaction projection was not initialized for ${input.transactionId}`);
    }
  }
}
