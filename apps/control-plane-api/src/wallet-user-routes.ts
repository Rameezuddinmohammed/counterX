/**
 * Self-serve wallet onboarding routes.
 *
 *   POST /control/v1/wallet-users/provision
 *     Requires platform scope + identity.scope.manage — held by a real
 *     human platform operator, OR by the narrow "service.onboarding"
 *     machine credential the Auth0 Credentials Exchange Action stamps for
 *     the Post-Login Action (see packages/authorization/src/catalog.ts —
 *     it is the one deliberate exception to "machine credentials are
 *     read-only"). Called the instant someone logs in — never by a browser
 *     directly. Idempotent: the same Auth0 subject always gets the same
 *     wallet back.
 *
 *   POST /control/v1/wallet-users/:walletId/setup-tokens
 *     The logged-in wallet owner's own session mints a short-lived,
 *     single-use token for their local setup script to use next.
 *
 *   POST /control/v1/wallet-users/agent-keys
 *     Deliberately UNAUTHENTICATED (registered in skipAuthRoutes) — a fresh
 *     local script has no browser session or JWT at all. The setup token
 *     itself, minted by the route above, is the entire proof of identity
 *     here: single-use, 15-minute expiry, and only ever transmitted to the
 *     person who was just looking at their own "connect" page.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getActorContext, registerRoutePermission } from "@counter/http-api-kit";
import type { WalletUserProvisionerLike } from "./wallet-user-store.js";

export interface WalletUserRoutesOptions {
  readonly provisioner: WalletUserProvisionerLike;
}

function sendValidationError(reply: FastifyReply, message: string): void {
  void reply.status(400).send({ error: { code: "INVALID_FORMAT", message } });
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

export async function walletUserRoutesPlugin(
  fastify: FastifyInstance,
  options: WalletUserRoutesOptions,
): Promise<void> {
  const { provisioner } = options;

  registerRoutePermission("POST:/control/v1/wallet-users/provision", {
    permission: "identity.scope.manage",
  });
  registerRoutePermission("POST:/control/v1/wallet-users/:walletId/setup-tokens", {
    permission: "identity.agent_key.manage",
  });

  fastify.post(
    "/control/v1/wallet-users/provision",
    async (request: FastifyRequest, reply: FastifyReply) => {
      // identity.scope.manage is also granted by wallet.owner (for managing
      // one's own wallet-scoped resources) — without this check, any logged-in
      // wallet owner's own session token could call this route and provision
      // an arbitrary auth0Subject. Only a platform-scoped actor may call it.
      const actorContext = getActorContext(request);
      if (actorContext?.scope.kind !== "platform") {
        void reply.status(403).send({
          error: { code: "UNAUTHORIZED", message: "Requires platform scope" },
        });
        return;
      }

      const body = request.body as Record<string, unknown> | undefined;
      const auth0Subject = body?.["auth0Subject"];
      if (typeof auth0Subject !== "string" || auth0Subject.length === 0) {
        sendValidationError(reply, "Field 'auth0Subject' is required");
        return;
      }

      const result = await provisioner.provisionForAuth0Subject(auth0Subject);
      void reply.status(result.created ? 201 : 200).send({
        walletId: result.walletId,
        walletUserActorId: result.walletUserActorId,
        created: result.created,
      });
    },
  );

  fastify.post(
    "/control/v1/wallet-users/:walletId/setup-tokens",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = request.params as Record<string, string>;
      const walletId = params["walletId"] ?? "";

      if (!verifyWalletAccess(request, walletId)) {
        void reply.status(404).send({
          error: { code: "NOT_FOUND", message: "The requested resource was not found" },
        });
        return;
      }

      const result = await provisioner.mintSetupToken(walletId);
      void reply.status(201).send(result);
    },
  );

  fastify.post(
    "/control/v1/wallet-users/agent-keys",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as Record<string, unknown> | undefined;
      const setupToken = body?.["setupToken"];
      const keyId = body?.["keyId"];
      const publicKeyBase64Url = body?.["publicKeyBase64Url"];
      if (typeof setupToken !== "string" || setupToken.length === 0) {
        sendValidationError(reply, "Field 'setupToken' is required");
        return;
      }
      if (typeof keyId !== "string" || keyId.length === 0) {
        sendValidationError(reply, "Field 'keyId' is required");
        return;
      }
      if (typeof publicKeyBase64Url !== "string" || publicKeyBase64Url.length === 0) {
        sendValidationError(reply, "Field 'publicKeyBase64Url' is required");
        return;
      }

      const walletId = await provisioner.redeemSetupToken(setupToken);
      if (walletId === undefined) {
        void reply.status(401).send({
          error: {
            code: "UNAUTHORIZED",
            message: "Setup token is invalid, expired, or already used",
          },
        });
        return;
      }

      const result = await provisioner.registerAgentKey(walletId, keyId, publicKeyBase64Url);

      // Best-effort: a fresh agent is real and usable even if this fails, it
      // just falls back to the old "ask Counter for a runtime credential"
      // path. Never let a runtime-credential problem fail key registration —
      // that write already durably succeeded above.
      let runtimeCredential: { runtimeUrl: string; runtimeAuthToken: string } | undefined;
      try {
        const credential = await provisioner.mintRuntimeCredential();
        runtimeCredential = {
          runtimeUrl: credential.runtimeUrl,
          runtimeAuthToken: credential.runtimeAuthToken,
        };
      } catch {
        runtimeCredential = undefined;
      }

      void reply.status(201).send({
        walletId,
        agentId: result.agentId,
        keyId: result.keyId,
        ...(runtimeCredential ?? {}),
      });
    },
  );
}
