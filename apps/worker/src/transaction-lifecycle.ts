/**
 * Real transaction-lifecycle job handler.
 *
 * Drives a transaction through the durable workflow state machine
 * (@counter/workflow) from DRAFT to CLOSED: quote -> checkout -> commit
 * (payment authorize + capture, order commit) -> reconciliation of the
 * intended outcome against the provider-reported outcome -> receipt/evidence.
 *
 * The provider interaction is expressed through the `PaymentAuthorizationPort`
 * abstraction so that unit tests inject a deterministic mock (representing the
 * connector mock client) while a real HTTP client can be selected behind env
 * configuration in the deployment entrypoint. See findings for what is real vs
 * mocked today.
 */

import {
  createCounterId,
  instantFromEpochMilliseconds,
  type CounterId,
  type Instant,
} from "@counter/domain";
import {
  createInitialState,
  transitionOrder,
  transitionPayment,
  transitionPhase,
  type TransactionState,
} from "@counter/workflow";

// ─── Handler contract ──────────────────────────────────────────────────────

/**
 * A typed job handler executes the durable effect for a single job type and
 * either resolves (success -> job completed) or throws a classified error so
 * the worker loop can decide retry vs dead-letter.
 */
export interface JobHandler {
  execute(job: HandledJob, now: Instant): Promise<void>;
}

/** The subset of a claimed job the handlers need. */
export interface HandledJob {
  readonly id: CounterId<"job">;
  readonly type: string;
  readonly payload: unknown;
}

// ─── Error classification ────────────────────────────────────────────────────

/**
 * Errors thrown by handlers carry an errorClass the worker loop forwards to
 * `repo.fail`. `retryable=false` signals a terminal (non-retryable) failure.
 */
export class HandlerError extends Error {
  readonly errorClass: string;
  readonly retryable: boolean;

  constructor(errorClass: string, message: string, retryable: boolean) {
    super(message);
    this.name = "HandlerError";
    this.errorClass = errorClass;
    this.retryable = retryable;
  }
}

// ─── Provider port (real vs mock is chosen by the caller) ─────────────────────

export interface PaymentAuthorizationRequest {
  readonly transactionId: CounterId<"transaction">;
  readonly amountMinor: number;
  readonly currency: string;
  /**
   * Stable, opaque transaction reference from the job payload. Used verbatim as
   * the idempotency key for every external effect (Shopify draft/order,
   * Razorpay order, payment authorize/capture) so a retry of the same job
   * causes AT MOST ONE external effect per provider. This is NOT regenerated
   * per attempt.
   */
  readonly idempotencyKey: string;
  /** Optional Shopify variant GID for the real catalog-backed draft order. */
  readonly variantId?: string | undefined;
  /** Line quantity for the real draft order (defaults to 1). */
  readonly quantity?: number | undefined;
}

export interface PaymentAuthorizationResult {
  /**
   * Provider-reported outcome. `indeterminate` means an external effect MAY
   * have occurred but the terminal outcome could not be confirmed (e.g. a
   * timeout AFTER a possible effect); it MUST NOT be collapsed to a failure.
   */
  readonly status: "authorized" | "captured" | "declined" | "indeterminate";
  /** Provider-reported amount captured, used for reconciliation. */
  readonly capturedMinor: number;
  /** Opaque provider reference used as external evidence. */
  readonly providerReference: string;
  /**
   * Last-known state string for an indeterminate outcome (surfaced to the
   * durable state machine as INDETERMINATE rather than a hard failure).
   */
  readonly lastKnownState?: string | undefined;
  /**
   * The CTP-signed payment evidence envelope backing a `captured`/`authorized`
   * outcome. This is the cryptographic "signed receipt" the payment provider
   * produced (see invariant #3): it MUST be carried into the durable receipt so
   * the recorded evidence is the signed envelope itself, not merely a reference
   * string. It carries provider references and amounts only — never raw payment
   * credentials, PAN, CVV, or UPI PIN. Absent for declined/indeterminate.
   */
  readonly signedEvidence?: unknown;
}

