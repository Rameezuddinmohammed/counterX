/**
 * Durable resume cursor for CatalogSyncService.backfillProducts, backing
 * @counter/shopify-connector's CursorStore interface.
 *
 * SECURITY: rows carry only pagination cursors and sync bookkeeping - no
 * payment credentials, PAN, CVV, UPI PIN, or private keys.
 */

import type { Environment } from "@counter/domain";
import type { CursorStore, DurableCursor } from "@counter/shopify-connector";
import type { TransactionalDatabase } from "./database.js";

interface CursorRow {
  cursor: string | null;
  last_synced_at: Date;
  sync_state: string;
  pages_fetched: number;
  total_cost: string;
}

function rowToCursor(
  merchantId: string,
  resource: DurableCursor["resource"],
  row: CursorRow,
): DurableCursor {
  return Object.freeze({
    merchantId,
    resource,
    cursor: row.cursor,
    lastSyncedAt: row.last_synced_at.getTime() as DurableCursor["lastSyncedAt"],
    syncState: row.sync_state as DurableCursor["syncState"],
    pagesFetched: row.pages_fetched,
    totalCost: Number(row.total_cost),
  });
}

export class PostgresCursorStore implements CursorStore {
  constructor(
    private readonly database: TransactionalDatabase,
    private readonly environment: Environment,
  ) {}

  async getCursor(
    merchantId: string,
    resource: DurableCursor["resource"],
  ): Promise<DurableCursor | undefined> {
    const result = await this.database.query<CursorRow>(
      `SELECT cursor, last_synced_at, sync_state, pages_fetched, total_cost
         FROM merchant.catalog_sync_cursors
        WHERE environment = $1 AND merchant_id = $2 AND resource = $3`,
      [this.environment, merchantId, resource],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : rowToCursor(merchantId, resource, row);
  }

  async saveCursor(cursor: DurableCursor): Promise<void> {
    await this.database.query(
      `INSERT INTO merchant.catalog_sync_cursors (
         environment, merchant_id, resource, cursor, last_synced_at,
         sync_state, pages_fetched, total_cost
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (environment, merchant_id, resource) DO UPDATE SET
         cursor = EXCLUDED.cursor,
         last_synced_at = EXCLUDED.last_synced_at,
         sync_state = EXCLUDED.sync_state,
         pages_fetched = EXCLUDED.pages_fetched,
         total_cost = EXCLUDED.total_cost`,
      [
        this.environment,
        cursor.merchantId,
        cursor.resource,
        cursor.cursor,
        new Date(cursor.lastSyncedAt).toISOString(),
        cursor.syncState,
        cursor.pagesFetched,
        cursor.totalCost,
      ],
    );
  }

  async resetCursor(merchantId: string, resource: DurableCursor["resource"]): Promise<void> {
    await this.database.query(
      `DELETE FROM merchant.catalog_sync_cursors
        WHERE environment = $1 AND merchant_id = $2 AND resource = $3`,
      [this.environment, merchantId, resource],
    );
  }
}
