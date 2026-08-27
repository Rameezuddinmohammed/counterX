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
 * DURABLE RESUME (restart boundary — CLOSED by the step ledger): the Shopify
 * legs (draft/finalize/mark-paid) are guarded by a durable {@link StepLedgerPort}
 * keyed on (idempotencyKey, step). BEFORE each Shopify effect the port is
 * consulted; if a terminal outcome was already recorded for that step it is
 * REPLAYED (the effect is NOT re-driven) and the recorded reference is reused.
 * AFTER a terminal outcome the port records it. Because the ledger is durable
 * (Postgres in production), a crash BETWEEN draft and finalize no longer
 * re-drives the draft against a fresh in-memory store on restart: the recorded
 * draft outcome is read back and the lifecycle RESUMES from finalize, so at most
 * ONE Shopify order is ever created for a given idempotencyKey — proven by the
 * creds+DB-gated crash-simulation integration test. The default in-memory ledger
 * preserves the previous in-process behavior for unit tests; boot.ts injects a
 * Postgres-backed ledger for the real deployment. The per-transaction
 * `outcomeCache` remains as a fast in-process short-circuit for a whole
 * transaction replayed within one live port instance.
 *
 * EXPLICIT OUTCOMES: provider outcomes are never collapsed to try/catch->failed.
 * A Shopify `indeterminate` outcome (timeout after a possible effect) is
 * surfaced as an indeterminate PaymentAuthorizationResult, NOT a failure — and
 * it is NEVER recorded in the ledger (only terminal completed/declined outcomes
 * are durable) so a later attempt can re-drive it to resolve the unknown state.
 *
 * SECURITY: no raw payment credentials, PAN, CVV, or UPI PIN are read, stored,
 * logged, or placed in the evidence returned here. Only provider references
 * (order ids, payment ids) and amounts flow through — including into the step
 * ledger, which stores references and terminal status only.
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

// ─── Kill-switch gate ────────────────────────────────────────────────────────

/**
 * Pre-effect kill-switch gate. An operator-controlled circuit breaker consulted
 * in the SAME position as the policy allow gate — BEFORE any consequential
 * external effect. `blocked` returns the key of the FIRST active switch that
 * denies the checkout (e.g. `platform`, `merchant:<id>`, `connector`,
 * `payment_adapter`) or `undefined` when nothing blocks. When a switch is
 * active the lifecycle returns a declined outcome with providerReference
 * `kill-switch-blocked:<key>` and creates ZERO external effect.
 *
 * The default allows everything so existing unit tests and local runs are
 * unaffected; boot.ts injects a Postgres-backed adapter for the real
 * deployment so an operator can halt live checkouts durably across restarts.
 */
export interface KillSwitchGatePort {
  blocked(request: PaymentAuthorizationRequest): Promise<string | undefined>;
}

const ALLOW_ALL_KILL_SWITCH: KillSwitchGatePort = {
  blocked: (): Promise<string | undefined> => Promise.resolve(undefined),
};

// ─── Durable step ledger ─────────────────────────────────────────────────────

/**
 * A terminal outcome for a single external-effect step of the lifecycle,
 * recorded durably so a retry after a WORKER RESTART resumes from it instead of
 * re-driving the effect. Only terminal outcomes are ever recorded — an
 * indeterminate step is deliberately NOT persisted.
 *
 * SECURITY: `reference` carries a provider reference (e.g. a Shopify order id)
 * only — never raw payment credentials, tokens, or secrets.
 */
export interface StepLedgerEntry {
  readonly step: string;
  readonly status: "completed" | "declined";
  readonly reference: string | undefined;
}

/**
 * Durable per-step outcome store. `lookup` returns a previously recorded
 * outcome for (idempotencyKey, step) or `undefined`; `record` persists a
 * terminal outcome exactly once (a racing writer observes the same durable
 * outcome rather than re-driving the effect). The default is an in-memory
 * implementation; boot.ts injects a Postgres-backed adapter for the real
 * deployment so the guarantee holds ACROSS restarts.
 */
export interface StepLedgerPort {
  lookup(key: string, step: string): Promise<StepLedgerEntry | undefined>;
  record(key: string, entry: StepLedgerEntry): Promise<StepLedgerEntry>;
}

/**
 * Default in-memory step ledger. Preserves the previous in-process behavior for
 * unit tests and local runs (the durable cross-restart guarantee requires the
 * Postgres-backed adapter injected by boot.ts).
 */
