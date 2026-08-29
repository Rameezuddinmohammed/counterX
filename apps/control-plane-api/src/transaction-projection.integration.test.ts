/**
 * Integration proof for the merchant transaction read-model against the LIVE
 * Supabase Postgres (creds/DB-gated). Mirrors the gating + seed/cleanup
 * discipline of apps/worker/src/concurrency.integration.test.ts.
 *
 * It seeds its OWN uniquely-keyed rows across runtime.workflow_intents +
 * runtime.lifecycle_steps + runtime.spend_ledger for TEST_MERCHANT_A under a
 * dedicated 'sandbox' environment (so it never collides with the worker's
 * hardcoded 'local' rows), asserts:
 *   (a) the projected Transaction reflects the seeded real rows — amount in
 *       MAJOR units, currentState derived from the step sequence, transitions
 *       present — both via the Postgres store directly AND via the HTTP route;
 *   (b) TEST_MERCHANT_B cannot see merchant A's transaction via list or by id
 *       (tenant isolation);
 * and in afterAll DELETEs exactly the rows it inserted (by unique
 * transaction_id / reference). It NEVER drops/truncates/migrates.
 *
 * SKIPPED unless DATABASE_URL is present.
 */
import { afterAll, beforeAll, expect } from "vitest";
import { describe as vitestDescribe, it as vitestIt } from "vitest";
import { PostgresDatabase } from "@counter/data";
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from "jose";
import type { FastifyInstance } from "fastify";
import { createServer } from "./index.js";
import { createPostgresTransactionStore } from "./transaction-store-postgres.js";
import { createPostgresPolicyStore } from "./policy-store-postgres.js";
import type { Transaction } from "./transaction-routes.js";

const databaseUrl = process.env["DATABASE_URL"];
const gatedDescribe = databaseUrl ? vitestDescribe : vitestDescribe.skip;

const TEST_ISSUER = "https://dev-jzw3etjxnn3svs56.us.auth0.com/";
const TEST_AUDIENCE = "https://api.counter.dev";
const CLAIMS_NAMESPACE = "https://counter.dev/";

// A dedicated environment for this test's rows so they are never confused with
// the worker's hardcoded 'local' runtime rows.
const TEST_ENV = "sandbox";

const RUN_ID = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const TEST_MERCHANT_A = `ctr_merchant_txnprojA${RUN_ID}`;
const TEST_MERCHANT_B = `ctr_merchant_txnprojB${RUN_ID}`;
const TXN_ID = `ctr_txn_proj_${RUN_ID}`;
const WALLET_ID = `ctr_wallet_proj_${RUN_ID}`;
const INTENT_ID = `wfi_${RUN_ID}`;

type SignKey = Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];

async function mintToken(
  scope: Record<string, unknown>,
  actorKind: string,
  role: string,
  privateKey: SignKey,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    sub: "ctr_merchant-user_AAAAAAAAAAAAAAAAAAAAAA",
    [`${CLAIMS_NAMESPACE}actor_kind`]: actorKind,
    [`${CLAIMS_NAMESPACE}environment`]: "test",
    [`${CLAIMS_NAMESPACE}scope`]: scope,
    [`${CLAIMS_NAMESPACE}roles`]: [role],
    [`${CLAIMS_NAMESPACE}assurance`]: "session",
    permissions: ["identity.scope.read"],
  })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(TEST_ISSUER)
    .setAudience(TEST_AUDIENCE)
    .setExpirationTime(now + 3600)
    .setIssuedAt(now)
    .sign(privateKey);
}

