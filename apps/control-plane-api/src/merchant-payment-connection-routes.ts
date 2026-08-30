/**
 * Self-serve merchant onboarding, Step 4: own-gateway Razorpay connect.
 * See merchant-payment-connection-store.ts's header for the full scope
 * boundary (own-gateway ONLY, not wired into the real checkout path yet).
 *
 *   POST /control/v1/merchant-applications/:merchantId/payment-connection
 *   GET  /control/v1/merchant-applications/:merchantId/payment-connection
 *
 * Same access-control shape as merchant-application-routes.ts: the caller's
 * own merchant-scoped session (existence-hiding 404 for a mismatched
 * merchant) or a platform operator. POST requires identity.scope.manage
 * (elevated assurance), GET requires identity.scope.read.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getActorContext, registerRoutePermission } from "@counter/http-api-kit";
import type { MerchantPaymentConnectionStoreLike } from "./merchant-payment-connection-store.js";
import { PaymentConnectionError } from "./merchant-payment-connection-store.js";

export interface MerchantPaymentConnectionRoutesOptions {
  readonly store: MerchantPaymentConnectionStoreLike;
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

export async function merchantPaymentConnectionRoutesPlugin(
  fastify: FastifyInstance,
  options: MerchantPaymentConnectionRoutesOptions,
): Promise<void> {
  const { store } = options;

  registerRoutePermission("POST:/control/v1/merchant-applications/:merchantId/payment-connection", {
    permission: "identity.scope.manage",
  });
  registerRoutePermission("GET:/control/v1/merchant-applications/:merchantId/payment-connection", {
    permission: "identity.scope.read",
  });

  fastify.post(
    "/control/v1/merchant-applications/:merchantId/payment-connection",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = request.params as Record<string, string>;
      const merchantId = params["merchantId"] ?? "";

      if (!verifyMerchantAccess(request, merchantId)) {
        sendNotFound(reply);
        return;
      }

      const body = request.body as Record<string, unknown> | undefined;
      const keyId = body?.["keyId"];
      const keySecret = body?.["keySecret"];

      if (typeof keyId !== "string" || keyId.length === 0) {
        sendValidationError(reply, "Field 'keyId' is required");
        return;
      }
      if (typeof keySecret !== "string" || keySecret.length === 0) {
        sendValidationError(reply, "Field 'keySecret' is required");
        return;
      }

      try {
        const status = await store.connectRazorpay(merchantId, { keyId, keySecret });
        void reply.status(200).send(status);
      } catch (error) {
        if (error instanceof PaymentConnectionError) {
          sendValidationError(reply, error.message);
          return;
        }
        throw error;
      }
    },
  );

  fastify.get(
    "/control/v1/merchant-applications/:merchantId/payment-connection",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = request.params as Record<string, string>;
      const merchantId = params["merchantId"] ?? "";

      if (!verifyMerchantAccess(request, merchantId)) {
        sendNotFound(reply);
        return;
      }

      const status = await store.getConnectionStatus(merchantId);
      void reply.status(200).send(status);
    },
  );
}
