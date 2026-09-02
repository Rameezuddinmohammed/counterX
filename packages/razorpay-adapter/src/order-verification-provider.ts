/**
 * Real Razorpay one-time payment VERIFICATION provider.
 *
 * Unlike {@link RazorpayTestProvider}'s createInstruction (which creates a
 * FRESH order), this provider verifies an order created ELSEWHERE — the same
 * real order apps/worker/src/real-lifecycle.ts's step 4 already creates via
 * RazorpayTestProvider ("prove the server-side integration") — by polling
 * Razorpay's real, authoritative GET /v1/orders/{id}/payments. It never
 * creates a second order and never trusts anything but Razorpay's own
 * server-reported payment status.
 *
 * WHY THIS EXISTS: the worker's unattended authorize/capture seam previously
 * used CounterTestPaymentProvider (a purely in-memory simulation) for this
 * step, because Razorpay's real Standard Checkout requires a human to
 * complete it in a browser and the worker's authorize/capture call is
 * otherwise a single synchronous round trip. This provider closes that gap
 * WITHOUT inventing a parallel pipeline: when the order has no captured
 * payment yet it returns "action_required" (real order_id + key_id, so a
 * human can complete real Standard Checkout), which real-lifecycle.ts's
 * existing authorizeCapture() fallback already turns into an INDETERMINATE
 * outcome — a first-class, already-supported state, not a new one. A later
 * retry of the SAME transaction (job retry, or the reconciliation scanner)
 * re-polls the SAME order and finds it captured once the human has paid.
 *
 * The metadata key "razorpayOrderId" MUST be present on createInstruction's
 * command — real-lifecycle.ts threads through the real order id its own
 * step 4 already created for the same transaction (same idempotencyKey).
 *
 * capabilities/verifyClientReturn/query/refund/queryRefund/verifyWebhook are
 * delegated to an internal RazorpayTestProvider instance rather than
 * reimplemented — those operations are identical regardless of who created
 * the order.
 *
 * SECURITY: no raw payment credentials, PAN, CVV, or UPI PIN pass through
 * here — only provider references, amounts, and status. Evidence returned
 * for a real captured payment is CTP-signed exactly like
 * CounterTestPaymentProvider's, but the canonical_claim is built from REAL
 * Razorpay data (payment id, amount, method) instead of a simulated one, and
 * source_id/environment make clear this is Razorpay TEST MODE evidence, not
 * a live payment.
 */

import { randomBytes } from "node:crypto";

import type { Instant } from "@counter/domain";
import {
  createCanonicalError,
  instantFromEpochMilliseconds,
  serializeInstant,
} from "@counter/domain";
import type { CtpEnvelope, EvidencePayload, Signer } from "@counter/trust-protocol";
import { buildUnsignedEnvelope, generateNonce, signEnvelope } from "@counter/trust-protocol";
import type {
  CreatePaymentInstruction,
  PaymentOperationResult,
  ProviderCapabilities,
  ProviderContext,
  ProviderPaymentEvidence,
  ProviderReference,
  ProviderRefundEvidence,
  ProviderRefundReference,
  RawClientReturn,
  RawWebhook,
  RefundCommand,
  UntrustedOrVerifiedReturn,
  VerifiedProviderEvent,
} from "@counter/payment-sdk";
import type { PaymentProvider } from "@counter/payment-sdk";

import type { RazorpayHttpPort } from "./http-client.js";
import type { RazorpayPayment } from "./types.js";
import type { RazorpayTestAdapterConfig } from "./adapter-config.js";
import { RazorpayTestProvider } from "./razorpay-provider.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const RETRY_AFTER_MS = 15 * 1000;
const ACTION_EXPIRY_MS = 15 * 60 * 1000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function nowInstant(clock: () => number): Instant {
  const result = instantFromEpochMilliseconds(clock());
  if (!result.ok) {
    throw new TypeError("Clock produced invalid instant");
  }
  return result.value;
}

