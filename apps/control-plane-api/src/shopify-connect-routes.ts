/**
 * Self-serve Shopify OAuth routes — the real authorization-code grant flow,
 * replacing "an operator manually sets SHOPIFY_STORE_DOMAIN/SHOPIFY_ACCESS_TOKEN"
 * (apps/worker/src/connector-env.ts) with "a merchant clicks Connect Shopify
 * and authorizes their own store."
 *
 *   GET /control/v1/merchants/:merchantId/shopify/authorize?shop={shop}.myshopify.com
 *     Requires the caller's own merchant-scoped session (matching
 *     :merchantId — existence-hiding 404 for a mismatched merchant, same
 *     shape as wallet-user-routes.ts's verifyWalletAccess). Redirects the
 *     browser to Shopify's real consent screen.
 *
 *   GET /control/v1/merchants/:merchantId/shopify/callback
 *     Shopify's own redirect back after the merchant approves. Deliberately
 *     UNAUTHENTICATED (registered in skipAuthRoutes, by route PATTERN since
 *     :merchantId varies per request — see http-api-kit's auth.ts) — the
 *     merchant's browser lands here carrying no Counter session at all. The
 *     `state` param minted by the authorize route (hashed, single-use,
 *     10-minute expiry) plus Shopify's own HMAC signature over the full
 *     callback query string are the entire proof this request is genuine.
 *     See shopify-connection-store.ts's completeAuthorization for both
 *     checks. On success, redirects the browser back into the merchant
 *     console; on any failure, redirects with an error flag rather than
 *     rendering raw JSON to a browser tab.
 *
 *   GET /control/v1/merchants/:merchantId/shopify/connection
 *     Read-only status the merchant console polls after being redirected
 *     back, to reflect "Connected" without a manual page refresh. Same
 *     access check as the authorize route.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getActorContext, registerRoutePermission } from "@counter/http-api-kit";
import type { ShopifyConnectionProvisionerLike } from "./shopify-connection-store.js";
import { ShopifyOAuthError } from "./shopify-connection-store.js";

export interface ShopifyConnectRoutesOptions {
  readonly provisioner: ShopifyConnectionProvisionerLike;
  /**
   * Where to send the merchant's browser after the callback resolves.
   * Query params `shopify=connected` or `shopify=error` are appended.
   * Defaults to a relative path so this works behind any merchant-console
   * origin without hardcoding one.
   */
  readonly consoleReturnUrl?: string;
}

const DEFAULT_RETURN_PATH = "/shopify";

function sendValidationError(reply: FastifyReply, message: string): void {
  void reply.status(400).send({ error: { code: "INVALID_FORMAT", message } });
}

function verifyMerchantAccess(request: FastifyRequest, merchantId: string): boolean {
  const actorContext = getActorContext(request);
  if (actorContext === undefined) {
    return false;
  }
  const scope = actorContext.scope;
  if (scope.kind === "platform") {
    return true;
  }
  if (scope.kind === "merchant") {
    return scope.merchantId === merchantId;
  }
  return false;
}

function firstQueryValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

export async function shopifyConnectRoutesPlugin(
  fastify: FastifyInstance,
  options: ShopifyConnectRoutesOptions,
): Promise<void> {
  const { provisioner } = options;
  const returnUrl = options.consoleReturnUrl ?? DEFAULT_RETURN_PATH;

  registerRoutePermission("GET:/control/v1/merchants/:merchantId/shopify/authorize", {
    permission: "identity.service_identity.manage",
  });
  registerRoutePermission("GET:/control/v1/merchants/:merchantId/shopify/connection", {
    permission: "identity.service_identity.read",
  });

  fastify.get(
    "/control/v1/merchants/:merchantId/shopify/authorize",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = request.params as Record<string, string>;
      const merchantId = params["merchantId"] ?? "";

      if (!verifyMerchantAccess(request, merchantId)) {
        void reply.status(404).send({
          error: { code: "NOT_FOUND", message: "The requested resource was not found" },
        });
        return;
      }

      const query = request.query as Record<string, unknown>;
      const shop = firstQueryValue(query["shop"]);
      if (shop === undefined || shop.length === 0) {
        sendValidationError(reply, "Query parameter 'shop' is required");
        return;
      }

      try {
        const { authorizeUrl } = await provisioner.beginAuthorization(merchantId, shop);
        void reply.redirect(authorizeUrl, 302);
      } catch (error) {
        if (error instanceof ShopifyOAuthError) {
          sendValidationError(reply, error.message);
          return;
        }
        throw error;
      }
    },
  );

  fastify.get(
    "/control/v1/merchants/:merchantId/shopify/callback",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const rawQuery = request.query as Record<string, unknown>;
      const query: Record<string, string | undefined> = {};
      for (const key of Object.keys(rawQuery)) {
        query[key] = firstQueryValue(rawQuery[key]);
      }

      try {
        await provisioner.completeAuthorization(query);
        void reply.redirect(`${returnUrl}?shopify=connected`, 302);
      } catch (error) {
        if (error instanceof ShopifyOAuthError) {
          request.log.warn({ err: error }, "Shopify OAuth callback rejected");
          void reply.redirect(`${returnUrl}?shopify=error`, 302);
          return;
        }
        throw error;
      }
    },
  );

  fastify.get(
    "/control/v1/merchants/:merchantId/shopify/connection",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = request.params as Record<string, string>;
      const merchantId = params["merchantId"] ?? "";

      if (!verifyMerchantAccess(request, merchantId)) {
        void reply.status(404).send({
          error: { code: "NOT_FOUND", message: "The requested resource was not found" },
        });
        return;
      }

      const status = await provisioner.getConnectionStatus(merchantId);
      void reply.status(200).send(status);
    },
  );
}
