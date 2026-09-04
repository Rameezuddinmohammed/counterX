/**
 * Read-only prepaid wallet balance — Phase 4 (wallet-dashboard backend) of
 * the remote-MCP plan. Serves the wallet-console dashboard with real data
 * from packages/data's PostgresWalletBalanceStore, backing wallet.balances
 * and wallet.balance_events (migration 0021) — the SAME store
 * PrepaidBalanceMandateBindingService reads at binding time and the worker's
 * real purchase path debits at spend time.
 *
 *   GET /control/v1/wallets/:walletId/balance
 *     Optional query param `limit` (1-100, default 20) bounds recentEvents.
 *
 * Same access-control shape as buyer-notification-routes.ts /
 * wallet-mandate-routes.ts: the caller's own wallet-scoped session
 * (existence-hiding 404 for a mismatched wallet) or a platform operator.
 *
 * SECURITY: balance_minor and every event's amount_minor are bigints —
 * converted to decimal strings for the wire, same convention as
 * wallet-mandate-routes.ts's toWireConstraints. No payment credentials are
 * ever read or returned; providerPaymentId is an opaque Razorpay payment id
 * reference, not a credential.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getActorContext, registerRoutePermission } from "@counter/http-api-kit";
import type { PostgresWalletBalanceStore } from "@counter/data";

export interface WalletBalanceRoutesOptions {
  readonly store: PostgresWalletBalanceStore;
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

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function clampLimit(raw: string | undefined): number {
  if (raw === undefined) {
    return DEFAULT_LIMIT;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_LIMIT;
  }
  return Math.min(parsed, MAX_LIMIT);
}

const ROUTE = "/control/v1/wallets/:walletId/balance";

export async function walletBalanceRoutesPlugin(
  fastify: FastifyInstance,
  options: WalletBalanceRoutesOptions,
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
    const limit = clampLimit(query["limit"]);

    const [balanceMinor, hasBalanceAccount, recentEvents] = await Promise.all([
      store.getBalance(walletId),
      store.hasBalanceAccount(walletId),
      store.listRecentEvents(walletId, limit),
    ]);

    // wallet.balances has no currency column read path independent of the
    // ledger itself — the most recent event's currency is authoritative
    // when present (every wallet in this pilot is INR-only regardless, per
    // wallet-balance-store.ts's own column default).
    const currency = recentEvents[0]?.currency ?? "INR";

    void reply.status(200).send({
      walletId,
      hasBalanceAccount,
      balanceMinor: balanceMinor.toString(),
      currency,
      recentEvents: recentEvents.map((event) => ({
        reference: event.reference,
        eventType: event.eventType,
        amountMinor: event.amountMinor.toString(),
        currency: event.currency,
        providerPaymentId: event.providerPaymentId,
        createdAt: event.createdAt,
      })),
    });
  });
}
