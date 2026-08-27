#!/usr/bin/env node
/**
 * On-demand end-to-end REAL transaction verification.
 *
 * Runs ONE complete real checkout against the REAL Shopify test store and the
 * REAL Razorpay test API, driving the SAME connector factories and worker
 * lifecycle wiring that `apps/worker` uses in production (FEAT-003):
 *
 *   - @counter/shopify-connector  createShopifyConnectorFromConfig
 *   - @counter/razorpay-adapter   createRealRazorpayProvider
 *   - @counter/payment-sdk        CounterTestPaymentProvider (CTP-signed)
 *   - @counter/worker             selectPaymentAuthorizationPort +
 *                                 createTransactionLifecycleHandler
 *
 * This script does NOT re-implement the lifecycle. It builds the connectors via
 * the worker's own `selectPaymentAuthorizationPort` (the exact real
 * PaymentAuthorizationPort the worker wires) and invokes it through the real
 * transaction-lifecycle handler, so what runs here is exactly the money seam
 * the worker runs.
 *
 * PREREQUISITE: run `pnpm build` first. This script imports the BUILT package
 * entrypoints (the compiled `dist/` output of the workspace packages). They are
 * loaded by their built entrypoint path so the script needs no extra dependency
 * wiring; each entrypoint resolves its own transitive `@counter/*` dependencies
 * from its package's node_modules.
 *
 * GATING: if any required real credential is absent the script prints a clear
 * SKIPPED message and exits 0. It is intentionally NOT wired into the default
 * test/build/CI path. Invoke on demand with `pnpm verify:real`.
 *
 * SECURITY: no secret value is ever printed. Only provider references, amounts,
 * statuses, and the CTP-signed receipt are logged. Credentials are read from
 * the environment and passed straight into the connector factories.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Import a built workspace entrypoint by its dist path from the repo root. */
async function importBuilt(relativeDistPath) {
  const absolute = resolve(repoRoot, relativeDistPath);
  try {
    return await import(pathToFileURL(absolute).href);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to import built entrypoint '${relativeDistPath}'. Did you run \`pnpm build\` first? (${message})`,
    );
  }
}

// ─── Credential gating (kept free of heavy imports) ──────────────────────────

const env = process.env;
const worker = await importBuilt("apps/worker/dist/index.js");
const shopifyCreds = worker.resolveShopifyCredentials(env);
const razorpayCreds = worker.resolveRazorpayCredentials(env);

if (shopifyCreds === null || razorpayCreds === null) {
  // Never print any secret value; only report which family of creds is absent.
  const missing = [];
  if (shopifyCreds === null) {
    missing.push("Shopify (SHOPIFY_STORE_DOMAIN/SHOPIFY_SHOP_DOMAIN + SHOPIFY_ACCESS_TOKEN)");
  }
  if (razorpayCreds === null) {
    missing.push("Razorpay (RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET + RAZORPAY_WEBHOOK_SECRET)");
  }
  console.log("SKIPPED: real credentials not present.");
  console.log(`  Missing: ${missing.join(", ")}`);
  console.log("  This on-demand verification only runs when real connector credentials are set.");
  process.exit(0);
}

// ─── Real path imports (only reached when creds are present) ─────────────────

const shopifyConnector = await importBuilt("packages/shopify-connector/dist/index.js");
const domain = await importBuilt("packages/domain/dist/index.js");

const { createShopifyConnectorFromConfig } = shopifyConnector;
const {
  selectPaymentAuthorizationPort,
  createTransactionLifecycleHandler,
  TRANSACTION_LIFECYCLE_JOB_TYPE,
} = worker;
const { instantFromEpochMilliseconds } = domain;

// ─── Small helpers ───────────────────────────────────────────────────────────

