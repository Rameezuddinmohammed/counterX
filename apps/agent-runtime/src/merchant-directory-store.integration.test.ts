/**
 * Integration proof for MerchantDirectoryStore against the LIVE Supabase
 * Postgres (DATABASE_URL-gated). Seeds the full FK chain a real onboarded
 * merchant would have (identity.scope_registry -> merchant.scopes ->
 * identity.actors -> merchant.onboarding_applications), mirroring
 * apps/control-plane-api/src/merchant-application-store.integration.test.ts's
 * seed/cleanup discipline: uniquely-keyed rows per run, afterAll deletes
 * exactly what it inserted in FK-safe order, never truncates/drops/migrates.
 *
 * SKIPPED unless TEST_DATABASE_URL or DATABASE_URL is present.
 */
import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createCounterId } from "@counter/domain";
import type { Environment } from "@counter/domain";
import { PostgresDatabase } from "@counter/data";
import { MerchantDirectoryStore } from "./merchant-directory-store.js";

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

function freshActorId(): string {
  const result = createCounterId("merchant-user", randomBytes(16));
  if (!result.ok) throw new Error("Failed to generate a fresh merchant-user actor id");
  return result.value;
}

databaseDescribe("MerchantDirectoryStore (real Postgres)", () => {
  const database = new PostgresDatabase(databaseUrl as string);
  const store = new MerchantDirectoryStore(database, ENVIRONMENT);
  const seededMerchantIds: string[] = [];

  afterAll(async () => {
    // FK-safe reverse order.
    for (const merchantId of seededMerchantIds) {
      await database.query(
        `DELETE FROM merchant.capability_manifests WHERE environment = $1 AND merchant_id = $2`,
        [ENVIRONMENT, merchantId],
      );
      await database.query(
        `DELETE FROM merchant.shopify_connections WHERE environment = $1 AND merchant_id = $2`,
        [ENVIRONMENT, merchantId],
      );
      await database.query(
        `DELETE FROM merchant.onboarding_applications WHERE environment = $1 AND merchant_id = $2`,
        [ENVIRONMENT, merchantId],
      );
      await database.query(
        `DELETE FROM identity.actors WHERE environment = $1 AND owner_scope_id = $2`,
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
  }, databaseHookTimeout);

  /** Seeds a full merchant fixture, optionally with a live Shopify connection and/or a confirmed manifest. */
  async function seedMerchant(options: {
    readonly legalEntityName: string;
    readonly withShopifyConnection: boolean;
    readonly withManifest: boolean;
  }): Promise<string> {
    const merchantId = freshMerchantId();
    const actorId = freshActorId();
    const subject = `merchant-directory-test|${randomBytes(6).toString("hex")}`;
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
    await database.query(
      `INSERT INTO identity.actors
         (environment, actor_kind, actor_id, owner_scope_kind, owner_scope_id, status, created_at)
       VALUES ($1, 'merchant_user', $2, 'merchant', $3, 'active', $4)`,
      [ENVIRONMENT, actorId, merchantId, now],
    );
    await database.query(
      `INSERT INTO merchant.onboarding_applications
         (environment, merchant_id, auth0_subject, merchant_user_actor_id,
          legal_entity_name, approval_status, lifecycle_state, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', 'SANDBOX_READY', $6, $6)`,
      [ENVIRONMENT, merchantId, subject, actorId, options.legalEntityName, now],
    );
    if (options.withShopifyConnection) {
      const suffix = randomBytes(4).toString("hex");
      await database.query(
        `INSERT INTO merchant.shopify_connections
           (environment, merchant_id, shop_domain, access_token, granted_scope, status, connected_at)
         VALUES ($1, $2, $3, 'test-token', 'read_products', 'active', $4)`,
        [ENVIRONMENT, merchantId, `directory-test-${suffix}.myshopify.com`, now],
      );
    }
    if (options.withManifest) {
      await database.query(
        `INSERT INTO merchant.capability_manifests
           (environment, merchant_id, manifest_version, capabilities, version_bindings,
            generated_at, signature_digest, created_at)
         VALUES ($1, $2, 'v1', $3, '{}'::jsonb, $4,
                 'sha256:0000000000000000000000000000000000000000000000000000000000000000'::text, $4)`,
        [ENVIRONMENT, merchantId, ["search", "quote"], now],
      );
    }
    return merchantId;
  }

  it(
    "lists a merchant with an active Shopify connection AND a confirmed manifest",
    async () => {
      const merchantId = await seedMerchant({
        legalEntityName: "Directory Test Fully Onboarded",
        withShopifyConnection: true,
        withManifest: true,
      });

      const results = await store.list(undefined, 50);
      expect(results.some((m) => m.merchantId === merchantId)).toBe(true);
    },
    databaseHookTimeout,
  );

  it(
    "excludes a merchant with a Shopify connection but no confirmed manifest",
    async () => {
      const merchantId = await seedMerchant({
        legalEntityName: "Directory Test No Manifest",
        withShopifyConnection: true,
        withManifest: false,
      });

      const results = await store.list(undefined, 50);
      expect(results.some((m) => m.merchantId === merchantId)).toBe(false);
    },
    databaseHookTimeout,
  );

  it(
    "excludes a merchant with a confirmed manifest but no Shopify connection",
    async () => {
      const merchantId = await seedMerchant({
        legalEntityName: "Directory Test No Shopify",
        withShopifyConnection: false,
        withManifest: true,
      });

      const results = await store.list(undefined, 50);
      expect(results.some((m) => m.merchantId === merchantId)).toBe(false);
    },
    databaseHookTimeout,
  );

  it(
    "search query filters by display name, case-insensitively",
    async () => {
      const uniqueToken = randomBytes(4).toString("hex");
      const merchantId = await seedMerchant({
        legalEntityName: `Zephyr Traders ${uniqueToken}`,
        withShopifyConnection: true,
        withManifest: true,
      });

      const matched = await store.list(`zephyr traders ${uniqueToken}`.toUpperCase(), 50);
      expect(matched.some((m) => m.merchantId === merchantId)).toBe(true);

      const unmatched = await store.list(`no-such-merchant-${uniqueToken}`, 50);
      expect(unmatched.some((m) => m.merchantId === merchantId)).toBe(false);
    },
    databaseHookTimeout,
  );
});
