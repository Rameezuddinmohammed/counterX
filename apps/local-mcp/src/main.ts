/**
 * Local development entrypoint for apps/local-mcp.
 *
 * Registers read tools plus write tools wired against the package's own
 * in-memory test doubles (InMemorySecureKeyStore, InMemoryMerchantRuntimeClient,
 * InMemoryRevocationStore) so the MCP surface is launchable and exercisable in
 * local dev/testing without any real wallet infrastructure, real signing keys,
 * or a live merchant backend. This is intentionally NOT wired to real
 * infrastructure — see main-real.ts for the real wiring (a persistent
 * on-disk signing key, and an HTTP client that talks to the actual deployed
 * agent-runtime API).
 *
 * Run: node apps/local-mcp/dist/main.js  (stdio transport)
 */
import { InMemorySecureKeyStore } from "@counter/wallet-domain";
import { InMemoryMerchantRuntimeClient, InMemoryRevocationStore } from "@counter/wallet-application";
import { createMcpServer, createStdioTransport } from "./index.js";

async function main(): Promise<void> {
  const keyStore = new InMemorySecureKeyStore();
  const merchantClient = new InMemoryMerchantRuntimeClient("sandbox");
  const revocationStore = new InMemoryRevocationStore();

  const server = createMcpServer({ keyStore, merchantClient, revocationStore });
  const transport = createStdioTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  console.error("[@counter/local-mcp] fatal error", error);
  process.exit(1);
});
