/**
 * Hackathon-scoped merchant onboarding: "where do I receive crypto
 * payments." See merchant-wallet-connection-store.ts's header for the full
 * scope boundary (format validation only — no live on-chain verification).
 *
 *   POST /control/v1/merchant-applications/:merchantId/wallet-connection
 *   GET  /control/v1/merchant-applications/:merchantId/wallet-connection
 *
 * Same access-control shape as merchant-payment-connection-routes.ts: the
 * caller's own merchant-scoped session (existence-hiding 404 for a
 * mismatched merchant) or a platform operator. POST requires
 * identity.scope.manage (elevated assurance), GET requires
 * identity.scope.read.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getActorContext, registerRoutePermission } from "@counter/http-api-kit";
import type { MerchantWalletConnectionStoreLike } from "./merchant-wallet-connection-store.js";
import { WalletConnectionError } from "./merchant-wallet-connection-store.js";

export interface MerchantWalletConnectionRoutesOptions {
  readonly store: MerchantWalletConnectionStoreLike;
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

export async function merchantWalletConnectionRoutesPlugin(
  fastify: FastifyInstance,
  options: MerchantWalletConnectionRoutesOptions,
): Promise<void> {
  const { store } = options;

  registerRoutePermission("POST:/control/v1/merchant-applications/:merchantId/wallet-connection", {
    permission: "identity.scope.manage",
  });
  registerRoutePermission("GET:/control/v1/merchant-applications/:merchantId/wallet-connection", {
    permission: "identity.scope.read",
  });

  fastify.post(
    "/control/v1/merchant-applications/:merchantId/wallet-connection",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = request.params as Record<string, string>;
      const merchantId = params["merchantId"] ?? "";

      if (!verifyMerchantAccess(request, merchantId)) {
        sendNotFound(reply);
        return;
      }

      const body = request.body as Record<string, unknown> | undefined;
      const chain = body?.["chain"];
      const address = body?.["address"];

      if (typeof chain !== "string" || chain.length === 0) {
        sendValidationError(reply, "Field 'chain' is required");
        return;
      }
      if (typeof address !== "string" || address.length === 0) {
        sendValidationError(reply, "Field 'address' is required");
        return;
      }
      if (chain !== "solana-devnet") {
        sendValidationError(reply, "chain must be 'solana-devnet'");
        return;
      }

      try {
        const status = await store.connect(merchantId, { chain, address });
        void reply.status(200).send(status);
      } catch (error) {
        if (error instanceof WalletConnectionError) {
          sendValidationError(reply, error.message);
          return;
        }
        throw error;
      }
    },
  );

  fastify.get(
    "/control/v1/merchant-applications/:merchantId/wallet-connection",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = request.params as Record<string, string>;
      const merchantId = params["merchantId"] ?? "";

      if (!verifyMerchantAccess(request, merchantId)) {
        sendNotFound(reply);
        return;
      }

      const status = await store.getConnection(merchantId);
      void reply.status(200).send(status);
    },
  );
}
