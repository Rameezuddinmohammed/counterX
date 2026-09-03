/**
 * Recurring payment mandate routes (UPI Autopay / e-mandate registration).
 *
 * All routes require a wallet-owner-authenticated session (or a
 * platform-scoped actor) — mirrors wallet-user-routes.ts's
 * verifyWalletAccess existence-hiding pattern (404, not 403, for a wallet
 * that isn't yours) exactly.
 *
 *   POST /control/v1/wallets/:walletId/recurring-mandates
 *     Begins registration: creates/reuses a Razorpay customer, creates the
 *     registration order, returns checkout config (never the key secret)
 *     for the browser's Razorpay checkout widget.
 *
 *   POST /control/v1/wallets/:walletId/recurring-mandates/:referenceId/confirm
 *     Verifies the checkout widget's callback and activates the mandate.
 *
 *   DELETE /control/v1/wallets/:walletId/recurring-mandates/:referenceId
 *     Revokes the mandate (cancels the Razorpay token if it was active).
 *
 *   GET /control/v1/wallets/:walletId/recurring-mandates
 *     Lists the wallet's mandates for display in the onboarding UI.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getActorContext, registerRoutePermission } from "@counter/http-api-kit";
import type { RecurringMandateProvisionerLike } from "./recurring-mandate-store.js";

export interface RecurringMandateRoutesOptions {
  readonly provisioner: RecurringMandateProvisionerLike;
}

function sendValidationError(reply: FastifyReply, message: string): void {
  void reply.status(400).send({ error: { code: "INVALID_FORMAT", message } });
}

function sendNotFound(reply: FastifyReply): void {
  void reply
    .status(404)
    .send({ error: { code: "NOT_FOUND", message: "The requested resource was not found" } });
}

/** Same existence-hiding contract as wallet-user-routes.ts's verifyWalletAccess. */
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

