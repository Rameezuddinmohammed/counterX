/**
 * Deployment entry point for agent-runtime.
 * Binds to 0.0.0.0 so the Fly.io proxy can reach the server.
 *
 * In production-like environments a durable Postgres idempotency store is
 * required: DATABASE_URL must be set and a PostgresDatabase is constructed and
 * injected into createServer. In local/test/development an in-memory store is
 * used unless DATABASE_URL is provided.
 *
 * Real merchant handlers (search/quote/transaction/cancel/refund/receipt) are
 * wired from real Shopify + Razorpay credentials when present, via
 * real-handlers.ts. Razorpay is optional: without it every handler except
 * refund still works (refund throws at call time, naming what's missing).
 * Without EITHER credential set, mock handlers are used and ONLY permitted in
 * local/test/development — see index.ts's resolveMerchantHandlers.
 */
import { resolveCounterEnvironment, type Environment } from "@counter/domain";
import { PostgresDatabase, PostgresIdempotencyStore, PostgresJobRepository } from "@counter/data";
import { createShopifyConnectorFromConfig } from "@counter/shopify-connector";
import { createRealRazorpayProvider } from "@counter/razorpay-adapter";
import { createServer, APP_NAME, type CreateServerOptions } from "./index.js";
import { requireShopifyCredentials, requireRazorpayCredentials } from "./connector-env.js";
import { createRealHandlers } from "./real-handlers.js";

const port = parseInt(process.env["PORT"] || "8080", 10);

const environment = process.env["NODE_ENV"] || "production";

// Environments that may run without a durable database / with mock handlers.
const NON_PRODUCTION_ENVIRONMENTS = ["local", "test", "development"];
const isNonProduction = NON_PRODUCTION_ENVIRONMENTS.includes(environment);

// The durable-data partition (bound into the idempotency store below) is
// resolved from COUNTER_ENV alone — NODE_ENV's vocabulary ("development") is
// a different, framework-level taxonomy, not a valid Counter environment. A
// production-like deployment with an absent/invalid COUNTER_ENV fails loud
// rather than silently writing to the wrong (or a guessed) partition.
const runtimeEnvironmentResult = resolveCounterEnvironment(
  process.env["COUNTER_ENV"],
  !isNonProduction,
);
if (!runtimeEnvironmentResult.ok) {
  console.error(`[${APP_NAME}] ${runtimeEnvironmentResult.error.message}`);
  process.exit(1);
}
const runtimeEnvironment: Environment = runtimeEnvironmentResult.value;

const databaseUrl = process.env["DATABASE_URL"];

let database: PostgresDatabase | undefined;
const hasDatabaseUrl = databaseUrl !== undefined && databaseUrl.trim().length > 0;

if (!hasDatabaseUrl && !isNonProduction) {
  // Fail loudly: a production-like deployment must not silently run on a
  // non-durable in-memory idempotency store.
  console.error(
    `[${APP_NAME}] DATABASE_URL is required in production-like environment '${environment}'`,
  );
  process.exit(1);
}

if (hasDatabaseUrl) {
  database = new PostgresDatabase(databaseUrl as string);
}

// Real handlers require both a database (to enqueue jobs / read the
// transaction spine / store quotes) and Shopify credentials (to serve real
// catalog data). Razorpay is resolved separately and passed through as
// possibly-undefined — only the refund handler needs it.
let merchantHandlers: CreateServerOptions["merchantHandlers"];
if (database !== undefined) {
  const shopifyCreds = requireShopifyCredentials(process.env, !isNonProduction);
  if (shopifyCreds !== null) {
    const razorpayCreds = requireRazorpayCredentials(process.env, !isNonProduction);
    const shopify = createShopifyConnectorFromConfig({
      shopDomain: shopifyCreds.shopDomain,
      accessToken: shopifyCreds.accessToken,
      apiVersion: shopifyCreds.apiVersion,
    });
    const razorpay =
      razorpayCreds === null
        ? undefined
        : createRealRazorpayProvider({
            keyId: razorpayCreds.keyId,
            keySecret: razorpayCreds.keySecret,
            webhookSecret: razorpayCreds.webhookSecret,
            baseUrl: razorpayCreds.baseUrl,
          });
    merchantHandlers = createRealHandlers({
      database,
      environment: runtimeEnvironment,
      shopify,
      jobRepository: new PostgresJobRepository(database, runtimeEnvironment),
      razorpay,
    });
    console.log(`[${APP_NAME}] real merchant handlers wired`, {
      shopify: true,
      razorpay: razorpay !== undefined,
    });
  }
}

// Mock merchant handlers are only acceptable for local development / test,
// and only when real handlers were not wired above (no DATABASE_URL or no
// Shopify credentials). In production-like environments createServer will
// throw when no real handlers are supplied, so the process fails loudly at
// startup rather than silently serving mocked execution paths.
const allowMockHandlers = isNonProduction && merchantHandlers === undefined;

const serverOptions: CreateServerOptions = {
  logger: true,
  environment,
  version: process.env["APP_VERSION"] || "0.1.0",
  allowMockHandlers,
  ...(merchantHandlers !== undefined ? { merchantHandlers } : {}),
  ...(database !== undefined
    ? { idempotencyStore: new PostgresIdempotencyStore(database, runtimeEnvironment) }
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
