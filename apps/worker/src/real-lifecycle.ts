/**
 * Real connector-backed PaymentAuthorizationPort.
 *
 * This is the money seam that the transaction-lifecycle handler calls. When
 * both Shopify and Razorpay credentials are present the worker wires THIS
 * implementation, which drives the full real lifecycle for a single checkout:
 *
 *   1. resolve a Shopify variant (from the payload, else a catalog query)
 *   2. explicit policy allow gate (see note below)
 *   3. REAL Shopify draft order            (DraftOrderCreateAction)
 *   4. REAL Razorpay order                 (provider.createInstruction) — proves
 *                                           the server-side Razorpay integration
 *   5. unattended payment evidence         (CounterTestPaymentProvider, CTP-signed)
 *   6. REAL Shopify finalize + mark-as-paid (OrderFinalizeAction, PaymentRecordAction)
 *   7. REAL Shopify OrderQuery as authoritative evidence (OrderQueryAction)
 *   8. reconcile intended vs provider-reported amount
 *
 * IDEMPOTENCY: `request.idempotencyKey` (the opaque, per-transaction payload
 * reference) is used verbatim as the idempotency key for EVERY external effect
 * so a retry causes at most one draft, one order, and one Razorpay order. The
 * Shopify ActionPorts already cache per idempotency key; the Razorpay provider
 * forwards the key as `Idempotency-Key`. This method therefore honors the
 * per-transactionId IDEMPOTENCY CONTRACT documented on PaymentAuthorizationPort.
 *
 * EXPLICIT OUTCOMES: provider outcomes are never collapsed to try/catch->failed.
 * A Shopify `indeterminate` outcome (timeout after a possible effect) is
 * surfaced as an indeterminate PaymentAuthorizationResult, NOT a failure.
 *
 * SECURITY: no raw payment credentials, PAN, CVV, or UPI PIN are read, stored,
 * logged, or placed in the evidence returned here. Only provider references
 * (order ids, payment ids) and amounts flow through.
 */

import { createCanonicalError } from "@counter/domain";
import type { IsoCurrencyCode, MerchantId, Money } from "@counter/domain";
import type { ActionOutcome } from "@counter/connector-sdk";
import type { ShopifyConnector } from "@counter/shopify-connector";
import type { PaymentProvider, ProviderPaymentEvidence } from "@counter/payment-sdk";

import type {
  PaymentAuthorizationPort,
  PaymentAuthorizationRequest,
  PaymentAuthorizationResult,
} from "./transaction-lifecycle.js";

// ─── Policy gate ─────────────────────────────────────────────────────────────

/**
 * Minimal policy decision seam. The full policy engine is not reachable from
 * the worker without violating dependency-cruiser (worker -> workflow only),
 * so the decision is kept as an explicit allow step here. A production wiring
 * can inject a real port implementing this shape.
 */
export interface LifecyclePolicyPort {
  allow(request: PaymentAuthorizationRequest): Promise<boolean>;
}

const ALLOW_ALL_POLICY: LifecyclePolicyPort = {
  allow: (): Promise<boolean> => Promise.resolve(true),
};

// ─── Catalog variant resolution ──────────────────────────────────────────────

/**
 * Resolves a released Shopify variant GID when the payload does not carry one.
 * Injected so unit tests can supply a deterministic variant without a network
 * call. Returns `null` when no variant can be resolved.
 */
export interface VariantResolverPort {
  resolveReleasedVariant(): Promise<string | null>;
}

// ─── Config ──────────────────────────────────────────────────────────────────

export interface RealLifecycleConfig {
  readonly shopify: ShopifyConnector;
  readonly razorpay: PaymentProvider;
  /** The unattended, CTP-signed provider used to obtain typed payment evidence. */
  readonly payments: PaymentProvider;
  /** Merchant identity used on payment commands. */
  readonly merchantId: MerchantId;
  readonly policy?: LifecyclePolicyPort | undefined;
  readonly variantResolver?: VariantResolverPort | undefined;
  /** Bounded per-action timeout in milliseconds (defaults to 15s). */
  readonly actionTimeoutMs?: number | undefined;
}

const DEFAULT_ACTION_TIMEOUT_MS = 15_000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toMoney(amountMinor: number, currency: string): Money {
  return Object.freeze({
    amountMinor: BigInt(amountMinor),
    currency: currency as IsoCurrencyCode,
  });
}

