/**
 * Integration proof for WalletUserProvisioner against the LIVE Supabase
 * Postgres (DATABASE_URL-gated). Mirrors the gating + seed/cleanup
 * discipline of transaction-projection.integration.test.ts: uses uniquely
 * -keyed rows (a per-run suffix) so it never collides with real data, and
 * in afterAll DELETEs exactly what it inserted, in FK-safe order. It NEVER
 * drops/truncates/migrates.
 *
 * SKIPPED unless DATABASE_URL is present.
 */
import { afterAll, beforeAll, expect } from "vitest";
import { describe as vitestDescribe, it as vitestIt } from "vitest";
import { PostgresDatabase } from "@counter/data";
import { createCounterId } from "@counter/domain";
import { WalletUserProvisioner } from "./wallet-user-store.js";

const databaseUrl = process.env["DATABASE_URL"];
const gatedDescribe = databaseUrl ? vitestDescribe : vitestDescribe.skip;

const TEST_ENV = "sandbox";
const RUN_ID = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const SUBJECT_A = `wallet-user-store-test|${RUN_ID}-a`;
const SUBJECT_B = `wallet-user-store-test|${RUN_ID}-b`;
const FAKE_PUBLIC_KEY = "QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI"; // 32 synthetic bytes, base64url

function fakeKeyId(): string {
  const result = createCounterId("key", crypto.getRandomValues(new Uint8Array(16)));
  if (!result.ok) throw new Error("Failed to derive a test key id");
  return result.value as unknown as string;
}

gatedDescribe("WalletUserProvisioner (real Supabase)", () => {
  let database: PostgresDatabase;
  let provisioner: WalletUserProvisioner;
  const insertedWalletIds: string[] = [];

  beforeAll(() => {
    database = new PostgresDatabase(databaseUrl as string);
    provisioner = new WalletUserProvisioner(database, TEST_ENV);
  });

  afterAll(async () => {
    // FK-safe deletion order: agent_public_keys and wallet_users both
    // reference actors (agent_public_keys_actor_fk / wallet_users_actor_fk),
    // so both must go before actors; wallet_users and wallet_setup_tokens
    // both reference wallet.scopes, so both must go before it; scope_registry
    // last (wallet.scopes references it).
    for (const walletId of insertedWalletIds) {
      await database.query(
        `DELETE FROM identity.agent_public_keys WHERE environment = $1 AND owner_scope_id = $2`,
        [TEST_ENV, walletId],
      );
      await database.query(
        `DELETE FROM identity.wallet_setup_tokens WHERE environment = $1 AND wallet_id = $2`,
        [TEST_ENV, walletId],
      );
      await database.query(
        `DELETE FROM identity.wallet_users WHERE environment = $1 AND wallet_id = $2`,
        [TEST_ENV, walletId],
      );
      await database.query(
        `DELETE FROM identity.actors WHERE environment = $1 AND owner_scope_id = $2`,
        [TEST_ENV, walletId],
      );
      await database.query(`DELETE FROM wallet.scopes WHERE environment = $1 AND wallet_id = $2`, [
        TEST_ENV,
        walletId,
      ]);
      await database.query(
        `DELETE FROM identity.scope_registry WHERE environment = $1 AND scope_id = $2`,
        [TEST_ENV, walletId],
      );
    }
    await database.close();
  });

  vitestIt(
    "provisions a real wallet for a new subject, and is idempotent on repeat login",
    async () => {
      const first = await provisioner.provisionForAuth0Subject(SUBJECT_A);
      insertedWalletIds.push(first.walletId);
      expect(first.created).toBe(true);
      expect(first.walletId).toMatch(/^ctr_wallet_/);

      const second = await provisioner.provisionForAuth0Subject(SUBJECT_A);
      expect(second.created).toBe(false);
      expect(second.walletId).toBe(first.walletId);

      const rows = await database.query(
        `SELECT wallet_id FROM identity.wallet_users WHERE environment = $1 AND auth0_subject = $2`,
        [TEST_ENV, SUBJECT_A],
      );
      expect(rows.rows).toHaveLength(1);
    },
  );

  vitestIt("different subjects get different wallets", async () => {
    const a = await provisioner.provisionForAuth0Subject(SUBJECT_A);
    const b = await provisioner.provisionForAuth0Subject(SUBJECT_B);
    insertedWalletIds.push(b.walletId);
    expect(a.walletId).not.toBe(b.walletId);
  });

  vitestIt("mints a setup token, redeems it exactly once, then rejects reuse", async () => {
    const { walletId } = await provisioner.provisionForAuth0Subject(
      `wallet-user-store-test|${RUN_ID}-c`,
    );
    insertedWalletIds.push(walletId);

    const { setupToken, expiresAt } = await provisioner.mintSetupToken(walletId);
    expect(setupToken.length).toBeGreaterThan(20);
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());

    const redeemed = await provisioner.redeemSetupToken(setupToken);
    expect(redeemed).toBe(walletId);

    const reused = await provisioner.redeemSetupToken(setupToken);
    expect(reused).toBeUndefined();
  });

  vitestIt("rejects an unknown token", async () => {
    const result = await provisioner.redeemSetupToken("not-a-real-token");
    expect(result).toBeUndefined();
  });

  vitestIt("registers a real agent key for a provisioned wallet", async () => {
    const { walletId } = await provisioner.provisionForAuth0Subject(
      `wallet-user-store-test|${RUN_ID}-d`,
    );
    insertedWalletIds.push(walletId);

    const suppliedKeyId = fakeKeyId();
    const { agentId, keyId } = await provisioner.registerAgentKey(
      walletId,
      suppliedKeyId,
      FAKE_PUBLIC_KEY,
    );
    expect(agentId).toMatch(/^ctr_agent_/);
    expect(keyId).toBe(suppliedKeyId);

    const keyRow = await database.query<{ owner_scope_id: string; public_key_base64url: string }>(
      `SELECT owner_scope_id, public_key_base64url FROM identity.agent_public_keys
        WHERE environment = $1 AND key_id = $2`,
      [TEST_ENV, keyId],
    );
    expect(keyRow.rows[0]?.owner_scope_id).toBe(walletId);
    expect(keyRow.rows[0]?.public_key_base64url).toBe(FAKE_PUBLIC_KEY);
  });

  vitestIt("refuses to register a key for a nonexistent wallet", async () => {
    await expect(
      provisioner.registerAgentKey("ctr_wallet_doesnotexist00000000", fakeKeyId(), FAKE_PUBLIC_KEY),
    ).rejects.toThrow(/No such wallet/);
  });

  vitestIt("refuses a malformed keyId", async () => {
    const { walletId } = await provisioner.provisionForAuth0Subject(
      `wallet-user-store-test|${RUN_ID}-e`,
    );
    insertedWalletIds.push(walletId);

    await expect(
      provisioner.registerAgentKey(walletId, "not-a-counter-id", FAKE_PUBLIC_KEY),
    ).rejects.toThrow(/Invalid keyId/);
  });
});
