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
 *   POST /control/v1/wallets/:walletId/mandates/:mandateId/revoke
 *     Buyer-initiated revocation — until this route existed, a self-serve
 *     mandate created via wallet-console's /connect had NO way to be
 *     revoked short of an engineer editing the database directly, which is
 *     exactly the gap the Mandate Pivot's Phase 1 exists to close for
 *     mandate CREATION and was left open on the revoke side. Gated by
 *     payment.mandate.manage — the SAME step-up-assurance bar as issuing a
 *     mandate in the first place, since revoking is the same authority
 *     grant in reverse. Monotonic: only an "active" mandate can be revoked
 *     (409 otherwise) — this never overwrites an "expired" mandate's status,
 *     which would erase the real reason it stopped being usable. Takes
 *     effect immediately: MandateRepository.findActive (used both by the
 *     GET route above and by checkMandateAuthority before any purchase) only
 *     ever returns status === "active" rows.
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
const REVOKE_ROUTE = "/control/v1/wallets/:walletId/mandates/:mandateId/revoke";

export async function walletMandateRoutesPlugin(
  fastify: FastifyInstance,
  options: WalletMandateRoutesOptions,
): Promise<void> {
  const { mandateRepository } = options;

  registerRoutePermission(`GET:${ROUTE}`, { permission: "identity.scope.read" });
  registerRoutePermission(`POST:${REVOKE_ROUTE}`, { permission: "payment.mandate.manage" });

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

  fastify.post(REVOKE_ROUTE, async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as Record<string, string>;
    const walletId = params["walletId"] ?? "";
    const mandateId = params["mandateId"] ?? "";

    if (!verifyWalletAccess(request, walletId)) {
      sendNotFound(reply);
      return;
    }

    const existing = await mandateRepository.findById(mandateId as CounterId<"mandate">);
    // A mandate that doesn't exist, or exists but belongs to a DIFFERENT
    // wallet, gets the same 404 — never reveal that a mandate id is real but
    // owned by someone else.
    if (existing === undefined || existing.walletId !== walletId) {
      sendNotFound(reply);
      return;
    }

    if (existing.status !== "active") {
      void reply.status(409).send({
        error: {
          code: "MANDATE_NOT_ACTIVE",
          message: `This mandate is already ${existing.status} and cannot be revoked.`,
        },
      });
      return;
    }

    await mandateRepository.updateStatus(existing.mandateId, "revoked");

    void reply.status(200).send({
      mandate: toWireMandate({ ...existing, status: "revoked" }),
    });
  });
}