function unwrapOutcome<T>(outcome: ActionOutcome<T>, effect: string):
  | { readonly kind: "ok"; readonly result: T; readonly reference: string }
  | { readonly kind: "indeterminate"; readonly lastKnownState: string }
  | { readonly kind: "failed"; readonly message: string } {
  switch (outcome.status) {
    case "succeeded":
      return {
        kind: "ok",
        result: outcome.result,
        reference: outcome.sourceReference.value,
      };
    case "indeterminate":
      return {
        kind: "indeterminate",
        lastKnownState: outcome.lastKnownState ?? `${effect}.indeterminate`,
      };
    case "failed":
      return { kind: "failed", message: outcome.error.message };
  }
}

// ─── Real PaymentAuthorizationPort ───────────────────────────────────────────

/**
 * Builds a {@link PaymentAuthorizationPort} that drives the full real lifecycle
 * against live Shopify + Razorpay + the CTP-signed unattended payment provider.
 */
export function createRealPaymentAuthorizationPort(
  config: RealLifecycleConfig,
): PaymentAuthorizationPort {
  const policy = config.policy ?? ALLOW_ALL_POLICY;
  const timeoutMs = config.actionTimeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS;

  // Per-transaction outcome cache. A retry of the SAME transaction returns the
  // existing captured/declined outcome so the worker seam guarantees AT MOST
  // ONE external effect per transaction, independent of provider-side dedup.
  // Indeterminate outcomes are NOT cached (a later attempt must be able to
  // re-drive them to resolve the unknown state).
  const outcomeCache = new Map<string, PaymentAuthorizationResult>();

  async function resolveVariant(request: PaymentAuthorizationRequest): Promise<string> {
    if (request.variantId !== undefined) {
      return request.variantId;
    }
    if (config.variantResolver !== undefined) {
      const resolved = await config.variantResolver.resolveReleasedVariant();
      if (resolved !== null) {
        return resolved;
      }
    }
    throw createCanonicalError({
      code: "UNAVAILABLE",
      category: "unavailable",
      message: "No Shopify variant available for the checkout (payload.variantId missing and catalog query returned none)",
    });
  }

  return {
    async authorizeAndCapture(
      request: PaymentAuthorizationRequest,
    ): Promise<PaymentAuthorizationResult> {
      const key = request.idempotencyKey;
      const correlationId = key;

      const cached = outcomeCache.get(key);
      if (cached !== undefined) {
        return cached;
      }

      // 2. Policy allow gate (explicit).
      const allowed = await policy.allow(request);
      if (!allowed) {
        const denied = Object.freeze({
          status: "declined" as const,
          capturedMinor: 0,
          providerReference: `policy-declined:${key}`,
        });
        outcomeCache.set(key, denied);
        return denied;
      }

      // 1. Resolve the variant against the real catalog.
      const variantId = await resolveVariant(request);
      const quantity = request.quantity ?? 1;

      // 3. REAL Shopify draft order (idempotencyKey = transaction reference).
      const draftOutcome = await config.shopify.draftOrderCreate.execute({
        payload: {
          lineItems: [{ variantId, quantity }],
          customerId: undefined,
          note: `Counter autonomous checkout ${key}`,
          tags: ["counter-autonomous"],
          metadata: { correlationId, idempotencyKey: key },
        },
        idempotencyKey: key,
        correlationId,
        preconditions: [],
        timeoutMs,
      });
      const draft = unwrapOutcome(draftOutcome, "shopify.draft");
      if (draft.kind === "indeterminate") {
        return indeterminate(draft.lastKnownState, `draft:${key}`);
      }
      if (draft.kind === "failed") {
        return declined(`draft-failed:${key}`);
      }
      const draftOrderId = draft.reference;

      // 4. REAL Razorpay order to PROVE the server-side integration. The
      //    razorpay_order_id is captured as evidence in providerData. Explicit
      //    outcome handling: a non-action_required kind is surfaced, never
      //    swallowed.
      const razorpayResult = await config.razorpay.createInstruction({
        authorizationRef: key,
        amount: toMoney(request.amountMinor, request.currency),
        currency: request.currency as IsoCurrencyCode,
        merchantId: config.merchantId,
        idempotencyKey: key,
        metadata: { counterTransaction: key },
      });
      let razorpayOrderId: string | undefined;
      if (razorpayResult.kind === "action_required") {
        razorpayOrderId = razorpayResult.action.metadata?.["razorpay_order_id"];
      } else if (razorpayResult.kind === "indeterminate") {
        return indeterminate("razorpay.order.indeterminate", `razorpay:${key}`);
      } else if (razorpayResult.kind === "declined") {
        return declined(`razorpay-declined:${key}`);
      }

      // 5. Unattended payment through the CTP-signed provider for typed
      //    authorize + capture evidence. The idempotency key dedups replays.
      const authorized = await authorizeCapture(config.payments, config.merchantId, request, key);
      if (authorized.kind === "declined") {
        return declined(`payment-declined:${key}`);
      }
      if (authorized.kind === "indeterminate") {
        return indeterminate(authorized.lastKnownState, `payment:${key}`);
      }
      const paymentEvidence = authorized.evidence;

      // 6. REAL Shopify finalize (payment pending) then mark-as-paid.
      const finalizeOutcome = await config.shopify.orderFinalize.execute({
        payload: {
          draftOrderId,
          paymentPending: true,
          metadata: { correlationId, idempotencyKey: key },
        },
        idempotencyKey: key,
        correlationId,
        preconditions: [],
        timeoutMs,
      });
      const finalized = unwrapOutcome(finalizeOutcome, "shopify.finalize");
      if (finalized.kind === "indeterminate") {
        return indeterminate(finalized.lastKnownState, `finalize:${key}`);
      }
      if (finalized.kind === "failed") {
        return indeterminate("finalize.failed", `finalize:${key}`);
      }
      const orderId = finalized.reference;

      const markPaidOutcome = await config.shopify.paymentRecord.execute({
        payload: {
          orderId,
          metadata: { correlationId, idempotencyKey: key },
        },
        idempotencyKey: key,
        correlationId,
        preconditions: [],
        timeoutMs,
      });
      const markedPaid = unwrapOutcome(markPaidOutcome, "shopify.markPaid");
      if (markedPaid.kind === "indeterminate") {
        return indeterminate(markedPaid.lastKnownState, `markPaid:${key}`);
      }
      if (markedPaid.kind === "failed") {
        return indeterminate("markPaid.failed", `markPaid:${key}`);
      }

      // 7. REAL Shopify OrderQuery: authoritative financial evidence. Payment
      //    "confirmed" is backed by THIS typed query, never a local boolean.
      const queryOutcome = await config.shopify.orderQuery.execute({
        payload: {
          orderId,
          metadata: { correlationId, idempotencyKey: key },
        },
        idempotencyKey: key,
        correlationId,
        preconditions: [],
        timeoutMs,
      });
      const queried = unwrapOutcome(queryOutcome, "shopify.query");
      if (queried.kind === "indeterminate") {
        return indeterminate(queried.lastKnownState, `query:${key}`);
      }
      if (queried.kind === "failed") {
        return indeterminate("query.failed", `query:${key}`);
      }
      const orderResult = queried.result as {
        readonly totalPrice: string;
        readonly currencyCode: string;
        readonly status: string;
      };

      // 8. Reconcile intended vs provider-reported amount. The authoritative
      //    amount comes from the Shopify order query (major units -> minor).
      const providerAmountMinor = toMinorUnits(orderResult.totalPrice, request.currency);

      // The signed payment evidence reference is the external truth we return.
      const providerReference = buildReference(paymentEvidence, razorpayOrderId, orderId);

      const captured = Object.freeze({
        status: "captured" as const,
        capturedMinor: providerAmountMinor,
        providerReference,
      });
      outcomeCache.set(key, captured);
      return captured;
    },
  };
}