/** A stable-within-run, unique-per-run idempotency/transaction reference. */
const runId = `verify-real-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
/** Small INR amount in minor units (paise). Defaults to Rs.1.00. */
const AMOUNT_MINOR = Number.parseInt(env.VERIFY_REAL_AMOUNT_MINOR ?? "100", 10);
const CURRENCY = "INR";
const TIMEOUT_MS = 15_000;

function step(label, title) {
  console.log(`\n[${label}] ${title}`);
}

/** Current time as a domain Instant (only constructed on the real path). */
function nowInstant() {
  const result = instantFromEpochMilliseconds(Date.now());
  if (!result.ok) {
    throw new Error("Could not construct current Instant");
  }
  return result.value;
}

/** Parse the worker providerReference "pay:...|shopify_order:...|razorpay_order:...". */
function parseProviderReference(reference) {
  const parts = {};
  for (const segment of reference.split("|")) {
    const idx = segment.indexOf(":");
    if (idx > 0) {
      parts[segment.slice(0, idx)] = segment.slice(idx + 1);
    }
  }
  return parts;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Counter :: REAL transaction verification");
  console.log(`  run id (idempotency key): ${runId}`);
  console.log(`  amount: ${AMOUNT_MINOR} minor (${CURRENCY})`);

  // Build the SAME real Shopify connector the worker builds. Used here for the
  // standalone connectivity/catalog probe (step 1), the authoritative order
  // query (step 6), and best-effort cleanup at the end. The transaction itself
  // is driven by the worker's own selected port (below).
  const shopify = createShopifyConnectorFromConfig({
    shopDomain: shopifyCreds.shopDomain,
    accessToken: shopifyCreds.accessToken,
    apiVersion: shopifyCreds.apiVersion,
  });

  // Step 1: Shopify connectivity + released product/variant selection.
  step(1, "Shopify connectivity + released product/variant");
  const shopResponse = await shopify.client.query(
    `query VerifyShop { shop { name myshopifyDomain currencyCode } }`,
    {},
  );
  if (shopResponse.errors && shopResponse.errors.length > 0) {
    throw new Error(
      `Shopify connectivity failed: ${shopResponse.errors.map((e) => e.message).join("; ")}`,
    );
  }
  const shop = shopResponse.data?.shop;
  console.log(`  shop: ${shop?.name} (${shop?.myshopifyDomain}) currency=${shop?.currencyCode}`);

  let variantId = env.SHOPIFY_TEST_VARIANT_GID?.trim();
  if (variantId === undefined || variantId.length === 0) {
    const catalog = await shopify.client.query(
      `query VerifyReleasedVariant {
        products(first: 5, query: "status:active") {
          edges { node {
            id title status
            variants(first: 5) { edges { node { id title availableForSale } } }
          } }
        }
      }`,
      {},
    );
    if (catalog.errors && catalog.errors.length > 0) {
      throw new Error(`Catalog query failed: ${catalog.errors.map((e) => e.message).join("; ")}`);
    }
    const edges = catalog.data?.products?.edges ?? [];
    for (const productEdge of edges) {
      const product = productEdge.node;
      for (const variantEdge of product.variants?.edges ?? []) {
        if (variantEdge.node?.availableForSale === true) {
          variantId = variantEdge.node.id;
          console.log(`  selected product: ${product.title} (${product.id})`);
          console.log(`  selected variant: ${variantEdge.node.title} (${variantId})`);
          break;
        }
      }
      if (variantId !== undefined && variantId.length > 0) {
        break;
      }
    }
  } else {
    console.log(`  using SHOPIFY_TEST_VARIANT_GID override: ${variantId}`);
  }

  if (variantId === undefined || variantId.length === 0) {
    throw new Error(
      "No released Shopify variant available. Set SHOPIFY_TEST_VARIANT_GID to a purchasable variant GID.",
    );
  }

  // Build the REAL worker port (same wiring the worker uses).
  // selectPaymentAuthorizationPort resolves creds and wires the real Shopify
  // connector + real Razorpay provider + CTP-signed CounterTestPaymentProvider,
  // returning the exact PaymentAuthorizationPort the worker drives. Steps 2-8
  // happen INSIDE authorizeAndCapture -- we do not re-implement them here.
  const selected = selectPaymentAuthorizationPort(env);
  if (selected.mode !== "real") {
    throw new Error(
      `Expected the worker to select the REAL connector port but it selected '${selected.mode}'.`,
    );
  }
  console.log(`  worker selected connector mode: ${selected.mode}`);

  // Drive the FULL worker transaction-lifecycle handler. This runs the real
  // durable state machine and the real money seam, and records the final signed
  // receipt via the sink.
  let receipt;
  const sink = {
    async record(r) {
      receipt = r;
    },
  };
  const handler = createTransactionLifecycleHandler(selected.port, sink);

  const job = {
    id: runId,
    type: TRANSACTION_LIFECYCLE_JOB_TYPE,
    payload: {
      transactionId: runId,
      amountMinor: AMOUNT_MINOR,
      currency: CURRENCY,
      variantId,
      quantity: 1,
    },
  };

  console.log("\n  -> running the worker transaction-lifecycle handler (real connectors)...");
  await handler.execute(job, nowInstant());

  if (receipt === undefined) {
    throw new Error("The lifecycle handler did not emit a receipt.");
  }

  // The worker's providerReference carries the real provider identifiers
  // produced during authorizeAndCapture (payment / shopify order / razorpay).
  const refs = parseProviderReference(receipt.providerReference);
  const shopifyOrderId = refs.shopify_order;

  // Step 2: REAL Shopify draft order.
  step(2, "REAL Shopify draft order (created inside the lifecycle)");
  console.log(`  finalized shopify order id: ${shopifyOrderId ?? "(n/a)"}`);

  // Step 3: REAL Razorpay test order.
  step(3, "REAL Razorpay test order (POST /v1/orders)");
  console.log(`  razorpay order id: ${refs.razorpay_order ?? "(n/a)"}`);

  // Step 4: unattended CTP-signed payment evidence.
  step(4, "Unattended CTP-signed payment evidence");
  console.log(`  payment reference: ${refs.pay ?? "(n/a)"}`);
  console.log(`  payment state: ${receipt.finalState.payment?.status ?? "(n/a)"}`);

  // Step 5: REAL Shopify finalize + mark-as-paid.
  step(5, "REAL Shopify finalize + mark-as-paid (inside the lifecycle)");
  console.log(`  order committed to state: ${receipt.finalState.order?.status ?? "(n/a)"}`);

  // Step 6: REAL Shopify OrderQuery as authoritative evidence.
  step(6, "REAL Shopify OrderQuery (authoritative evidence)");
  if (shopifyOrderId !== undefined) {
    const queryOutcome = await shopify.orderQuery.execute({
      payload: {
        orderId: shopifyOrderId,
        metadata: { correlationId: runId, idempotencyKey: runId },
      },
      idempotencyKey: runId,
      correlationId: runId,
      preconditions: [],
      timeoutMs: TIMEOUT_MS,
    });
    if (queryOutcome.status === "succeeded") {
      const order = queryOutcome.result;
      console.log(`  order name: ${order.name}`);
      console.log(`  financial status: ${order.status}`);
      console.log(`  total: ${order.totalPrice} ${order.currencyCode}`);
    } else {
      console.log(`  order query outcome: ${queryOutcome.status}`);
    }
  } else {
    console.log("  no shopify order id to query.");
  }

  // Step 7: reconciliation.
  step(7, "Reconciliation (intended vs provider amount)");
  console.log(`  intended amount minor:  ${receipt.reconciliation.intendedAmountMinor}`);
  console.log(`  provider amount minor:  ${receipt.reconciliation.providerAmountMinor}`);
  console.log(`  reconciled: ${receipt.reconciliation.reconciled}`);

  // Step 8: the FINAL signed receipt.
  step(8, "FINAL signed receipt");
  console.log(
    JSON.stringify(
      {
        transactionId: String(receipt.transactionId),
        finalPhase: receipt.finalState.phase,
        paymentStatus: receipt.finalState.payment?.status,
        orderStatus: receipt.finalState.order?.status,
        providerReference: receipt.providerReference,
        reconciliation: receipt.reconciliation,
      },
      null,
      2,
    ),
  );

  // Best-effort cleanup: cancel the order to leave the store clean.
  step("cleanup", "Best-effort order cancellation (leave store clean)");
  if (shopifyOrderId !== undefined) {
    try {
      const cancelOutcome = await shopify.orderCancel.execute({
        payload: {
          orderId: shopifyOrderId,
          reason: "OTHER",
          metadata: { correlationId: runId, idempotencyKey: `${runId}-cancel` },
        },
        idempotencyKey: `${runId}-cancel`,
        correlationId: runId,
        preconditions: [],
        timeoutMs: TIMEOUT_MS,
      });
      console.log(`  cancel outcome: ${cancelOutcome.status}`);
    } catch (error) {
      console.log(
        `  cancel best-effort failed (non-fatal): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } else {
    console.log("  nothing to cancel.");
  }

  console.log("\nREAL transaction verification complete.");
}

main().catch((error) => {
  // Never print secrets; surface only the error message.
  console.error(
    `\nREAL transaction verification FAILED: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