/**
 * Abstraction over the external payment provider. Unit tests pass a
 * deterministic in-memory implementation (the connector mock client);
 * production wires the real HTTP client.
 *
 * IDEMPOTENCY CONTRACT (must hold before a LIVE connector is attached):
 * `execute` rebuilds transaction state from DRAFT on every attempt, so a
 * retryable failure AFTER capture (notably `reconciliation.mismatch`, but also
 * any transient error between capture and CLOSED) causes this method to be
 * invoked AGAIN for the same `transactionId`. Implementations MUST therefore be
 * idempotent per `request.transactionId`: a repeated call for a transaction
 * that was already authorized/captured must return the EXISTING provider
 * outcome (same `capturedMinor` / `providerReference`) and MUST NOT create a
 * second authorization or capture. The deterministic in-process stand-in used
 * today trivially satisfies this (it recomputes the same result and moves no
 * real money); a real gateway client must enforce it by passing the
 * `transactionId` as the provider's idempotency key (e.g. Razorpay/Stripe
 * `Idempotency-Key`) or by querying prior state before capturing. Until that
 * guarantee is wired, do NOT attach a connector that debits real funds.
 */
export interface PaymentAuthorizationPort {
  authorizeAndCapture(request: PaymentAuthorizationRequest): Promise<PaymentAuthorizationResult>;
}

// ─── Payload ─────────────────────────────────────────────────────────────────

export interface TransactionLifecyclePayload {
  readonly transactionId: string;
  readonly amountMinor: number;
  readonly currency: string;
  /** Optional Shopify variant GID for the real catalog-backed lifecycle. */
  readonly variantId?: string | undefined;
  /** Optional line quantity for the real draft order (defaults to 1). */
  readonly quantity?: number | undefined;
}

// ─── Reconciliation + receipt output ─────────────────────────────────────────

export interface ReconciliationOutcome {
  /** Did the provider-reported outcome match the intended outcome? */
  readonly reconciled: boolean;
  readonly intendedAmountMinor: number;
  readonly providerAmountMinor: number;
}

export interface TransactionReceipt {
  readonly transactionId: CounterId<"transaction">;
  readonly finalState: TransactionState;
  readonly providerReference: string;
  readonly reconciliation: ReconciliationOutcome;
  /**
   * The CTP-signed payment evidence envelope, when the provider returned one.
   * This is the actual signed receipt (invariant #3 / FEAT-004 AC) — provider
   * references and amounts only, never secrets. Present on a captured outcome;
   * carried through on indeterminate when partial evidence exists.
   */
  readonly signedEvidence?: unknown;
}

/**
 * A sink for durable outcomes (receipt/evidence). In production this can be
 * backed by the outbox so effects are durable and reconcilable; unit tests use
 * an in-memory recorder to assert the lifecycle actually ran.
 */
