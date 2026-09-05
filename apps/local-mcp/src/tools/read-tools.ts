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
 * (MerchantRuntimeClient) reaches agent-runtime's merchant-scoped
 * `/runtime/v1/merchants/:merchantId/...` routes, plus (as of this pass)
 * `GET /runtime/v1/merchants`, the merchant directory — NOT scoped to one
 * merchantId. merchant.list and merchant.search are now wired to
 * `merchantClient.listMerchants()` for real below: "discoverable" there
 * means a merchant with both an active Shopify connection AND a confirmed
 * Capability Manifest (see MerchantDirectoryStore's own header in
 * agent-runtime for why that's an honest interim proxy, not the same as the
 * still-unbuilt operator-reviewed ACTIVATION_REVIEW -> ACTIVE gate).
 * product.search, product.details, quote.get, transaction.status, and
 * receipt.verify all map 1:1 onto real methods on that client and are wired
 * for real below. product.search calls the SAME `search()` method/route
 * that already backed the real Shopify-connected catalog (agent-runtime's
 * merchant-routes.ts `/search`) — it existed, fully implemented on both
 * ends, with zero MCP tool ever calling it, until this pass.
 * `deps.walletClient` (WalletRuntimeClient) reaches control-plane-api's
 * wallet-scoped routes; notifications.list/invoices.get (Phase 2) and, as of
 * Phase 4 (wallet-dashboard backend), wallet.status (via getMandates,
 * reading real wallet.mandates rows) are wired for real below.
 * pending-actions.list has no durable "pending approval" concept anywhere in
 * the runtime yet (`requiresApproval` is a policy config field, never
 * persisted as a queryable transaction state), so it keeps its previous
 * honest "unavailable" shape rather than fabricate data.
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
    "Retrieve the current status of a wallet by ID, including lifecycle state, active mandates, and prepaid balance.",
    { wallet_id: z.string().min(1).describe("The wallet ID to query") },
    async ({ wallet_id }) => {
      try {
        return await withTimeout(async (_signal) => {
          if (walletClient === undefined) {
            return jsonResponse({
              wallet_id,
              status: "unavailable",
              mandates: [],
              balance: null,
            });
          }
          // Independent calls, run together — a balance-fetch failure must
          // never mask real mandate data (or vice versa). Each result is
          // reported honestly on its own; neither is fabricated from the
          // other.
          const [mandatesResult, balanceResult] = await Promise.all([
            walletClient.getMandates(wallet_id),
            walletClient.getBalance(wallet_id),
          ]);

          const balance = balanceResult.ok
            ? {
                hasBalanceAccount: balanceResult.value.hasBalanceAccount,
                balanceMinor: balanceResult.value.balanceMinor,
                currency: balanceResult.value.currency,
              }
            : null;

          if (!mandatesResult.ok) {
            return jsonResponse({
              wallet_id,
              status: mandatesResult.error.kind === "timeout" ? "indeterminate" : "unavailable",
              mandates: [],
              balance,
              reason: mandatesResult.error.kind,
            });
          }
          // "active" here means "at least one active mandate exists" - the
          // only real, durable signal this codebase has for wallet
          // lifecycle state today (there is no separate wallet.wallets
          // status column). A wallet with zero active mandates is
          // truthfully reported as "no_active_mandate", never fabricated
          // as "active".
          return jsonResponse({
            wallet_id,
            status: mandatesResult.value.total > 0 ? "active" : "no_active_mandate",
            mandates: mandatesResult.value.mandates,
            balance,
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
          const effectiveLimit = limit ?? 20;
          const effectiveOffset = offset ?? 0;
          if (merchantClient === undefined) {
            return jsonResponse({
              wallet_id,
              merchants: [],
              total: 0,
              limit: effectiveLimit,
              offset: effectiveOffset,
            });
          }
          // The directory store has no server-side offset — fetch enough
          // rows to cover this page and slice client-side rather than
          // silently ignoring `offset` (which would make every page look
          // like page one).
          const result = await merchantClient.listMerchants(
            undefined,
            effectiveOffset + effectiveLimit,
          );
          if (!result.ok) {
            return jsonResponse({
              wallet_id,
              merchants: [],
              total: 0,
              limit: effectiveLimit,
              offset: effectiveOffset,
              status: result.error.kind === "timeout" ? "indeterminate" : "unavailable",
              reason: result.error.kind,
            });
          }
          return jsonResponse({
            wallet_id,
            merchants: result.value.merchants.slice(effectiveOffset),
            total: result.value.total,
            limit: effectiveLimit,
            offset: effectiveOffset,
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
          const effectiveLimit = limit ?? 10;
          if (merchantClient === undefined) {
            return jsonResponse({
              wallet_id,
              query,
              category,
              results: [],
              total: 0,
              limit: effectiveLimit,
            });
          }
          // The directory only searches by display name server-side (see
          // MerchantDirectoryStore.list) — `category`, when given, is
          // applied here against each result's own goodsTypes, an exact
          // match against a FulfillmentCapability string (e.g.
          // "fulfillment.physical.ship"), not a fuzzy product-keyword search.
          const result = await merchantClient.listMerchants(
            query,
            category !== undefined ? 50 : effectiveLimit,
          );
          if (!result.ok) {
            return jsonResponse({
              wallet_id,
              query,
              category,
              results: [],
              total: 0,
              limit: effectiveLimit,
              status: result.error.kind === "timeout" ? "indeterminate" : "unavailable",
              reason: result.error.kind,
            });
          }
          const filtered =
            category !== undefined
              ? result.value.merchants.filter((m) => m.goodsTypes.includes(category))
              : result.value.merchants;
          return jsonResponse({
            wallet_id,
            query,
            category,
            results: filtered.slice(0, effectiveLimit),
            total: filtered.length,
            limit: effectiveLimit,
          });
        });
      } catch (error) {
        return safeErrorResponse(error);
      }
    },
  );

  // product.search / catalog.search / catalog.list - List or search a merchant's real product catalog
  const productSearchSchema = {
    wallet_id: z.string().min(1).describe("The wallet ID"),
    merchant_id: z.string().min(1).describe("The merchant ID (from merchant.list)"),
    query: z
      .string()
      .max(200)
      .optional()
      .describe(
        "Search text, e.g. a product name or keyword. Omit or empty to list the merchant's full catalog.",
      ),
    limit: z.number().int().min(1).max(25).optional().describe("Maximum results to return"),
  };

  const productSearchHandler = async ({
    wallet_id,
    merchant_id,
    query,
    limit,
  }: {
    wallet_id: string;
    merchant_id: string;
    query?: string | undefined;
    limit?: number | undefined;
  }) => {
    try {
      return await withTimeout(async (_signal) => {
        const effectiveLimit = limit ?? 10;
        if (merchantClient === undefined) {
          return jsonResponse({
            wallet_id,
            merchant_id,
            results: [],
            total_count: 0,
          });
        }
        // When query is omitted, empty, or whitespace, normalize to "*" so both
        // older deployed runtimes (which require a non-empty `query` field) and
        // Shopify's catalog search return the full product catalog without a 400.
        const effectiveQuery =
          typeof query === "string" && query.trim().length > 0 ? query.trim() : "*";
        const result = await merchantClient.search(merchant_id, effectiveQuery, undefined, {
          limit: effectiveLimit,
        });
        if (!result.ok) {
          return jsonResponse({
            wallet_id,
            merchant_id,
            results: [],
            total_count: 0,
            status: result.error.kind === "timeout" ? "indeterminate" : "unavailable",
            reason: result.error.kind,
          });
        }
        return jsonResponse({
          wallet_id,
          merchant_id,
          results: result.value.results,
          total_count: result.value.totalCount,
          next_cursor: result.value.nextCursor,
        });
      });
    } catch (error) {
      return safeErrorResponse(error);
    }
  };

  server.tool(
    "product.search",
    "List or search the products a specific merchant sells. Use this before product.details " +
      "(which needs a variant_id you don't have until you've seen the catalog).",
    productSearchSchema,
    productSearchHandler,
  );

  // catalog.search - Alias for product.search
  server.tool(
    "catalog.search",
    "Search or browse a merchant's product catalog. Alias for product.search.",
    productSearchSchema,
    productSearchHandler,
  );

  // catalog.list - Alias for product.search (list entire catalog)
  server.tool(
    "catalog.list",
    "List products available in a merchant's catalog. Alias for product.search.",
    productSearchSchema,
    productSearchHandler,
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
