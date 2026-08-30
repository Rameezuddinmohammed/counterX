/**
 * Merchant-facing refund-request routes: the merchant's half of the refund
 * RELAY (see refund-request-store.ts's header for the full design
 * rationale). The founder-visible surface for "the merchant is notified" —
 * a filed request becomes visible here; no email/SMS/webhook notification
 * exists in this codebase and none is added by this route.
 *
 *   GET /control/v1/merchants/:merchantId/refund-requests
 *     Lists this merchant's refund requests, newest first.
 *
 *   POST /control/v1/merchants/:merchantId/refund-requests/:refundRequestId/approve
 *     Approves a pending request — this is where the actual Razorpay
 *     refund call happens.
 *
 *   POST /control/v1/merchants/:merchantId/refund-requests/:refundRequestId/deny
 *     Denies a pending request — no external effect.
 *
 * Tenant isolation mirrors transaction-routes.ts's verifyTenantAccess
 * exactly: the merchantId is already named in the URL (not resolved from an
 * opaque id), so a wrong-tenant caller gets 403 here, matching the existing
 * GET /merchants/:merchantId/transactions convention in this same app —
 * unlike wallet-user-routes.ts/recurring-mandate-routes.ts's 404
 * existence-hiding pattern, which applies when the resource id itself (not
 * the tenant id) is the thing being looked up.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getActorContext, registerRoutePermission } from "@counter/http-api-kit";
import { RefundRequestNotFoundError, type RefundRequestStoreLike } from "./refund-request-store.js";

export interface RefundRequestRoutesOptions {
  readonly store: RefundRequestStoreLike;
}

function sendForbidden(reply: FastifyReply): void {
  void reply.status(403).send({
    error: { code: "FORBIDDEN", message: "Access denied for the requested merchant" },
  });
}

function sendNotFound(reply: FastifyReply): void {
  void reply
    .status(404)
    .send({ error: { code: "NOT_FOUND", message: "The requested resource was not found" } });
}

function verifyTenantAccess(request: FastifyRequest, merchantId: string): boolean {
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

const LIST_ROUTE = "/control/v1/merchants/:merchantId/refund-requests";
const APPROVE_ROUTE = "/control/v1/merchants/:merchantId/refund-requests/:refundRequestId/approve";
const DENY_ROUTE = "/control/v1/merchants/:merchantId/refund-requests/:refundRequestId/deny";

export async function refundRequestRoutesPlugin(
  fastify: FastifyInstance,
  options: RefundRequestRoutesOptions,
): Promise<void> {
  const { store } = options;

  registerRoutePermission(`GET:${LIST_ROUTE}`, { permission: "payment.refund.read" });
  registerRoutePermission(`POST:${APPROVE_ROUTE}`, { permission: "payment.refund.manage" });
  registerRoutePermission(`POST:${DENY_ROUTE}`, { permission: "payment.refund.manage" });

  fastify.get(LIST_ROUTE, async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as Record<string, string>;
    const merchantId = params["merchantId"] ?? "";
    if (!verifyTenantAccess(request, merchantId)) {
      sendForbidden(reply);
      return;
    }
    const refundRequests = await store.list(merchantId);
    void reply.send({ refundRequests });
  });

  fastify.post(APPROVE_ROUTE, async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as Record<string, string>;
    const merchantId = params["merchantId"] ?? "";
    const refundRequestId = params["refundRequestId"] ?? "";
    if (!verifyTenantAccess(request, merchantId)) {
      sendForbidden(reply);
      return;
    }
    const decidedBy = getActorContext(request)?.actor.id;
    if (decidedBy === undefined) {
      sendForbidden(reply);
      return;
    }

    try {
      const result = await store.approve(merchantId, refundRequestId, decidedBy);
      void reply.status(200).send(result);
    } catch (error) {
      if (error instanceof RefundRequestNotFoundError) {
        sendNotFound(reply);
        return;
      }
      void reply.status(502).send({
        error: {
          code: "UPSTREAM_ERROR",
          message: error instanceof Error ? error.message : "Could not execute the refund",
        },
      });
    }
  });

  fastify.post(DENY_ROUTE, async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as Record<string, string>;
    const merchantId = params["merchantId"] ?? "";
    const refundRequestId = params["refundRequestId"] ?? "";
    if (!verifyTenantAccess(request, merchantId)) {
      sendForbidden(reply);
      return;
    }
    const decidedBy = getActorContext(request)?.actor.id;
    if (decidedBy === undefined) {
      sendForbidden(reply);
      return;
    }

    try {
      const result = await store.deny(merchantId, refundRequestId, decidedBy);
      void reply.status(200).send(result);
    } catch {
      // deny() only ever throws RefundRequestNotFoundError (no external
      // call involved) — matches recurring-mandate-routes.ts's DELETE
      // handler's collapse-to-404 convention.
      sendNotFound(reply);
    }
  });
}
