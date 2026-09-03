/**
 * Deployment entry point for apps/remote-mcp.
 * Binds 0.0.0.0 so the Fly.io proxy can reach the server.
 *
 * EVERYTHING this app needs is required, not optional (see config.ts). There
 * is no "degrade gracefully" mode here: an OAuth authorization server with no
 * upstream Auth0 application, or an MCP server with no Vault to sign with, is
 * not a reduced service — it is a broken one that would fail confusingly at
 * request time instead of loudly at boot. The one exception is
 * COUNTER_CONTROL_PLANE_URL, which only gates two read-only tools.
 */
import { PostgresDatabase } from "@counter/data";
import { resolveCounterEnvironment, type Environment } from "@counter/domain";
import { createServer, APP_NAME, MCP_PATH } from "./index.js";
import { loadConfig } from "./config.js";
import { PostgresRemoteMcpClientRepository } from "./oauth/client-repository.js";
import { createVaultKeyStoreFactory } from "./key-store-factory.js";
import { startVaultTokenRenewal } from "./vault-token-renewal.js";

const nodeEnvironment = process.env["NODE_ENV"] ?? "production";
const NON_PRODUCTION_ENVIRONMENTS = ["local", "test", "development"];
const isNonProduction = NON_PRODUCTION_ENVIRONMENTS.includes(nodeEnvironment);

async function main(): Promise<void> {
  const config = loadConfig(process.env);

  // The durable-data partition is resolved from COUNTER_ENV alone — NODE_ENV's
  // vocabulary ("development") is a different, framework-level taxonomy, not a
  // valid Counter environment. Same reasoning as apps/agent-runtime/src/main.ts.
  const environmentResult = resolveCounterEnvironment(process.env["COUNTER_ENV"], !isNonProduction);
  if (!environmentResult.ok) {
    throw new Error(environmentResult.error.message);
  }
  const environment: Environment = environmentResult.value;

  const database = new PostgresDatabase(config.databaseUrl);

  const { server, provider } = await createServer({
    auth0: config.auth0,
    publicBaseUrl: config.publicBaseUrl,
    clients: new PostgresRemoteMcpClientRepository(database, environment),
    keyStoreFactory: createVaultKeyStoreFactory({
      vaultAddr: config.vaultAddr,
      vaultToken: config.vaultToken,
      database,
    }),
    agentRuntimeUrl: config.agentRuntimeUrl,
    controlPlaneUrl: config.controlPlaneUrl,
    version: process.env["APP_VERSION"] ?? "0.1.0",
    environment: nodeEnvironment,
    logger: true,
  });

  // VAULT_TOKEN is a Vault periodic token (see vault-config.hcl) with no
  // fixed expiry as long as something renews it before each 30-day window
  // closes — this is that something. A renewal failure is loud (visible in
  // logs) but never crashes the process; see vault-token-renewal.ts.
  const tokenRenewal = startVaultTokenRenewal({
    vaultAddr: config.vaultAddr,
    vaultToken: config.vaultToken,
    onRenewed: (leaseDurationSeconds) => {
      console.log(`${APP_NAME} renewed its Vault token`, { leaseDurationSeconds });
    },
    onError: (error) => {
      console.error(`${APP_NAME} FAILED to renew its Vault token — will retry`, error);
    },
  });

  const address = await server.listen({ port: config.port, host: "0.0.0.0" });
  console.log(`${APP_NAME} listening on ${address}`, {
    mcpEndpoint: `${config.publicBaseUrl}${MCP_PATH}`,
    // Surfaced at boot because this exact URI must be allowlisted by hand in
    // the Auth0 application's "Allowed Callback URLs" — a mismatch here is
    // the single most likely deployment mistake, and it fails at Auth0 with
    // an opaque error, so logging it makes the fix obvious.
    auth0CallbackUrl: provider.auth0CallbackUrl,
    environment,
  });

  process.on("SIGTERM", () => {
    tokenRenewal.stop();
    void server.close().then(() => database.close());
  });
}

main().catch((error: unknown) => {
  console.error(`[${APP_NAME}] fatal error at startup`, error);
  process.exit(1);
});
