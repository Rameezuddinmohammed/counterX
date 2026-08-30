import type { Brand } from "@counter/domain";
import type {
  Environment,
  Instant,
  IsoCurrencyCode,
  MerchantId,
  Money,
  WalletId,
  AgentId,
} from "@counter/domain";

// ─── Branded References ──────────────────────────────────────────────────────

export type ProviderReference = Brand<string, "ProviderReference">;
export type ProviderRefundReference = Brand<string, "ProviderRefundReference">;

// ─── Provider Context & Capabilities ─────────────────────────────────────────

export interface ProviderContext {
  readonly environment: Environment;
  readonly walletId: WalletId;
  readonly agentId: AgentId;
  readonly merchantId: MerchantId;
}

export interface ProviderCapabilities {
  readonly methods: readonly string[];
  readonly currencies: readonly IsoCurrencyCode[];
  readonly lifecycleType: "authorize_capture" | "direct_capture";
  readonly idempotency: boolean;
  readonly webhookVerification: boolean;
  readonly refundSupported: boolean;
}

// ─── Actions & Evidence ──────────────────────────────────────────────────────

export interface HostedPaymentAction {
  readonly url: string;
  readonly method: "GET" | "POST";
  readonly metadata?: Record<string, string>;
}

export interface ProviderPaymentEvidence {
  readonly reference: ProviderReference;
  readonly status: "confirmed" | "declined" | "pending";
  readonly confirmedAt?: Instant;
  readonly providerData?: Record<string, unknown>;
}

export interface ProviderDecline {
  readonly code: string;
  readonly reason: string;
  readonly retryable: boolean;
}

export interface ProviderRefundEvidence {
  readonly reference: ProviderRefundReference;
  readonly status: "confirmed" | "pending" | "declined";
  readonly amount: Money;
  readonly processedAt?: Instant;
}

// ─── Webhook & Client Return ─────────────────────────────────────────────────

export interface VerifiedProviderEvent {
  readonly eventType: string;
  readonly reference: ProviderReference;
  readonly evidence: ProviderPaymentEvidence;
  readonly receivedAt: Instant;
}

export interface RawWebhook {
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
  readonly receivedAt: Instant;
}

export interface RawClientReturn {
  readonly queryParams: Readonly<Record<string, string>>;
  readonly fragment?: string;
  readonly returnedAt: Instant;
}

/**
 * Discriminated union for client return verification results.
 *
 * A browser return is correlation evidence only -- never captured/paid truth
 * without authoritative provider evidence.
 */
export type UntrustedOrVerifiedReturn = UntrustedReturn | VerifiedReturn;

/**
 * A browser return is correlation evidence only -- never captured/paid truth
 * without authoritative provider evidence.
 */
export interface UntrustedReturn {
  readonly kind: "untrusted";
  readonly correlationId: string;
}

export interface VerifiedReturn {
  readonly kind: "verified";
  readonly correlationId: string;
  readonly evidence: ProviderPaymentEvidence;
}

// ─── Commands ────────────────────────────────────────────────────────────────

export interface CreatePaymentInstruction {
  readonly authorizationRef: string;
  readonly amount: Money;
  readonly currency: IsoCurrencyCode;
  readonly merchantId: MerchantId;
  readonly idempotencyKey: string;
  readonly metadata?: Record<string, string>;
}

export interface AuthorizePayment {
  readonly authorizationRef: string;
  readonly amount: Money;
  readonly currency: IsoCurrencyCode;
  readonly merchantId: MerchantId;
  readonly idempotencyKey: string;
}

export interface CapturePayment {
  readonly reference: ProviderReference;
  readonly amount: Money;
  readonly idempotencyKey: string;
}

export interface VoidPayment {
  readonly reference: ProviderReference;
  readonly reason?: string;
  readonly idempotencyKey: string;
}

export interface RefundCommand {
  readonly reference: ProviderReference;
  readonly amount: Money;
  readonly reason?: string;
  readonly idempotencyKey: string;
}

// ─── Payment Operation Result ────────────────────────────────────────────────

export type PaymentOperationResult =
  | PaymentConfirmed
  | PaymentActionRequired
  | PaymentPending
  | PaymentDeclined
  | PaymentIndeterminate;

export interface PaymentConfirmed {
  readonly kind: "confirmed";
  readonly evidence: ProviderPaymentEvidence;
}

export interface PaymentActionRequired {
  readonly kind: "action_required";
  readonly action: HostedPaymentAction;
  readonly expiresAt: Instant;
}

export interface PaymentPending {
  readonly kind: "pending";
  readonly reference: ProviderReference;
}

export interface PaymentDeclined {
  readonly kind: "declined";
  readonly reason: ProviderDecline;
}

export interface PaymentIndeterminate {
  readonly kind: "indeterminate";
  readonly reference: ProviderReference;
  readonly queryAfter: Instant;
}
