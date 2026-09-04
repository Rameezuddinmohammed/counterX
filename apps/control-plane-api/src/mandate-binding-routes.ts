/**
 * Wallet-mandate binding route: durably persists a Counter-native
 * WalletMandate from an already-signed CTP counter.mandate.v1 envelope
 * (built and signed client-side, e.g. by apps/local-mcp or wallet-console
 * holding the buyer's own key). If the envelope claims a real provider
 * mandate (e.g. a confirmed Razorpay UPI Autopay registration), binding is
 * clamped to it; otherwise the mandate is accepted directly on the
 * strength of the buyer's own step-up-authenticated signature — see
 * mandate-binding-store.ts's header (INTERIM BINDING RULE) for the full
 * rationale.
 *
 * Requires a wallet-owner-authenticated session (or a platform-scoped
 * actor) — mirrors recurring-mandate-routes.ts's verifyWalletAccess
 * existence-hiding pattern (404, not 403, for a wallet that isn't yours)
 * exactly. Reuses the payment.mandate.manage permission, which already
 * carries a step-up assurance requirement — granting an agent spending
 * authority is held to the same trust bar as registering the underlying
 * payment mandate.
 *
 *   POST /control/v1/wallets/:walletId/mandates
 *     Body: { envelope: <signed CTP counter.mandate.v1 envelope> }
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getActorContext, registerRoutePermission } from "@counter/http-api-kit";
import type { MandateBindingService } from "./mandate-binding-store.js";

export interface MandateBindingRoutesOptions {
  readonly bindingService: MandateBindingService;
}

function sendValidationError(reply: FastifyReply, message: string): void {
  void reply.status(400).send({ error: { code: "INVALID_FORMAT", message } });
}

function sendNotFound(reply: FastifyReply): void {
  void reply
    .status(404)
    .send({ error: { code: "NOT_FOUND", message: "The requested resource was not found" } });
}

/** Same existence-hiding contract as recurring-mandate-routes.ts's verifyWalletAccess. */
function verifyWalletAccess(request: FastifyRequest, walletId: string): boolean {
  const actorContext = getActorContext(request);
  if (actorContext === undefined) {
    return false;
  }
  const scope = actorContext.scope;
  if (scope.kind === "platform") {
    return true;
  }
  if (scope.kind === "wallet") {
    return scope.walletId === walletId;
  }
  return false;
}

const ERROR_STATUS: Record<string, number> = {
  INVALID_ENVELOPE: 400,
  SIGNATURE_INVALID: 401,
  WALLET_MISMATCH: 400,
  AGENT_NOT_OWNED: 400,
  NO_ACTIVE_PROVIDER_MANDATE: 409,
  EXCEEDS_PROVIDER_MANDATE: 422,
  PERSIST_FAILED: 502,
};

export async function mandateBindingRoutesPlugin(
  fastify: FastifyInstance,
  options: MandateBindingRoutesOptions,
): Promise<void> {
  const { bindingService } = options;

  registerRoutePermission("POST:/control/v1/wallets/:walletId/mandates", {
    permission: "payment.mandate.manage",
  });

  fastify.post(
    "/control/v1/wallets/:walletId/mandates",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = request.params as Record<string, string>;
      const walletId = params["walletId"] ?? "";
      if (!verifyWalletAccess(request, walletId)) {
        sendNotFound(reply);
        return;
      }

      const body = request.body as Record<string, unknown> | undefined;
      const envelope = body?.["envelope"];
      if (envelope === undefined || typeof envelope !== "object") {
        sendValidationError(
          reply,
          "Field 'envelope' (a signed CTP counter.mandate.v1 envelope) is required",
        );
        return;
      }

      const result = await bindingService.bind(walletId, envelope, new Date());
      if (!result.ok) {
        const status = ERROR_STATUS[result.error.code] ?? 400;
        void reply.status(status).send({ error: result.error });
        return;
      }

      void reply.status(201).send(result.value);
    },
  );
}
