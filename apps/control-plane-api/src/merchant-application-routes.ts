/**
 * Self-serve merchant onboarding routes (Steps 0-2 of the onboarding
 * wizard: request access, business basics, catalog connect).
 *
 *   POST /control/v1/merchant-applications/provision
 *     JUDGMENT CALL, disclosed rather than left ambiguous: the wallet-user
 *     equivalent of this route (wallet-user-routes.ts) is called ONLY by
 *     Auth0's own Post-Login Action using a service credential — a real
 *     human's own session is never allowed to call it directly, because the
 *     Action ALSO stamps the resulting wallet scope onto that same login's
 *     ID token in one atomic step. Mirroring that exactly for merchants
 *     would require an Auth0 Post-Login Action that doesn't exist yet
 *     (dashboard/browser access this task doesn't have — genuinely out of
 *     scope for this pass, not skipped by oversight).
 *
 *     Rather than ship a wizard whose very first button does nothing until
 *     that Auth0 work lands, this route accepts EITHER:
 *       (a) a platform-scoped `service.onboarding` credential (the SAME
 *           grant wallet-user provisioning uses — see
 *           packages/authorization/src/catalog.ts), which may provision on
 *           behalf of an arbitrary caller-supplied auth0Subject, mirroring
 *           wallet-user-routes.ts exactly for the day an Auth0 Action calls
 *           this the same way; OR
 *       (b) a plain, real, Auth0-verified session with no Counter custom
 *           claims at all (the actual shape of a brand-new merchant-console
 *           user today, since no Post-Login Action stamps
 *           actor_kind/scope for merchant users yet) — in which case the
 *           route provisions for the CALLER'S OWN verified `sub` claim only,
 *           never a body-supplied one. This closes the impersonation hole a
 *           naive "trust any body-supplied auth0Subject" route would open:
 *           a claims-less caller can only ever provision themselves.
 *
 *     Route (b) requires relaxing actor-extraction's hard requirement for
 *     Counter's own custom claims — see this route's registration in
 *     skipActorClaimsRoutes (index.ts) and server-factory.ts's docs on that
 *     option. A real Bearer JWT is still mandatory (authPlugin is NOT
 *     skipped): an anonymous request is still rejected with 401.
 *
 *     KNOWN LIMITATION this discloses rather than hides: after this route
 *     succeeds, the merchant application row exists, but the SAME session's
 *     JWT does not gain merchant_user/merchant-scope claims — Auth0 tokens
 *     don't mutate mid-session, and no Post-Login Action re-stamps them on
 *     refresh either. So GET/PATCH below, which DO require real actor
 *     context, are not yet reachable by that same live browser session
 *     until the Auth0-side wiring lands. See this task's final report for
 *     the full implication.
 *
 *   GET /control/v1/merchant-applications/:merchantId
 *   PATCH /control/v1/merchant-applications/:merchantId/business-basics
 *     Normal actor-context-based access: the caller's own merchant-scoped
 *     session (matching :merchantId — existence-hiding 404 for a mismatched
 *     merchant, same shape as wallet-user-routes.ts's verifyWalletAccess) or
 *     a platform operator. Reuses identity.scope.read/identity.scope.manage
 *     — already granted to merchant.owner — rather than adding a new
 *     permission; PATCH therefore requires the SAME elevated assurance
 *     (multi_factor/step_up/service_authenticated) every other
 *     identity.scope.manage route already requires (see
 *     packages/authorization/src/assurance.ts).
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  getActorContext,
  getJwtPayload,
  registerRoutePermission,
  type JwtPayload,
} from "@counter/http-api-kit";
import type { MerchantApplicationProvisionerLike } from "./merchant-application-store.js";
import { MerchantApplicationValidationError } from "./merchant-application-store.js";

const CLAIMS_NAMESPACE = "https://counter.dev/";

export interface MerchantApplicationRoutesOptions {
  readonly provisioner: MerchantApplicationProvisionerLike;
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

/**
 * Reads the raw, signature-verified JWT payload directly (this route is
 * registered in skipActorClaimsRoutes, so getActorContext() is always
 * undefined here — see this file's header). Returns the trusted-service
 * caller's role/scope, or undefined for a plain claims-less session.
 */