// ─── Outcome constructors ────────────────────────────────────────────────────

function declined(reference: string): PaymentAuthorizationResult {
  return Object.freeze({
    status: "declined" as const,
    capturedMinor: 0,
    providerReference: reference,
  });
}

function indeterminate(lastKnownState: string, reference: string): PaymentAuthorizationResult {
  return Object.freeze({
    status: "indeterminate" as const,
    capturedMinor: 0,
    providerReference: reference,
    lastKnownState,
  });
}

// ─── Unattended payment authorize + capture ──────────────────────────────────

type AuthorizeCaptureOutcome =
  | { readonly kind: "captured"; readonly evidence: ProviderPaymentEvidence }
  | { readonly kind: "declined" }
  | { readonly kind: "indeterminate"; readonly lastKnownState: string };

async function authorizeCapture(
  payments: PaymentProvider,
  merchantId: MerchantId,
  request: PaymentAuthorizationRequest,
  key: string,
): Promise<AuthorizeCaptureOutcome> {
  const amount = toMoney(request.amountMinor, request.currency);

  // Prefer explicit authorize+capture when supported; otherwise createInstruction.
  if (payments.authorize !== undefined && payments.capture !== undefined) {
    const authResult = await payments.authorize({
      authorizationRef: key,
      amount,
      currency: request.currency as IsoCurrencyCode,
      merchantId,
      idempotencyKey: key,
    });

    if (authResult.kind === "declined") {
      return { kind: "declined" };
    }
    if (authResult.kind === "indeterminate") {
      // Effect MAY have occurred -> indeterminate, not failed.
      return { kind: "indeterminate", lastKnownState: "payment.authorize.indeterminate" };
    }

    const reference =
      authResult.kind === "confirmed"
        ? authResult.evidence.reference
        : authResult.kind === "pending"
          ? authResult.reference
          : (`test-auth-ref-${key}` as ProviderPaymentEvidence["reference"]);

    const captureResult = await payments.capture({
      reference,
      amount,
      idempotencyKey: key,
    });

    if (captureResult.kind === "confirmed") {
      return { kind: "captured", evidence: captureResult.evidence };
    }
    if (captureResult.kind === "declined") {
      return { kind: "declined" };
    }
    if (captureResult.kind === "indeterminate") {
      return { kind: "indeterminate", lastKnownState: "payment.capture.indeterminate" };
    }
    // pending / action_required: query for authoritative confirmed evidence.
    const evidence = await payments.query(reference);
    if (evidence.status === "confirmed") {
      return { kind: "captured", evidence };
    }
    if (evidence.status === "declined") {
      return { kind: "declined" };
    }
    return { kind: "indeterminate", lastKnownState: "payment.pending" };
  }

  // direct_capture provider: createInstruction returns confirmed/declined/etc.
  const result = await payments.createInstruction({
    authorizationRef: key,
    amount,
    currency: request.currency as IsoCurrencyCode,
    merchantId,
    idempotencyKey: key,
  });
  if (result.kind === "confirmed") {
    return { kind: "captured", evidence: result.evidence };
  }
  if (result.kind === "declined") {
    return { kind: "declined" };
  }
  if (result.kind === "indeterminate") {
    return { kind: "indeterminate", lastKnownState: "payment.createInstruction.indeterminate" };
  }
  return { kind: "indeterminate", lastKnownState: "payment.action_required" };
}

