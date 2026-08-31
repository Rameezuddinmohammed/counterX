/**
 * Deployment entry point for control-plane-api.
 * Binds to 0.0.0.0 so the Fly.io proxy can reach the server.
 *
 * In production-like environments (anything other than local/test/development)
 * a durable Postgres-backed policy store is required: DATABASE_URL must be set
 * and a PostgresDatabase is constructed and injected into createServer. In
 * local/test/development the in-memory store is used unless DATABASE_URL is
 * provided.
 */
import {
  resolveCounterEnvironment,
  type Environment,
  type IsoCurrencyCode,
} from "@counter/domain";
import {
  PostgresDatabase,
  PostgresCursorStore,
  PostgresProductRepository,
  PostgresVariantRepository,
  PostgresPriceRepository,
  PostgresInventoryRepository,
} from "@counter/data";
import { createHttpGraphQLClient, CatalogSyncService } from "@counter/shopify-connector";
import { createServer, APP_NAME, type CreateServerOptions } from "./index.js";
import { createPostgresPolicyStore } from "./policy-store-postgres.js";
import { createDefaultPolicyCompiler } from "./policy-routes.js";
import { createPostgresTransactionStore } from "./transaction-store-postgres.js";
import { WalletUserProvisioner, type RuntimeCredentialConfig } from "./wallet-user-store.js";
import {
  createRealRazorpayProvider,
  createRealRazorpayRecurringMandateProvider,
} from "@counter/razorpay-adapter";
import { RecurringMandateProvisioner } from "./recurring-mandate-store.js";
import {
  ShopifyConnectionProvisioner,
  type ShopifyOAuthConfig,
} from "./shopify-connection-store.js";
import { RefundRequestStore } from "./refund-request-store.js";
import { MerchantApplicationProvisioner } from "./merchant-application-store.js";
import { MerchantPaymentConnectionStore } from "./merchant-payment-connection-store.js";
import { MerchantReadinessService } from "./merchant-readiness-store.js";
import { MerchantManifestStore } from "./merchant-manifest-store.js";

const port = parseInt(process.env["PORT"] || "8080", 10);
const environment = process.env["NODE_ENV"] || "production";

// Environments that may run without a durable database.
const IN_MEMORY_ELIGIBLE = ["local", "test", "development"].includes(environment);

const databaseUrl = process.env["DATABASE_URL"];

let database: PostgresDatabase | undefined;
const hasDatabaseUrl = databaseUrl !== undefined && databaseUrl.trim().length > 0;

if (!hasDatabaseUrl && !IN_MEMORY_ELIGIBLE) {
  // Fail loudly: a production-like deployment must not silently run on a
  // non-durable in-memory store.
  console.error(
    `[${APP_NAME}] DATABASE_URL is required in production-like environment '${environment}'`,
  );
  process.exit(1);
}

if (hasDatabaseUrl) {
  database = new PostgresDatabase(databaseUrl as string);
}

// The durable-data partition (bound into every policy/transaction query below)
// is resolved from COUNTER_ENV alone — NODE_ENV's vocabulary ("development")
// is a different, framework-level taxonomy, not a valid Counter environment.
// This is what makes the store here agree with what the worker actually
// writes; previously this read `environment` (NODE_ENV-derived, typically
// "production") while every writer hardcoded "local", so the merchant
// console's transaction/policy views could never show real data.
const runtimeEnvironmentResult = resolveCounterEnvironment(
  process.env["COUNTER_ENV"],
  !IN_MEMORY_ELIGIBLE,
);
if (!runtimeEnvironmentResult.ok) {
  console.error(`[${APP_NAME}] ${runtimeEnvironmentResult.error.message}`);
  process.exit(1);
}
const runtimeEnvironment: Environment = runtimeEnvironmentResult.value;

// Optional: self-serve buyers only get a fully working connect command when
// this deployment has the shared merchant-runtime M2M credential configured
// (see RuntimeCredentialConfig's docs in wallet-user-store.ts for the
// deliberate shared-credential trade-off this makes). Missing it degrades
// gracefully — key registration still works, the local script just falls
// back to printing "ask Counter for these two values".
const runtimeM2mClientId = process.env["AGENT_RUNTIME_M2M_CLIENT_ID"];
const runtimeM2mClientSecret = process.env["AGENT_RUNTIME_M2M_CLIENT_SECRET"];
const runtimeCredentialConfig: RuntimeCredentialConfig | undefined =
  runtimeM2mClientId !== undefined && runtimeM2mClientSecret !== undefined
    ? {
        clientId: runtimeM2mClientId,
        clientSecret: runtimeM2mClientSecret,
        runtimeUrl:
          process.env["COUNTER_AGENT_RUNTIME_URL"] || "https://counter-agent-runtime.fly.dev",
      }
    : undefined;