function futureInstant(clock: () => number, offsetMs: number): Instant {
  const result = instantFromEpochMilliseconds(clock() + offsetMs);
  if (!result.ok) {
    throw new TypeError("Clock produced invalid future instant");
  }
  return result.value;
}

/** Same mapping RazorpayTestProvider uses: authorized payments count as confirmed (auto-capture is Razorpay's default for orders created without payment_capture: 0). */
function mapPaymentStatus(status: string): "confirmed" | "declined" | "pending" {
  switch (status) {
    case "captured":
    case "authorized":
      return "confirmed";
    case "failed":
      return "declined";
    default:
      return "pending";
  }
}

interface OrderPaymentsResponse {
  readonly entity: "collection";
  readonly count: number;
  readonly items: readonly RazorpayPayment[];
}

// ─── RazorpayOrderVerificationProvider ──────────────────────────────────────

export interface RazorpayOrderVerificationProviderConfig {
  readonly config: RazorpayTestAdapterConfig;
  readonly httpClient: RazorpayHttpPort;
  /** CTP signer used to attest the REAL Razorpay evidence this provider observes — same signer the worker already resolves via requireCounterTestPaymentSigner. */
  readonly signer: Signer;
  readonly kid: string;
  readonly clock?: () => number;
}

export class RazorpayOrderVerificationProvider implements PaymentProvider {
  readonly #config: RazorpayTestAdapterConfig;
  readonly #http: RazorpayHttpPort;
  readonly #signer: Signer;
  readonly #kid: string;
  readonly #clock: () => number;
  readonly #delegate: RazorpayTestProvider;