gatedDescribe("transaction read-model projection (DB-gated, live Supabase)", () => {
  const database = new PostgresDatabase(databaseUrl as string);
  let server: FastifyInstance;
  let privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];

  beforeAll(async () => {
    const kp = await generateKeyPair("RS256");
    privateKey = kp.privateKey;
    const publicJwk = await exportJWK(kp.publicKey);
    const jwks = createLocalJWKSet({ keys: [{ ...publicJwk, alg: "RS256", use: "sig" }] });

    // The server is constructed for the TEST_ENV so its in-line environment
    // matches the seeded rows, and injected with the real Postgres store.
    server = createServer({
      jwks,
      environment: TEST_ENV,
      // A durable policy store is required for production-like environments; we
      // inject the real Postgres-backed store (this test never writes policy).
      policyStore: createPostgresPolicyStore(database, TEST_ENV),
      transactionStore: createPostgresTransactionStore(database, TEST_ENV),
    });
    await server.ready();

    // --- Seed a fully-settled transaction for merchant A ---
    await database.query(
      `INSERT INTO runtime.workflow_intents
         (id, transaction_id, environment, scope_kind, scope_id, command_type,
          command_digest, authority_context, status, created_at)
       VALUES ($1, $2, $3, 'merchant', $4, 'checkout',
          'sha256:0000000000000000000000000000000000000000000000000000000000000000',
          $5, 'completed', now())`,
      [
        INTENT_ID,
        TXN_ID,
        TEST_ENV,
        TEST_MERCHANT_A,
        JSON.stringify({ buyerRef: "buyer_proj_seed", method: "upi" }),
      ],
    );

    // Ordered lifecycle steps: a claim guard (excluded) + the three shopify legs.
    const stepsSql = `INSERT INTO runtime.lifecycle_steps
        (environment, idempotency_key, step, status, reference, snapshot, created_at, completed_at)
       VALUES ($1, $2, $3, $4, $5, NULL, $6::timestamptz, $6::timestamptz)`;
    await database.query(stepsSql, [TEST_ENV, TXN_ID, "shopify.draft.claim", "completed", null, "2025-01-20T10:00:30.000Z"]);
    await database.query(stepsSql, [TEST_ENV, TXN_ID, "shopify.draft", "completed", "ord_proj_1", "2025-01-20T10:01:00.000Z"]);
    await database.query(stepsSql, [TEST_ENV, TXN_ID, "shopify.finalize", "completed", "ord_proj_1", "2025-01-20T10:02:00.000Z"]);
    await database.query(stepsSql, [TEST_ENV, TXN_ID, "shopify.markPaid", "completed", "ord_proj_1", "2025-01-20T10:03:00.000Z"]);

    // Amount: 150000 minor units => 1500 major (INR).
    await database.query(
      `INSERT INTO runtime.spend_ledger
         (environment, wallet_id, reference, amount_minor, currency, spent_at)
       VALUES ($1, $2, $3, $4, 'INR', now())`,
      [TEST_ENV, WALLET_ID, TXN_ID, "150000"],
    );
  }, 60_000);

  afterAll(async () => {
    try {
      await database.query(
        `DELETE FROM runtime.workflow_intents WHERE environment = $1 AND transaction_id = $2`,
        [TEST_ENV, TXN_ID],
      );
      await database.query(
        `DELETE FROM runtime.lifecycle_steps WHERE environment = $1 AND idempotency_key = $2`,
        [TEST_ENV, TXN_ID],
      );
      await database.query(
        `DELETE FROM runtime.spend_ledger WHERE environment = $1 AND reference = $2`,
        [TEST_ENV, TXN_ID],
      );
    } finally {
      await server?.close();
      await database.close();
    }
  }, 60_000);

  vitestIt("projects the seeded real rows into a settled Transaction (store + route)", async () => {
    // (a) Direct store projection.
    const store = createPostgresTransactionStore(database, TEST_ENV);
    const list = await store.list(TEST_MERCHANT_A, { limit: 50, offset: 0 }, TEST_ENV);
    expect(list).toHaveLength(1);
    const projected = list[0]!;
    expect(projected.transactionId).toBe(TXN_ID);
    expect(projected.merchantId).toBe(TEST_MERCHANT_A);
    expect(projected.amount).toBe(1500); // MAJOR units (150000 minor / 100)
    expect(projected.currency).toBe("INR");
    expect(projected.currentState).toBe("settled");
    // buyerRef/method are read from authority_context when present.
    expect(projected.buyerRef).toBe("buyer_proj_seed");
    expect(projected.method).toBe("upi");
    // Transitions: synthetic initiated + authorized + captured + settled; the
    // .claim row is excluded.
    expect(projected.transitions.map((t) => t.to)).toEqual([
      "initiated",
      "authorized",
      "captured",
      "settled",
    ]);
    expect(projected.transitions.some((t) => t.evidenceRef === "ord_proj_1")).toBe(true);

    // (b) Via the HTTP route with a merchant-A token.
    const tokenA = await mintToken(
      { kind: "merchant", merchantId: TEST_MERCHANT_A },
      "merchant_user",
      "merchant.owner",
      privateKey,
    );
    const routeList = await server.inject({
      method: "GET",
      url: `/control/v1/merchants/${TEST_MERCHANT_A}/transactions`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(routeList.statusCode).toBe(200);
    const body = JSON.parse(routeList.body) as Transaction[];
    expect(body).toHaveLength(1);
    expect(body[0]!.transactionId).toBe(TXN_ID);
    expect(body[0]!.amount).toBe(1500);
    expect(body[0]!.currentState).toBe("settled");

    const routeGet = await server.inject({
      method: "GET",
      url: `/control/v1/transactions/${TXN_ID}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(routeGet.statusCode).toBe(200);
    const single = JSON.parse(routeGet.body) as Transaction;
    expect(single.transactionId).toBe(TXN_ID);
    expect(single.merchantId).toBe(TEST_MERCHANT_A);
  }, 60_000);

  vitestIt("enforces tenant isolation: merchant B cannot see A's transaction", async () => {
    const store = createPostgresTransactionStore(database, TEST_ENV);
    // Direct store: B's list is empty.
    const bList = await store.list(TEST_MERCHANT_B, { limit: 50, offset: 0 }, TEST_ENV);
    expect(bList).toHaveLength(0);

    const tokenB = await mintToken(
      { kind: "merchant", merchantId: TEST_MERCHANT_B },
      "merchant_user",
      "merchant.owner",
      privateKey,
    );

    // B lists its own merchant scope: empty array.
    const bRouteList = await server.inject({
      method: "GET",
      url: `/control/v1/merchants/${TEST_MERCHANT_B}/transactions`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(bRouteList.statusCode).toBe(200);
    expect(JSON.parse(bRouteList.body)).toHaveLength(0);

    // B tries to list A's merchant scope: forbidden.
    const bCross = await server.inject({
      method: "GET",
      url: `/control/v1/merchants/${TEST_MERCHANT_A}/transactions`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(bCross.statusCode).toBe(403);

    // B tries to fetch A's transaction by id: 404 (no disclosure).
    const bGet = await server.inject({
      method: "GET",
      url: `/control/v1/transactions/${TXN_ID}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(bGet.statusCode).toBe(404);
  }, 60_000);
});