// Optional: recurring payment mandates (UPI Autopay / e-mandate) need the
// same Razorpay test-mode credentials the worker already uses for one-shot
// orders — reusing RAZORPAY_KEY_ID/KEY_SECRET rather than minting a new
// secret. Missing them degrades gracefully: the routes simply aren't
// registered (see index.ts's optional-provisioner pattern).
const razorpayKeyId = process.env["RAZORPAY_KEY_ID"];
const razorpayKeySecret = process.env["RAZORPAY_KEY_SECRET"];
const razorpayRecurringProvider =
  database !== undefined && razorpayKeyId !== undefined && razorpayKeySecret !== undefined
    ? createRealRazorpayRecurringMandateProvider({
        keyId: razorpayKeyId,
        keySecret: razorpayKeySecret,
        webhookSecret: process.env["RAZORPAY_WEBHOOK_SECRET"] || "",
        baseUrl: process.env["RAZORPAY_BASE_URL"] || "https://api.razorpay.com",
      })
    : undefined;

/**
 * Self-serve Shopify OAuth needs a real Shopify Partner app (API key +
 * secret) to exist. This deployment does not currently have one — unlike
 * DATABASE_URL, this is never treated as a fail-loud requirement in
 * production, because that would take the ENTIRE control-plane-api down
 * (policy/transaction routes included) over one still-optional feature.
 * Absent config simply means /control/v1/merchants/:merchantId/shopify/*
 * is not registered at all (see index.ts's shopifyConnectionProvisioner
 * option) — the same graceful-absence shape as walletUserProvisioner.
 */
const DEFAULT_SHOPIFY_OAUTH_SCOPES = "read_products,read_orders,write_orders";

function resolveShopifyOAuthConfig(): ShopifyOAuthConfig | undefined {
  const clientId = process.env["SHOPIFY_OAUTH_CLIENT_ID"]?.trim();
  const clientSecret = process.env["SHOPIFY_OAUTH_CLIENT_SECRET"]?.trim();
  const redirectUri = process.env["SHOPIFY_OAUTH_REDIRECT_URI"]?.trim();
  const scopes = process.env["SHOPIFY_OAUTH_SCOPES"]?.trim() || DEFAULT_SHOPIFY_OAUTH_SCOPES;

  if (!clientId || !clientSecret || !redirectUri) {
    console.log(
      `[${APP_NAME}] Shopify OAuth app credentials not configured ` +
        `(SHOPIFY_OAUTH_CLIENT_ID/SHOPIFY_OAUTH_CLIENT_SECRET/SHOPIFY_OAUTH_REDIRECT_URI) — ` +
        `self-serve Shopify connect routes are not registered.`,
    );
    return undefined;
  }
  return { clientId, clientSecret, redirectUri, scopes };
}

const shopifyOAuthConfig = resolveShopifyOAuthConfig();

// Optional: approving a refund request (the merchant-facing relay decision)
// needs the SAME Razorpay credentials — reusing razorpayKeyId/razorpayKeySecret
// above rather than a third credential set. Missing them degrades
// gracefully: the refund-request routes simply aren't registered, matching
// the recurring-mandate optional-provisioner pattern.
const razorpayRefundProvider =
  database !== undefined && razorpayKeyId !== undefined && razorpayKeySecret !== undefined
    ? createRealRazorpayProvider({
        keyId: razorpayKeyId,
        keySecret: razorpayKeySecret,
        webhookSecret: process.env["RAZORPAY_WEBHOOK_SECRET"] || "",
        baseUrl: process.env["RAZORPAY_BASE_URL"] || "https://api.razorpay.com",
      })
    : undefined;

// Shared with Step 5's MerchantReadinessService below, so a self-serve
// merchant's synthesized default policy (see merchant-readiness-store.ts's
// header) is written into and read from the SAME store/compiler
// policy-routes.ts's own GET/POST /merchants/:merchantId/policy routes use
// — never a second, shadow policy store.
const policyStore =
  database !== undefined ? createPostgresPolicyStore(database, runtimeEnvironment) : undefined;
const policyCompiler = createDefaultPolicyCompiler();

const readinessService =
  database !== undefined && policyStore !== undefined
    ? new MerchantReadinessService(database, runtimeEnvironment, policyStore, policyCompiler)
    : undefined;

