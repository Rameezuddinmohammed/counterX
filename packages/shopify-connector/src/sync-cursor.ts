/**
 * Durable cursor management for resumable catalog backfill.
 *
 * Tracks pagination state, cost consumed, and sync progress so that
 * interrupted backfills can resume from the exact position.
 */

import type { Instant } from "@counter/domain";

// ─── Sync State ───────────────────────────────────────────────────────────────

export const SYNC_STATES = ["idle", "in_progress", "completed", "failed"] as const;
export type SyncState = (typeof SYNC_STATES)[number];

// ─── Durable Cursor ───────────────────────────────────────────────────────────

export interface DurableCursor {
  readonly merchantId: string;
  readonly resource: "products" | "variants" | "inventory";
  readonly cursor: string | null;
  readonly lastSyncedAt: Instant;
  readonly syncState: SyncState;
  readonly pagesFetched: number;
  readonly totalCost: number;
}

// ─── Cursor Store Interface ───────────────────────────────────────────────────

export interface CursorStore {
  getCursor(
    merchantId: string,
    resource: DurableCursor["resource"],
  ): Promise<DurableCursor | undefined>;
  saveCursor(cursor: DurableCursor): Promise<void>;
  resetCursor(merchantId: string, resource: DurableCursor["resource"]): Promise<void>;
}

// ─── In-Memory Implementation ─────────────────────────────────────────────────

export class InMemoryCursorStore implements CursorStore {
  private readonly cursors = new Map<string, DurableCursor>();

  private key(merchantId: string, resource: DurableCursor["resource"]): string {
    return `${merchantId}:${resource}`;
  }

  async getCursor(
    merchantId: string,
    resource: DurableCursor["resource"],
  ): Promise<DurableCursor | undefined> {
    return this.cursors.get(this.key(merchantId, resource));
  }

  async saveCursor(cursor: DurableCursor): Promise<void> {
    this.cursors.set(this.key(cursor.merchantId, cursor.resource), Object.freeze({ ...cursor }));
  }

  async resetCursor(merchantId: string, resource: DurableCursor["resource"]): Promise<void> {
    this.cursors.delete(this.key(merchantId, resource));
  }

  /** Test helper: get all stored cursors. */
  getAll(): readonly DurableCursor[] {
    return [...this.cursors.values()];
  }

  /** Test helper: clear all cursors. */
  clear(): void {
    this.cursors.clear();
  }
}
