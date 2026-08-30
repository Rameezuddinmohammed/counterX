/**
 * Self-serve merchant onboarding, Step 6: manifest confirmation.
 *
 *   POST /control/v1/merchant-applications/:merchantId/manifest
 *     Generates and persists the merchant's CapabilityManifest. Requires
 *     SANDBOX_READY (or later) — see merchant-manifest-store.ts.
 *   GET  /control/v1/merchant-applications/:merchantId/manifest
 *     Returns the persisted manifest, 404 if none generated yet.
 *
 * Same access-control shape as merchant-application-routes.ts.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getActorContext, registerRoutePermission } from "@counter/http-api-kit";
import type { MerchantManifestStoreLike } from "./merchant-manifest-store.js";
import { MerchantManifestError } from "./merchant-manifest-store.js";

export interface MerchantManifestRoutesOptions {
  readonly store: MerchantManifestStoreLike;
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

export async function merchantManifestRoutesPlugin(
  fastify: FastifyInstance,
  options: MerchantManifestRoutesOptions,
): Promise<void> {
  const { store } = options;

  registerRoutePermission("POST:/control/v1/merchant-applications/:merchantId/manifest", {
    permission: "identity.scope.manage",
  });
  registerRoutePermission("GET:/control/v1/merchant-applications/:merchantId/manifest", {
    permission: "identity.scope.read",
  });

  fastify.post(
    "/control/v1/merchant-applications/:merchantId/manifest",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = request.params as Record<string, string>;
      const merchantId = params["merchantId"] ?? "";

      if (!verifyMerchantAccess(request, merchantId)) {
        sendNotFound(reply);
        return;
      }

      try {
        const manifest = await store.generateAndPersist(merchantId);
        void reply.status(201).send(manifest);
      } catch (error) {
        if (error instanceof MerchantManifestError) {
          sendValidationError(reply, error.message);
          return;
        }
        throw error;
      }
    },
  );

  fastify.get(
    "/control/v1/merchant-applications/:merchantId/manifest",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = request.params as Record<string, string>;
      const merchantId = params["merchantId"] ?? "";

      if (!verifyMerchantAccess(request, merchantId)) {
        sendNotFound(reply);
        return;
      }

      const manifest = await store.getManifest(merchantId);
      if (manifest === undefined) {
        sendNotFound(reply);
        return;
      }
      void reply.status(200).send(manifest);
    },
  );
}