  public constructor(opts: RazorpayOrderVerificationProviderConfig) {
    this.#config = opts.config;
    this.#http = opts.httpClient;
    this.#signer = opts.signer;
    this.#kid = opts.kid;
    this.#clock = opts.clock ?? (() => Date.now());
    this.#delegate = new RazorpayTestProvider({
      config: opts.config,
      httpClient: opts.httpClient,
      ...(opts.clock !== undefined ? { clock: opts.clock } : {}),
    });
  }

  public async capabilities(context: ProviderContext): Promise<ProviderCapabilities> {
    return this.#delegate.capabilities(context);
  }

  public async verifyClientReturn(input: RawClientReturn): Promise<UntrustedOrVerifiedReturn> {
    return this.#delegate.verifyClientReturn(input);
  }

  public async query(reference: ProviderReference): Promise<ProviderPaymentEvidence> {
    return this.#delegate.query(reference);
  }

  public async refund(command: RefundCommand): Promise<PaymentOperationResult> {
    return this.#delegate.refund(command);
  }

  public async queryRefund(reference: ProviderRefundReference): Promise<ProviderRefundEvidence> {
    return this.#delegate.queryRefund(reference);
  }

  public async verifyWebhook(input: RawWebhook): Promise<VerifiedProviderEvent> {
    return this.#delegate.verifyWebhook(input);
  }

  /**
   * Verifies (never creates) the real Razorpay order named in
   * command.metadata.razorpayOrderId.
   *
   *  - A captured/authorized payment against that order -> "confirmed" with
   *    REAL, CTP-signed evidence.
   *  - No such payment yet (the human has not completed Standard Checkout,
   *    or a prior attempt failed and can be retried) -> "action_required"
   *    with the real order_id/key_id, which the caller's existing fallback
   *    turns into INDETERMINATE — never a hard failure.
   */
  public async createInstruction(
    command: CreatePaymentInstruction,
  ): Promise<PaymentOperationResult> {
    const razorpayOrderId = command.metadata?.["razorpayOrderId"];
    if (razorpayOrderId === undefined || razorpayOrderId.length === 0) {
      throw createCanonicalError({
        code: "INVALID_FORMAT",
        category: "validation",
        message:
          "RazorpayOrderVerificationProvider requires metadata.razorpayOrderId (the real order created earlier in the same transaction)",
      });
    }

    const response = await this.#http.request<OrderPaymentsResponse>({
      method: "GET",
      path: `/v1/orders/${razorpayOrderId}/payments`,
    });

    if (response.status !== 200) {
      const queryAfter = futureInstant(this.#clock, RETRY_AFTER_MS);
      return Object.freeze({
        kind: "indeterminate" as const,
        reference: command.idempotencyKey as ProviderReference,
        queryAfter,
      });
    }

    const captured = response.body.items.find((p) => mapPaymentStatus(p.status) === "confirmed");
    if (captured !== undefined) {
      const now = nowInstant(this.#clock);
      const envelope = await this.#buildSignedEnvelope(captured, razorpayOrderId, now);
      const evidence: ProviderPaymentEvidence = Object.freeze({
        reference: captured.id as ProviderReference,
        status: "confirmed" as const,
        confirmedAt: now,
        providerData: Object.freeze({
          ...(envelope !== undefined ? { envelope } : {}),
          razorpayOrderId,
          razorpayPaymentId: captured.id,
          method: captured.method,
          amountPaise: captured.amount,
        }),
      });
      return Object.freeze({ kind: "confirmed" as const, evidence });
    }

    // No captured payment yet — real order/key id so a human can complete
    // (or retry) real Standard Checkout. A later attempt re-polls the SAME
    // order, never creates a second one.
    const expiresAt = futureInstant(this.#clock, ACTION_EXPIRY_MS);
    return Object.freeze({
      kind: "action_required" as const,
      action: Object.freeze({
        url: `${this.#config.baseUrl}/checkout`,
        method: "POST" as const,
        metadata: Object.freeze({
          razorpay_order_id: razorpayOrderId,
          razorpay_key_id: this.#config.keyId,
        }),
      }),
      expiresAt,
    });
  }

  async #buildSignedEnvelope(
    payment: RazorpayPayment,
    razorpayOrderId: string,
    now: Instant,
  ): Promise<CtpEnvelope<EvidencePayload> | undefined> {
    const issuedAtIso = serializeInstant(now);
    const nonce = generateNonce((length: number) => randomBytes(length));

    const expiresAtResult = instantFromEpochMilliseconds(this.#clock() + 3_600_000);
    const expiresAtIso = expiresAtResult.ok ? serializeInstant(expiresAtResult.value) : issuedAtIso;

    const payload: EvidencePayload = {
      evidence_id: `ctr_evidence_${payment.id}`,
      source_type: "payment_provider",
      // Explicit "-test-mode" suffix: this evidence attests a REAL Razorpay
      // TEST MODE payment, never a live one — CounterTestPaymentProvider's
      // source_id ("counter-test-provider") would misleadingly suggest a
      // purely simulated payment, which this is not.
      source_id: "razorpay-test-mode",
      observation_method: "direct",
      observation_time: issuedAtIso,
      data_classification: "internal",
      retention: "standard",
      canonical_claim: {
        reference: payment.id,
        status: "confirmed",
        razorpay_order_id: razorpayOrderId,
        razorpay_payment_id: payment.id,
        amount_paise: payment.amount,
        currency: payment.currency,
        method: payment.method,
        test_mode: true,
      },
    };

    const unsignedResult = buildUnsignedEnvelope<EvidencePayload>({
      type: "counter.evidence.v1",
      id: `ctr_evidence_${payment.id}`,
      issuer: "counter://razorpay/test-mode-payment-provider",
      subject: `counter://razorpay/payment/${payment.id}`,
      audience: ["counter://test/orchestrator"],
      environment: "sandbox",
      issued_at: issuedAtIso,
      not_before: issuedAtIso,
      expires_at: expiresAtIso,
      nonce,
      correlation_id: `ctr_correlation_${payment.id}`,
      payload,
      kid: this.#kid,
    });

    if (!unsignedResult.ok) {
      return undefined;
    }

    const signedResult = await signEnvelope(unsignedResult.value, this.#signer);
    if (!signedResult.ok) {
      return undefined;
    }

    return signedResult.value;
  }
}
