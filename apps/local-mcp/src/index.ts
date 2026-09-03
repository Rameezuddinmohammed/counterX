/**
 * apps/local-mcp
 *
 * Local MCP tool server and signer boundary. Provides:
 * - MCP transport adapter (stdio)
 * - Tool registration skeleton for wallet operations
 * - Hard denylist for policy/key/payment-secret mutation tools
 *
 * See design.md "Local signer and secure key storage".
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerReadTools } from "./tools/read-tools.js";
import { registerWriteTools } from "./tools/write-tools.js";
import type { WriteToolDependencies } from "./tools/write-tools.js";
import type { WalletRuntimeClient } from "./wallet-runtime-client.js";

export const APP_NAME = "@counter/local-mcp";

// Re-export read tools for testing
export { registerReadTools } from "./tools/read-tools.js";

// Re-export write tools for testing
export { registerWriteTools } from "./tools/write-tools.js";
export type { WriteToolDependencies } from "./tools/write-tools.js";

// Re-exported so apps/remote-mcp can build the same wallet-scoped read
// client over the remote transport instead of forking this file. The class
// and its behaviour are unchanged; only its visibility outside this package.
export { HttpWalletRuntimeClient } from "./wallet-runtime-client.js";
export type {
  WalletRuntimeClient,
  WalletNotification,
  WalletNotificationsResult,
  WalletMandateSummary,
  WalletMandatesResult,
  WalletClientResult,
  WalletClientError,
  WalletClientErrorKind,
} from "./wallet-runtime-client.js";

// ---------------------------------------------------------------------------
// Denylist: tools that must NEVER be exposed locally
// ---------------------------------------------------------------------------

export const DENIED_TOOL_PATTERNS = [
  "key.export",
  "key.rotate",
  "key.derive",
  "policy.mutate",
  "policy.override",
  "approval.grant",
  "approval.override",
  "recovery.initiate",
  "recovery.complete",
  "settlement.assert",
  "settlement.override",
  "payment-secret.read",
  "payment-secret.write",
] as const;

export type DeniedToolPattern = (typeof DENIED_TOOL_PATTERNS)[number];

const deniedToolSet: ReadonlySet<string> = new Set(DENIED_TOOL_PATTERNS);

export function isDeniedTool(toolName: string): boolean {
  return deniedToolSet.has(toolName);
}

// ---------------------------------------------------------------------------
// MCP Server Setup
// ---------------------------------------------------------------------------

/**
 * Creates and configures the MCP server with tool registrations.
 * Uses stdio transport for local process communication.
 * Optionally accepts write tool dependencies for consequential tools, and a
 * separate wallet-scoped read client (Phase 2 of the remote-MCP plan) for
 * notifications.list/invoices.get — independent of writeDeps since a wallet
 * read client has nothing to do with consequential purchase tools.
 *
 * `boundWalletId`, when present, is the ONE wallet this server instance is
 * scoped to (apps/remote-mcp always has this — see mcp-route.ts's own
 * session model docs; apps/local-mcp's main-real.ts does not pass one today,
 * so wallet.list keeps its previous stubbed behaviour there unchanged). Used
 * only by wallet.list below — everything else is unaffected.
 */
export function createMcpServer(
  writeDeps?: WriteToolDependencies,
  walletClient?: WalletRuntimeClient,
  boundWalletId?: string,
): McpServer {
  const server = new McpServer({
    name: APP_NAME,
    version: "0.1.0",
  });

  // Register all read-only tools. Reuses writeDeps' merchantClient when
  // present (same client, same auth) rather than requiring a second one -
  // read tools stay honestly stubbed when no client is configured at all.
  registerReadTools(server, {
    ...(writeDeps !== undefined ? { merchantClient: writeDeps.merchantClient } : {}),
    ...(walletClient !== undefined ? { walletClient } : {}),
  });

  // Register consequential (write) tools if dependencies are provided
  if (writeDeps) {
    registerWriteTools(server, writeDeps);
  }

  // Register wallet list tool. An authenticated MCP session (local or
  // remote) is never scoped to more than one wallet — see mcp-route.ts's own
  // "an MCP session belongs to exactly one WALLET" invariant — so when the
  // caller knows which one, the honest answer is that single wallet, not an
  // unconditional "not implemented" (which previously made a genuinely
  // connected, working wallet look inaccessible — found live, 2026-09-03,
  // via a real Claude.ai Connector attempt asking "check my wallet status").
  server.tool("wallet.list", "List wallets accessible to the current principal.", {}, async () => {
    return {
      content: [
        {
          type: "text" as const,
          text:
            boundWalletId === undefined
              ? JSON.stringify({ wallets: [], status: "not_implemented" })
              : JSON.stringify({ wallets: [{ wallet_id: boundWalletId }], status: "ok" }),
        },
      ],
    };
  });

  return server;
}

/**
 * Creates the stdio transport for local process communication.
 */
export function createStdioTransport(): StdioServerTransport {
  return new StdioServerTransport();
}

/**
 * Starts the MCP server with stdio transport.
 * Call this from the CLI entry point.
 */
export async function startServer(): Promise<void> {
  const server = createMcpServer();
  const transport = createStdioTransport();
  await server.connect(transport);
}
