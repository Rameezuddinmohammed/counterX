/**
 * Integration proof for PostgresPaymentConnectionReadStore against the real
 * merchant.payment_connections table (migration 0016) — proves the SQL
 * this store issues actually matches the live schema, not just a mocked
 * fake. This is the store apps/worker's boot-time connector selection reads
 * to resolve a specific merchant's OWN Razorpay credentials (see boot.ts's
 * resolveRazorpayCredentialsForMerchant), so a schema drift here would
 * silently break real per-merchant payment routing.
 *
 * SKIPPED unless TEST_DATABASE_URL or DATABASE_URL is present (mirrors the
 * other *.integration.test.ts gates). SAFETY: every row is written under a
 * UNIQUE per-run merchant id (via createCounterId, real 128-bit entropy) and,
 * in afterAll, deletes ONLY those rows. It never truncates, drops, or
 * migrates the shared schema.
 */
import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createCounterId } from "@counter/domain";
import { PostgresDatabase } from "./database.js";
import { PostgresPaymentConnectionReadStore } from "./payment-connection-read-store.js";

const databaseUrl =
  process.env["TEST_DATABASE_URL"]?.trim() || process.env["DATABASE_URL"]?.trim() || undefined;
const databaseDescribe = databaseUrl === undefined ? describe.skip : describe;
const databaseHookTimeout = 30_000;

function freshMerchantId(): string {
  const result = createCounterId("merchant", randomBytes(16));
  if (!result.ok) {
    throw new Error("Failed to generate a fresh merchant id for this test run");
  }
  return result.value;
}

databaseDescribe("PostgresPaymentConnectionReadStore (real Postgres)", () => {
  const database = new PostgresDatabase(databaseUrl as string);
  const store = new PostgresPaymentConnectionReadStore(database, "test");
  const createdMerchantIds: string[] = [];

  afterAll(async () => {
    for (const merchantId of createdMerchantIds) {
      await database.query(
        `DELETE FROM merchant.payment_connections WHERE environment = 'test' AND merchant_id = $1`,
        [merchantId],
      );
      await database.query(
        `DELETE FROM merchant.scopes WHERE environment = 'test' AND merchant_id = $1`,
        [merchantId],
      );
      await database.query(
        `DELETE FROM identity.scope_registry WHERE environment = 'test' AND scope_id = $1`,
        [merchantId],
      );
    }
  }, databaseHookTimeout);

  async function seedMerchant(merchantId: string): Promise<void> {
    const now = new Date().toISOString();
    await database.query(
      `INSERT INTO identity.scope_registry (environment, scope_kind, scope_id, created_at)
       VALUES ('test', 'merchant', $1, $2)`,
      [merchantId, now],
    );
    await database.query(
      `INSERT INTO merchant.scopes (environment, merchant_id, created_at) VALUES ('test', $1, $2)`,
      [merchantId, now],
    );
    createdMerchantIds.push(merchantId);
  }

  it(
    "returns undefined for a merchant with no connected gateway",
    async () => {
      const merchantId = freshMerchantId();
      await seedMerchant(merchantId);
      const result = await store.findByMerchantId(merchantId);
      expect(result).toBeUndefined();
    },
    databaseHookTimeout,
  );

  it(
    "reads back a real verified connection row, round-tripped through Postgres",
    async () => {
      const merchantId = freshMerchantId();
      await seedMerchant(merchantId);
      const verifiedAt = new Date("2026-01-01T00:00:00.000Z").toISOString();
      await database.query(
        `INSERT INTO merchant.payment_connections
           (environment, merchant_id, provider, key_id, key_secret, verified_at, created_at, updated_at)
         VALUES ('test', $1, 'razorpay', $2, $3, $4, $4, $4)`,
        [merchantId, "rzp_test_own_gateway", "secret_own_gateway", verifiedAt],
      );

      const result = await store.findByMerchantId(merchantId);
      expect(result).toEqual({
        keyId: "rzp_test_own_gateway",
        keySecret: "secret_own_gateway",
        verifiedAt,
      });
    },
    databaseHookTimeout,
  );

  it(
    "never returns another merchant's connection",
    async () => {
      const merchantA = freshMerchantId();
      const merchantB = freshMerchantId();
      await seedMerchant(merchantA);
      await seedMerchant(merchantB);
      const verifiedAt = new Date().toISOString();
      await database.query(
        `INSERT INTO merchant.payment_connections
           (environment, merchant_id, provider, key_id, key_secret, verified_at, created_at, updated_at)
         VALUES ('test', $1, 'razorpay', 'rzp_test_a', 'secret_a', $2, $2, $2)`,
        [merchantA, verifiedAt],
      );

      const resultA = await store.findByMerchantId(merchantA);
      const resultB = await store.findByMerchantId(merchantB);
      expect(resultA?.keyId).toBe("rzp_test_a");
      expect(resultB).toBeUndefined();
    },
    databaseHookTimeout,
  );
});
