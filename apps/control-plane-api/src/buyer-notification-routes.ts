/**
 * Read-only buyer-facing notifications/invoices — Phase 2 of the
 * remote-MCP plan (notifications backbone). Serves
 * apps/local-mcp's notifications.list/invoices.get MCP tools, reading the
 * runtime.buyer_notifications projection populated by
 * apps/worker/src/outbox-dispatcher.ts.
 *
 *   GET /control/v1/wallets/:walletId/notifications
 *     Optional query param `type` filters to one notification_type (e.g.
 *     "merchant.order.fulfilled.v1" for an "invoices"/order-status view).
 *
 * Same access-control shape as wallet-user-routes.ts: the caller's own
 * wallet-scoped session (existence-hiding 404 for a mismatched wallet) or
 * a platform operator.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getActorContext, registerRoutePermission } from "@counter/http-api-kit";
import type { PostgresBuyerNotificationStore } from "@counter/data";

export interface BuyerNotificationRoutesOptions {
  readonly store: PostgresBuyerNotificationStore;
}

function sendNotFound(reply: FastifyReply): void {
  void reply
    .status(404)
    .send({ error: { code: "NOT_FOUND", message: "The requested resource was not found" } });
}

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

const ROUTE = "/control/v1/wallets/:walletId/notifications";

export async function buyerNotificationRoutesPlugin(
  fastify: FastifyInstance,
  options: BuyerNotificationRoutesOptions,
): Promise<void> {
  const { store } = options;

  registerRoutePermission(`GET:${ROUTE}`, { permission: "identity.scope.read" });

  fastify.get(ROUTE, async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as Record<string, string>;
    const walletId = params["walletId"] ?? "";

    if (!verifyWalletAccess(request, walletId)) {
      sendNotFound(reply);
      return;
    }

    const query = request.query as Record<string, string | undefined>;
    const limitRaw = query["limit"];
    const limit = limitRaw !== undefined ? Number.parseInt(limitRaw, 10) : undefined;
    const notificationType = query["type"];

    const notifications = await store.listForWallet(walletId, {
      ...(limit !== undefined && Number.isFinite(limit) ? { limit } : {}),
      ...(notificationType !== undefined ? { notificationType } : {}),
    });

    void reply.status(200).send({
      walletId,
      notifications: notifications.map((n) => ({
        id: n.id,
        notificationType: n.notificationType,
        transactionId: n.transactionId,
        payload: n.payload,
        createdAt: new Date(Number(n.createdAt)).toISOString(),
      })),
      total: notifications.length,
    });
  });
}
