/**
 * Real merchant discovery: lists/searches merchants that have completed
 * self-serve onboarding far enough to be worth showing to a buyer agent.
 *
 * "Discoverable" here means all three: an active Shopify connection (a
 * real, live store, see merchant.shopify_connections, migration 0013), a
 * generated Capability Manifest (merchant.capability_manifests, migration
 * 0016 — the wizard's own final "manifest" step), AND
 * lifecycle_state = 'ACTIVE' — the canonical `ACTIVATION_REVIEW -> ACTIVE`
 * operator-reviewed activation gate from packages/merchant-application/src/
 * lifecycle.ts, applied via the real state machine in
 * apps/control-plane-api/src/merchant-activation-store.ts. A merchant who
 * dropped off mid-wizard, has no live store, never confirmed a manifest, or
 * is still awaiting operator review in ACTIVATION_REVIEW is excluded.
 */
import type { TransactionalDatabase } from "@counter/data";
import type { Environment } from "@counter/domain";

export interface MerchantDirectoryEntry {
  readonly merchantId: string;
  readonly displayName: string;
  readonly goodsTypes: readonly string[];
  readonly capabilities: readonly string[];
  readonly manifestGeneratedAt: string;
}

interface DirectoryRow {
  readonly merchant_id: string;
  readonly legal_entity_name: string | null;
  readonly goods_types: readonly string[] | null;
  readonly capabilities: readonly string[];
  readonly generated_at: Date;
}

export class MerchantDirectoryStore {
  constructor(
    private readonly database: TransactionalDatabase,
    private readonly environment: Environment,
  ) {}

  /**
   * `query`, when provided, matches case-insensitively against the
   * merchant's display name only (no full-text catalog search here — that
   * stays per-merchant, via the existing `POST /merchants/:id/search`
   * route once a buyer has picked a merchant).
   */
  async list(query: string | undefined, limit: number): Promise<readonly MerchantDirectoryEntry[]> {
    const trimmed = query?.trim();
    const namePattern = trimmed !== undefined && trimmed.length > 0 ? `%${trimmed}%` : null;

    const result = await this.database.query<DirectoryRow>(
      `SELECT a.merchant_id, a.legal_entity_name, a.goods_types,
              m.capabilities, m.generated_at
         FROM merchant.onboarding_applications a
         JOIN merchant.shopify_connections s
           ON s.environment = a.environment AND s.merchant_id = a.merchant_id AND s.status = 'active'
         JOIN merchant.capability_manifests m
           ON m.environment = a.environment AND m.merchant_id = a.merchant_id
        WHERE a.environment = $1
          AND a.lifecycle_state = 'ACTIVE'
          AND ($2::text IS NULL OR a.legal_entity_name ILIKE $2)
        ORDER BY m.generated_at DESC
        LIMIT $3`,
      [this.environment, namePattern, limit],
    );

    return result.rows.map((row) =>
      Object.freeze({
        merchantId: row.merchant_id,
        displayName: row.legal_entity_name ?? row.merchant_id,
        goodsTypes: row.goods_types ?? [],
        capabilities: row.capabilities,
        manifestGeneratedAt: row.generated_at.toISOString(),
      }),
    );
  }
}
