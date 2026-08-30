/**
 * Scope enforcement middleware.
 *
 * Deny-by-default: routes must declare required permission(s). Requests
 * without the required permission receive a 403 response. A request whose
 * actor HAS the permission (via role membership) but whose current
 * authentication assurance is too weak for that specific permission (e.g.
 * a plain browser session where step-up/multi-factor is required) is
 * ALSO denied — see assurancePermits in @counter/authorization, which
 * defines this per-permission policy but was, until now, never actually
 * consulted by any HTTP route in the system: every route only checked
 * role-derived permission membership. Found and fixed while building the
 * recurring-payment-mandate feature, which is the first route to actually
 * need step-up assurance enforced for real.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { createCanonicalError } from "@counter/domain";
import type { Permission } from "@counter/authorization";
import { assurancePermits } from "@counter/authorization";
import { getActorContext } from "./actor-extraction.js";

export interface RoutePermissionConfig {
  readonly permission: Permission;
}

const routePermissions = new Map<string, RoutePermissionConfig>();

/**
 * Register a required permission for a route pattern.
 * The key format is "METHOD:path", e.g. "GET:/control/v1/scopes".
 */
export function registerRoutePermission(routeKey: string, config: RoutePermissionConfig): void {
  routePermissions.set(routeKey, config);
}

/**
 * Clear registered route permissions (useful for tests).
 */
export function clearRoutePermissions(): void {
  routePermissions.clear();
}

function getRouteKey(request: FastifyRequest): string {
  const routerPath = request.routeOptions?.url ?? request.url;
  return `${request.method}:${routerPath}`;
}

export interface ScopeEnforcementOptions {
  readonly skipRoutes?: readonly string[];
  readonly denyByDefault?: boolean;
}

export const scopeEnforcementPlugin = fp(
  async (fastify: FastifyInstance, options: ScopeEnforcementOptions): Promise<void> => {
    const skipRoutes = options.skipRoutes ?? [];
    const denyByDefault = options.denyByDefault ?? true;

    fastify.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
      for (const route of skipRoutes) {
        if (request.url === route || request.url.startsWith(route + "/")) {
          return;
        }
      }

      const actorContext = getActorContext(request);
      if (actorContext === undefined) {
        return;
      }

      const routeKey = getRouteKey(request);
      const permConfig = routePermissions.get(routeKey);

      if (permConfig === undefined) {
        if (denyByDefault) {
          const error = createCanonicalError("UNAUTHORIZED");
          void reply.status(403).send({
            error: { code: error.code, message: error.message },
          });
          return reply;
        }
        return;
      }

      if (!actorContext.permissions.includes(permConfig.permission)) {
        const error = createCanonicalError("UNAUTHORIZED");
        void reply.status(403).send({
          error: { code: error.code, message: error.message },
        });
        return reply;
      }

      if (!assurancePermits(actorContext.assurance, permConfig.permission)) {
        const error = createCanonicalError("UNAUTHORIZED");
        void reply.status(403).send({
          error: { code: error.code, message: error.message },
        });
        return reply;
      }
    });
  },
  { name: "counter-scope-enforcement" },
);
