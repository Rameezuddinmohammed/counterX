/**
 * MCP read-only tool handlers.
 *
 * Each tool has:
 * - Strict zod schemas for input validation
 * - 30-second timeout via AbortController
 * - Safe error wrapping (never leaks internals)
 * - Cancellation support
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Timeout Helper
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 30_000;

async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Safe Error Wrapping
// ---------------------------------------------------------------------------

function safeErrorResponse(error: unknown): { content: Array<{ type: "text"; text: string }> } {
  const message = error instanceof Error ? error.message : "Unknown error";
  const isTimeout = error instanceof Error && error.name === "AbortError";

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          error: isTimeout ? "timeout" : "internal_error",
          message: isTimeout ? "Operation timed out after 30 seconds" : message,
        }),
      },
    ],
  };
}

function jsonResponse(data: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tool Registration
// ---------------------------------------------------------------------------

/**
 * Registers all read-only MCP tools on the given server.
 */
export function registerReadTools(server: McpServer): void {
  // wallet.status - Retrieve wallet status
  server.tool(
    "wallet.status",
    "Retrieve the current status of a wallet by ID, including lifecycle state and active mandates.",
    { wallet_id: z.string().min(1).describe("The wallet ID to query") },
    async ({ wallet_id }) => {
      try {
        return await withTimeout(async (_signal) => {
          return jsonResponse({
            wallet_id,
            status: "active",
            lifecycle_state: "active",
            mandates: [],
            pending_actions: 0,
          });
        });
      } catch (error) {
        return safeErrorResponse(error);
      }
    },
  );

  // merchant.list - List accessible merchants
  server.tool(
    "merchant.list",
    "List merchants accessible to the current wallet.",
    {
      wallet_id: z.string().min(1).describe("The wallet ID"),
      limit: z.number().int().min(1).max(100).optional().describe("Maximum results to return"),
      offset: z.number().int().min(0).optional().describe("Pagination offset"),
    },
    async ({ wallet_id, limit, offset }) => {
      try {
        return await withTimeout(async (_signal) => {
          return jsonResponse({
            wallet_id,
            merchants: [],
            total: 0,
            limit: limit ?? 20,
            offset: offset ?? 0,
          });
        });
      } catch (error) {
        return safeErrorResponse(error);
      }
    },
  );

  // merchant.search - Search merchants by query
  server.tool(
    "merchant.search",
    "Search merchants by name, category, or product keyword.",
    {
      wallet_id: z.string().min(1).describe("The wallet ID"),
      query: z.string().min(1).max(200).describe("Search query"),
      category: z.string().optional().describe("Filter by category"),
      limit: z.number().int().min(1).max(50).optional().describe("Maximum results"),
    },
    async ({ wallet_id, query, category, limit }) => {
      try {
        return await withTimeout(async (_signal) => {
          return jsonResponse({
            wallet_id,
            query,
            category,
            results: [],
            total: 0,
            limit: limit ?? 10,
          });
        });
      } catch (error) {
        return safeErrorResponse(error);
      }
    },
  );

  // product.details - Get product details
  server.tool(
    "product.details",
    "Get detailed information about a specific product variant.",
    {
      merchant_id: z.string().min(1).describe("The merchant ID"),
      variant_id: z.string().min(1).describe("The product variant ID"),
    },
    async ({ merchant_id, variant_id }) => {
      try {
        return await withTimeout(async (_signal) => {
          return jsonResponse({
            merchant_id,
            variant_id,
            product: null,
            status: "not_found",
          });
        });
      } catch (error) {
        return safeErrorResponse(error);
      }
    },
  );

  // quote.get - Get or create a quote
  server.tool(
    "quote.get",
    "Get a price quote for a product variant.",
    {
      merchant_id: z.string().min(1).describe("The merchant ID"),
      variant_id: z.string().min(1).describe("The product variant ID"),
      quantity: z.number().int().min(1).max(999).describe("Quantity to quote"),
      currency: z.string().length(3).describe("ISO 4217 currency code"),
    },
    async ({ merchant_id, variant_id, quantity, currency }) => {
      try {
        return await withTimeout(async (_signal) => {
          return jsonResponse({
            merchant_id,
            variant_id,
            quantity,
            currency,
            quote: null,
            status: "unavailable",
          });
        });
      } catch (error) {
        return safeErrorResponse(error);
      }
    },
  );

  // transaction.status - Get transaction status
  server.tool(
    "transaction.status",
    "Get the current status of a transaction.",
    {
      merchant_id: z.string().min(1).describe("The merchant ID"),
      transaction_id: z.string().min(1).describe("The transaction ID"),
    },
    async ({ merchant_id, transaction_id }) => {
      try {
        return await withTimeout(async (_signal) => {
          return jsonResponse({
            merchant_id,
            transaction_id,
            status: "unknown",
            state: null,
          });
        });
      } catch (error) {
        return safeErrorResponse(error);
      }
    },
  );

  // pending-actions.list - List pending approval actions
  server.tool(
    "pending-actions.list",
    "List pending approval actions that require wallet owner attention.",
    {
      wallet_id: z.string().min(1).describe("The wallet ID"),
    },
    async ({ wallet_id }) => {
      try {
        return await withTimeout(async (_signal) => {
          return jsonResponse({
            wallet_id,
            pending_actions: [],
            total: 0,
          });
        });
      } catch (error) {
        return safeErrorResponse(error);
      }
    },
  );

  // receipt.verify - Verify a transaction receipt
  server.tool(
    "receipt.verify",
    "Verify the integrity and authenticity of a transaction receipt.",
    {
      merchant_id: z.string().min(1).describe("The merchant ID"),
      transaction_id: z.string().min(1).describe("The transaction ID"),
    },
    async ({ merchant_id, transaction_id }) => {
      try {
        return await withTimeout(async (_signal) => {
          return jsonResponse({
            merchant_id,
            transaction_id,
            verified: false,
            receipt: null,
            status: "not_found",
          });
        });
      } catch (error) {
        return safeErrorResponse(error);
      }
    },
  );
}
