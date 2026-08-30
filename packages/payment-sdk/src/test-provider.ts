/**
 * Deterministic in-memory test payment provider.
 *
 * Covers all PaymentProvider operations with scenario-based behavior.
 * Evidence envelopes are cryptographically signed using the CTP trust-protocol
 * with "sandbox" as the CTP environment (CTP does not define "local"/"test").
 *
 * No external HTTP calls - everything is in-memory.
 */

import { randomBytes } from "node:crypto";

import type { Instant, IsoCurrencyCode, Money } from "@counter/domain";
import {
  createCanonicalError,
  instantFromEpochMilliseconds,
  serializeInstant,
} from "@counter/domain";
import type { CtpEnvelope, EvidencePayload, Signer } from "@counter/trust-protocol";
import { buildUnsignedEnvelope, generateNonce, signEnvelope } from "@counter/trust-protocol";

import type {
  AuthorizePayment,
  CapturePayment,
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
  VoidPayment,
} from "./types.js";
import type { PaymentProvider } from "./provider.js";

// ─── TestScenario ────────────────────────────────────────────────────────────

/**
 * Deterministic test scenarios that drive the behavior of CounterTestPaymentProvider.
 */
export type TestScenario =
  | "immediate_success"
  | "immediate_decline"
  | "timeout_before_effect"
  | "timeout_after_effect"
  | "pending_then_success"
  | "action_required"
  | "refund_success"
  | "refund_pending";

// ─── TestProviderConfig ──────────────────────────────────────────────────────

export interface TestProviderConfig {
  readonly environment: "local" | "test";
  readonly signer: Signer;
  readonly kid: string;
  readonly scenarios?: Map<string, TestScenario>;
  readonly clock?: () => number;
}

// ─── Internal State ──────────────────────────────────────────────────────────

interface StoredState {
  readonly scenario: TestScenario;
  readonly result: PaymentOperationResult;
  readonly evidence?: ProviderPaymentEvidence;
  readonly phase?: "authorized" | "captured" | "voided";
  readonly amount?: Money;
}

interface StoredRefundState {
  readonly scenario: TestScenario;
  readonly result: PaymentOperationResult;
  readonly evidence?: ProviderRefundEvidence;
}

// ─── Suffix Parsing ──────────────────────────────────────────────────────────

function parseScenarioFromSuffix(key: string): TestScenario {
  if (key.endsWith("-refund-pending")) return "refund_pending";
  if (key.endsWith("-decline")) return "immediate_decline";
  if (key.endsWith("-timeout-before")) return "timeout_before_effect";
  if (key.endsWith("-timeout-after")) return "timeout_after_effect";
  if (key.endsWith("-pending")) return "pending_then_success";
  if (key.endsWith("-action")) return "action_required";
  return "immediate_success";
}

// ─── Test Currency Codes ─────────────────────────────────────────────────────

const TEST_CURRENCIES: readonly IsoCurrencyCode[] = Object.freeze([
  "INR" as IsoCurrencyCode,
  "USD" as IsoCurrencyCode,
]);

// ─── CounterTestPaymentProvider ──────────────────────────────────────────────

/**
 * A deterministic, in-memory test payment provider that implements all
 * PaymentProvider operations. Behavior is controlled via TestScenario -
 * either looked up from a scenario map or parsed from the idempotency key suffix.
 *
 * Evidence is CTP-signed using the provided signer with "sandbox" as the
 * CTP environment (CTP only allows sandbox/pilot/production).
 */
export class CounterTestPaymentProvider implements PaymentProvider {
  readonly #signer: Signer;
  readonly #kid: string;
  readonly #scenarioMap: Map<string, TestScenario>;
  readonly #clock: () => number;
  readonly #state: Map<string, StoredState>;
  readonly #refundState: Map<string, StoredRefundState>;

  public constructor(config: TestProviderConfig) {
    if (config.environment !== "local" && config.environment !== "test") {
      throw createCanonicalError({
        code: "ENVIRONMENT_MISMATCH",
        category: "validation",
        message: "CounterTestPaymentProvider requires a test environment (local or test)",
      });
    }

    this.#signer = config.signer;
    this.#kid = config.kid;
    this.#scenarioMap = config.scenarios ?? new Map();
    this.#clock = config.clock ?? (() => Date.now());
    this.#state = new Map();
    this.#refundState = new Map();
  }

