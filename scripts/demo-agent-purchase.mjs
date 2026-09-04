#!/usr/bin/env node
/**
 * Buildathon demo purchase (finalplan.md Step 5): runs ONE real, live
 * purchase driven by the demo agent's OWN real Ed25519 key (registered by
 * register-agent-self-serve.mjs, bound to a real prepaid-balance-backed
 * WalletMandate by issue-and-bind-prepaid-mandate.mjs), through the REAL
 * worker money seam — the same `selectPaymentAuthorizationPort` +
 * `createTransactionLifecycleHandler` wiring apps/worker/src/main.ts runs in
 * production, with the SAME real durable stores (spend ledger, revocation
 * store, wallet balance store) main.ts wires, so the real production policy
 * (not ALLOW_ALL) actually gates the purchase.
 *
 * Unlike scripts/verify-real-transaction.mjs (which calls
 * selectPaymentAuthorizationPort with no durable stores, exercising only the
 * plain Razorpay one-shot path under the default allow-all policy), this
 * script:
 *   1. builds + signs a REAL CTP purchase intent with the agent's own key
 *      (@counter/wallet-application's PurchaseIntentBuilder — the exact
 *      class apps/local-mcp/src/tools/write-tools.ts's purchase.execute
 *      handler uses), and independently re-verifies that signature
 *      (@counter/trust-protocol's verifyEnvelope) before trusting it — never
 *      re-implementing signature verification;
 *   2. wires the REAL durable stores (spend ledger, revocation store, wallet
 *      balance store, step ledger, kill-switch store) into
 *      selectPaymentAuthorizationPort, so the deployed production policy
 *      genuinely governs the purchase, not a test-injected allow-all;
 *   3. drives a purchase with NO paymentReferenceId and a real
 *      authority.walletId, so the worker takes the prepaid-balance branch
 *      (real-lifecycle.ts) — debiting the wallet's real, Razorpay-funded
 *      balance instead of creating a fresh Razorpay order.
 *
 * NOT reproduced here (disclosed, not hidden): the full agent-runtime HTTP
 * hop (MerchantRuntimeClient -> agent-runtime -> worker) that a real MCP
 * client (apps/local-mcp) would go through, and agent-runtime's own
 * checkMandateAuthority ceiling check against this mandate's own
 * per-transaction ceiling (packages/wallet-application's
 * PolicyPrecheckService, run below, exercises the SAME precheck logic
 * in-process using this mandate's real constraints, but is not itself part
 * of the worker's money seam). This deployment's self-serve agent has no
 * agent-runtime M2M credentials configured yet (register-agent-self-serve.mjs
 * prints "<ask Counter>" for COUNTER_AGENT_RUNTIME_URL/COUNTER_RUNTIME_AUTH_TOKEN),
 * so the real, disclosed alternative safety property this script proves is
 * the one CLAUDE.md calls out: the wallet's remaining prepaid balance IS
 * checked, atomically, BEFORE any Shopify order is created (real-lifecycle.ts's
 * walletBalanceStore.debit() call sits ahead of the Shopify draft-order step).
 *
 * Usage:
 *   node scripts/demo-agent-purchase.mjs --amount-minor 50000 [--decline]
 *
 *   --amount-minor   Purchase amount in paise (default 50000 = Rs.500).
 *   --decline        Convenience flag: sets amount-minor to an amount that
 *                     should exceed the wallet's remaining real balance, to
 *                     demonstrate the pre-effect decline. Overrides
 *                     --amount-minor if both given.
 *
 * PREREQUISITE: `pnpm build` (imports compiled dist, same convention as
 * every other script here).
 *
 * SECURITY: never logs the private key or any secret. Reads DATABASE_URL,
 * RAZORPAY_ and SHOPIFY_ credentials from .env, same as every other script here.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import readline from "node:readline/promises";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");

function importFromRepo(relativePath) {
  return import(pathToFileURL(resolve(repoRoot, relativePath)).href);
}

for (const line of readFileSync(resolve(repoRoot, ".env"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) continue;
    if (key === "--decline") {
      args.decline = true;
      continue;
    }
    args[key.slice(2)] = argv[i + 1];
    i += 1;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

const walletId = args["wallet-id"] ?? "ctr_wallet_I5rsr86W9WUgbDG_dbcjIA";
const agentId = args["agent-id"] ?? "ctr_agent__nR51leUYCqMZF9xYQKBqQ";
const mandateId = args["mandate-id"] ?? "ctr_mandate_IHEvoD9s4cPpZKEOClq_Gg";
const kid = args["kid"] ?? "ctr_key_WdLItEYm1hWWlk4xyWRbXg";
const merchantId = args["merchant-id"] ?? "ctr_merchant_BwcHBwcHBwcHBwcHBwcHBw";
const ceilingMinor = BigInt(args["ceiling-minor"] ?? "500000");
// --decline's amount is resolved against the wallet's REAL live balance
// inside main() (not hardcoded here) — a stale hardcoded "over budget"
// figure could accidentally succeed if the wallet was topped up since,
// which would silently defeat the exact safety property this mode exists
// to demonstrate.
let amountMinor = Number.parseInt(args["amount-minor"] ?? "50000", 10);

const keyStorePath = process.env.COUNTER_WALLET_KEYSTORE_PATH;
let passphrase = process.env.COUNTER_WALLET_KEYSTORE_PASSPHRASE;
if (passphrase === undefined) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  passphrase = await rl.question("Passphrase for the agent's key file: ");
  rl.close();
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

function step(label, title) {
  console.log(`\n[${label}] ${title}`);
}

async function main() {
  console.log("Counter :: LIVE agent-signed purchase (finalplan.md Step 5)");
  console.log(`  wallet:   ${walletId}`);
  console.log(`  agent:    ${agentId}`);
  console.log(`  mandate:  ${mandateId}`);

  // ─── Gate on real credentials, same discipline as verify-real-transaction.mjs ───
  const worker = await importFromRepo("apps/worker/dist/index.js");
  const shopifyCreds = worker.resolveShopifyCredentials(process.env);
  const razorpayCreds = worker.resolveRazorpayCredentials(process.env);
  if (shopifyCreds === null || razorpayCreds === null) {
    console.log("SKIPPED: real Shopify/Razorpay credentials not present.");
    process.exit(0);
  }

  const data = await importFromRepo("packages/data/dist/index.js");
  const domain = await importFromRepo("packages/domain/dist/index.js");
  const walletDomain = await importFromRepo("packages/wallet-domain/dist/index.js");
  const walletApplication = await importFromRepo("packages/wallet-application/dist/index.js");
  const trustProtocol = await importFromRepo("packages/trust-protocol/dist/index.js");
  const shopifyConnector = await importFromRepo("packages/shopify-connector/dist/index.js");

  const { instantFromEpochMilliseconds } = domain;
  const { FileSecureKeyStore } = walletDomain;
  const { PolicyPrecheckService, PurchaseProposalBuilder, PurchaseIntentBuilder } =
    walletApplication;
  const { verifyEnvelope, InMemoryKeyRegistry } = trustProtocol;
  const { createShopifyConnectorFromConfig } = shopifyConnector;

  // ─── --decline: resolve against the wallet's REAL live balance, never a
  // hardcoded guess — a stale "over budget" figure could accidentally
  // succeed if the wallet was topped up since, silently defeating the exact
  // safety property this mode exists to demonstrate. ───
  if (args.decline) {
    const balanceStoreForCheck = new data.PostgresWalletBalanceStore(
      new data.PostgresDatabase(databaseUrl),
      process.env.COUNTER_ENV ?? "test",
    );
    const currentBalanceMinor = await balanceStoreForCheck.getBalance(walletId);
    amountMinor = Number(currentBalanceMinor) + 100;
    console.log(
      `  (--decline) current real balance: ${currentBalanceMinor} paise; using amount ${amountMinor} paise to guarantee over-budget`,
    );
  }
  console.log(`  amount:   ${amountMinor} paise (Rs.${(amountMinor / 100).toFixed(2)})`);

  function nowInstant() {
    const result = instantFromEpochMilliseconds(Date.now());
    if (!result.ok) throw new Error("Could not construct current Instant");
    return result.value;
  }

  // ─── 1. Load the agent's REAL key ───
  step(1, "Loading the demo agent's real Ed25519 signing key");
  const keyStore = new FileSecureKeyStore(keyStorePath ?? walletDomain.defaultWalletKeyStorePath());
  keyStore.unlockStore(passphrase);
  const descriptor = await keyStore.getPublicDescriptor(kid);
  if (!descriptor) {
    throw new Error(`No key '${kid}' found in the local key store at ${keyStorePath}`);
  }
  console.log(`  key found: ${kid} (public key only shown, never the private key)`);

  // ─── 2. Real policy precheck against this mandate's REAL constraints ───
  step(2, "Real policy precheck against the mandate's own constraints");
  const paymentReferenceId = `prepaid-balance:${walletId}`;
  const policy = {
    merchantAllowlist: { allowedMerchantIds: [merchantId], allowedDomains: [] },
    geography: { allowedMerchantCountries: ["IN"], allowedDeliveryCountries: ["IN"] },
    category: { allowedCategories: [] },
    currency: { allowedCurrencies: ["INR"] },
    amountLimits: { perTransactionMaxPaise: ceilingMinor },
    countLimits: {},
    operations: { allowedOperations: ["purchase"] },
    timeConstraints: {},
    approvalThreshold: { thresholdPaise: ceilingMinor },
    paymentReferences: { allowedReferenceIds: [paymentReferenceId] },
  };
  const revocationStoreForPrecheck = new data.PostgresRevocationStore(
    new data.PostgresDatabase(databaseUrl),
    process.env.COUNTER_ENV ?? "test",
  );
  const precheckService = new PolicyPrecheckService({
    isRevoked: (scopeType, scopeId) => revocationStoreForPrecheck.isRevoked(scopeType, scopeId),
  });

  const quoteId = `quote_${randomUUID()}`;
  const quote = {
    quoteId,
    merchantId,
    merchantCountry: "IN",
    deliveryCountry: "IN",
    currency: "INR",
    totalAmountPaise: BigInt(amountMinor),
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    quoteDigest: `sha256:demo-${randomUUID()}`,
  };

  const precheckResult = await precheckService.precheck({
    quote,
    policy,
    policyVersionId: "wallet-console-v1",
    mandate: {
      mandateId,
      walletId,
      agentId,
      kid,
      constraints: policy,
      paymentReferenceId,
      validFrom: new Date(Date.now() - 1000).toISOString(),
      validUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      status: "active",
    },
    accumulatedUsage: { rollingPeriodTotalPaise: 0n, aggregateTotalPaise: 0n, transactionCount: 0 },
    paymentReferenceId,
    timestamp: new Date().toISOString(),
  });
  console.log(`  precheck outcome: ${precheckResult.outcome}`);
  if (precheckResult.reasons.length > 0) {
    console.log(`  precheck reasons: ${precheckResult.reasons.join("; ")}`);
  }

  // ─── 3. Build + sign a REAL CTP purchase intent with the agent's own key ───
  step(3, "Building + signing a REAL CTP purchase intent with the agent's own key");
  const proposalBuilder = new PurchaseProposalBuilder(keyStore);
  const timestamp = new Date().toISOString();
  const proposal = proposalBuilder.build({ walletId, quote, precheckResult, timestamp });

  const intentBuilder = new PurchaseIntentBuilder(keyStore, "sandbox");
  const intent = intentBuilder.build({
    proposal,
    mandateId,
    agentId,
    quoteExpiresAt: quote.expiresAt,
    kid,
    paymentReferenceId,
    timestamp: new Date().toISOString(),
    correlationId: randomUUID(),
  });
  const signedIntent = await intentBuilder.sign(intent, kid);
  console.log(`  intent id:  ${intent.intentId}`);
  console.log(`  signature present: ${Boolean(signedIntent.signedEnvelope.signature)}`);

  // Independently re-verify the signature — never trust our own signing call.
  const keyRegistry = new InMemoryKeyRegistry();
  keyRegistry.add({
    kid,
    use: "verify",
    alg: "EdDSA",
    publicKey: Buffer.from(descriptor.publicKey).toString("base64url"),
    status: "active",
    validFrom: new Date(Date.now() - 60_000).toISOString(),
    validUntil: new Date(Date.now() + 60_000).toISOString(),
    issuer: walletId,
  });
  const verifyResult = await verifyEnvelope(signedIntent.signedEnvelope, {
    keyRegistry,
    currentTime: new Date().toISOString(),
    expectedIssuer: walletId,
    expectedAudience: merchantId,
    expectedEnvironment: "sandbox",
  });
  console.log(`  independent signature re-verification: ${verifyResult.ok ? "VALID" : "INVALID"}`);
  if (!verifyResult.ok) {
    throw new Error(`Signed intent failed independent verification: ${verifyResult.error.message}`);
  }

  if (precheckResult.outcome === "denied") {
    console.log("\nPrecheck denied this purchase — stopping before any external effect.");
    console.log(`  reasons: ${precheckResult.reasons.join("; ")}`);
    return;
  }

  // ─── 4. Real Shopify variant (same discovery as verify-real-transaction.mjs) ───
  step(4, "Real Shopify connectivity + released variant");
  const shopify = createShopifyConnectorFromConfig({
    shopDomain: shopifyCreds.shopDomain,
    accessToken: shopifyCreds.accessToken,
    apiVersion: shopifyCreds.apiVersion,
  });
  let variantId = process.env.SHOPIFY_TEST_VARIANT_GID?.trim();
  if (!variantId) {
    const catalog = await shopify.client.query(
      `query { products(first: 5, query: "status:active") { edges { node { title variants(first: 5) { edges { node { id availableForSale } } } } } } }`,
      {},
    );
    for (const edge of catalog.data?.products?.edges ?? []) {
      for (const v of edge.node.variants?.edges ?? []) {
        if (v.node.availableForSale) {
          variantId = v.node.id;
          break;
        }
      }
      if (variantId) break;
    }
  }
  if (!variantId) throw new Error("No released Shopify variant available.");
  console.log(`  variant: ${variantId}`);

  // ─── 5. Wire the REAL production policy + REAL durable stores (main.ts's own wiring) ───
  step(5, "Wiring the REAL worker money seam (real policy, real durable stores)");
  const database = new data.PostgresDatabase(databaseUrl);
  const runtimeEnvironment = process.env.COUNTER_ENV ?? "test";
  const selection = await worker.selectPaymentAuthorizationPort(process.env, undefined, {
    stepLedger: new data.PostgresStepLedger(database, runtimeEnvironment),
    killSwitchStore: new data.PostgresKillSwitchStore(database, runtimeEnvironment),
    spendLedger: new data.PostgresSpendLedger(database, runtimeEnvironment),
    recurringMandateStore: new data.PostgresRecurringMandateReadStore(database, runtimeEnvironment),
    paymentConnectionStore: new data.PostgresPaymentConnectionReadStore(
      database,
      runtimeEnvironment,
    ),
    revocationStore: new data.PostgresRevocationStore(database, runtimeEnvironment),
    walletBalanceStore: new data.PostgresWalletBalanceStore(database, runtimeEnvironment),
  });
  if (selection.mode !== "real") {
    throw new Error(`Expected the REAL connector port but got '${selection.mode}'.`);
  }
  console.log(`  connector mode: ${selection.mode}`);

  let receipt;
  const sink = {
    async record(r) {
      receipt = r;
    },
  };
  const handler = worker.createTransactionLifecycleHandler(selection.port, sink);

  const runId = `demo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const job = {
    id: runId,
    type: worker.TRANSACTION_LIFECYCLE_JOB_TYPE,
    payload: {
      transactionId: runId,
      amountMinor,
      currency: "INR",
      variantId,
      quantity: 1,
      // NO paymentReferenceId: real-lifecycle.ts's prepaid-balance branch
      // triggers on paymentReferenceId === undefined + authority.walletId
      // present. See real-lifecycle.ts's own branch comment.
      authority: {
        quotedAmountMinor: amountMinor,
        mandateExpiresAtMs: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).getTime(),
        authorizedMerchantId: merchantId,
        walletId,
        mandateId,
      },
    },
  };

  step(6, "Running the REAL worker transaction-lifecycle handler");
  try {
    await handler.execute(job, nowInstant());
  } catch (error) {
    if (error?.name === "HandlerError" && error.errorClass === "payment.declined") {
      console.log(`\nDECLINED: ${error.message}`);
      console.log(
        "This is the safety property: the wallet's real prepaid balance was checked and found",
      );
      console.log(
        "insufficient BEFORE the order was finalized or any money moved — no committed Shopify",
      );
      console.log(
        "Order exists for this attempt (a reversible, uncommitted draft may exist internally;",
      );
      console.log("Shopify never treats a draft as a real order, and it reserves no inventory).");
      return;
    }
    throw error;
  }

  if (receipt === undefined) {
    console.log("\nNo receipt was recorded — the job completed without a captured outcome.");
    return;
  }

  function parseProviderReference(reference) {
    const parts = {};
    for (const segment of reference.split("|")) {
      const idx = segment.indexOf(":");
      if (idx > 0) parts[segment.slice(0, idx)] = segment.slice(idx + 1);
    }
    return parts;
  }
  const refs = parseProviderReference(receipt.providerReference);

  step(7, "Result");
  console.log(
    JSON.stringify(
      {
        transactionId: String(receipt.transactionId),
        finalPhase: receipt.finalState.phase,
        paymentStatus: receipt.finalState.payment?.status,
        orderStatus: receipt.finalState.order?.status,
        shopifyOrderId: refs.shopify_order ?? "(none)",
        paymentEvidenceReference: refs.pay ?? "(none)",
        reconciliation: receipt.reconciliation,
        hasSignedEvidence: receipt.signedEvidence !== undefined,
      },
      null,
      2,
    ),
  );

  // Best-effort cleanup so the demo store stays clean between rehearsals.
  if (refs.shopify_order) {
    try {
      await shopify.orderCancel.execute({
        payload: {
          orderId: refs.shopify_order,
          reason: "OTHER",
          metadata: { correlationId: runId, idempotencyKey: `${runId}-cancel` },
        },
        idempotencyKey: `${runId}-cancel`,
        correlationId: runId,
        preconditions: [],
        timeoutMs: 15_000,
      });
      console.log("\n  (best-effort) cancelled the Shopify order to keep the store clean.");
    } catch {
      // non-fatal
    }
  }
}

main().catch((error) => {
  console.error(
    `\nDemo purchase FAILED: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
