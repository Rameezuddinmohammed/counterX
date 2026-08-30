/**
 * Self-serve merchant onboarding, Step 5: readiness check.
 *
 *   GET /control/v1/merchant-applications/:merchantId/readiness
 *     Runs the real ReadinessEngine over freshly-assembled evidence (see
 *     merchant-readiness-store.ts's header for the full disclosure of every
 *     judgment call). Auto-transitions VERIFYING -> SANDBOX_READY the moment
 *     the merchant is ready — see that file's header for why this endpoint
 *     performs the transition itself rather than requiring a second call.
 *
 * Same access-control shape as merchant-application-routes.ts.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getActorContext, registerRoutePermission } from "@counter/http-api-kit";
import type { MerchantReadinessServiceLike } from "./merchant-readiness-store.js";
import { MerchantReadinessError } from "./merchant-readiness-store.js";

export interface MerchantReadinessRoutesOptions {
  readonly service: MerchantReadinessServiceLike;
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

export async function merchantReadinessRoutesPlugin(
  fastify: FastifyInstance,
  options: MerchantReadinessRoutesOptions,
): Promise<void> {
  const { service } = options;

  registerRoutePermission("GET:/control/v1/merchant-applications/:merchantId/readiness", {
    permission: "identity.scope.read",
  });

  fastify.get(
    "/control/v1/merchant-applications/:merchantId/readiness",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = request.params as Record<string, string>;
      const merchantId = params["merchantId"] ?? "";

      if (!verifyMerchantAccess(request, merchantId)) {
        sendNotFound(reply);
        return;
      }

      try {
        const summary = await service.evaluate(merchantId);
        void reply.status(200).send(summary);
      } catch (error) {
        if (error instanceof MerchantReadinessError) {
          sendNotFound(reply);
          return;
        }
        throw error;
      }
    },
  );
}
