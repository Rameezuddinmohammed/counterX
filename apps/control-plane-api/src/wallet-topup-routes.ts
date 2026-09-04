/**
 * Real self-serve Razorpay top-up for a wallet's prepaid balance — the piece
 * that never existed before (topUp() on wallet-balance-store.ts previously
 * had script-only callers; see scripts/issue-and-bind-prepaid-mandate.mjs).
 *
 *   POST /control/v1/wallets/:walletId/topup/order
 *     Body: { amountMinor: string } — INR paise, 0 < amount <= MAX_TOPUP_MINOR.
 *     Creates a real Razorpay order via the SAME RazorpayTestProvider
 *     instance main.ts already builds for refunds (razorpayRefundProvider —
 *     one-shot orders, not the recurring-mandate provider). Returns ONLY the
 *     public Razorpay key id, never the key secret.
 *
 *   POST /control/v1/wallets/:walletId/topup/confirm
 *     Body: { razorpayOrderId, razorpayPaymentId, razorpaySignature }
 *     Independently verifies the checkout callback via
 *     RazorpayTestProvider.verifyClientReturn() — HMAC signature check AND an
 *     authoritative GET /v1/payments/:id re-check — before crediting
 *     anything. Signature verification itself is NOT reimplemented here.
 *
 *     SECURITY: the credited amount is never taken from this request body —
 *     there is no amountMinor field here at all. It is the amount THIS
 *     SAME ROUTE recorded when it created the order (below), looked up by
 *     the now-verified razorpayOrderId. Razorpay's Orders API was created
 *     with `partial_payment: false` (razorpay-provider.ts's createInstruction),
 *     so a captured payment against that order is guaranteed to be for the
 *     order's exact amount — a buyer cannot pay ₹10 and have ₹10,000 credited.
 *
 *     KNOWN SIMPLIFICATION (disclosed, not hidden): the order→amount
 *     correlation below is an in-memory Map, not a durable row. It survives
 *     the ordinary create-order → open-checkout → confirm flow within one
 *     running process (which is what a single interactive demo/session is),
 *     but a control-plane-api restart between those two calls strands the
 *     order — confirm then fails closed with TOPUP_NOT_FOUND rather than
 *     guessing an amount, per this repo's "no silent consequential failure"
 *     rule. A production version would persist this in a small durable
 *     table (or wallet.balance_events itself, pending) instead.
 *
 * Same wallet-scoped existence-hiding pattern as wallet-balance-routes.ts /
 * prepaid-balance-mandate-binding-routes.ts (404, not 403, for a mismatched
 * wallet). Gated on identity.scope.manage — a real money-affecting mutation
 * on the caller's own tenant, held to the same step-up bar as
 * payment.mandate.manage (see packages/authorization/src/assurance.ts's
 * tenantMutationAssurances) — the browser must have completed
 * mfa.challengeWithPopup() first, same as the mandate-authorization flow.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getActorContext, registerRoutePermission } from "@counter/http-api-kit";
import type { PostgresWalletBalanceStore } from "@counter/data";
import type { PaymentProvider } from "@counter/payment-sdk";
import {
  createMoney,
  instantFromEpochMilliseconds,
  type Instant,
  type IsoCurrencyCode,
  type MerchantId,
} from "@counter/domain";

export interface WalletTopupRoutesOptions {
  readonly store: PostgresWalletBalanceStore;
  readonly razorpayProvider: PaymentProvider;
  readonly merchantId: MerchantId;
}

function sendValidationError(reply: FastifyReply, message: string): void {
  void reply.status(400).send({ error: { code: "INVALID_FORMAT", message } });
}

function sendNotFound(reply: FastifyReply): void {
  void reply
    .status(404)
    .send({ error: { code: "NOT_FOUND", message: "The requested resource was not found" } });
}

/** Same existence-hiding contract as wallet-balance-routes.ts's verifyWalletAccess. */
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

function nowInstant(): Instant {
  const result = instantFromEpochMilliseconds(Date.now());
  if (!result.ok) {
    throw new Error("Failed to derive current instant for top-up processing");
  }
  return result.value;
}

const CURRENCY = "INR" as IsoCurrencyCode;
// A sane demo ceiling (finalplan.md), not a product-level limit.
const MAX_TOPUP_MINOR = 5_000_000n; // ₹50,000

const ORDER_ROUTE = "/control/v1/wallets/:walletId/topup/order";
const CONFIRM_ROUTE = "/control/v1/wallets/:walletId/topup/confirm";

interface PendingTopup {
  readonly walletId: string;
  readonly amountMinor: bigint;
}

