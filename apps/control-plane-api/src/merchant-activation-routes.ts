/**
 * Operator-authenticated merchant activation: the ACTIVATION_REVIEW ->
 * ACTIVE gate.
 *
 *   POST /control/v1/merchant-applications/:merchantId/approve
 *     Approves a merchant sitting in ACTIVATION_REVIEW, moving it to
 *     ACTIVE via the real state machine (merchant-activation-store.ts).
 *     This is the one lifecycle transition in the whole self-serve wizard
 *     that a merchant's own session can NEVER trigger — see this route's
 *     verifyOperatorAccess below. Body: { reason: string } — a short
 *     human-readable note recorded as the transition's evidence (who
 *     approved this merchant and why), matching
 *     transitionMerchantLifecycle's real actor/reason/evidence recording.
 *
 * Authorization, disclosed rather than left to permission-registration
 * alone: registerRoutePermission below requires identity.scope.manage,
 * which several non-operator roles also hold (e.g. merchant.owner on its
 * own merchant scope, service.onboarding on platform scope for the
 * self-serve provisioning route) — permission membership ALONE is not
 * enough to keep this operator-only. verifyOperatorAccess additionally
 * requires the caller's actor.kind to literally be 'operator' AND its
 * scope.kind to be 'platform', which only the platform.operator role
 * grants (see packages/authorization/src/catalog.ts's ROLE_DEFINITIONS —
 * 'platform.operator' is the only role with actorKinds: ['operator']).
 * A non-operator caller — including a merchant approving its own
 * application, or the service.onboarding machine credential — gets 403,
 * not 404: unlike the merchant-scoped routes in this app,
 * existence-hiding doesn't apply here (this is a platform-wide admin
 * action, not a cross-tenant merchant lookup), so an unauthorized caller
 * is told plainly that they're forbidden.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getActorContext, registerRoutePermission } from "@counter/http-api-kit";
import type { MerchantActivationStoreLike } from "./merchant-activation-store.js";
import { MerchantActivationError } from "./merchant-activation-store.js";

export interface MerchantActivationRoutesOptions {
  readonly store: MerchantActivationStoreLike;
}

function sendValidationError(reply: FastifyReply, message: string): void {
  void reply.status(400).send({ error: { code: "INVALID_FORMAT", message } });
}

function sendNotFound(reply: FastifyReply): void {
  void reply
    .status(404)
    .send({ error: { code: "NOT_FOUND", message: "The requested resource was not found" } });
}

function sendForbidden(reply: FastifyReply): void {
  void reply.status(403).send({
    error: {
      code: "UNAUTHORIZED",
      message: "Only a platform operator may approve a merchant for activation",
    },
  });
}

function verifyOperatorAccess(request: FastifyRequest): string | undefined {
  const actorContext = getActorContext(request);
  if (actorContext === undefined) {
    return undefined;
  }
  if (actorContext.scope.kind !== "platform" || actorContext.actor.kind !== "operator") {
    return undefined;
  }
  return actorContext.actor.id;
}

export async function merchantActivationRoutesPlugin(
  fastify: FastifyInstance,
  options: MerchantActivationRoutesOptions,
): Promise<void> {
  const { store } = options;

  registerRoutePermission("POST:/control/v1/merchant-applications/:merchantId/approve", {
    permission: "identity.scope.manage",
  });

  fastify.post(
    "/control/v1/merchant-applications/:merchantId/approve",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const operatorId = verifyOperatorAccess(request);
      if (operatorId === undefined) {
        sendForbidden(reply);
        return;
      }

      const params = request.params as Record<string, string>;
      const merchantId = params["merchantId"] ?? "";

      const body = request.body as Record<string, unknown> | undefined;
      const reason = body?.["reason"];
      if (typeof reason !== "string" || reason.trim().length === 0) {
        sendValidationError(reply, "Field 'reason' is required");
        return;
      }

      try {
        const result = await store.approve(merchantId, operatorId, reason);
        void reply.status(200).send(result);
      } catch (error) {
        if (error instanceof MerchantActivationError) {
          if (error.message.startsWith("No such merchant application")) {
            sendNotFound(reply);
            return;
          }
          sendValidationError(reply, error.message);
          return;
        }
        throw error;
      }
    },
  );
}
