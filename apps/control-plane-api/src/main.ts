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
import { WalletUserProvisioner, type RuntimeCredentialConfig } from "./wallet-user-store.js";

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

const serverOptions: CreateServerOptions = {
  logger: true,
  environment,
  version: process.env["APP_VERSION"] || "0.1.0",
  ...(database !== undefined
    ? {
        policyStore: createPostgresPolicyStore(database, runtimeEnvironment),
        transactionStore: createPostgresTransactionStore(database, runtimeEnvironment),
        walletUserProvisioner: new WalletUserProvisioner(
          database,
          runtimeEnvironment,
          runtimeCredentialConfig,
        ),
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