export async function walletTopupRoutesPlugin(
  fastify: FastifyInstance,
  options: WalletTopupRoutesOptions,
): Promise<void> {
  const { store, razorpayProvider, merchantId } = options;

  // See this file's header for why an in-memory correlation is an accepted,
  // disclosed simplification here rather than a durable table.
  const pendingTopups = new Map<string, PendingTopup>();

  registerRoutePermission(`POST:${ORDER_ROUTE}`, { permission: "identity.scope.manage" });
  registerRoutePermission(`POST:${CONFIRM_ROUTE}`, { permission: "identity.scope.manage" });

  fastify.post(ORDER_ROUTE, async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as Record<string, string>;
    const walletId = params["walletId"] ?? "";
    if (!verifyWalletAccess(request, walletId)) {
      sendNotFound(reply);
      return;
    }

    const body = request.body as Record<string, unknown> | undefined;
    const amountMinorRaw = body?.["amountMinor"];
    if (typeof amountMinorRaw !== "string" || !/^[1-9][0-9]*$/u.test(amountMinorRaw)) {
      sendValidationError(reply, "Field 'amountMinor' (a positive integer string) is required");
      return;
    }
    const amountMinor = BigInt(amountMinorRaw);
    if (amountMinor > MAX_TOPUP_MINOR) {
      sendValidationError(
        reply,
        `'amountMinor' must not exceed ${MAX_TOPUP_MINOR.toString()} for this demo`,
      );
      return;
    }

    const moneyResult = createMoney(amountMinor, CURRENCY);
    if (!moneyResult.ok) {
      sendValidationError(reply, "Invalid top-up amount");
      return;
    }

    const referenceId = `ctr_topup_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

    const result = await razorpayProvider.createInstruction({
      authorizationRef: referenceId,
      amount: moneyResult.value,
      currency: CURRENCY,
      merchantId,
      idempotencyKey: referenceId,
    });

    if (result.kind !== "action_required") {
      void reply.status(502).send({
        error: {
          code: "PROVIDER_ERROR",
          message: "Could not create a top-up order with Razorpay.",
        },
      });
      return;
    }

    const metadata = result.action.metadata ?? {};
    const razorpayOrderId = metadata["razorpay_order_id"];
    if (razorpayOrderId === undefined) {
      void reply.status(502).send({
        error: { code: "PROVIDER_ERROR", message: "Razorpay did not return an order id." },
      });
      return;
    }

    pendingTopups.set(razorpayOrderId, { walletId, amountMinor });

    void reply.status(201).send({
      referenceId,
      checkout: {
        razorpayOrderId,
        razorpayKeyId: metadata["razorpay_key_id"],
        amountMinor: metadata["amount"],
        currency: metadata["currency"],
      },
    });
  });

  fastify.post(CONFIRM_ROUTE, async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as Record<string, string>;
    const walletId = params["walletId"] ?? "";
    if (!verifyWalletAccess(request, walletId)) {
      sendNotFound(reply);
      return;
    }

    const body = request.body as Record<string, unknown> | undefined;
    const razorpayOrderId = body?.["razorpayOrderId"];
    const razorpayPaymentId = body?.["razorpayPaymentId"];
    const razorpaySignature = body?.["razorpaySignature"];
    if (
      typeof razorpayOrderId !== "string" ||
      typeof razorpayPaymentId !== "string" ||
      typeof razorpaySignature !== "string"
    ) {
      sendValidationError(reply, "Missing required fields");
      return;
    }

    const pending = pendingTopups.get(razorpayOrderId);
    if (pending === undefined || pending.walletId !== walletId) {
      void reply.status(409).send({
        error: {
          code: "TOPUP_NOT_FOUND",
          message:
            "No matching top-up request for this order. Please retry the top-up from the start.",
        },
      });
      return;
    }

    const verification = await razorpayProvider.verifyClientReturn({
      queryParams: {
        razorpay_order_id: razorpayOrderId,
        razorpay_payment_id: razorpayPaymentId,
        razorpay_signature: razorpaySignature,
      },
      returnedAt: nowInstant(),
    });

    if (verification.kind !== "verified" || verification.evidence.status !== "confirmed") {
      void reply.status(400).send({
        error: {
          code: "PAYMENT_NOT_VERIFIED",
          message: "Could not verify this payment with Razorpay.",
        },
      });
      return;
    }

    // Only drop the pending-order correlation once the credit has actually
    // landed. If store.topUp() throws (e.g. a transient DB error) or
    // returns !ok, this record must survive so a retried confirm can still
    // find it and safely re-attempt — topUp() is idempotent by
    // (environment, wallet_id, reference), so re-attempting never
    // double-credits. Deleting it unconditionally here would strand an
    // already-captured Razorpay payment with no way to recover the credit.
    const outcome = await store.topUp({
      walletId,
      reference: razorpayPaymentId,
      amountMinor: pending.amountMinor,
      currency: CURRENCY,
      providerPaymentId: razorpayPaymentId,
    });

    if (!outcome.ok) {
      void reply.status(502).send({ error: outcome.error });
      return;
    }

    pendingTopups.delete(razorpayOrderId);

    void reply.status(200).send({
      balanceMinor: outcome.value.balanceMinor.toString(),
      currency: CURRENCY,
      alreadyApplied: outcome.value.alreadyApplied,
    });
  });
}