  /**
   * Determines the scenario for a given key by checking the scenario map first,
   * then falling back to suffix-based parsing.
   */
  public getScenario(key: string): TestScenario {
    return this.#scenarioMap.get(key) ?? parseScenarioFromSuffix(key);
  }

  public async capabilities(_context: ProviderContext): Promise<ProviderCapabilities> {
    return Object.freeze({
      methods: Object.freeze(["card", "upi", "wallet"]),
      currencies: TEST_CURRENCIES,
      lifecycleType: "authorize_capture" as const,
      idempotency: true,
      webhookVerification: true,
      refundSupported: true,
    });
  }

  public async createInstruction(
    command: CreatePaymentInstruction,
  ): Promise<PaymentOperationResult> {
    const scenario = this.getScenario(command.idempotencyKey);

    // Idempotency: if we already have state for this key, return stored result
    const existing = this.#state.get(command.idempotencyKey);
    if (existing !== undefined) {
      return existing.result;
    }

    const reference = `test-ref-${command.idempotencyKey}` as ProviderReference;
    const now = this.#now();

    switch (scenario) {
      case "immediate_success": {
        const evidence = await this.#generateEvidence(reference, "confirmed", now);
        const result: PaymentOperationResult = { kind: "confirmed", evidence };
        this.#state.set(command.idempotencyKey, { scenario, result, evidence });
        return result;
      }

      case "immediate_decline": {
        const result: PaymentOperationResult = {
          kind: "declined",
          reason: Object.freeze({
            code: "INSUFFICIENT_FUNDS",
            reason: "Test decline",
            retryable: false,
          }),
        };
        this.#state.set(command.idempotencyKey, { scenario, result });
        return result;
      }

      case "timeout_before_effect": {
        // Effect did NOT happen - store state for query resolution
        const queryAfter = this.#futureInstant(5000);
        const result: PaymentOperationResult = { kind: "indeterminate", reference, queryAfter };
        this.#state.set(command.idempotencyKey, { scenario, result });
        return result;
      }

      case "timeout_after_effect": {
        // Effect DID happen but we simulate timeout
        const evidenceInternal = await this.#generateEvidence(reference, "confirmed", now);
        const queryAfter = this.#futureInstant(5000);
        const result: PaymentOperationResult = { kind: "indeterminate", reference, queryAfter };
        this.#state.set(command.idempotencyKey, { scenario, result, evidence: evidenceInternal });
        return result;
      }

      case "pending_then_success": {
        const result: PaymentOperationResult = { kind: "pending", reference };
        this.#state.set(command.idempotencyKey, { scenario, result });
        return result;
      }

      case "action_required": {
        const expiresAt = this.#futureInstant(900_000); // 15 minutes
        const result: PaymentOperationResult = {
          kind: "action_required",
          action: Object.freeze({
            url: `https://test.counter.network/pay/${reference}`,
            method: "GET" as const,
          }),
          expiresAt,
        };
        this.#state.set(command.idempotencyKey, { scenario, result });
        return result;
      }

      default: {
        // refund_success and refund_pending are refund-specific; default to immediate_success
        const evidence = await this.#generateEvidence(reference, "confirmed", now);
        const result: PaymentOperationResult = { kind: "confirmed", evidence };
        this.#state.set(command.idempotencyKey, { scenario, result, evidence });
        return result;
      }
    }
  }

