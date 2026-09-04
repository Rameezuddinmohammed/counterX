/**
 * Integration proof for MerchantShopifyConnectionStore against the LIVE
 * Supabase Postgres (DATABASE_URL-gated). Seeds two merchants, each with
 * their OWN merchant.shopify_connections row, and confirms getActive
 * resolves the RIGHT row per merchantId — never the other merchant's, and
 * never a revoked or nonexistent connection. This is the real-Postgres
 * counterpart to real-handlers.test.ts's fake-resolver proof that the
 * handlers themselves don't cross-contaminate.
 *
 * Seed chain is deliberately short: merchant.shopify_connections only FKs
 * to merchant.scopes (see migration 0013), which in turn FKs to
 * identity.scope_registry — no onboarding_applications/actors rows needed
 * for this store (unlike merchant-directory-store.integration.test.ts,
 * which joins onboarding_applications for the display name). Mirrors that
 * file's seed/cleanup discipline: uniquely-keyed rows per run, afterAll
 * deletes exactly what it inserted in FK-safe order, never truncates/drops.
 *
 * SKIPPED unless TEST_DATABASE_URL or DATABASE_URL is present.
 */
import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createCounterId } from "@counter/domain";
import type { Environment } from "@counter/domain";
import { PostgresDatabase } from "@counter/data";
import { MerchantShopifyConnectionStore } from "./merchant-shopify-connection-store.js";

const databaseUrl =
  process.env["TEST_DATABASE_URL"]?.trim() || process.env["DATABASE_URL"]?.trim() || undefined;
const databaseDescribe = databaseUrl === undefined ? describe.skip : describe;
const databaseHookTimeout = 30_000;
const ENVIRONMENT: Environment = "test";

function freshMerchantId(): string {
  const result = createCounterId("merchant", randomBytes(16));
  if (!result.ok) throw new Error("Failed to generate a fresh merchant id");
  return result.value;
}

databaseDescribe("MerchantShopifyConnectionStore (real Postgres)", () => {
  const database = new PostgresDatabase(databaseUrl as string);
  const store = new MerchantShopifyConnectionStore(database, ENVIRONMENT);
  const seededMerchantIds: string[] = [];

  afterAll(async () => {
    // FK-safe reverse order.
    for (const merchantId of seededMerchantIds) {
      await database.query(
        `DELETE FROM merchant.shopify_connections WHERE environment = $1 AND merchant_id = $2`,
        [ENVIRONMENT, merchantId],
      );
      await database.query(
        `DELETE FROM merchant.scopes WHERE environment = $1 AND merchant_id = $2`,
        [ENVIRONMENT, merchantId],
      );
      await database.query(
        `DELETE FROM identity.scope_registry WHERE environment = $1 AND scope_id = $2`,
        [ENVIRONMENT, merchantId],
      );
    }
    await database.close();
  }, databaseHookTimeout);

  /** Seeds a bare merchant scope, optionally with a shopify_connections row. */
  async function seedMerchant(options: {
    readonly withConnection: "active" | "revoked" | "none";
  }): Promise<{ merchantId: string; shopDomain: string; accessToken: string }> {
    const merchantId = freshMerchantId();
    const now = new Date().toISOString();
    seededMerchantIds.push(merchantId);

    await database.query(
      `INSERT INTO identity.scope_registry (environment, scope_kind, scope_id, created_at)
       VALUES ($1, 'merchant', $2, $3)`,
      [ENVIRONMENT, merchantId, now],
    );
    await database.query(
      `INSERT INTO merchant.scopes (environment, scope_kind, merchant_id, created_at)
       VALUES ($1, 'merchant', $2, $3)`,
      [ENVIRONMENT, merchantId, now],
    );

    const suffix = randomBytes(4).toString("hex");
    const shopDomain = `conn-store-test-${suffix}.myshopify.com`;
    const accessToken = `test-token-${suffix}`;

    if (options.withConnection !== "none") {
      await database.query(
        `INSERT INTO merchant.shopify_connections
           (environment, merchant_id, shop_domain, access_token, granted_scope, status, connected_at)
         VALUES ($1, $2, $3, $4, 'read_products', $5, $6)`,
        [ENVIRONMENT, merchantId, shopDomain, accessToken, options.withConnection, now],
      );
    }

    return { merchantId, shopDomain, accessToken };
  }

  it(
    "resolves each of TWO merchants to their OWN connection, never the other's",
    async () => {
      const merchantA = await seedMerchant({ withConnection: "active" });
      const merchantB = await seedMerchant({ withConnection: "active" });

      const connectionA = await store.getActive(merchantA.merchantId);
      const connectionB = await store.getActive(merchantB.merchantId);

      expect(connectionA).toBeDefined();
      expect(connectionA?.shopDomain).toBe(merchantA.shopDomain);
      expect(connectionA?.accessToken).toBe(merchantA.accessToken);
      expect(connectionA?.shopDomain).not.toBe(merchantB.shopDomain);

      expect(connectionB).toBeDefined();
      expect(connectionB?.shopDomain).toBe(merchantB.shopDomain);
      expect(connectionB?.accessToken).toBe(merchantB.accessToken);
      expect(connectionB?.shopDomain).not.toBe(merchantA.shopDomain);
    },
    databaseHookTimeout,
  );

  it(
    "returns undefined for a merchant whose connection is revoked, not the stale row",
    async () => {
      const merchant = await seedMerchant({ withConnection: "revoked" });

      const connection = await store.getActive(merchant.merchantId);
      expect(connection).toBeUndefined();
    },
    databaseHookTimeout,
  );

  it(
    "returns undefined for a merchant with no shopify_connections row at all",
    async () => {
      const merchant = await seedMerchant({ withConnection: "none" });

      const connection = await store.getActive(merchant.merchantId);
      expect(connection).toBeUndefined();
    },
    databaseHookTimeout,
  );

  it(
    "never returns a connection for a merchant id that was never seeded",
    async () => {
      const connection = await store.getActive(freshMerchantId());
      expect(connection).toBeUndefined();
    },
    databaseHookTimeout,
  );
});
