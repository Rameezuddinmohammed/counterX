/**
 * Integration proof for PostgresRevocationStore + PostgresMandateRepository
 * against the real wallet.revocations / wallet.mandates tables (migration
 * 0018) — proves the SQL matches the live schema, and that
 * WalletRevocationService's real cascade (wallet -> mandates) works end to
 * end through real Postgres, not mocks.
 *
 * SKIPPED unless TEST_DATABASE_URL or DATABASE_URL is present (mirrors the
 * other *.integration.test.ts gates). SAFETY: every row is written under a
 * UNIQUE per-run id (via createCounterId, real 128-bit entropy) and, in
 * afterAll, deletes ONLY those rows. It never truncates, drops, or migrates
 * the shared schema.
 */
import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createCounterId } from "@counter/domain";
import type { CounterId } from "@counter/domain";
import { WalletRevocationService } from "@counter/wallet-application";
import type { BuyerPolicyConstraints, WalletMandate } from "@counter/wallet-domain";
import { PostgresDatabase } from "./database.js";
import { PostgresRevocationStore } from "./revocation-store.js";
import { PostgresMandateRepository } from "./mandate-repository.js";

const databaseUrl =
  process.env["TEST_DATABASE_URL"]?.trim() || process.env["DATABASE_URL"]?.trim() || undefined;
const databaseDescribe = databaseUrl === undefined ? describe.skip : describe;
const databaseHookTimeout = 30_000;

function freshId<Kind extends "wallet" | "mandate" | "agent" | "actor">(
  kind: Kind,
): CounterId<Kind> {
  const result = createCounterId(kind, randomBytes(16));
  if (!result.ok) {
    throw new Error(`Failed to generate a fresh ${kind} id`);
  }
  return result.value;
}

const TEST_CONSTRAINTS: BuyerPolicyConstraints = {
  merchantAllowlist: { allowedMerchantIds: [], allowedDomains: [] },
  geography: { allowedMerchantCountries: ["IN"], allowedDeliveryCountries: ["IN"] },
  category: { allowedCategories: [] },
  currency: { allowedCurrencies: ["INR"] },
  amountLimits: { perTransactionMaxPaise: 100_000n },
  countLimits: {},
  operations: { allowedOperations: ["purchase"] },
  timeConstraints: {},
  approvalThreshold: { thresholdPaise: 50_000n },
  paymentReferences: { allowedReferenceIds: [] },
};

databaseDescribe("PostgresRevocationStore + PostgresMandateRepository (real Postgres)", () => {
  const database = new PostgresDatabase(databaseUrl as string);
  const revocationStore = new PostgresRevocationStore(database, "test");
  const mandateRepo = new PostgresMandateRepository(database, "test");
  const writtenWalletIds: string[] = [];
  const writtenMandateIds: string[] = [];

  afterAll(async () => {
    for (const mandateId of writtenMandateIds) {
      await database.query(
        `DELETE FROM wallet.mandates WHERE environment = 'test' AND mandate_id = $1`,
        [mandateId],
      );
    }
    for (const walletId of writtenWalletIds) {
      await database.query(
        `DELETE FROM wallet.revocations WHERE environment = 'test' AND scope_id = $1`,
        [walletId],
      );
      await database.query(
        `DELETE FROM wallet.scopes WHERE environment = 'test' AND wallet_id = $1`,
        [walletId],
      );
      await database.query(
        `DELETE FROM identity.scope_registry WHERE environment = 'test' AND scope_id = $1`,
        [walletId],
      );
    }
  }, databaseHookTimeout);

  async function seedWallet(walletId: string): Promise<void> {
    const now = new Date().toISOString();
    await database.query(
      `INSERT INTO identity.scope_registry (environment, scope_kind, scope_id, created_at)
       VALUES ('test', 'wallet', $1, $2)`,
      [walletId, now],
    );
    await database.query(
      `INSERT INTO wallet.scopes (environment, wallet_id, created_at) VALUES ('test', $1, $2)`,
      [walletId, now],
    );
    writtenWalletIds.push(walletId);
  }

  it(
    "records a revocation and reads it back through the real service",
    async () => {
      const walletId = freshId("wallet");
      await seedWallet(walletId);
      const principalId = freshId("actor");

      const service = new WalletRevocationService(revocationStore, mandateRepo);
      const result = await service.revoke({
        principalId,
        walletId,
        scopeType: "wallet",
        reasonClass: "security_compromise",
        scopeId: walletId,
        correlationId: `test-revoke-${walletId}`,
        kid: "test-kid",
      });

      expect(result.ok).toBe(true);
      expect(await revocationStore.isRevoked("wallet", walletId)).toBe(true);
      expect(await service.isRevoked("wallet", walletId)).toBe(true);

      // Idempotent: a second revoke() for the same scope returns the SAME record.
      const second = await service.revoke({
        principalId,
        walletId,
        scopeType: "wallet",
        reasonClass: "policy_violation",
        scopeId: walletId,
        correlationId: `test-revoke-again-${walletId}`,
        kid: "test-kid",
      });
      expect(second.ok).toBe(true);
      if (result.ok && second.ok) {
        expect(second.value.record.revocationId).toBe(result.value.record.revocationId);
      }
    },
    databaseHookTimeout,
  );

  it(
    "cascades a wallet revocation to its real Postgres-backed mandates",
    async () => {
      const walletId = freshId("wallet");
      await seedWallet(walletId);
      const agentId = freshId("agent");
      const principalId = freshId("actor");
      const mandateId = freshId("mandate");
      writtenMandateIds.push(mandateId);

      const mandate: WalletMandate = {
        mandateId,
        walletId,
        principalId,
        agentId,
        kid: "test-kid",
        constraints: TEST_CONSTRAINTS,
        paymentReferenceId: "test-payref",
        validFrom: new Date().toISOString(),
        validUntil: new Date(Date.now() + 86_400_000).toISOString(),
        issuedAt: new Date().toISOString(),
        consentAttestationDigest: "sha256:test-digest",
        status: "active",
        revocationLocator: "test-locator",
        policyVersionId: "v1",
      };
      await mandateRepo.save(mandate);
      expect((await mandateRepo.findById(mandateId))?.status).toBe("active");

      const service = new WalletRevocationService(revocationStore, mandateRepo);
      const result = await service.revoke({
        principalId,
        walletId,
        scopeType: "wallet",
        reasonClass: "security_compromise",
        scopeId: walletId,
        correlationId: `test-cascade-${walletId}`,
        kid: "test-kid",
      });

      expect(result.ok).toBe(true);
      expect((await mandateRepo.findById(mandateId))?.status).toBe("revoked");
      expect(await mandateRepo.findActive(walletId)).toHaveLength(0);
    },
    databaseHookTimeout,
  );
});