export interface ReceiptSink {
  record(receipt: TransactionReceipt): Promise<void>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function unwrap<T>(
  result: { ok: true; value: T } | { ok: false; error: { message: string } },
  errorClass: string,
): T {
  if (!result.ok) {
    throw new HandlerError(errorClass, result.error.message, false);
  }
  return result.value;
}

function parsePayload(payload: unknown): TransactionLifecyclePayload {
  if (typeof payload !== "object" || payload === null) {
    throw new HandlerError("payload.invalid", "Job payload is not an object", false);
  }
  const record = payload as Record<string, unknown>;
  const transactionId = record["transactionId"];
  const amountMinor = record["amountMinor"];
  const currency = record["currency"];
  if (typeof transactionId !== "string" || transactionId.length === 0) {
    throw new HandlerError("payload.invalid", "transactionId is required", false);
  }
  if (typeof amountMinor !== "number" || !Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw new HandlerError("payload.invalid", "amountMinor must be a positive integer", false);
  }
  if (typeof currency !== "string" || currency.length === 0) {
    throw new HandlerError("payload.invalid", "currency is required", false);
  }
  const variantIdRaw = record["variantId"];
  const quantityRaw = record["quantity"];
  const variantId =
    typeof variantIdRaw === "string" && variantIdRaw.length > 0 ? variantIdRaw : undefined;
  if (
    quantityRaw !== undefined &&
    (typeof quantityRaw !== "number" || !Number.isInteger(quantityRaw) || quantityRaw <= 0)
  ) {
    throw new HandlerError(
      "payload.invalid",
      "quantity must be a positive integer when provided",
      false,
    );
  }
  const quantity = typeof quantityRaw === "number" ? quantityRaw : undefined;
  return { transactionId, amountMinor, currency, variantId, quantity };
}

function deriveTransactionId(raw: string): CounterId<"transaction"> {
  // Deterministically derive a valid transaction CounterId from the payload's
  // opaque transaction reference so the state machine has a typed id.
  const entropy = new Uint8Array(16);
  for (let index = 0; index < raw.length; index += 1) {
    entropy[index % 16] = (entropy[index % 16]! + raw.charCodeAt(index)) & 0xff;
  }
  const result = createCounterId("transaction", entropy);
  if (!result.ok) {
    throw new HandlerError("transaction.id", "Could not derive transaction id", false);
  }
  return result.value;
}

function instant(milliseconds: number): Instant {
  const result = instantFromEpochMilliseconds(milliseconds);
  if (!result.ok) {
    throw new HandlerError("instant.invalid", "Invalid instant", false);
  }
  return result.value;
}

// ─── The handler ─────────────────────────────────────────────────────────────

export const TRANSACTION_LIFECYCLE_JOB_TYPE = "transaction.lifecycle";

/**
 * Executes the real durable transaction lifecycle. The state machine
 * transitions are real (not stubbed); reverting the execution body to a no-op
 * would leave the receipt's finalState in DRAFT and fail the unit tests.
 */
export function createTransactionLifecycleHandler(
  provider: PaymentAuthorizationPort,
  sink: ReceiptSink,
): JobHandler {
  return {
    async execute(job: HandledJob, now: Instant): Promise<void> {
      const payload = parsePayload(job.payload);
      const transactionId = deriveTransactionId(payload.transactionId);

      // 1. Real state machine: DRAFT -> QUOTED -> CHECKOUT_READY -> COMMITTING.
      let state = createInitialState({ transactionId, now });
      state = unwrap(
        transitionPhase({ state, to: "QUOTED", expectedVersion: state.version, now }),
        "lifecycle.phase",
      );
      state = unwrap(
        transitionPhase({ state, to: "CHECKOUT_READY", expectedVersion: state.version, now }),
        "lifecycle.phase",
      );
      // Move payment into an actionable state before committing.
      state = unwrap(
        transitionPayment({ state, to: "authorizing", expectedVersion: state.version, now }),
        "lifecycle.payment",
      );
      state = unwrap(
        transitionPhase({ state, to: "COMMITTING", expectedVersion: state.version, now }),
        "lifecycle.phase",
      );

      // 2. External truth: call the provider (mock client in tests, real HTTP
      //    client behind env config in production).
      //    GUARD: this may re-run for the same transactionId on a retry (see the
      //    IDEMPOTENCY CONTRACT on PaymentAuthorizationPort). The transactionId
      //    is passed as the provider's natural idempotency key so a compliant
      //    connector de-duplicates rather than double-capturing.
      const providerResult = await provider.authorizeAndCapture({
        transactionId,
        amountMinor: payload.amountMinor,
        currency: payload.currency,
        // The opaque payload transaction reference is the STABLE idempotency
        // key across retries (not regenerated per attempt).
        idempotencyKey: payload.transactionId,
        variantId: payload.variantId,
        quantity: payload.quantity,
      });

      if (providerResult.status === "declined") {
        // Reflect the decline in real state, then fail terminally.
        state = unwrap(
          transitionPayment({ state, to: "declining", expectedVersion: state.version, now }),
          "lifecycle.payment",
        );
        state = unwrap(
          transitionPayment({ state, to: "declined", expectedVersion: state.version, now }),
          "lifecycle.payment",
        );
        throw new HandlerError(
          "payment.declined",
          `Payment declined by provider for ${payload.transactionId}`,
          false,
        );
      }

      if (providerResult.status === "indeterminate") {
        // A possible external effect exists but the terminal outcome is
        // unconfirmed. Surface INDETERMINATE (retryable) rather than failing;
        // the per-transactionId idempotency contract lets a later attempt
        // resolve it without a second capture.
        state = unwrap(
          transitionPhase({ state, to: "INDETERMINATE", expectedVersion: state.version, now }),
          "lifecycle.phase",
        );
        await sink.record({
          transactionId,
          finalState: state,
          providerReference: providerResult.providerReference,
          reconciliation: {
            reconciled: false,
            intendedAmountMinor: payload.amountMinor,
            providerAmountMinor: providerResult.capturedMinor,
          },
          signedEvidence: providerResult.signedEvidence,
        });
        throw new HandlerError(
          "payment.indeterminate",
          `Payment outcome indeterminate for ${payload.transactionId}` +
            (providerResult.lastKnownState !== undefined
              ? ` (lastKnownState=${providerResult.lastKnownState})`
              : ""),
          true,
        );
      }

      // 3. Advance payment to authorized then captured, and commit the order.
      state = unwrap(
        transitionPayment({ state, to: "authorized", expectedVersion: state.version, now }),
        "lifecycle.payment",
      );
      state = unwrap(
        transitionPayment({ state, to: "capturing", expectedVersion: state.version, now }),
        "lifecycle.payment",
      );
      state = unwrap(
        transitionPayment({ state, to: "captured", expectedVersion: state.version, now }),
        "lifecycle.payment",
      );
      state = unwrap(
        transitionOrder({ state, to: "committing", expectedVersion: state.version, now }),
        "lifecycle.order",
      );
      state = unwrap(
        transitionOrder({ state, to: "committed", expectedVersion: state.version, now }),
        "lifecycle.order",
      );

      // 4. Reconciliation: compare intended vs provider-reported outcome.
      const reconciliation: ReconciliationOutcome = {
        reconciled: providerResult.capturedMinor === payload.amountMinor,
        intendedAmountMinor: payload.amountMinor,
        providerAmountMinor: providerResult.capturedMinor,
      };
      if (!reconciliation.reconciled) {
        // Provider effect exists but does not match intent -> INDETERMINATE and
        // a retryable failure so a follow-up reconciliation can resolve it.
        // NOTE: the retry replays authorizeAndCapture from DRAFT; correctness
        // depends on the provider honoring the per-transactionId idempotency
        // contract documented on PaymentAuthorizationPort so the replay does not
        // capture a second time. Resume-from-persisted-state is deferred to the
        // live-connector milestone.
        state = unwrap(
          transitionPhase({ state, to: "INDETERMINATE", expectedVersion: state.version, now }),
          "lifecycle.phase",
        );
        await sink.record({
          transactionId,
          finalState: state,
          providerReference: providerResult.providerReference,
          reconciliation,
          signedEvidence: providerResult.signedEvidence,
        });
        throw new HandlerError(
          "reconciliation.mismatch",
          `Provider captured ${String(providerResult.capturedMinor)} but intended ${String(payload.amountMinor)}`,
          true,
        );
      }

      // 5. Close the transaction and emit the receipt/evidence.
      state = unwrap(
        transitionPhase({ state, to: "ACTIVE", expectedVersion: state.version, now }),
        "lifecycle.phase",
      );
      state = unwrap(
        transitionPhase({ state, to: "CLOSED", expectedVersion: state.version, now }),
        "lifecycle.phase",
      );

      await sink.record({
        transactionId,
        finalState: state,
        providerReference: providerResult.providerReference,
        reconciliation,
        signedEvidence: providerResult.signedEvidence,
      });
    },
  };
}

export { instant as instantFromMillis };
