/**
 * Real entrypoint for apps/local-mcp — wired to genuine infrastructure
 * instead of the in-memory test doubles main.ts uses:
 *
 *   - FileSecureKeyStore: a real, persistent Ed25519 key on disk (encrypted
 *     at rest), instead of a key that vanishes when the process exits.
 *   - HttpMerchantRuntimeClient: talks to the actual deployed agent-runtime
 *     API over HTTPS, instead of returning canned in-memory responses.
 *
 * Run `pnpm --filter @counter/local-mcp register-buyer-agent` first (once)
 * to provision the wallet/agent/key this entrypoint signs with, then set:
 *   COUNTER_AGENT_RUNTIME_URL          e.g. https://counter-agent-runtime.fly.dev
 *   COUNTER_RUNTIME_AUTH_TOKEN         bearer token for the deployed API
 *   COUNTER_WALLET_KEYSTORE_PASSPHRASE the passphrase chosen at registration
 *   COUNTER_WALLET_KEYSTORE_PATH       optional; defaults to ~/.counter/wallet-keys.enc.json
 *   COUNTER_CONTROL_PLANE_URL          optional; e.g. https://counter-control-plane-api.fly.dev
 *                                      — enables notifications.list/invoices.get (Phase 2);
 *                                      omitted, those tools stay honestly "unavailable"
 *
 * Durable revocation is out of scope for this phase — InMemoryRevocationStore
 * is used here too; only the key custody and the merchant-runtime transport
 * are real.
 *
 * Run: node apps/local-mcp/dist/main-real.js  (stdio transport)
 */
import { FileSecureKeyStore, defaultWalletKeyStorePath } from "@counter/wallet-domain";
import { HttpMerchantRuntimeClient, InMemoryRevocationStore } from "@counter/wallet-application";
import { createMcpServer, createStdioTransport } from "./index.js";
import { HttpWalletRuntimeClient } from "./wallet-runtime-client.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required to run the real MCP entrypoint`);
  }
  return value;
}

async function main(): Promise<void> {
  const baseUrl = requireEnv("COUNTER_AGENT_RUNTIME_URL");
  const authToken = requireEnv("COUNTER_RUNTIME_AUTH_TOKEN");
  const passphrase = requireEnv("COUNTER_WALLET_KEYSTORE_PASSPHRASE");
  const keyStorePath = process.env["COUNTER_WALLET_KEYSTORE_PATH"] ?? defaultWalletKeyStorePath();

  const keyStore = new FileSecureKeyStore(keyStorePath);
  keyStore.unlockStore(passphrase);

  const merchantClient = new HttpMerchantRuntimeClient(baseUrl, authToken, new Map(), {
    environment: "sandbox",
  });
  const revocationStore = new InMemoryRevocationStore();

  // Wallet-scoped notifications.list/invoices.get (Phase 2 of the
  // remote-MCP plan) — optional: control-plane-api's base URL defaults to
  // the agent-runtime one's sibling service naming, but is independently
  // overridable since they are separate Fly apps. Uses the SAME bearer
  // token as merchantClient (control-plane-api's default JWT audience is
  // the same https://api.counter.dev resource — see
  // wallet-runtime-client.ts's header).
  const controlPlaneUrl = process.env["COUNTER_CONTROL_PLANE_URL"];
  const walletClient =
    controlPlaneUrl !== undefined && controlPlaneUrl.trim().length > 0
      ? new HttpWalletRuntimeClient(controlPlaneUrl, authToken)
      : undefined;

  const server = createMcpServer({ keyStore, merchantClient, revocationStore }, walletClient);
  const transport = createStdioTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  console.error("[@counter/local-mcp] fatal error (real entrypoint)", error);
  process.exit(1);
});
