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

export const APP_NAME = "@counter/local-mcp";

// Re-export read tools for testing
export { registerReadTools } from "./tools/read-tools.js";

// Re-export write tools for testing
export { registerWriteTools } from "./tools/write-tools.js";
export type { WriteToolDependencies } from "./tools/write-tools.js";

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
 * Optionally accepts write tool dependencies for consequential tools.
 */
export function createMcpServer(writeDeps?: WriteToolDependencies): McpServer {
  const server = new McpServer({
    name: APP_NAME,
    version: "0.1.0",
  });

  // Register all read-only tools. Reuses writeDeps' merchantClient when
  // present (same client, same auth) rather than requiring a second one -
  // read tools stay honestly stubbed when no client is configured at all.
  registerReadTools(
    server,
    writeDeps !== undefined ? { merchantClient: writeDeps.merchantClient } : undefined,
  );

  // Register consequential (write) tools if dependencies are provided
  if (writeDeps) {
    registerWriteTools(server, writeDeps);
  }

  // Register wallet list tool
  server.tool("wallet.list", "List wallets accessible to the current principal.", {}, async () => {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ wallets: [], status: "not_implemented" }),
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
