/**
 * Read-only wallet-mandate listing — Phase 4 (wallet-dashboard backend) of
 * the remote-MCP plan. Serves both the future wallet-console dashboard and
 * apps/local-mcp's wallet.status MCP tool with the SAME real data: this
 * wallet's currently-active WalletMandate rows (packages/data's
 * PostgresMandateRepository, backing wallet.mandates — the same table
 * checkMandateAuthority itself reads before enqueueing a purchase).
 *
 *   GET /control/v1/wallets/:walletId/mandates
 *     Returns only status === "active" mandates (MandateRepository.findActive)
 *     — a revoked/expired mandate is real history but not "what can this
 *     agent do right now", which is what this route is for.
 *
 * Same access-control shape as buyer-notification-routes.ts /
 * mandate-binding-routes.ts: the caller's own wallet-scoped session
 * (existence-hiding 404 for a mismatched wallet) or a platform operator.
 *
 * SECURITY: a WalletMandate's `constraints` carry only spend limits/
 * allowlists (never a private key or raw payment credential), but its
 * bigint minor-unit fields (perTransactionMaxPaise, etc.) do not survive
 * Fastify's JSON serializer as-is — toWireConstraints below converts them to
 * decimal strings, the same wire convention mandate-binding-store.ts's own
 * response already uses.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getActorContext, registerRoutePermission } from "@counter/http-api-kit";
import type { CounterId } from "@counter/domain";
import type {
  BuyerPolicyConstraints,
  MandateRepository,
  WalletMandate,
} from "@counter/wallet-domain";

export interface WalletMandateRoutesOptions {
  readonly mandateRepository: MandateRepository;
}

function sendNotFound(reply: FastifyReply): void {
  void reply
    .status(404)
    .send({ error: { code: "NOT_FOUND", message: "The requested resource was not found" } });
}

/** Same existence-hiding contract as buyer-notification-routes.ts's verifyWalletAccess. */
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

function toWireConstraints(constraints: BuyerPolicyConstraints): Record<string, unknown> {
  return {
    ...constraints,
    amountLimits: {
      ...constraints.amountLimits,
      perTransactionMaxPaise: constraints.amountLimits.perTransactionMaxPaise.toString(),
      rollingMaxPaise: constraints.amountLimits.rollingMaxPaise?.toString(),
      aggregateMaxPaise: constraints.amountLimits.aggregateMaxPaise?.toString(),
    },
    approvalThreshold: {
      thresholdPaise: constraints.approvalThreshold.thresholdPaise.toString(),
    },
  };
}

function toWireMandate(mandate: WalletMandate): Record<string, unknown> {
  return {
    mandateId: mandate.mandateId,
    agentId: mandate.agentId,
    principalId: mandate.principalId,
    kid: mandate.kid,
    paymentReferenceId: mandate.paymentReferenceId,
    validFrom: mandate.validFrom,
    validUntil: mandate.validUntil,
    issuedAt: mandate.issuedAt,
    status: mandate.status,
    policyVersionId: mandate.policyVersionId,
    constraints: toWireConstraints(mandate.constraints),
  };
}

const ROUTE = "/control/v1/wallets/:walletId/mandates";

export async function walletMandateRoutesPlugin(
  fastify: FastifyInstance,
  options: WalletMandateRoutesOptions,
): Promise<void> {
  const { mandateRepository } = options;

  registerRoutePermission(`GET:${ROUTE}`, { permission: "identity.scope.read" });

  fastify.get(ROUTE, async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as Record<string, string>;
    const walletId = params["walletId"] ?? "";

    if (!verifyWalletAccess(request, walletId)) {
      sendNotFound(reply);
      return;
    }

    const mandates = await mandateRepository.findActive(walletId as CounterId<"wallet">);

    void reply.status(200).send({
      walletId,
      mandates: mandates.map(toWireMandate),
      total: mandates.length,
    });
  });
}