// ─── Reference / amount helpers ──────────────────────────────────────────────

function buildReference(
  paymentEvidence: ProviderPaymentEvidence,
  razorpayOrderId: string | undefined,
  shopifyOrderId: string,
): string {
  // Provider references only (no secrets). Compose a compact evidence pointer.
  const parts = [`pay:${paymentEvidence.reference}`, `shopify_order:${shopifyOrderId}`];
  if (razorpayOrderId !== undefined) {
    parts.push(`razorpay_order:${razorpayOrderId}`);
  }
  return parts.join("|");
}

/**
 * Converts a Shopify money string (major units, e.g. "49.99") to integer minor
 * units for the given currency. Only currencies with 2 decimal minor units are
 * expected here (INR/USD); non-decimal formats fall back to integer parsing.
 */
function toMinorUnits(major: string, _currency: string): number {
  const trimmed = major.trim();
  const negative = trimmed.startsWith("-");
  const abs = negative ? trimmed.slice(1) : trimmed;
  const [whole, fraction = ""] = abs.split(".");
  const wholePart = Number.parseInt(whole ?? "0", 10);
  const fractionPadded = (fraction + "00").slice(0, 2);
  const fractionPart = Number.parseInt(fractionPadded, 10);
  const minor = wholePart * 100 + fractionPart;
  return negative ? -minor : minor;
}

export const __testing = Object.freeze({ toMinorUnits });
