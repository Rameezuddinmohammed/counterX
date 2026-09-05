/**
 * Makes ONE merchant genuinely discoverable to a buyer agent, by walking the
 * REAL onboarding lifecycle from wherever it currently is up to ACTIVE.
 *
 * WHY THIS EXISTS: a buyer agent only ever sees merchants that satisfy all
 * three conditions in apps/agent-runtime/src/merchant-directory-store.ts —
 * lifecycle_state = 'ACTIVE', an active row in merchant.shopify_connections,
 * and a row in merchant.capability_manifests. The self-serve path that would
 * normally produce the Shopify connection is NOT available on the deployed
 * control-plane-api (it boots with "Shopify OAuth app credentials not
 * configured -- self-serve Shopify connect routes are not registered"), so
 * without this script a demo merchant can never become visible.
 *
 * WHAT IT DOES *NOT* DO: bypass the state machine. Every lifecycle transition
 * below goes through the same real store the HTTP route uses, which in turn
 * goes through transitionMerchantLifecycle() (packages/merchant-application/
 * src/lifecycle.ts). An illegal transition is rejected here exactly as it
 * would be in the product. The legal path is:
 *
 *   DRAFT -> CONNECTING -> MAPPING -> VERIFYING -> SANDBOX_READY
 *         -> ACTIVATION_REVIEW -> ACTIVE
 *
 *   updateBusinessBasics    DRAFT            -> CONNECTING
 *   markCatalogConnected    CONNECTING       -> MAPPING          (requires an active
 *                                                                Shopify connection OR
 *                                                                a manual catalog item)
 *   confirmCatalog          MAPPING          -> VERIFYING
 *   readiness.evaluate      VERIFYING        -> SANDBOX_READY    (only when NO blocking
 *                                                                checks remain)
 *   manifest.generateAndPersist SANDBOX_READY -> ACTIVATION_REVIEW (+ writes the manifest
 *                                                                  in the same transaction)
 *   activation.approve      ACTIVATION_REVIEW -> ACTIVE          (operator-only in the
 *                                                                product)
 *
 * THE ONE RAW WRITE, disclosed rather than hidden: the
 * merchant.shopify_connections row. Its only writer in the product is
 * ShopifyConnectionProvisioner.completeAuthorization(), which needs a real
 * Shopify OAuth code exchange this deployment cannot perform. Direct
 * parameterized SQL is that table's own documented convention (migration
 * 0013: "written exclusively via parameterized SQL from a role that bypasses
 * RLS"), and standing in for an unreachable HTTP route is the same judgment
 * call scripts/approve-merchant-activation.mjs already documents. Every
 * CHECK constraint on the table still applies -- notably the shop_domain
 * format and the FK to merchant.scopes.
 *
 * SAFETY: additive and idempotent. It never DELETEs, never DROPs, never
 * migrates, and every step is skipped when already satisfied, so re-running
 * is a no-op. Defaults to a DRY RUN; pass --yes to actually write.
 *
 * PREREQUISITES (imports compiled dist, same convention as every script here):
 *   pnpm --filter @counter/domain build
 *   pnpm --filter @counter/data build
 *   pnpm --filter @counter/merchant-application build
 *   pnpm --filter @counter/trust-protocol build
 *   pnpm --filter @counter/control-plane-api build
 *
 * Usage:
 *   node scripts/seed-demo-merchant.mjs --merchant-id ctr_merchant_...            # dry run
 *   node scripts/seed-demo-merchant.mjs --merchant-id ctr_merchant_... --yes      # apply
 *
 * Optional:
 *   --shop-domain <x.myshopify.com>   defaults to SHOPIFY_STORE_DOMAIN
 *   --access-token <token>            defaults to SHOPIFY_ACCESS_TOKEN
 *   --entity-name "Acme Apparel"      defaults to "Counter Demo Apparel"
 *   --contact-email you@example.com   defaults to demo@counter.dev
 *   --operator-id ctr_operator_...    defaults to a freshly generated id
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { randomBytes } from "node:crypto";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const importFromRepo = (p) => import(pathToFileURL(resolve(repoRoot, p)).href);

// .env is the source of truth for DATABASE_URL here, deliberately OVERRIDING
// any inherited shell value. An earlier session lost a lot of time to a stale
// exported DATABASE_URL silently redirecting reads at a local throwaway
// container while every message claimed to be talking to the real database.
// The resolved host is printed below so that can never happen quietly again.
const envFromFile = new Map();
for (const line of readFileSync(resolve(repoRoot, ".env"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) envFromFile.set(m[1], m[2].replace(/^"|"$/g, ""));
}
const fromEnvFile = (key) => envFromFile.get(key) ?? process.env[key];

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const apply = args.yes === true;
const merchantId = args["merchant-id"];
if (!merchantId) {
  console.error(
    "Usage: node scripts/seed-demo-merchant.mjs --merchant-id <ctr_merchant_...> [--yes]",
  );
  process.exit(1);
}

const databaseUrl = fromEnvFile("DATABASE_URL");
if (!databaseUrl) throw new Error("DATABASE_URL is required (checked .env then process env)");
const environment = fromEnvFile("COUNTER_ENV") ?? "test";
const shopDomain = args["shop-domain"] ?? fromEnvFile("SHOPIFY_STORE_DOMAIN");
const accessToken = args["access-token"] ?? fromEnvFile("SHOPIFY_ACCESS_TOKEN");
const entityName = args["entity-name"] ?? "Counter Demo Apparel";
const contactEmail = args["contact-email"] ?? "demo@counter.dev";
const goodsType = args["goods-type"] ?? "fulfillment.physical.ship";
const razorpayKeyId = args["razorpay-key-id"] ?? fromEnvFile("RAZORPAY_KEY_ID");
const razorpayKeySecret = args["razorpay-key-secret"] ?? fromEnvFile("RAZORPAY_KEY_SECRET");
const razorpayBaseUrl = fromEnvFile("RAZORPAY_BASE_URL");

if (!shopDomain) throw new Error("No --shop-domain and no SHOPIFY_STORE_DOMAIN in .env");
if (!accessToken) throw new Error("No --access-token and no SHOPIFY_ACCESS_TOKEN in .env");

const { PostgresDatabase } = await importFromRepo("packages/data/dist/database.js");
const { createCounterId } = await importFromRepo("packages/domain/dist/ids.js");
const { MerchantApplicationProvisioner } = await importFromRepo(
  "apps/control-plane-api/dist/merchant-application-store.js",
);
const { createPostgresPolicyStore } = await importFromRepo(
  "apps/control-plane-api/dist/policy-store-postgres.js",
);
const { createDefaultPolicyCompiler } = await importFromRepo(
  "apps/control-plane-api/dist/policy-routes.js",
);
const { MerchantReadinessService } = await importFromRepo(
  "apps/control-plane-api/dist/merchant-readiness-store.js",
);
const { MerchantManifestStore } = await importFromRepo(
  "apps/control-plane-api/dist/merchant-manifest-store.js",
);
const { MerchantActivationStore } = await importFromRepo(
  "apps/control-plane-api/dist/merchant-activation-store.js",
);
const { MerchantPaymentConnectionStore } = await importFromRepo(
  "apps/control-plane-api/dist/merchant-payment-connection-store.js",
);

let operatorId = args["operator-id"];
if (!operatorId) {
  const generated = createCounterId("operator", randomBytes(16));
  if (!generated.ok) throw new Error("Failed to generate an operator id");
  operatorId = generated.value;
}

const database = new PostgresDatabase(databaseUrl);

const step = (n, msg) => console.log(`\n[${n}] ${msg}`);
const ok = (msg) => console.log(`    OK    ${msg}`);
const skip = (msg) => console.log(`    SKIP  ${msg}`);
const plan = (msg) => console.log(`    WOULD ${msg}`);
const warn = (msg) => console.log(`    WARN  ${msg}`);

try {
  const serverInfo = await database.query(
    "SELECT current_database() db, coalesce(inet_server_addr()::text,'unix') addr, substring(version(),1,22) v",
  );
  const host = (() => {
    try {
      return new URL(databaseUrl).host;
    } catch {
      return "(unparseable)";
    }
  })();

  console.log("=".repeat(72));
  console.log(`TARGET DATABASE : ${host}`);
  console.log(`  server        : ${JSON.stringify(serverInfo.rows[0])}`);
  console.log(`  environment   : ${environment}`);
  console.log(`MERCHANT        : ${merchantId}`);
  console.log(`SHOP DOMAIN     : ${shopDomain}`);
  console.log(`MODE            : ${apply ? "APPLY (writes)" : "DRY RUN (no writes)"}`);
  console.log("=".repeat(72));

  const provisioner = new MerchantApplicationProvisioner(database, environment);
  const policyStore = createPostgresPolicyStore(database, environment);
  const policyCompiler = createDefaultPolicyCompiler();
  const readiness = new MerchantReadinessService(
    database,
    environment,
    policyStore,
    policyCompiler,
  );
  const manifests = new MerchantManifestStore(database, environment, readiness);
  const activation = new MerchantActivationStore(database, environment);

  const snapshot = await provisioner.getApplication(merchantId);
  if (snapshot === undefined) {
    console.error(
      `\nNo merchant application found for ${merchantId} in environment '${environment}'.`,
    );
    process.exit(1);
  }
  console.log(
    `\nCurrent lifecycle state: ${snapshot.lifecycleState} (v${snapshot.lifecycleVersion})`,
  );

  // ---------------------------------------------------------------- 1. Shopify
  step(1, "Shopify connection (merchant.shopify_connections)");
  const existing = await database.query(
    `SELECT shop_domain, status FROM merchant.shopify_connections
      WHERE environment = $1 AND merchant_id = $2`,
    [environment, merchantId],
  );
  if (existing.rows.length > 0 && existing.rows[0].status === "active") {
    skip(`already connected to ${existing.rows[0].shop_domain}`);
  } else if (!apply) {
    plan(`insert an active connection to ${shopDomain}`);
  } else {
    const now = new Date().toISOString();
    await database.query(
      `INSERT INTO merchant.shopify_connections
         (environment, merchant_id, shop_domain, access_token, granted_scope, status, connected_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'active', $6, $6)
       ON CONFLICT (environment, merchant_id) DO UPDATE
         SET shop_domain = EXCLUDED.shop_domain,
             access_token = EXCLUDED.access_token,
             granted_scope = EXCLUDED.granted_scope,
             status = 'active',
             updated_at = EXCLUDED.updated_at`,
      [
        environment,
        merchantId,
        shopDomain,
        accessToken,
        "read_products,read_orders,write_orders,read_inventory",
        now,
      ],
    );
    ok(`connected to ${shopDomain}`);
  }

  // ---------------------------------------------------------------- 1b. Razorpay
  // Required before readiness will pass: the readiness engine reports
  // payment_configured as *Blocking* when a merchant has no verified payment
  // connection, which pins the merchant at VERIFYING forever.
  //
  // Uses the real MerchantPaymentConnectionStore, which verifies the
  // credentials against Razorpay's own API before persisting — so this is a
  // genuinely verified connection, not a fabricated row.
  step("1b", "Razorpay payment connection (merchant.payment_connections)");
  const payments = new MerchantPaymentConnectionStore(
    database,
    environment,
    razorpayBaseUrl !== undefined ? { baseUrl: razorpayBaseUrl } : {},
  );
  const payStatus = await payments.getConnectionStatus(merchantId);
  if (payStatus.connected) {
    skip(`already connected (${payStatus.provider} ${payStatus.keyId ?? ""})`);
  } else if (!apply) {
    plan(`verify + connect Razorpay key ${String(razorpayKeyId).slice(0, 12)}...`);
  } else if (!razorpayKeyId || !razorpayKeySecret) {
    warn("no RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET available — readiness will stay Blocking");
  } else {
    try {
      await payments.connectRazorpay(merchantId, {
        keyId: razorpayKeyId,
        keySecret: razorpayKeySecret,
      });
      ok(`verified + connected Razorpay key ${razorpayKeyId.slice(0, 12)}...`);
    } catch (e) {
      warn(`Razorpay connect failed: ${e.message}`);
    }
  }

  // --------------------------------------------------------- 2..7 lifecycle
  const transitions = [
    {
      n: 2,
      from: "DRAFT",
      label: "business basics -> CONNECTING",
      run: () =>
        provisioner.updateBusinessBasics(merchantId, {
          legalEntityName: entityName,
          contactEmail,
          // goodsTypes are FulfillmentCapability values from
          // @counter/merchant-application, NOT free-text product categories —
          // "apparel" is rejected with "Unknown goods type". Shipped physical
          // apparel is fulfillment.physical.ship. Override with --goods-type.
          goodsTypes: [goodsType],
        }),
    },
    {
      n: 3,
      from: "CONNECTING",
      label: "catalog connected -> MAPPING",
      run: () => provisioner.markCatalogConnected(merchantId),
    },
    {
      n: 4,
      from: "MAPPING",
      label: "catalog confirmed -> VERIFYING",
      run: () => provisioner.confirmCatalog(merchantId),
    },
    {
      n: 5,
      from: "VERIFYING",
      label: "readiness evaluated -> SANDBOX_READY",
      run: async () => {
        const summary = await readiness.evaluate(merchantId);
        // ReadinessCheckView is { checkKind, status, reason } — see
        // merchant-readiness-store.ts. Print every check, not just the ones a
        // guessed-at "severity" field would have matched, so a stuck readiness
        // gate always explains itself.
        console.log(
          `    INFO  overall=${summary.overallStatus} isReady=${String(summary.isReady)}`,
        );
        for (const c of summary.checks ?? []) {
          console.log(`            [${c.status}] ${c.checkKind}: ${c.reason}`);
        }
        return summary;
      },
    },
    {
      n: 6,
      from: "SANDBOX_READY",
      label: "manifest generated -> ACTIVATION_REVIEW",
      run: () => manifests.generateAndPersist(merchantId),
    },
    {
      n: 7,
      from: "ACTIVATION_REVIEW",
      label: "operator approval -> ACTIVE",
      run: () => activation.approve(merchantId, operatorId, "demo seeding: buildathon merchant"),
    },
  ];

  for (const t of transitions) {
    step(t.n, t.label);
    const current = (await provisioner.getApplication(merchantId)).lifecycleState;
    if (current === "ACTIVE") {
      skip("already ACTIVE");
      continue;
    }
    if (current !== t.from) {
      skip(`state is ${current}, this step applies at ${t.from}`);
      continue;
    }
    if (!apply) {
      plan(`run ${t.label} (currently ${current})`);
      break; // a dry run cannot observe later states it never produced
    }
    try {
      await t.run();
      const after = (await provisioner.getApplication(merchantId)).lifecycleState;
      if (after === t.from) {
        warn(`state did not advance (still ${after}) — see any warnings above`);
        break;
      }
      ok(`${t.from} -> ${after}`);
    } catch (e) {
      warn(`failed: ${e.message}`);
      break;
    }
  }

  // ------------------------------------------------------------ 8. verify
  step(8, "Discoverability (the EXACT query a buyer agent runs)");
  const directory = await database.query(
    `SELECT a.merchant_id, a.legal_entity_name, a.lifecycle_state, m.capabilities
       FROM merchant.onboarding_applications a
       JOIN merchant.shopify_connections s
         ON s.environment = a.environment AND s.merchant_id = a.merchant_id AND s.status = 'active'
       JOIN merchant.capability_manifests m
         ON m.environment = a.environment AND m.merchant_id = a.merchant_id
      WHERE a.environment = $1 AND a.lifecycle_state = 'ACTIVE'`,
    [environment],
  );
  if (directory.rows.length === 0) {
    warn("NOT discoverable yet — merchant.list would still return nothing.");
    const final = await provisioner.getApplication(merchantId);
    const conn = await database.query(
      `SELECT count(*)::int n FROM merchant.shopify_connections
        WHERE environment=$1 AND merchant_id=$2 AND status='active'`,
      [environment, merchantId],
    );
    const man = await database.query(
      `SELECT count(*)::int n FROM merchant.capability_manifests
        WHERE environment=$1 AND merchant_id=$2`,
      [environment, merchantId],
    );
    console.log(
      `            lifecycle=${final.lifecycleState} shopifyConnection=${conn.rows[0].n} manifest=${man.rows[0].n}`,
    );
  } else {
    ok(`${directory.rows.length} merchant(s) now discoverable:`);
    for (const r of directory.rows) console.log("            " + JSON.stringify(r));
  }

  if (!apply) {
    console.log("\nDRY RUN — nothing was written. Re-run with --yes to apply.");
  }
} finally {
  await database.close();
}
