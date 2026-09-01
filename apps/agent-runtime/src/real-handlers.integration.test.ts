/**
 * Integration proof that transactionCreate's durable mandate-authority
 * enforcement (the actual money-moving-boundary gate this milestone adds)
 * works against REAL Postgres — a signed purchase-intent envelope only
 * reaches the durable job queue when it resolves to a real, active,
 * unrevoked, in-limits WalletMandate; every other case is denied BEFORE
 * the quote is consumed or a job is enqueued.
 *
 * SKIPPED unless TEST_DATABASE_URL or DATABASE_URL is present (mirrors
 * every other *.integration.test.ts gate in this repo). SAFETY: every row
 * is written under a unique per-run id; afterAll deletes only those rows.
 * Never truncates, drops, or migrates the shared schema.
 */
import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createCounterId } from "@counter/domain";
import type { CounterId, Environment } from "@counter/domain";
import {
  PostgresDatabase,
  PostgresQuoteStore,
  PostgresMandateRepository,
  PostgresRevocationStore,
  PostgresJobRepository,
} from "@counter/data";
import type { BuyerPolicyConstraints, WalletMandate } from "@counter/wallet-domain";
import {
  buildUnsignedEnvelope,
  signEnvelope,
  InMemorySigner,
  TEST_KEY_RECORD_A,
  getTestPrivateKeyA,
  type PurchaseIntentPayload,
} from "@counter/trust-protocol";
import { __testing } from "./real-handlers.js";

const databaseUrl =
  process.env["TEST_DATABASE_URL"]?.trim() || process.env["DATABASE_URL"]?.trim() || undefined;
const databaseDescribe = databaseUrl === undefined ? describe.skip : describe;
const databaseHookTimeout = 30_000;
const ENVIRONMENT: Environment = "test";
const MERCHANT_ID = "ctr_merchant_AAAAAAAAAAAAAAAAAAAAAA";

function freshId<Kind extends "wallet" | "mandate" | "agent" | "actor" | "transaction" | "key">(
  kind: Kind,
): CounterId<Kind> {
  const result = createCounterId(kind, randomBytes(16));
  if (!result.ok) throw new Error(`Failed to generate a fresh ${kind} id`);
  return result.value;
}

function testConstraints(overrides: Partial<BuyerPolicyConstraints> = {}): BuyerPolicyConstraints {
  return {
    merchantAllowlist: { allowedMerchantIds: [MERCHANT_ID], allowedDomains: [] },
    geography: { allowedMerchantCountries: ["IN"], allowedDeliveryCountries: ["IN"] },
    category: { allowedCategories: [] },
    currency: { allowedCurrencies: ["INR"] },
    amountLimits: { perTransactionMaxPaise: 500_000n },
    countLimits: {},
    operations: { allowedOperations: ["purchase"] },
    timeConstraints: {},
    approvalThreshold: { thresholdPaise: 500_000n },
    paymentReferences: { allowedReferenceIds: [] },
    ...overrides,
  };
}