function isOnboardingServiceCaller(payload: JwtPayload): boolean {
  const actorKind = payload[`${CLAIMS_NAMESPACE}actor_kind`];
  const scope = payload[`${CLAIMS_NAMESPACE}scope`] as { kind?: string } | undefined;
  const roles = payload[`${CLAIMS_NAMESPACE}roles`];
  return (
    actorKind === "service" &&
    scope?.kind === "platform" &&
    Array.isArray(roles) &&
    roles.includes("service.onboarding")
  );
}

export async function merchantApplicationRoutesPlugin(
  fastify: FastifyInstance,
  options: MerchantApplicationRoutesOptions,
): Promise<void> {
  const { provisioner } = options;

  // No registerRoutePermission call for the provision route: it is
  // registered in skipActorClaimsRoutes, so getActorContext() is always
  // undefined there and scope-enforcement's permission check would never
  // run anyway (see http-api-kit's scope-enforcement.ts — it no-ops when
  // actor context is undefined). The route does its own authorization
  // below instead. GET/PATCH below use real actor context and DO need a
  // registered permission.
  registerRoutePermission("GET:/control/v1/merchant-applications/:merchantId", {
    permission: "identity.scope.read",
  });
  registerRoutePermission("PATCH:/control/v1/merchant-applications/:merchantId/business-basics", {
    permission: "identity.scope.manage",
  });
  registerRoutePermission(
    "GET:/control/v1/merchant-applications/:merchantId/manual-catalog-items",
    {
      permission: "identity.scope.read",
    },
  );
  registerRoutePermission(
    "POST:/control/v1/merchant-applications/:merchantId/manual-catalog-items",
    {
      permission: "identity.scope.manage",
    },
  );
  registerRoutePermission("POST:/control/v1/merchant-applications/:merchantId/catalog-connected", {
    permission: "identity.scope.manage",
  });

  fastify.post(
    "/control/v1/merchant-applications/provision",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const payload = getJwtPayload(request);
      if (payload === undefined) {
        // authPlugin is NOT skipped for this route, so this should be
        // unreachable in practice — defensive only.
        void reply
          .status(401)
          .send({ error: { code: "UNAUTHENTICATED", message: "Authentication required" } });
        return;
      }

      let auth0Subject: string;
      if (isOnboardingServiceCaller(payload)) {
        const body = request.body as Record<string, unknown> | undefined;
        const bodySubject = body?.["auth0Subject"];
        if (typeof bodySubject !== "string" || bodySubject.length === 0) {
          sendValidationError(reply, "Field 'auth0Subject' is required");
          return;
        }
        auth0Subject = bodySubject;
      } else {
        // Plain session (any actor kind, or none at all): always provision
        // for the caller's OWN verified subject — never a body-supplied
        // one, so a claims-less caller can only ever provision themselves.
        auth0Subject = payload.sub;
      }

      const result = await provisioner.provisionForAuth0Subject(auth0Subject);
      void reply.status(result.created ? 201 : 200).send({
        merchantId: result.merchantId,
        merchantUserActorId: result.merchantUserActorId,
        created: result.created,
        lifecycleState: result.lifecycleState,
        approvalStatus: result.approvalStatus,
      });
    },
  );

  fastify.get(
    "/control/v1/merchant-applications/:merchantId",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = request.params as Record<string, string>;
      const merchantId = params["merchantId"] ?? "";

      if (!verifyMerchantAccess(request, merchantId)) {
        sendNotFound(reply);
        return;
      }

      const application = await provisioner.getApplication(merchantId);
      if (application === undefined) {
        sendNotFound(reply);
        return;
      }
      void reply.status(200).send(application);
    },
  );

  fastify.patch(
    "/control/v1/merchant-applications/:merchantId/business-basics",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = request.params as Record<string, string>;
      const merchantId = params["merchantId"] ?? "";

      if (!verifyMerchantAccess(request, merchantId)) {
        sendNotFound(reply);
        return;
      }

      const body = request.body as Record<string, unknown> | undefined;
      const legalEntityName = body?.["legalEntityName"];
      const contactEmail = body?.["contactEmail"];
      const contactPhone = body?.["contactPhone"];
      const goodsTypes = body?.["goodsTypes"];

      if (typeof legalEntityName !== "string" || legalEntityName.length === 0) {
        sendValidationError(reply, "Field 'legalEntityName' is required");
        return;
      }
      if (typeof contactEmail !== "string" || contactEmail.length === 0) {
        sendValidationError(reply, "Field 'contactEmail' is required");
        return;
      }
      if (contactPhone !== undefined && typeof contactPhone !== "string") {
        sendValidationError(reply, "Field 'contactPhone' must be a string");
        return;
      }
      if (!Array.isArray(goodsTypes) || goodsTypes.some((value) => typeof value !== "string")) {
        sendValidationError(reply, "Field 'goodsTypes' must be a non-empty array of strings");
        return;
      }

      try {
        const updated = await provisioner.updateBusinessBasics(merchantId, {
          legalEntityName,
          contactEmail,
          ...(contactPhone !== undefined ? { contactPhone } : {}),
          goodsTypes: goodsTypes as readonly string[],
        });
        void reply.status(200).send(updated);
      } catch (error) {
        if (error instanceof MerchantApplicationValidationError) {
          sendValidationError(reply, error.message);
          return;
        }
        throw error;
      }
    },
  );

  fastify.get(
    "/control/v1/merchant-applications/:merchantId/manual-catalog-items",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = request.params as Record<string, string>;
      const merchantId = params["merchantId"] ?? "";

      if (!verifyMerchantAccess(request, merchantId)) {
        sendNotFound(reply);
        return;
      }

      const items = await provisioner.listManualCatalogItems(merchantId);
      void reply.status(200).send({ items });
    },
  );

  fastify.post(
    "/control/v1/merchant-applications/:merchantId/manual-catalog-items",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = request.params as Record<string, string>;
      const merchantId = params["merchantId"] ?? "";

      if (!verifyMerchantAccess(request, merchantId)) {
        sendNotFound(reply);
        return;
      }

      const body = request.body as Record<string, unknown> | undefined;
      const name = body?.["name"];
      const description = body?.["description"];
      const priceMinor = body?.["priceMinor"];
      const currency = body?.["currency"];

      if (typeof name !== "string" || name.length === 0) {
        sendValidationError(reply, "Field 'name' is required");
        return;
      }
      if (description !== undefined && typeof description !== "string") {
        sendValidationError(reply, "Field 'description' must be a string");
        return;
      }
      if (typeof priceMinor !== "number") {
        sendValidationError(reply, "Field 'priceMinor' must be a number (smallest currency unit)");
        return;
      }
      if (typeof currency !== "string" || currency.length === 0) {
        sendValidationError(reply, "Field 'currency' is required");
        return;
      }

      try {
        const item = await provisioner.addManualCatalogItem(merchantId, {
          name,
          ...(description !== undefined ? { description } : {}),
          priceMinor,
          currency,
        });
        void reply.status(201).send(item);
      } catch (error) {
        if (error instanceof MerchantApplicationValidationError) {
          sendValidationError(reply, error.message);
          return;
        }
        throw error;
      }
    },
  );

  fastify.post(
    "/control/v1/merchant-applications/:merchantId/catalog-connected",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = request.params as Record<string, string>;
      const merchantId = params["merchantId"] ?? "";

      if (!verifyMerchantAccess(request, merchantId)) {
        sendNotFound(reply);
        return;
      }

      try {
        const updated = await provisioner.markCatalogConnected(merchantId);
        void reply.status(200).send(updated);
      } catch (error) {
        if (error instanceof MerchantApplicationValidationError) {
          sendValidationError(reply, error.message);
          return;
        }
        throw error;
      }
    },
  );
}
