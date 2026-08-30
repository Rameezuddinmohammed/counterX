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
import { resolveCounterEnvironment, type Environment } from "@counter/domain";
import { PostgresDatabase } from "@counter/data";
import { createServer, APP_NAME, type CreateServerOptions } from "./index.js";
import { createPostgresPolicyStore } from "./policy-store-postgres.js";
import { createPostgresTransactionStore } from "./transaction-store-postgres.js";
import {
  ShopifyConnectionProvisioner,
  type ShopifyOAuthConfig,
} from "./shopify-connection-store.js";

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

const serverOptions: CreateServerOptions = {
  logger: true,
  environment,
  version: process.env["APP_VERSION"] || "0.1.0",
  ...(database !== undefined
    ? {
        policyStore: createPostgresPolicyStore(database, runtimeEnvironment),
        transactionStore: createPostgresTransactionStore(database, runtimeEnvironment),
        ...(shopifyOAuthConfig !== undefined
          ? {
              shopifyConnectionProvisioner: new ShopifyConnectionProvisioner(
                database,
                runtimeEnvironment,
                shopifyOAuthConfig,
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
