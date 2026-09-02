/**
 * Register (or rotate) a merchant's own webhook endpoint for real
 * order/fulfillment event delivery — see merchant-webhook-endpoint-store.ts's
 * header for the full design. The actual settings-page UI that calls this
 * is explicitly out of scope here — this is the API a future UI page calls.
 *
 *   POST /control/v1/merchants/:merchantId/webhook-endpoint
 *     Body: { url: "https://merchant.example.com/webhooks/counter" }
 *     Returns the signing secret ONCE (registration or rotation only).
 *   GET  /control/v1/merchants/:merchantId/webhook-endpoint
 *     Returns { connected, url } — never the secret.
 *
 * Same access-control shape as merchant-payment-connection-routes.ts and
 * transaction-routes.ts: the caller's own merchant-scoped session
 * (existence-hiding 404 for a mismatched merchant) or a platform operator.
 * POST requires identity.scope.manage, GET requires identity.scope.read.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getActorContext, registerRoutePermission } from "@counter/http-api-kit";
import type { MerchantWebhookEndpointStoreLike } from "./merchant-webhook-endpoint-store.js";
import { WebhookEndpointValidationError } from "./merchant-webhook-endpoint-store.js";

export interface MerchantWebhookEndpointRoutesOptions {
  readonly store: MerchantWebhookEndpointStoreLike;
}

function sendValidationError(reply: FastifyReply, message: string): void {
  void reply.status(400).send({ error: { code: "INVALID_FORMAT", message } });
}

function sendNotFound(reply: FastifyReply): void {
  void reply
    .status(404)
    .send({ error: { code: "NOT_FOUND", message: "The requested resource was not found" } });
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

const POST_ROUTE = "/control/v1/merchants/:merchantId/webhook-endpoint";
const GET_ROUTE = "/control/v1/merchants/:merchantId/webhook-endpoint";

export async function merchantWebhookEndpointRoutesPlugin(
  fastify: FastifyInstance,
  options: MerchantWebhookEndpointRoutesOptions,
): Promise<void> {
  const { store } = options;

  registerRoutePermission(`POST:${POST_ROUTE}`, { permission: "identity.scope.manage" });
  registerRoutePermission(`GET:${GET_ROUTE}`, { permission: "identity.scope.read" });

  fastify.post(POST_ROUTE, async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as Record<string, string>;
    const merchantId = params["merchantId"] ?? "";

    if (!verifyMerchantAccess(request, merchantId)) {
      sendNotFound(reply);
      return;
    }

    const body = request.body as Record<string, unknown> | undefined;
    const url = body?.["url"];
    if (typeof url !== "string" || url.length === 0) {
      sendValidationError(reply, "Field 'url' is required");
      return;
    }

    try {
      const registration = await store.register(merchantId, url);
      void reply.status(200).send(registration);
    } catch (error) {
      if (error instanceof WebhookEndpointValidationError) {
        sendValidationError(reply, error.message);
        return;
      }
      throw error;
    }
  });

  fastify.get(GET_ROUTE, async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as Record<string, string>;
    const merchantId = params["merchantId"] ?? "";

    if (!verifyMerchantAccess(request, merchantId)) {
      sendNotFound(reply);
      return;
    }

    const status = await store.getStatus(merchantId);
    void reply.status(200).send(status);
  });
}
