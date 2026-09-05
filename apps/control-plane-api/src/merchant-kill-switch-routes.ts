/**
 * Merchant-scoped kill switch: a real, durable on/off gate a merchant can
 * flip themselves to halt their OWN store's agent-driven purchases, backed
 * by @counter/data's AsyncKillSwitchStore / runtime.kill_switches (the same
 * durable store the worker's real checkout path already consults BEFORE
 * any external effect — see apps/worker/src/boot.ts's
 * createPostgresKillSwitchGatePort). This route is the first HTTP surface
 * over that store; it existed as a real, tested primitive with no route on
 * top of it until now.
 *
 * SCOPE, disclosed: this route only ever activates/deactivates/reads the
 * `merchant` scope for the caller's OWN merchantId — a merchant can never
 * touch the `global` or another merchant's `wallet`/`merchant` switch
 * through this route. That is a deliberate narrowing of
 * AsyncKillSwitchStore's general shape (which supports all three scopes)
 * to the one capability this task actually asked for: "a merchant can halt
 * their own store." A platform operator may act on behalf of the merchant
 * too (existing verifyTenantAccess pattern), but still only against that
 * merchant's own `merchant`-scope switch — global/other-merchant control
 * is intentionally out of reach from this route.
 *
 *   POST /control/v1/merchants/:merchantId/kill-switch
 *     Body: { active: boolean, reason?: string }
 *     active=true  -> recordActivate({scope:'merchant', entityId:merchantId, reason})
 *     active=false -> deactivate('merchant', merchantId)
 *   GET  /control/v1/merchants/:merchantId/kill-switch
 *     Returns { active: boolean, reason: string | null, activatedAt: string | null }
 *
 * Same access-control shape as policy-routes.ts / transaction-routes.ts:
 * the caller's own merchant-scoped session (scope.merchantId === :merchantId)
 * or a platform operator.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getActorContext, registerRoutePermission } from "@counter/http-api-kit";
import type { AsyncKillSwitchStore } from "@counter/data";
import type { Instant } from "@counter/domain";

function now(): Instant {
  return Date.now() as Instant;
}

export interface MerchantKillSwitchRoutesOptions {
  readonly store: AsyncKillSwitchStore;
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

function actorLabel(request: FastifyRequest): string {
  const actorContext = getActorContext(request);
  if (actorContext === undefined) {
    return "unknown";
  }
  return `${actorContext.actor.kind}:${actorContext.actor.id}`;
}

interface ActivateBody {
  readonly active?: unknown;
  readonly reason?: unknown;
}

const ROUTE = "/control/v1/merchants/:merchantId/kill-switch";
const DEFAULT_REASON = "Activated from the merchant console";

export async function merchantKillSwitchRoutesPlugin(
  fastify: FastifyInstance,
  options: MerchantKillSwitchRoutesOptions,
): Promise<void> {
  const { store } = options;

  registerRoutePermission(`POST:${ROUTE}`, { permission: "identity.scope.manage" });
  registerRoutePermission(`GET:${ROUTE}`, { permission: "identity.scope.read" });

  fastify.post(ROUTE, async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as Record<string, string>;
    const merchantId = params["merchantId"] ?? "";

    if (!verifyTenantAccess(request, merchantId)) {
      void reply.status(403).send({
        error: { code: "FORBIDDEN", message: "Access denied for the requested merchant" },
      });
      return;
    }

    const body = (request.body ?? {}) as ActivateBody;
    if (typeof body.active !== "boolean") {
      void reply.status(400).send({
        error: { code: "INVALID_FORMAT", message: "Body must include a boolean 'active' field" },
      });
      return;
    }

    if (body.active) {
      const reason =
        typeof body.reason === "string" && body.reason.trim().length > 0
          ? body.reason.trim()
          : DEFAULT_REASON;
      const result = await store.recordActivate(
        {
          scope: "merchant",
          entityId: merchantId,
          reason,
          activatedBy: actorLabel(request),
        },
        now(),
      );
      if (!result.ok) {
        void reply
          .status(400)
          .send({ error: { code: result.error.code, message: result.error.message } });
        return;
      }
      void reply.status(200).send({
        active: true,
        reason: result.value.reason,
        activatedAt: new Date(result.value.activatedAt).toISOString(),
      });
      return;
    }

    const result = await store.deactivate("merchant", merchantId);
    if (!result.ok) {
      void reply
        .status(400)
        .send({ error: { code: result.error.code, message: result.error.message } });
      return;
    }
    void reply.status(200).send({ active: false, reason: null, activatedAt: null });
  });

  fastify.get(ROUTE, async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as Record<string, string>;
    const merchantId = params["merchantId"] ?? "";

    if (!verifyTenantAccess(request, merchantId)) {
      void reply.status(403).send({
        error: { code: "FORBIDDEN", message: "Access denied for the requested merchant" },
      });
      return;
    }

    const activeResult = await store.isActive("merchant", merchantId, now());
    if (!activeResult.ok) {
      void reply
        .status(400)
        .send({ error: { code: activeResult.error.code, message: activeResult.error.message } });
      return;
    }

    if (!activeResult.value) {
      void reply.status(200).send({ active: false, reason: null, activatedAt: null });
      return;
    }

    const listResult = await store.listActive(now());
    if (!listResult.ok) {
      void reply
        .status(400)
        .send({ error: { code: listResult.error.code, message: listResult.error.message } });
      return;
    }
    const row = listResult.value.find(
      (entry) => entry.scope === "merchant" && entry.entityId === merchantId,
    );

    void reply.status(200).send({
      active: true,
      reason: row?.reason ?? null,
      activatedAt: row !== undefined ? new Date(row.activatedAt).toISOString() : null,
    });
  });
}