function requireString(
  body: Record<string, unknown> | undefined,
  field: string,
): string | undefined {
  const value = body?.[field];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export async function recurringMandateRoutesPlugin(
  fastify: FastifyInstance,
  options: RecurringMandateRoutesOptions,
): Promise<void> {
  const { provisioner } = options;

  registerRoutePermission("POST:/control/v1/wallets/:walletId/recurring-mandates", {
    permission: "payment.mandate.manage",
  });
  registerRoutePermission(
    "POST:/control/v1/wallets/:walletId/recurring-mandates/:referenceId/confirm",
    { permission: "payment.mandate.manage" },
  );
  registerRoutePermission("DELETE:/control/v1/wallets/:walletId/recurring-mandates/:referenceId", {
    permission: "payment.mandate.manage",
  });
  registerRoutePermission("GET:/control/v1/wallets/:walletId/recurring-mandates", {
    permission: "payment.mandate.read",
  });

  fastify.post(
    "/control/v1/wallets/:walletId/recurring-mandates",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = request.params as Record<string, string>;
      const walletId = params["walletId"] ?? "";
      if (!verifyWalletAccess(request, walletId)) {
        sendNotFound(reply);
        return;
      }

      const body = request.body as Record<string, unknown> | undefined;
      const contactName = requireString(body, "contactName");
      const contactEmail = requireString(body, "contactEmail");
      const contactPhone = requireString(body, "contactPhone");
      const validUntil = requireString(body, "validUntil");
      const ceilingMinorRaw = body?.["ceilingMinor"];
      const eligibleMerchants = body?.["eligibleMerchants"];
      const eligibleOperations = body?.["eligibleOperations"];

      if (contactName === undefined) {
        sendValidationError(reply, "Field 'contactName' is required");
        return;
      }
      if (contactEmail === undefined) {
        sendValidationError(reply, "Field 'contactEmail' is required");
        return;
      }
      if (contactPhone === undefined) {
        sendValidationError(reply, "Field 'contactPhone' is required");
        return;
      }
      if (validUntil === undefined) {
        sendValidationError(reply, "Field 'validUntil' is required");
        return;
      }
      if (typeof ceilingMinorRaw !== "string" && typeof ceilingMinorRaw !== "number") {
        sendValidationError(reply, "Field 'ceilingMinor' is required");
        return;
      }
      let ceilingMinor: bigint;
      try {
        ceilingMinor = BigInt(ceilingMinorRaw);
      } catch {
        sendValidationError(reply, "Field 'ceilingMinor' must be a whole number of minor units");
        return;
      }
      if (ceilingMinor <= 0n) {
        sendValidationError(reply, "Field 'ceilingMinor' must be positive");
        return;
      }
      if (
        !Array.isArray(eligibleMerchants) ||
        !eligibleMerchants.every((m) => typeof m === "string")
      ) {
        sendValidationError(reply, "Field 'eligibleMerchants' must be an array of strings");
        return;
      }
      if (
        !Array.isArray(eligibleOperations) ||
        !eligibleOperations.every((o) => typeof o === "string")
      ) {
        sendValidationError(reply, "Field 'eligibleOperations' must be an array of strings");
        return;
      }

      const actorContext = getActorContext(request);
      const principalId = actorContext?.actor.id;
      if (principalId === undefined) {
        sendValidationError(reply, "Could not resolve the calling actor");
        return;
      }

      try {
        const result = await provisioner.beginRegistration({
          walletId,
          principalId,
          contactName,
          contactEmail,
          contactPhone,
          ceilingMinor,
          validUntil,
          eligibleMerchants,
          eligibleOperations,
        });
        void reply.status(201).send(result);
      } catch (error) {
        void reply.status(502).send({
          error: {
            code: "UPSTREAM_ERROR",
            message:
              error instanceof Error ? error.message : "Could not begin mandate registration",
          },
        });
      }
    },
  );

  fastify.post(
    "/control/v1/wallets/:walletId/recurring-mandates/:referenceId/confirm",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = request.params as Record<string, string>;
      const walletId = params["walletId"] ?? "";
      const referenceId = params["referenceId"] ?? "";
      if (!verifyWalletAccess(request, walletId)) {
        sendNotFound(reply);
        return;
      }

      const body = request.body as Record<string, unknown> | undefined;
      const razorpayOrderId = requireString(body, "razorpayOrderId");
      const razorpayPaymentId = requireString(body, "razorpayPaymentId");
      const razorpaySignature = requireString(body, "razorpaySignature");
      if (
        razorpayOrderId === undefined ||
        razorpayPaymentId === undefined ||
        razorpaySignature === undefined
      ) {
        sendValidationError(
          reply,
          "Fields 'razorpayOrderId', 'razorpayPaymentId', and 'razorpaySignature' are required",
        );
        return;
      }

      try {
        const result = await provisioner.confirmRegistration({
          walletId,
          referenceId,
          razorpayOrderId,
          razorpayPaymentId,
          razorpaySignature,
        });
        void reply.status(200).send(result);
      } catch (error) {
        void reply.status(400).send({
          error: {
            code: "CONFIRMATION_FAILED",
            message:
              error instanceof Error ? error.message : "Could not confirm mandate registration",
          },
        });
      }
    },
  );

  fastify.delete(
    "/control/v1/wallets/:walletId/recurring-mandates/:referenceId",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = request.params as Record<string, string>;
      const walletId = params["walletId"] ?? "";
      const referenceId = params["referenceId"] ?? "";
      if (!verifyWalletAccess(request, walletId)) {
        sendNotFound(reply);
        return;
      }

      const principalId = getActorContext(request)?.actor.id ?? "unknown";

      try {
        await provisioner.revoke(walletId, referenceId, principalId);
        void reply.status(204).send();
      } catch {
        sendNotFound(reply);
      }
    },
  );

  fastify.get(
    "/control/v1/wallets/:walletId/recurring-mandates",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = request.params as Record<string, string>;
      const walletId = params["walletId"] ?? "";
      if (!verifyWalletAccess(request, walletId)) {
        sendNotFound(reply);
        return;
      }

      const mandates = await provisioner.list(walletId);
      void reply.status(200).send({ mandates });
    },
  );
}
