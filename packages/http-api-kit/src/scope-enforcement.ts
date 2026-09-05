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

function getRouteKey(request: FastifyRequest): string | undefined {
  // `routeOptions.url` is the matched route PATTERN (e.g.
  // "/control/v1/merchants/:merchantId/shopify/connection"). It is undefined
  // when nothing matched at all and Fastify is on its way to the 404
  // handler — root-level onRequest hooks run for that path too. Returning
  // undefined here (rather than falling back to the concrete request.url,
  // which can never be a registered permission key) is what lets the caller
  // hand an unmatched request to the real 404 handler instead of answering
  // a deny-by-default 403.
  const routerPath = request.routeOptions?.url;
  return routerPath === undefined ? undefined : `${request.method}:${routerPath}`;
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
      if (routeKey === undefined) {
        // No route matched this request at all, so there is no handler that
        // could run and nothing to authorize — let Fastify's own 404 handler
        // answer. Previously this fell through to the deny-by-default branch
        // below and returned 403 "not authorized" for a path that simply does
        // not exist, which actively misled debugging: an optional feature
        // whose routes were never registered (self-serve Shopify connect,
        // when SHOPIFY_OAUTH_* is unset) looked like a permissions bug on a
        // route that was working fine. Deny-by-default still applies in full
        // to every route that DOES exist but declares no permission.
        return;
      }
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
        // Deliberately DISTINGUISHED from the permission failures above.
        // The actor genuinely holds this permission; only the strength of
        // their current sign-in falls short, and that is something they can
        // fix themselves by re-authenticating. Collapsing it into the same
        // opaque "not authorized" made a completely ordinary situation — a
        // brand-new merchant whose plain social login stamped
        // assurance "session" trying to save any onboarding step — look
        // like a broken permission system, with no hint that signing in
        // again was the answer (hit for real, 2026-09-05).
        //
        // Safe to disclose: this describes the CALLER'S OWN session, never
        // another tenant's data or the existence of a resource, so it
        // leaks nothing the caller does not already know about themselves.
        // Mirrors OAuth's own `insufficient_user_authentication`
        // (RFC 9470 step-up authentication challenge).
        void reply.status(403).send({
          error: {
            code: "STEP_UP_REQUIRED",
            message:
              "This action needs stronger sign-in verification than your current session has. " +
              "Sign out and sign in again to continue.",
          },
        });
        return reply;
      }
    });
  },
  { name: "counter-scope-enforcement" },
);