  public async query(reference: ProviderReference): Promise<ProviderPaymentEvidence> {
    // Find state by reference
    const entry = this.#findByReference(reference);

    if (entry === undefined) {
      return Object.freeze({
        reference,
        status: "pending" as const,
      });
    }

    const [key, state] = entry;
    const now = this.#now();

    switch (state.scenario) {
      case "pending_then_success": {
        // Transition to confirmed on query
        const evidence = await this.#generateEvidence(reference, "confirmed", now);
        const updatedResult: PaymentOperationResult = { kind: "confirmed", evidence };
        this.#state.set(key, { ...state, result: updatedResult, evidence });
        return evidence;
      }

      case "timeout_before_effect": {
        // Nothing happened - return declined
        const evidence: ProviderPaymentEvidence = Object.freeze({
          reference,
          status: "declined" as const,
        });
        return evidence;
      }

      case "timeout_after_effect": {
        // Effect happened - return stored confirmed evidence
        if (state.evidence !== undefined) {
          return state.evidence;
        }
        const evidence = await this.#generateEvidence(reference, "confirmed", now);
        return evidence;
      }

      case "immediate_success": {
        if (state.evidence !== undefined) {
          return state.evidence;
        }
        return Object.freeze({ reference, status: "confirmed" as const, confirmedAt: now });
      }

      default: {
        if (state.evidence !== undefined) {
          return state.evidence;
        }
        return Object.freeze({ reference, status: "pending" as const });
      }
    }
  }

  /**
   * Verifies a browser return. A browser return is correlation evidence only -
   * it is never captured/paid truth without authoritative provider evidence.
   */
  public async verifyClientReturn(input: RawClientReturn): Promise<UntrustedOrVerifiedReturn> {
    const correlationId = input.queryParams["ref"] ?? input.queryParams["id"] ?? "unknown";

    // Look up if we have confirmed evidence for this correlation
    const entry = this.#findByReference(correlationId as ProviderReference);
    if (entry !== undefined) {
      const [, state] = entry;
      if (state.evidence !== undefined && state.evidence.status === "confirmed") {
        return Object.freeze({
          kind: "verified" as const,
          correlationId,
          evidence: state.evidence,
        });
      }
    }

    return Object.freeze({
      kind: "untrusted" as const,
      correlationId,
    });
  }

  public async authorize(command: AuthorizePayment): Promise<PaymentOperationResult> {
    const scenario = this.getScenario(command.idempotencyKey);
    const existing = this.#state.get(command.idempotencyKey);
    if (existing !== undefined) {
      return existing.result;
    }

    const reference = `test-auth-ref-${command.idempotencyKey}` as ProviderReference;
    const now = this.#now();

    switch (scenario) {
      case "immediate_decline": {
        const result: PaymentOperationResult = {
          kind: "declined",
          reason: Object.freeze({
            code: "INSUFFICIENT_FUNDS",
            reason: "Test decline",
            retryable: false,
          }),
        };
        this.#state.set(command.idempotencyKey, { scenario, result });
        return result;
      }

      case "timeout_before_effect": {
        const queryAfter = this.#futureInstant(5000);
        const result: PaymentOperationResult = { kind: "indeterminate", reference, queryAfter };
        this.#state.set(command.idempotencyKey, { scenario, result });
        return result;
      }

      case "timeout_after_effect": {
        const evidenceInternal = await this.#generateEvidence(reference, "confirmed", now);
        const queryAfter = this.#futureInstant(5000);
        const result: PaymentOperationResult = { kind: "indeterminate", reference, queryAfter };
        this.#state.set(command.idempotencyKey, {
          scenario,
          result,
          evidence: evidenceInternal,
          phase: "authorized",
          amount: command.amount,
        });
        return result;
      }