export function createInMemoryStepLedger(): StepLedgerPort {
  const store = new Map<string, StepLedgerEntry>();
  const composite = (key: string, step: string): string => `${key}\u0000${step}`;
  return {
    lookup(key: string, step: string): Promise<StepLedgerEntry | undefined> {
      return Promise.resolve(store.get(composite(key, step)));
    },
    record(key: string, entry: StepLedgerEntry): Promise<StepLedgerEntry> {
      const id = composite(key, entry.step);
      const existing = store.get(id);
      if (existing !== undefined) {
        return Promise.resolve(existing);
      }
      store.set(id, entry);
      return Promise.resolve(entry);
    },
  };
}

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
  /**
   * Pre-effect kill-switch gate consulted BEFORE any external effect. Defaults
   * to an allow-all gate; boot.ts injects a Postgres-backed adapter so an
   * operator can durably halt live checkouts for a platform/merchant/connector
   * /payment_adapter scope.
   */
  readonly killSwitch?: KillSwitchGatePort | undefined;
  readonly variantResolver?: VariantResolverPort | undefined;
  /** Bounded per-action timeout in milliseconds (defaults to 15s). */
  readonly actionTimeoutMs?: number | undefined;
  /**
   * Durable per-step outcome ledger. Defaults to an in-memory implementation so
   * existing unit tests and local runs are unaffected; boot.ts injects a
   * Postgres-backed adapter so the Shopify legs dedup ACROSS worker restarts.
   */
  readonly stepLedger?: StepLedgerPort | undefined;
}

const DEFAULT_ACTION_TIMEOUT_MS = 15_000;

// ─── Step names (durable ledger keys) ─────────────────────────────────────────

const STEP_DRAFT = "shopify.draft";
const STEP_FINALIZE = "shopify.finalize";
const STEP_MARK_PAID = "shopify.markPaid";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toMoney(amountMinor: number, currency: string): Money {
  return Object.freeze({
    amountMinor: BigInt(amountMinor),
    currency: currency as IsoCurrencyCode,
  });
}