// Kicks off a real product-catalog backfill the moment a merchant's Shopify
// OAuth connection completes, using the access token that connection just
// obtained (never persisted here, never logged - held only for the
// duration of this one call). Fire-and-forget by contract (see
// OnShopifyConnected's doc comment in shopify-connection-store.ts): a
// backfill failure must never surface as an OAuth callback error, since the
// connection itself is already durably saved by the time this runs. This
// is what makes the wizard's catalog-review step (packages/shopify-
// connector's CatalogSyncService + product-index.ts existed and were fully
// tested but wired to nothing before this) actually have real products to
// review.
//
// storeCurrency defaults to INR (CounterX is India-first; every other
// money-handling path in this codebase - recurring mandates, spend limits -
// is already INR-only per PILOT.md) rather than querying the merchant's
// real store currency, a real simplification worth revisiting once a
// non-INR merchant needs onboarding.
function createShopifyConnectedHandler(
  postgresDatabase: PostgresDatabase,
  targetEnvironment: Environment,
): (input: { merchantId: string; shopDomain: string; accessToken: string }) => void {
  const cursorStore = new PostgresCursorStore(postgresDatabase, targetEnvironment);
  const productRepo = new PostgresProductRepository(postgresDatabase, targetEnvironment);
  const variantRepo = new PostgresVariantRepository(postgresDatabase, targetEnvironment);
  const priceRepo = new PostgresPriceRepository(postgresDatabase, targetEnvironment);
  const inventoryRepo = new PostgresInventoryRepository(postgresDatabase, targetEnvironment);

  return (input): void => {
    const client = createHttpGraphQLClient({
      shopDomain: input.shopDomain,
      accessToken: input.accessToken,
    });
    const syncService = new CatalogSyncService(client, cursorStore);

    const runToCompletion = async (): Promise<void> => {
      // backfillProducts is budget-limited per call and saves a durable
      // resume cursor when it stops early - loop until the whole catalog
      // is fetched (hasMore: false) rather than syncing only the first
      // budget-limited chunk on a merchant's very first connection. Capped
      // to bound worst-case work against a pathologically large catalog or
      // a stuck cursor; the durable cursor means a later real sync
      // (webhook-driven incremental update, or a future manual resync)
      // picks up exactly where this leaves off either way.
      const MAX_ITERATIONS = 200;
      for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
        const result = await syncService.backfillProducts(input.merchantId, {
          pageSize: 50,
          costBudget: 5000,
          storeCurrency: "INR" as IsoCurrencyCode,
        });
        for (const product of result.products) {
          await productRepo.save(product);
          for (const variant of product.variants) {
            await variantRepo.save(variant);
          }
        }
        for (const price of result.prices) {
          await priceRepo.save(price);
        }
        for (const inventory of result.inventory) {
          await inventoryRepo.save(inventory);
        }
        if (!result.hasMore) {
          return;
        }
      }
      console.warn(
        `[${APP_NAME}] Catalog backfill for merchant ${input.merchantId} hit the ${String(MAX_ITERATIONS)}-iteration cap without completing - durable cursor saved, will resume on next sync`,
      );
    };

    void runToCompletion().catch((error: unknown) => {
      console.error(
        `[${APP_NAME}] Catalog backfill failed for merchant ${input.merchantId} after a successful Shopify connection`,
        error,
      );
    });
  };
}

const serverOptions: CreateServerOptions = {
  logger: true,
  environment,
  version: process.env["APP_VERSION"] || "0.1.0",
  ...(database !== undefined
    ? {
        ...(policyStore !== undefined ? { policyStore, policyCompiler } : {}),
        transactionStore: createPostgresTransactionStore(database, runtimeEnvironment),
        walletUserProvisioner: new WalletUserProvisioner(
          database,
          runtimeEnvironment,
          runtimeCredentialConfig,
        ),
        merchantApplicationProvisioner: new MerchantApplicationProvisioner(
          database,
          runtimeEnvironment,
        ),
        merchantPaymentConnectionStore: new MerchantPaymentConnectionStore(
          database,
          runtimeEnvironment,
          {
            ...(process.env["RAZORPAY_BASE_URL"]
              ? { baseUrl: process.env["RAZORPAY_BASE_URL"] }
              : {}),
          },
        ),
        ...(readinessService !== undefined
          ? {
              merchantReadinessService: readinessService,
              merchantManifestStore: new MerchantManifestStore(
                database,
                runtimeEnvironment,
                readinessService,
              ),
            }
          : {}),
        ...(razorpayRecurringProvider !== undefined
          ? {
              recurringMandateProvisioner: new RecurringMandateProvisioner(
                database,
                runtimeEnvironment,
                razorpayRecurringProvider,
              ),
            }
          : {}),
        ...(shopifyOAuthConfig !== undefined
          ? {
              shopifyConnectionProvisioner: new ShopifyConnectionProvisioner(
                database,
                runtimeEnvironment,
                shopifyOAuthConfig,
                createShopifyConnectedHandler(database, runtimeEnvironment),
              ),
            }
          : {}),
        ...(razorpayRefundProvider !== undefined
          ? {
              refundRequestStore: new RefundRequestStore(
                database,
                runtimeEnvironment,
                razorpayRefundProvider,
              ),
            }
          : {}),
      }
    : {}),
};

const server = createServer(serverOptions);

void server.listen({ port, host: "0.0.0.0" }).then((address) => {
  console.log(`${APP_NAME} listening on ${address}`);
});

process.on("SIGTERM", () => {
  void server.close().then(() => {
    if (database !== undefined) {
      return database.close();
    }
    return undefined;
  });
});