      case "pending_then_success": {
        const result: PaymentOperationResult = { kind: "pending", reference };
        this.#state.set(command.idempotencyKey, {
          scenario,
          result,
          phase: "authorized",
          amount: command.amount,
        });
        return result;
      }

      case "action_required": {
        const expiresAt = this.#futureInstant(900_000);
        const result: PaymentOperationResult = {
          kind: "action_required",
          action: Object.freeze({
            url: `https://test.counter.network/pay/${reference}`,
            method: "GET" as const,
          }),
          expiresAt,
        };
        this.#state.set(command.idempotencyKey, {
          scenario,
          result,
          phase: "authorized",
          amount: command.amount,
        });
        return result;
      }

      default: {
        // immediate_success and others
        const evidence = await this.#generateEvidence(reference, "confirmed", now);
        const result: PaymentOperationResult = { kind: "confirmed", evidence };
        this.#state.set(command.idempotencyKey, {
          scenario,
          result,
          evidence,
          phase: "authorized",
          amount: command.amount,
        });
        return result;
      }
    }
  }

  public async capture(command: CapturePayment): Promise<PaymentOperationResult> {
    const now = this.#now();
    const reference = command.reference;

    // Find authorized state
    const entry = this.#findByReference(reference);
    if (entry !== undefined) {
      const [key, state] = entry;
      const evidence = await this.#generateEvidence(reference, "confirmed", now);
      const result: PaymentOperationResult = { kind: "confirmed", evidence };
      this.#state.set(key, { ...state, result, evidence, phase: "captured" });
      return result;
    }

    // No prior authorized state - generate fresh evidence
    const evidence = await this.#generateEvidence(reference, "confirmed", now);
    const result: PaymentOperationResult = { kind: "confirmed", evidence };
    this.#state.set(command.idempotencyKey, {
      scenario: "immediate_success",
      result,
      evidence,
      phase: "captured",
    });
    return result;
  }

  public async void(command: VoidPayment): Promise<PaymentOperationResult> {
    const now = this.#now();
    const reference = command.reference;

    const entry = this.#findByReference(reference);
    const evidence = await this.#generateEvidence(reference, "confirmed", now);
    const result: PaymentOperationResult = { kind: "confirmed", evidence };

    if (entry !== undefined) {
      const [key, state] = entry;
      this.#state.set(key, { ...state, result, evidence, phase: "voided" });
    } else {
      this.#state.set(command.idempotencyKey, {
        scenario: "immediate_success",
        result,
        evidence,
        phase: "voided",
      });
    }

    return result;
  }

  public async refund(command: RefundCommand): Promise<PaymentOperationResult> {
    const scenario = this.getScenario(command.idempotencyKey);
    const existingRefund = this.#refundState.get(command.idempotencyKey);
    if (existingRefund !== undefined) {
      return existingRefund.result;
    }

    const reference = `test-refund-ref-${command.idempotencyKey}` as ProviderReference;
    const refundReference = `test-refund-ref-${command.idempotencyKey}` as ProviderRefundReference;
    const now = this.#now();

    switch (scenario) {
      case "refund_pending": {
        const result: PaymentOperationResult = {
          kind: "pending",
          reference,
        };
        const refundEvidence: ProviderRefundEvidence = Object.freeze({
          reference: refundReference,
          status: "pending" as const,
          amount: command.amount,
        });
        this.#refundState.set(command.idempotencyKey, {
          scenario,
          result,
          evidence: refundEvidence,
        });
        return result;
      }

      default: {
        // refund_success and all others - return confirmed
        const evidence = await this.#generateEvidence(reference, "confirmed", now);
        const result: PaymentOperationResult = { kind: "confirmed", evidence };
        const refundEvidence: ProviderRefundEvidence = Object.freeze({
          reference: refundReference,
          status: "confirmed" as const,
          amount: command.amount,
          processedAt: now,
        });
        this.#refundState.set(command.idempotencyKey, {
          scenario,
          result,
          evidence: refundEvidence,
        });
        return result;
      }
    }
  }

  public async queryRefund(reference: ProviderRefundReference): Promise<ProviderRefundEvidence> {
    // Find refund state by reference
    for (const state of this.#refundState.values()) {
      if (state.evidence !== undefined && state.evidence.reference === reference) {
        // If pending, transition to confirmed on query
        if (state.evidence.status === "pending") {
          const now = this.#now();
          return Object.freeze({
            reference,
            status: "confirmed" as const,
            amount: state.evidence.amount,
            processedAt: now,
          });
        }
        return state.evidence;
      }
    }

    // Default: return confirmed with zero amount placeholder
    const now = this.#now();
    return Object.freeze({
      reference,
      status: "confirmed" as const,
      amount: Object.freeze({ amountMinor: 0n, currency: "INR" as IsoCurrencyCode }),
      processedAt: now,
    });
  }

  public async verifyWebhook(input: RawWebhook): Promise<VerifiedProviderEvent> {
    const bodyString = new TextDecoder().decode(input.body);
    const parsed = JSON.parse(bodyString) as Record<string, unknown>;

    // For test provider: verify "x-test-signature" header equals "valid"
    const signature = input.headers["x-test-signature"];
    if (signature !== "valid") {
      throw createCanonicalError({
        code: "UNAUTHENTICATED",
        category: "authentication",
        message: "Invalid test webhook signature",
      });
    }

    const reference = ((parsed["reference"] as string) ?? "test-webhook-ref") as ProviderReference;
    const eventType = (parsed["eventType"] as string) ?? "payment.completed";

    const evidence: ProviderPaymentEvidence = Object.freeze({
      reference,
      status: "confirmed" as const,
      confirmedAt: input.receivedAt,
      providerData: parsed,
    });

    return Object.freeze({
      eventType,
      reference,
      evidence,
      receivedAt: input.receivedAt,
    });
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  #now(): Instant {
    const result = instantFromEpochMilliseconds(this.#clock());
    if (!result.ok) {
      throw new TypeError("Clock returned invalid epoch milliseconds");
    }
    return result.value;
  }

  #futureInstant(offsetMs: number): Instant {
    const future = this.#clock() + offsetMs;
    const result = instantFromEpochMilliseconds(future);
    if (!result.ok) {
      throw new TypeError("Failed to compute future instant");
    }
    return result.value;
  }

  #findByReference(reference: ProviderReference | string): [string, StoredState] | undefined {
    for (const [key, state] of this.#state.entries()) {
      // Check if reference matches the stored result reference
      if (state.result.kind === "confirmed" && state.evidence?.reference === reference) {
        return [key, state];
      }
      if (state.result.kind === "pending" && state.result.reference === reference) {
        return [key, state];
      }
      if (state.result.kind === "indeterminate" && state.result.reference === reference) {
        return [key, state];
      }
      if (state.result.kind === "action_required") {
        // Check constructed reference patterns
        const expectedRef = `test-ref-${key}`;
        const expectedAuthRef = `test-auth-ref-${key}`;
        if (reference === expectedRef || reference === expectedAuthRef) {
          return [key, state];
        }
      }
    }
    return undefined;
  }

  async #generateEvidence(
    reference: ProviderReference,
    status: "confirmed" | "declined" | "pending",
    now: Instant,
  ): Promise<ProviderPaymentEvidence> {
    const envelope = await this.#buildSignedEnvelope(reference, now);

    const base = { reference, status } as const;
    const withConfirmed = status === "confirmed" ? { ...base, confirmedAt: now } : base;
    const withData =
      envelope !== undefined
        ? { ...withConfirmed, providerData: { envelope } as Record<string, unknown> }
        : withConfirmed;

    return Object.freeze(withData);
  }

  async #buildSignedEnvelope(
    reference: ProviderReference,
    now: Instant,
  ): Promise<CtpEnvelope<EvidencePayload> | undefined> {
    const issuedAt = serializeInstant(now);
    const nonce = generateNonce((length: number) => randomBytes(length));

    const expiresAtResult = instantFromEpochMilliseconds(now + 3_600_000);
    const expiresAt = expiresAtResult.ok ? serializeInstant(expiresAtResult.value) : issuedAt;

    const payload: EvidencePayload = {
      evidence_id: `ctr_evidence_${reference}`,
      source_type: "payment_provider",
      source_id: "counter-test-provider",
      observation_method: "direct",
      observation_time: issuedAt,
      data_classification: "internal",
      retention: "standard",
      canonical_claim: { reference, status: "confirmed" },
    };

    const unsignedResult = buildUnsignedEnvelope<EvidencePayload>({
      type: "counter.evidence.v1",
      id: `ctr_evidence_${reference}`,
      issuer: "counter://test/payment-provider",
      subject: `counter://test/payment/${reference}`,
      audience: ["counter://test/orchestrator"],
      environment: "sandbox",
      issued_at: issuedAt,
      not_before: issuedAt,
      expires_at: expiresAt,
      nonce,
      correlation_id: `ctr_correlation_${reference}`,
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
