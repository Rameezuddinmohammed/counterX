/**
 * Deployment entry point for agent-runtime.
 * Binds to 0.0.0.0 so the Fly.io proxy can reach the server.
 *
 * In production-like environments a durable Postgres idempotency store is
 * required: DATABASE_URL must be set and a PostgresDatabase is constructed and
 * injected into createServer. In local/test/development an in-memory store is
 * used unless DATABASE_URL is provided.
 */
import { resolveCounterEnvironment, type Environment } from "@counter/domain";
import { PostgresDatabase, PostgresIdempotencyStore } from "@counter/data";
import { createServer, APP_NAME, type CreateServerOptions } from "./index.js";

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

// Mock merchant handlers are only acceptable for local development / test.
// In production-like environments createServer will throw when no real
// handlers are supplied, so the process fails loudly at startup rather than
// silently serving mocked execution paths. Real handlers are not yet wired
// end-to-end here; when they are, pass them via `merchantHandlers` and drop
// this opt-in.
const allowMockHandlers = isNonProduction;

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

const serverOptions: CreateServerOptions = {
  logger: true,
  environment,
  version: process.env["APP_VERSION"] || "0.1.0",
  allowMockHandlers,
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
