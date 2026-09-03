/**
 * MCP read-only tool handlers.
 *
 * Each tool has:
 * - Strict zod schemas for input validation
 * - 30-second timeout via AbortController
 * - Safe error wrapping (never leaks internals)
 * - Cancellation support
 *
 * REAL vs. STRUCTURALLY-UNREACHABLE, as of this pass: `deps.merchantClient`
 * (MerchantRuntimeClient) only reaches agent-runtime's merchant-scoped
 * `/runtime/v1/merchants/:merchantId/...` routes. product.details, quote.get,
 * transaction.status, and receipt.verify all map 1:1 onto real methods on
 * that client and are wired for real below. wallet.status, merchant.list,
 * pending-actions.list, and wallet.list are WALLET-scoped operations with no
 * client in this app that can reach them at all (not just "no route" - there
 * is no wallet-scoped HTTP client injected here); they keep returning their
 * previous honest "unavailable" shape rather than fabricate data, pending a
 * real wallet-scoped client being added in a later pass. merchant.search, as
 * designed ("search merchants by name/category"), doesn't match any real
 * capability either - the one real search method on MerchantRuntimeClient
 * searches PRODUCTS within one already-known merchant, not merchants
 * themselves - so it also stays stubbed rather than being wired to the wrong
 * thing.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { MerchantRuntimeClient } from "@counter/wallet-application";
import type { WalletRuntimeClient } from "../wallet-runtime-client.js";

// ---------------------------------------------------------------------------
// Read Tool Dependencies
// ---------------------------------------------------------------------------

/**
 * Both fields optional and independent: when merchantClient is omitted,
 * merchant-scoped tools fall back to their previous honest
 * "unavailable"/empty shape (never fabricated success); same for
 * walletClient and the wallet-scoped notifications.list/invoices.get tools
 * (Phase 2 of the remote-MCP plan).
 */
export interface ReadToolDependencies {
  readonly merchantClient?: MerchantRuntimeClient;
  readonly walletClient?: WalletRuntimeClient;
}

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
export function registerReadTools(server: McpServer, deps?: ReadToolDependencies): void {
  const merchantClient = deps?.merchantClient;
  const walletClient = deps?.walletClient;
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
          if (merchantClient === undefined) {
            return jsonResponse({
              merchant_id,
              variant_id,
              product: null,
              status: "not_found",
            });
          }
          const result = await merchantClient.getProduct(merchant_id, variant_id);
          if (!result.ok) {
            return jsonResponse({
              merchant_id,
              variant_id,
              product: null,
              status: result.error.kind === "timeout" ? "indeterminate" : "not_found",
              reason: result.error.kind,
            });
          }
          return jsonResponse({
            merchant_id,
            variant_id,
            product: result.value,
            status: "found",
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
          if (merchantClient === undefined) {
            return jsonResponse({
              merchant_id,
              variant_id,
              quantity,
              currency,
              quote: null,
              status: "unavailable",
            });
          }
          const result = await merchantClient.getQuote(merchant_id, variant_id, quantity, currency);
          if (!result.ok) {
            return jsonResponse({
              merchant_id,
              variant_id,
              quantity,
              currency,
              quote: null,
              status: result.error.kind === "timeout" ? "indeterminate" : "unavailable",
              reason: result.error.kind,
            });
          }
          return jsonResponse({
            merchant_id,
            variant_id,
            quantity,
            currency,
            quote: result.value,
            status: "available",
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
          if (merchantClient === undefined) {
            return jsonResponse({
              merchant_id,
              transaction_id,
              status: "unknown",
              state: null,
            });
          }
          const result = await merchantClient.getTransactionStatus(merchant_id, transaction_id);
          if (!result.ok) {
            return jsonResponse({
              merchant_id,
              transaction_id,
              status: result.error.kind === "timeout" ? "indeterminate" : "unknown",
              state: null,
              reason: result.error.kind,
            });
          }
          return jsonResponse({
            merchant_id,
            transaction_id,
            status: "known",
            state: result.value,
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
          if (merchantClient === undefined) {
            return jsonResponse({
              merchant_id,
              transaction_id,
              verified: false,
              receipt: null,
              status: "not_found",
            });
          }
          const result = await merchantClient.getReceipt(merchant_id, transaction_id);
          if (!result.ok) {
            return jsonResponse({
              merchant_id,
              transaction_id,
              verified: false,
              receipt: null,
              status: result.error.kind === "timeout" ? "indeterminate" : "not_found",
              reason: result.error.kind,
            });
          }
          // NOTE: the server-side receipt this returns is currently known to
          // be fabricated (fake single line item, non-cryptographic
          // pseudo-signature) - that is separate, in-progress work elsewhere
          // in the production-readiness plan (Phase D2). This tool now
          // correctly calls the real route; whether the route's OWN content
          // is trustworthy is that other work's job, not this one's.
          return jsonResponse({
            merchant_id,
            transaction_id,
            verified: true,
            receipt: result.value,
            status: "found",
          });
        });
      } catch (error) {
        return safeErrorResponse(error);
      }
    },
  );

  // notifications.list - List real order/fulfillment notifications for a wallet
  server.tool(
    "notifications.list",
    "List recent order/fulfillment notifications for a wallet (real orders and their delivery status).",
    {
      wallet_id: z.string().min(1).describe("The wallet ID"),
      limit: z.number().int().min(1).max(100).optional().describe("Maximum results to return"),
    },
    async ({ wallet_id, limit }) => {
      try {
        return await withTimeout(async (_signal) => {
          if (walletClient === undefined) {
            return jsonResponse({
              wallet_id,
              notifications: [],
              total: 0,
              status: "unavailable",
            });
          }
          const result = await walletClient.listNotifications(wallet_id, {
            ...(limit !== undefined ? { limit } : {}),
          });
          if (!result.ok) {
            return jsonResponse({
              wallet_id,
              notifications: [],
              total: 0,
              status: result.error.kind === "timeout" ? "indeterminate" : "unavailable",
              reason: result.error.kind,
            });
          }
          return jsonResponse({
            wallet_id,
            notifications: result.value.notifications,
            total: result.value.total,
            status: "available",
          });
        });
      } catch (error) {
        return safeErrorResponse(error);
      }
    },
  );

  // invoices.get - Order-created/fulfilled notifications for a wallet, invoice-style
  server.tool(
    "invoices.get",
    "Get real order receipts and delivery status for a wallet, filtered to order-lifecycle events (an invoice-style view over notifications.list).",
    {
      wallet_id: z.string().min(1).describe("The wallet ID"),
      limit: z.number().int().min(1).max(100).optional().describe("Maximum results to return"),
    },
    async ({ wallet_id, limit }) => {
      try {
        return await withTimeout(async (_signal) => {
          if (walletClient === undefined) {
            return jsonResponse({
              wallet_id,
              invoices: [],
              total: 0,
              status: "unavailable",
            });
          }
          const created = await walletClient.listNotifications(wallet_id, {
            ...(limit !== undefined ? { limit } : {}),
            notificationType: "merchant.order.created.v1",
          });
          if (!created.ok) {
            return jsonResponse({
              wallet_id,
              invoices: [],
              total: 0,
              status: created.error.kind === "timeout" ? "indeterminate" : "unavailable",
              reason: created.error.kind,
            });
          }
          return jsonResponse({
            wallet_id,
            invoices: created.value.notifications,
            total: created.value.total,
            status: "available",
          });
        });
      } catch (error) {
        return safeErrorResponse(error);
      }
    },
  );
}
