/**
 * Prepaid-balance-backed wallet-mandate binding route: durably persists a
 * Counter-native WalletMandate from an already-signed CTP
 * counter.mandate.v1 envelope (built and signed client-side, e.g. by
 * apps/local-mcp holding the buyer's own key), bound to the wallet's
 * PREPAID BALANCE account instead of a provider recurring mandate — see
 * prepaid-balance-mandate-binding-store.ts's header for the full design.
 *
 * Identical request/auth shape to mandate-binding-routes.ts (same
 * wallet-owner-authenticated session, same payment.mandate.manage
 * permission with step-up assurance, same existence-hiding 404-not-403
 * pattern) — deliberately a SEPARATE route, not a query-param branch on the
 * existing one, so the two authority models never share a code path.
 *
 *   POST /control/v1/wallets/:walletId/prepaid-mandates
 *     Body: { envelope: <signed CTP counter.mandate.v1 envelope> }
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getActorContext, registerRoutePermission } from "@counter/http-api-kit";
import type { PrepaidBalanceMandateBindingService } from "./prepaid-balance-mandate-binding-store.js";

export interface PrepaidBalanceMandateBindingRoutesOptions {
  readonly bindingService: PrepaidBalanceMandateBindingService;
}

function sendValidationError(reply: FastifyReply, message: string): void {
  void reply.status(400).send({ error: { code: "INVALID_FORMAT", message } });
}

function sendNotFound(reply: FastifyReply): void {
  void reply
    .status(404)
    .send({ error: { code: "NOT_FOUND", message: "The requested resource was not found" } });
}

/** Same existence-hiding contract as mandate-binding-routes.ts's verifyWalletAccess. */
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
  NO_PREPAID_BALANCE_ACCOUNT: 409,
  EXCEEDS_PREPAID_POLICY: 422,
  PERSIST_FAILED: 502,
};

export async function prepaidBalanceMandateBindingRoutesPlugin(
  fastify: FastifyInstance,
  options: PrepaidBalanceMandateBindingRoutesOptions,
): Promise<void> {
  const { bindingService } = options;

  registerRoutePermission("POST:/control/v1/wallets/:walletId/prepaid-mandates", {
    permission: "payment.mandate.manage",
  });

  fastify.post(
    "/control/v1/wallets/:walletId/prepaid-mandates",
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