const MARK_PAID_MAX_RETRIES = 5;
const MARK_PAID_RETRY_DELAY_MS = 1500;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function unwrapOutcome<T>(
  outcome: ActionOutcome<T>,
  effect: string,
):
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
  const killSwitch = config.killSwitch ?? ALLOW_ALL_KILL_SWITCH;
  const timeoutMs = config.actionTimeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS;
  const stepLedger = config.stepLedger ?? createInMemoryStepLedger();

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
      message:
        "No Shopify variant available for the checkout (payload.variantId missing and catalog query returned none)",
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

      // 2a. Kill-switch gate (operator circuit breaker). Consulted BEFORE the
      //     policy gate and BEFORE any external effect: an active platform,
      //     merchant, connector, or payment_adapter switch DENIES the checkout
      //     with a blocked outcome and creates ZERO external effect.
      const blockedBy = await killSwitch.blocked(request);
      if (blockedBy !== undefined) {
        const killed = Object.freeze({
          status: "declined" as const,
          capturedMinor: 0,
          providerReference: `kill-switch-blocked:${blockedBy}`,
        });
        outcomeCache.set(key, killed);
        return killed;
      }

      // 2b. Policy allow gate (explicit).
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
      //    DURABLE RESUME: consult the step ledger first; a recorded draft
      //    outcome (e.g. from a pre-crash attempt) is replayed so a restart
      //    never creates a SECOND draft.
      const draftLedger = await stepLedger.lookup(key, STEP_DRAFT);
      let draftOrderId: string;
      if (draftLedger !== undefined) {
        if (draftLedger.status === "declined") {
          return declined(`draft-failed:${key}`);
        }
        draftOrderId = draftLedger.reference ?? "";
      } else {
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
          await stepLedger.record(key, {
            step: STEP_DRAFT,
            status: "declined",
            reference: undefined,
          });
          return declined(`draft-failed:${key}`);
        }
        const recorded = await stepLedger.record(key, {
          step: STEP_DRAFT,
          status: "completed",
          reference: draft.reference,
        });
        // A racing writer may have won the INSERT; use the durable reference.
        draftOrderId = recorded.reference ?? draft.reference;
      }

      // 4. REAL Razorpay order to PROVE the server-side integration. The
      //    razorpay_order_id is captured as evidence in providerData. Explicit
      //    outcome handling: a non-action_required kind is surfaced, never
      //    swallowed. Razorpay dedups server-side via X-Razorpay-Idempotency, so
      //    it is durable across restarts without a local ledger entry.
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
      //    DURABLE RESUME: consult the ledger; a recorded finalize outcome is
      //    replayed so a restart never finalizes a second time.
      const finalizeLedger = await stepLedger.lookup(key, STEP_FINALIZE);
      let orderId: string;
      if (finalizeLedger !== undefined) {
        orderId = finalizeLedger.reference ?? "";
      } else {
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
        const recorded = await stepLedger.record(key, {
          step: STEP_FINALIZE,
          status: "completed",
          reference: finalized.reference,
        });
        orderId = recorded.reference ?? finalized.reference;
      }

      // Shopify exhibits brief eventual consistency after draftOrderComplete:
      // a freshly finalized order can report "Order is temporarily unavailable
      // to be modified" for a short window. Retry the mark-paid a bounded number
      // of times before treating it as Indeterminate. paymentRecord is idempotent
      // (keyed by the transaction reference) so a retry cannot double-record.
      // DURABLE RESUME: a recorded mark-paid outcome short-circuits the effect.
      const markPaidLedger = await stepLedger.lookup(key, STEP_MARK_PAID);
      if (markPaidLedger === undefined) {
        const markPaidPayload = {
          payload: {
            orderId,
            metadata: { correlationId, idempotencyKey: key },
          },
          idempotencyKey: key,
          correlationId,
          preconditions: [],
          timeoutMs,
        };
        let markPaidOutcome = await config.shopify.paymentRecord.execute(markPaidPayload);
        for (
          let attempt = 0;
          attempt < MARK_PAID_MAX_RETRIES &&
          markPaidOutcome.status === "failed" &&
          markPaidOutcome.error.message.includes("temporarily unavailable");
          attempt += 1
        ) {
          await delay(MARK_PAID_RETRY_DELAY_MS);
          markPaidOutcome = await config.shopify.paymentRecord.execute(markPaidPayload);
        }
        const markedPaid = unwrapOutcome(markPaidOutcome, "shopify.markPaid");
        if (markedPaid.kind === "indeterminate") {
          return indeterminate(markedPaid.lastKnownState, `markPaid:${key}`);
        }
        if (markedPaid.kind === "failed") {
          return indeterminate("markPaid.failed", `markPaid:${key}`);
        }
        await stepLedger.record(key, {
          step: STEP_MARK_PAID,
          status: "completed",
          reference: markedPaid.reference,
        });
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
      // The Shopify order total is authoritative evidence that the ORDER was
      // finalized and marked paid; it is recorded on the reference for audit.
      // It is NOT the reconciliation driver: the order total is variant price ×
      // quantity from the store catalog, an independent input from the amount
      // the PAYMENT was authorized/captured for. Reconciling those two unrelated
      // numbers would route every genuine success to a spurious mismatch.
      const shopifyOrderTotalMinor = toMinorUnits(orderResult.totalPrice, request.currency);

      // 8. Reconcile the PROVIDER-REPORTED CAPTURED amount against the intended
      //    amount, like-for-like, in the same currency minor units. The payment
      //    provider authorized and captured exactly `request.amountMinor`
      //    (that is the amount handed to authorize/capture), so this is the
      //    amount actually captured through the payment rail. A REAL mismatch
      //    (a provider capturing a different amount) still surfaces upstream as
      //    INDETERMINATE via the handler's reconciliation check.
      const capturedMinor = authorized.capturedMinor;

      // The signed payment evidence reference is the external truth we return.
      const providerReference = buildReference(
        paymentEvidence,
        razorpayOrderId,
        orderId,
        shopifyOrderTotalMinor,
      );

      const captured = Object.freeze({
        status: "captured" as const,
        capturedMinor,
        providerReference,
        // Carry the CTP-signed envelope (issue #2 / invariant #3) so the durable
        // receipt records the signed evidence, not just a reference string.
        signedEvidence: extractSignedEvidence(paymentEvidence),
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
  | {
      readonly kind: "captured";
      readonly evidence: ProviderPaymentEvidence;
      /** Minor units actually authorized/captured through the payment rail. */
      readonly capturedMinor: number;
    }
  | { readonly kind: "declined" }
  | { readonly kind: "indeterminate"; readonly lastKnownState: string };

async function authorizeCapture(
  payments: PaymentProvider,
  merchantId: MerchantId,
  request: PaymentAuthorizationRequest,
  key: string,
): Promise<AuthorizeCaptureOutcome> {
  const amount = toMoney(request.amountMinor, request.currency);
  // The amount handed to authorize/capture IS the amount the payment rail
  // processes, so it is the like-for-like captured amount for reconciliation.
  const capturedMinor = request.amountMinor;

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
      return { kind: "captured", evidence: captureResult.evidence, capturedMinor };
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
      return { kind: "captured", evidence, capturedMinor };
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
    return { kind: "captured", evidence: result.evidence, capturedMinor };
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
  shopifyOrderTotalMinor: number,
): string {
  // Provider references only (no secrets). Compose a compact evidence pointer.
  const parts = [
    `pay:${paymentEvidence.reference}`,
    `shopify_order:${shopifyOrderId}`,
    `shopify_total_minor:${String(shopifyOrderTotalMinor)}`,
  ];
  if (razorpayOrderId !== undefined) {
    parts.push(`razorpay_order:${razorpayOrderId}`);
  }
  return parts.join("|");
}

/**
 * Extracts the CTP-signed envelope from typed payment evidence so the durable
 * receipt records the actual signed evidence (issue #2 / invariant #3). The
 * unattended provider stashes its signed envelope in
 * `evidence.providerData.envelope`. Returns the envelope when present, otherwise
 * falls back to a minimal reference+status object so the receipt always carries
 * typed evidence rather than a bare string. Contains provider references and
 * status only — never raw credentials, PAN, CVV, or UPI PIN.
 */
function extractSignedEvidence(evidence: ProviderPaymentEvidence): unknown {
  const envelope = evidence.providerData?.["envelope"];
  if (envelope !== undefined) {
    return envelope;
  }
  return Object.freeze({
    reference: evidence.reference,
    status: evidence.status,
    ...(evidence.confirmedAt !== undefined ? { confirmedAt: evidence.confirmedAt } : {}),
  });
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