databaseDescribe("transactionCreate — durable mandate-authority enforcement (real Postgres)", () => {
  const database = new PostgresDatabase(databaseUrl as string);
  const quoteStore = new PostgresQuoteStore(database, ENVIRONMENT);
  const mandateRepo = new PostgresMandateRepository(database, ENVIRONMENT);
  const revocationStore = new PostgresRevocationStore(database, ENVIRONMENT);
  const jobRepository = new PostgresJobRepository(database, ENVIRONMENT);
  const handler = __testing.createTransactionCreateHandler(database, ENVIRONMENT, jobRepository);

  const writtenWalletIds: string[] = [];
  const writtenMandateIds: string[] = [];
  const writtenQuoteIds: string[] = [];
  const writtenJobIds: string[] = [];

  afterAll(async () => {
    for (const jobId of writtenJobIds) {
      await database.query(`DELETE FROM runtime.jobs WHERE environment = $1 AND id = $2`, [
        ENVIRONMENT,
        jobId,
      ]);
    }
    for (const quoteId of writtenQuoteIds) {
      await database.query(`DELETE FROM runtime.quotes WHERE environment = $1 AND id = $2`, [
        ENVIRONMENT,
        quoteId,
      ]);
    }
    for (const mandateId of writtenMandateIds) {
      await database.query(
        `DELETE FROM wallet.revocations WHERE environment = $1 AND scope_id = $2`,
        [ENVIRONMENT, mandateId],
      );
      await database.query(`DELETE FROM wallet.mandates WHERE environment = $1 AND mandate_id = $2`, [
        ENVIRONMENT,
        mandateId,
      ]);
    }
    for (const walletId of writtenWalletIds) {
      await database.query(
        `DELETE FROM identity.agent_public_keys WHERE environment = $1 AND owner_scope_id = $2`,
        [ENVIRONMENT, walletId],
      );
      await database.query(
        `DELETE FROM identity.actors WHERE environment = $1 AND owner_scope_id = $2`,
        [ENVIRONMENT, walletId],
      );
      await database.query(`DELETE FROM wallet.scopes WHERE environment = $1 AND wallet_id = $2`, [
        ENVIRONMENT,
        walletId,
      ]);
      await database.query(
        `DELETE FROM identity.scope_registry WHERE environment = $1 AND scope_id = $2`,
        [ENVIRONMENT, walletId],
      );
    }
    await database.close();
  }, databaseHookTimeout);

  async function seedWalletWithRegisteredAgentKey(
    walletId: string,
    agentId: string,
  ): Promise<CounterId<"key">> {
    const now = new Date().toISOString();
    await database.query(
      `INSERT INTO identity.scope_registry (environment, scope_kind, scope_id, created_at)
       VALUES ($1, 'wallet', $2, $3)`,
      [ENVIRONMENT, walletId, now],
    );
    await database.query(
      `INSERT INTO wallet.scopes (environment, wallet_id, created_at) VALUES ($1, $2, $3)`,
      [ENVIRONMENT, walletId, now],
    );
    // agent_public_keys.agent_id FKs to identity.actors — mirrors
    // WalletUserProvisioner.registerAgentKey's own two-insert shape exactly.
    await database.query(
      `INSERT INTO identity.actors (
         environment, actor_kind, actor_id, owner_scope_kind, owner_scope_id, status, created_at
       ) VALUES ($1, 'registered_agent', $2, 'wallet', $3, 'active', $4)`,
      [ENVIRONMENT, agentId, walletId, now],
    );
    // The agent's REGISTERED public key — PostgresCtpKeyRegistry (constructed
    // internally by the handler) resolves this kid against this row, so
    // signature verification is against a real durable key record, not a
    // trusted-by-fiat test double. agent_public_keys' PK is (environment,
    // key_id) alone, so each seeded wallet needs its OWN fresh kid — reusing
    // one across wallets collides on the primary key.
    const kid = freshId("key");
    await database.query(
      `INSERT INTO identity.agent_public_keys (
         environment, owner_scope_kind, owner_scope_id, key_id, actor_kind,
         agent_id, algorithm, public_key_base64url, created_at, not_before
       ) VALUES ($1, 'wallet', $2, $3, 'registered_agent', $4, 'Ed25519', $5, $6, $6)`,
      [ENVIRONMENT, walletId, kid, agentId, TEST_KEY_RECORD_A.publicKey, now],
    );
    writtenWalletIds.push(walletId);
    return kid;
  }

  async function seedMandate(overrides: Partial<WalletMandate> = {}): Promise<WalletMandate> {
    const mandateId = freshId("mandate");
    const walletId = overrides.walletId ?? freshId("wallet");
    const agentId = overrides.agentId ?? freshId("agent");
    // The wallet a mandate references MUST exist first (wallet.mandates'
    // real FK to wallet.scopes) — seed it (and the agent's registered key,
    // needed by the handler's own PostgresCtpKeyRegistry lookup) BEFORE
    // ever inserting the mandate row itself.
    const kid = await seedWalletWithRegisteredAgentKey(walletId, agentId);
    const mandate: WalletMandate = {
      mandateId,
      walletId,
      principalId: freshId("actor"),
      agentId,
      kid,
      constraints: testConstraints(),
      paymentReferenceId: "ctr_payment-reference_test-provider-mandate",
      validFrom: "2020-01-01T00:00:00.000Z",
      validUntil: "2099-12-31T23:59:59.000Z",
      issuedAt: new Date().toISOString(),
      consentAttestationDigest: "sha256:test-consent-digest",
      status: "active",
      revocationLocator: `revoke:mandate:${mandateId}`,
      policyVersionId: "v1",
      ...overrides,
    };
    await mandateRepo.save(mandate);
    writtenMandateIds.push(mandateId);
    return mandate;
  }

  async function seedQuote(totalPriceMinor: bigint): Promise<{ quoteId: string; digest: string }> {
    const quoteId = `ctr_quote_${randomBytes(8).toString("hex")}`;
    const digest = `sha256:${randomBytes(32).toString("hex")}`;
    await quoteStore.save({
      id: quoteId,
      merchantId: MERCHANT_ID,
      variantId: "gid://shopify/ProductVariant/1",
      quantity: 1,
      unitPriceMinor: totalPriceMinor,
      totalPriceMinor,
      currency: "INR",
      ctpDigest: digest,
      quoteContent: { note: "integration test fixture" },
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 600_000),
    });
    writtenQuoteIds.push(quoteId);
    return { quoteId, digest };
  }

  async function signedIntentEnvelope(input: {
    mandateId: string;
    kid: string;
    walletId: string;
    agentId: string;
    quoteId: string;
    quoteDigest: string;
  }) {
    const now = new Date().toISOString();
    const payload: PurchaseIntentPayload = {
      intent_id: `intent-${randomBytes(8).toString("hex")}`,
      mandate_id: input.mandateId,
      wallet_id: input.walletId,
      agent_id: input.agentId,
      merchant_id: MERCHANT_ID,
      environment: "sandbox",
      operation: "purchase",
      trigger_type: "agent_initiated",
      items: [{ item_id: "gid://shopify/ProductVariant/1", quantity: 1 }],
      quote_id: input.quoteId,
      quote_digest: input.quoteDigest,
      quote_issued_at: now,
      quote_expires_at: new Date(Date.now() + 600_000).toISOString(),
      currency: "INR",
      max_amount: { amount: 100_000, currency: "INR" },
      payment_authorization_ref: "ctr_payment-reference_test-provider-mandate",
      transaction_id: `intent-txn-${randomBytes(8).toString("hex")}`,
      intent_expiry: new Date(Date.now() + 600_000).toISOString(),
    };
    const unsignedResult = buildUnsignedEnvelope<PurchaseIntentPayload>({
      type: "counter.purchase-intent.v1",
      id: `intent-${payload.intent_id}`,
      issuer: `counter://wallet/${input.walletId}`,
      subject: `counter://agent/${input.agentId}`,
      audience: [MERCHANT_ID],
      environment: "sandbox",
      issued_at: now,
      not_before: now,
      expires_at: payload.intent_expiry,
      nonce: `intent-nonce-${randomBytes(8).toString("hex")}`,
      correlation_id: `corr-${randomBytes(8).toString("hex")}`,
      payload,
      kid: input.kid,
    });
    if (!unsignedResult.ok) throw new Error("fixture setup failed");
    // Same real Ed25519 private key material (test-key-A) for every seeded
    // wallet — only the durable key_id label differs per wallet.
    const signedResult = await signEnvelope(
      unsignedResult.value,
      new InMemorySigner(input.kid, getTestPrivateKeyA()),
    );
    if (!signedResult.ok) throw new Error("fixture setup failed");
    return signedResult.value;
  }

  it(
    "enqueues a real job when the signed intent resolves to an active, unrevoked, in-limits mandate",
    async () => {
      const agentId = freshId("agent");
      const mandate = await seedMandate({ agentId });
      const { quoteId, digest } = await seedQuote(100_000n);
      const envelope = await signedIntentEnvelope({
        mandateId: mandate.mandateId,
        kid: mandate.kid,
        walletId: mandate.walletId,
        agentId,
        quoteId,
        quoteDigest: digest,
      });

      const result = await handler.handle(
        { merchantId: MERCHANT_ID, correlationId: "corr-1", idempotencyKey: undefined, version: "v1" },
        { quoteId, paymentMethod: "upi", billingAddress: undefined, ctpEnvelope: envelope },
      );

      expect(result.ok).toBe(true);
      // Confirm a real job actually landed in the durable queue — payload is
      // stored as JSON text under payload_reference (PostgresJobRepository
      // .enqueue's own column), not a jsonb 'payload' column.
      const jobs = await database.query<{ id: string; payload_reference: string }>(
        `SELECT id, payload_reference FROM runtime.jobs
          WHERE environment = $1 AND type = 'transaction.lifecycle'
            AND payload_reference::jsonb ->> 'amountMinor' = '100000'
          ORDER BY created_at DESC LIMIT 1`,
        [ENVIRONMENT],
      );
      expect(jobs.rows).toHaveLength(1);
      writtenJobIds.push(jobs.rows[0]!.id);
      const payload = JSON.parse(jobs.rows[0]!.payload_reference) as {
        authority?: { mandateId?: string };
      };
      expect(payload.authority?.mandateId).toBe(mandate.mandateId);
    },
    databaseHookTimeout,
  );

  it(
    "refuses a signed intent with NO mandate_id — an ungoverned agent request is never enqueued",
    async () => {
      const agentId = freshId("agent");
      const mandate = await seedMandate({ agentId });
      const { quoteId, digest } = await seedQuote(100_000n);
      const envelope = await signedIntentEnvelope({
        mandateId: mandate.mandateId,
        kid: mandate.kid,
        walletId: mandate.walletId,
        agentId,
        quoteId,
        quoteDigest: digest,
      });
      const strippedEnvelope = { ...envelope, payload: { ...envelope.payload, mandate_id: "" } };

      const result = await handler.handle(
        { merchantId: MERCHANT_ID, correlationId: "corr-2", idempotencyKey: undefined, version: "v1" },
        { quoteId, paymentMethod: "upi", billingAddress: undefined, ctpEnvelope: strippedEnvelope },
      );

      expect(result.ok).toBe(false);
      // The quote must NOT have been consumed either — a denied request
      // leaves the buyer able to retry with a proper mandate.
      const stillUnconsumed = await quoteStore.get(quoteId);
      expect(stillUnconsumed.ok && stillUnconsumed.value?.consumedAt).toBeUndefined();
    },
    databaseHookTimeout,
  );

  it(
    "refuses when the mandate is durably revoked, even though nothing else about the request changed",
    async () => {
      const agentId = freshId("agent");
      const mandate = await seedMandate({ agentId });
      await revocationStore.save({
        revocationId: freshId("actor"),
        scopeType: "mandate",
        scopeId: mandate.mandateId,
        effectiveTime: new Date().toISOString(),
        reasonClass: "principal_initiated",
        sequence: 1,
        createdAt: new Date().toISOString(),
        principalId: mandate.principalId,
      });
      const { quoteId, digest } = await seedQuote(100_000n);
      const envelope = await signedIntentEnvelope({
        mandateId: mandate.mandateId,
        kid: mandate.kid,
        walletId: mandate.walletId,
        agentId,
        quoteId,
        quoteDigest: digest,
      });

      const result = await handler.handle(
        { merchantId: MERCHANT_ID, correlationId: "corr-3", idempotencyKey: undefined, version: "v1" },
        { quoteId, paymentMethod: "upi", billingAddress: undefined, ctpEnvelope: envelope },
      );

      expect(result.ok).toBe(false);
    },
    databaseHookTimeout,
  );

  it(
    "refuses an amount exceeding the mandate's own per-transaction ceiling",
    async () => {
      const agentId = freshId("agent");
      const mandate = await seedMandate({
        agentId,
        constraints: testConstraints({ amountLimits: { perTransactionMaxPaise: 1_000n } }),
      });
      const { quoteId, digest } = await seedQuote(100_000n); // exceeds the 1,000 paise ceiling
      const envelope = await signedIntentEnvelope({
        mandateId: mandate.mandateId,
        kid: mandate.kid,
        walletId: mandate.walletId,
        agentId,
        quoteId,
        quoteDigest: digest,
      });

      const result = await handler.handle(
        { merchantId: MERCHANT_ID, correlationId: "corr-4", idempotencyKey: undefined, version: "v1" },
        { quoteId, paymentMethod: "upi", billingAddress: undefined, ctpEnvelope: envelope },
      );

      expect(result.ok).toBe(false);
    },
    databaseHookTimeout,
  );

  it(
    "refuses when the mandate's merchant allowlist does not include the operating merchant",
    async () => {
      const agentId = freshId("agent");
      const mandate = await seedMandate({
        agentId,
        constraints: testConstraints({
          merchantAllowlist: { allowedMerchantIds: ["ctr_merchant_someone_else"], allowedDomains: [] },
        }),
      });
      const { quoteId, digest } = await seedQuote(100_000n);
      const envelope = await signedIntentEnvelope({
        mandateId: mandate.mandateId,
        kid: mandate.kid,
        walletId: mandate.walletId,
        agentId,
        quoteId,
        quoteDigest: digest,
      });

      const result = await handler.handle(
        { merchantId: MERCHANT_ID, correlationId: "corr-5", idempotencyKey: undefined, version: "v1" },
        { quoteId, paymentMethod: "upi", billingAddress: undefined, ctpEnvelope: envelope },
      );

      expect(result.ok).toBe(false);
    },
    databaseHookTimeout,
  );
});
