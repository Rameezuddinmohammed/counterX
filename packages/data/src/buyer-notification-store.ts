/**
 * The wallet-queryable read model behind the notifications.list/invoices.get
 * MCP tools (apps/local-mcp) — populated from the SAME outbox event stream
 * that feeds merchant webhook delivery (see apps/worker/src/outbox-dispatcher.ts's
 * header: one write path, two consumers). runtime.receipts itself is NOT
 * wallet-indexed and stays untouched/immutable as-is; this is a new,
 * separate projection, not a change to receipts.
 *
 * write() is idempotent by (environment, wallet_id, notification_type,
 * transaction_id) — ON CONFLICT DO NOTHING — because outbox delivery is
 * at-least-once (see outbox-dispatcher.ts): a redelivered/retried event must
 * never create a duplicate notification row.
 *
 * SECURITY: read methods take walletId as an explicit, caller-supplied
 * filter — every caller (the MCP tool route) MUST scope this to the
 * authenticated wallet's own id; this store itself does no authorization,
 * same trust boundary as every other direct-SQL store in this codebase.
 */
import type { CounterId, Environment, Instant } from "@counter/domain";
import { instantFromEpochMilliseconds } from "@counter/domain";
import type { TransactionalDatabase } from "./database.js";

function instantFromDate(value: Date): Instant {
  const result = instantFromEpochMilliseconds(value.getTime());
  if (!result.ok) {
    throw new Error("Persisted buyer_notifications row contains an invalid timestamp");
  }
  return result.value;
}

export interface BuyerNotificationInput {
  readonly id: CounterId<"buyer-notification">;
  readonly walletId: string;
  readonly notificationType: string;
  readonly transactionId: string | undefined;
  readonly payload: unknown;
}

export interface BuyerNotification {
  readonly id: string;
  readonly walletId: string;
  readonly notificationType: string;
  readonly transactionId: string | undefined;
  readonly payload: unknown;
  readonly createdAt: Instant;
}

interface BuyerNotificationRow {
  id: string;
  wallet_id: string;
  notification_type: string;
  transaction_id: string | null;
  payload: unknown;
  created_at: Date;
}

function fromRow(row: BuyerNotificationRow): BuyerNotification {
  return {
    id: row.id,
    walletId: row.wallet_id,
    notificationType: row.notification_type,
    transactionId: row.transaction_id ?? undefined,
    payload: row.payload,
    createdAt: instantFromDate(row.created_at),
  };
}

export class PostgresBuyerNotificationStore {
  constructor(
    private readonly database: TransactionalDatabase,
    private readonly environment: Environment,
  ) {}

  /** Returns true when this write actually inserted a new row (false = idempotent no-op replay). */
  async write(input: BuyerNotificationInput): Promise<boolean> {
    const result = await this.database.query(
      `INSERT INTO runtime.buyer_notifications
         (id, environment, wallet_id, notification_type, transaction_id, payload, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, clock_timestamp())
       ON CONFLICT (environment, wallet_id, notification_type, transaction_id) DO NOTHING`,
      [
        input.id,
        this.environment,
        input.walletId,
        input.notificationType,
        input.transactionId ?? null,
        JSON.stringify(input.payload),
      ],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async listForWallet(
    walletId: string,
    options: { readonly limit?: number; readonly notificationType?: string } = {},
  ): Promise<readonly BuyerNotification[]> {
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
    const result =
      options.notificationType !== undefined
        ? await this.database.query<BuyerNotificationRow>(
            `SELECT * FROM runtime.buyer_notifications
              WHERE environment = $1 AND wallet_id = $2 AND notification_type = $3
              ORDER BY created_at DESC
              LIMIT $4`,
            [this.environment, walletId, options.notificationType, limit],
          )
        : await this.database.query<BuyerNotificationRow>(
            `SELECT * FROM runtime.buyer_notifications
              WHERE environment = $1 AND wallet_id = $2
              ORDER BY created_at DESC
              LIMIT $3`,
            [this.environment, walletId, limit],
          );
    return result.rows.map(fromRow);
  }
}
