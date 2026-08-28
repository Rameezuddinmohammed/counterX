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
import { PostgresDatabase } from "@counter/data";
import { createServer, APP_NAME, type CreateServerOptions } from "./index.js";
import { createPostgresPolicyStore } from "./policy-store-postgres.js";
import { createPostgresTransactionStore } from "./transaction-store-postgres.js";

const port = parseInt(process.env["PORT"] || "8080", 10);
const environment = process.env["NODE_ENV"] || "production";
// Runtime tables are currently written in the legacy "local" partition by the
// durable worker repositories. Keep the read model on that same partition until
// all runtime repositories accept an explicit environment. Deployments may
// override this deliberately once that migration is complete.
const runtimeEnvironment = process.env["COUNTER_RUNTIME_ENV"] || "local";

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

const serverOptions: CreateServerOptions = {
  logger: true,
  environment,
  version: process.env["APP_VERSION"] || "0.1.0",
  ...(database !== undefined
    ? {
        policyStore: createPostgresPolicyStore(database),
        transactionStore: createPostgresTransactionStore(database, runtimeEnvironment),
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
