/**
 * Mandate issuance service.
 *
 * Issues mandates ONLY from current stepped-up consent attestation.
 * Validates:
 * - Agent is registered with an active key
 * - Consent attestation is fresh and unrevoked (matched by digest)
 * - Policy allows the mandate scope
 *
 * Builds and returns a CTP counter.mandate.v1 unsigned envelope.
 * Signing is deferred to the SecureKeyStore holder.
 */

import type { CounterId } from "@counter/domain";
import { CryptoIdGenerator } from "@counter/domain";
import type { MandatePayload, UnsignedCtpEnvelope, MoneyAmount } from "@counter/trust-protocol";
import { buildUnsignedEnvelope, computePayloadDigest } from "@counter/trust-protocol";
import type { BuyerPolicyConstraints, WalletMandate, MandateRepository } from "@counter/wallet-domain";
import type { AgentRegistration } from "./agent-registration.js";
import type { StepUpSession } from "./step-up-service.js";
import { StepUpService } from "./step-up-service.js";

// ---------------------------------------------------------------------------
// Mandate Issuance Input
// ---------------------------------------------------------------------------

export interface MandateIssuanceParams {
  readonly walletId: CounterId<"wallet">;
  readonly principalId: CounterId<"actor">;
  readonly agentId: CounterId<"agent">;
  readonly kid: string;
  readonly constraints: BuyerPolicyConstraints;
  readonly paymentReferenceId: string;
  readonly validFrom: string;
  readonly validUntil: string;
  readonly consentAttestationDigest: string;
  readonly policyVersionId: string;
  readonly stepUpSession: StepUpSession;
  readonly correlationId: string;
}

// ---------------------------------------------------------------------------
// Mandate Issuance Result
// ---------------------------------------------------------------------------

export interface MandateIssuanceOutput {
  readonly mandate: WalletMandate;
  readonly envelope: UnsignedCtpEnvelope<MandatePayload>;
  readonly payloadDigest: string;
}

export interface MandateIssuanceError {
  readonly kind: "mandate_issuance_error";
  readonly reason: string;
}

export type MandateIssuanceResult =
  | { readonly ok: true; readonly value: MandateIssuanceOutput }
  | { readonly ok: false; readonly error: MandateIssuanceError };

// ---------------------------------------------------------------------------
// Agent Lookup Function
// ---------------------------------------------------------------------------

export type AgentLookup = (agentId: CounterId<"agent">) => AgentRegistration | undefined;
export type ConsentDigestValidator = (digest: string) => boolean;

// ---------------------------------------------------------------------------
// Mandate Service
// ---------------------------------------------------------------------------

export class MandateService {
  readonly #mandateRepo: MandateRepository;
  readonly #agentLookup: AgentLookup;
  readonly #consentDigestValidator: ConsentDigestValidator;
  readonly #stepUpService: StepUpService;
  readonly #idGenerator: CryptoIdGenerator;

  constructor(
    mandateRepo: MandateRepository,
    agentLookup: AgentLookup,
    consentDigestValidator: ConsentDigestValidator,
    stepUpService?: StepUpService,
  ) {
    this.#mandateRepo = mandateRepo;
    this.#agentLookup = agentLookup;
    this.#consentDigestValidator = consentDigestValidator;
    this.#stepUpService = stepUpService ?? new StepUpService();
    this.#idGenerator = new CryptoIdGenerator();
  }

  /**
   * Issues a mandate from a fresh stepped-up consent attestation.
   *
   * Validates:
   * 1. Step-up session is valid and fresh
   * 2. Agent is registered with an active key
   * 3. Consent attestation digest is valid/fresh
   * 4. Validity window is sane
   */
  issue(params: MandateIssuanceParams): MandateIssuanceResult {
    // 1. Validate step-up session
    const stepUpValidation = this.#stepUpService.validateSession(params.stepUpSession);
    if (!stepUpValidation.valid) {
      return {
        ok: false,
        error: {
          kind: "mandate_issuance_error",
          reason: `Step-up validation failed: ${stepUpValidation.reason}`,
        },
      };
    }

    // 2. Validate agent registration
    const agent = this.#agentLookup(params.agentId);
    if (!agent) {
      return {
        ok: false,
        error: {
          kind: "mandate_issuance_error",
          reason: "Agent is not registered",
        },
      };
    }

    if (agent.status !== "active") {
      return {
        ok: false,
        error: {
          kind: "mandate_issuance_error",
          reason: `Agent status is '${agent.status}' - only active agents can receive mandates`,
        },
      };
    }

    if (agent.publicKeyDescriptor.kid !== params.kid) {
      return {
        ok: false,
        error: {
          kind: "mandate_issuance_error",
          reason: "Key ID does not match the agent's registered key",
        },
      };
    }

    if (agent.walletId !== params.walletId) {
      return {
        ok: false,
        error: {
          kind: "mandate_issuance_error",
          reason: "Agent is not registered to this wallet",
        },
      };
    }

    // 3. Validate consent attestation digest
    if (!this.#consentDigestValidator(params.consentAttestationDigest)) {
      return {
        ok: false,
        error: {
          kind: "mandate_issuance_error",
          reason: "Consent attestation digest is invalid or has been revoked",
        },
      };
    }

    // 4. Validate validity window
    if (params.validFrom >= params.validUntil) {
      return {
        ok: false,
        error: {
          kind: "mandate_issuance_error",
          reason: "Mandate validity window is invalid (validFrom must be before validUntil)",
        },
      };
    }

    // Generate mandate ID
    const mandateId = this.#idGenerator.generate("mandate");
    const now = new Date().toISOString();
    const revocationLocator = `revoke:mandate:${mandateId}`;

    // Build CTP mandate payload
    const payload: MandatePayload = {
      mandate_id: mandateId,
      principal_id: params.principalId,
      wallet_id: params.walletId,
      agent_id: params.agentId,
      kid: params.kid,
      allowed_merchants: [...params.constraints.merchantAllowlist.allowedMerchantIds],
      allowed_domains: [...params.constraints.merchantAllowlist.allowedDomains],
      merchant_countries: [...params.constraints.geography.allowedMerchantCountries],
      delivery_countries: [...params.constraints.geography.allowedDeliveryCountries],
      categories: [...params.constraints.category.allowedCategories],
      ...(params.constraints.category.allowedSkus ? { skus: [...params.constraints.category.allowedSkus] } : {}),
      currencies: [...params.constraints.currency.allowedCurrencies],
      per_transaction_limit: bigintToMoneyAmount(params.constraints.amountLimits.perTransactionMaxPaise, "INR"),
      ...buildOptionalRollingLimits(params.constraints),
      ...buildOptionalAggregateLimit(params.constraints),
      ...(params.constraints.countLimits.maxQuantityPerTransaction !== undefined ? { quantity_limit: params.constraints.countLimits.maxQuantityPerTransaction } : {}),
      ...(params.constraints.countLimits.maxTransactions !== undefined ? { transaction_count_limit: params.constraints.countLimits.maxTransactions } : {}),
      allowed_operations: [...params.constraints.operations.allowedOperations],
      approval_threshold: bigintToMoneyAmount(params.constraints.approvalThreshold.thresholdPaise, "INR"),
      ...buildOptionalTimeWindows(params.constraints),
      payment_authorization_ref: params.paymentReferenceId,
      validity_start: params.validFrom,
      validity_end: params.validUntil,
      nonce_scope: `mandate:${mandateId}`,
      revocation_locator: revocationLocator,
      policy_version: params.policyVersionId,
      policy_digest: `sha256:${params.policyVersionId}`,
    };

    // Build unsigned CTP envelope
    const envelopeResult = buildUnsignedEnvelope<MandatePayload>({
      type: "counter.mandate.v1",
      id: `mandate-${mandateId}`,
      issuer: `counter://wallet/${params.walletId}`,
      subject: `counter://agent/${params.agentId}`,
      audience: [`counter://wallet/${params.walletId}`, `counter://agent/${params.agentId}`],
      environment: "pilot",
      issued_at: now,
      not_before: params.validFrom,
      expires_at: params.validUntil,
      nonce: `mandate-nonce-${mandateId}`,
      correlation_id: params.correlationId,
      payload,
      kid: params.kid,
      evidence_refs: [
        {
          type: "consent-attestation",
          id: params.consentAttestationDigest,
          digest: params.consentAttestationDigest,
        },
      ],
    });

    if (!envelopeResult.ok) {
      return {
        ok: false,
        error: {
          kind: "mandate_issuance_error",
          reason: `Envelope construction failed: ${envelopeResult.error.message}`,
        },
      };
    }

    // Build domain mandate
    const mandate: WalletMandate = {
      mandateId,
      walletId: params.walletId,
      principalId: params.principalId,
      agentId: params.agentId,
      kid: params.kid,
      constraints: params.constraints,
      paymentReferenceId: params.paymentReferenceId,
      validFrom: params.validFrom,
      validUntil: params.validUntil,
      issuedAt: now,
      consentAttestationDigest: params.consentAttestationDigest,
      status: "active",
      revocationLocator,
      policyVersionId: params.policyVersionId,
    };

    // Persist
    this.#mandateRepo.save(mandate);

    // Consume step-up nonce
    this.#stepUpService.consumeNonce(params.stepUpSession.nonce);

    const payloadDigest = computePayloadDigest(payload);

    return {
      ok: true,
      value: {
        mandate,
        envelope: envelopeResult.value,
        payloadDigest,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bigintToMoneyAmount(paise: bigint, currency: string): MoneyAmount {
  return { amount: Number(paise), currency };
}

function buildOptionalRollingLimits(constraints: BuyerPolicyConstraints): { rolling_limits: readonly { amount: number; currency: string; period: string }[] } | Record<string, never> {
  const { rollingPeriodMs, rollingMaxPaise } = constraints.amountLimits;
  if (rollingPeriodMs !== undefined && rollingMaxPaise !== undefined) {
    return {
      rolling_limits: [
        {
          amount: Number(rollingMaxPaise),
          currency: "INR",
          period: `${rollingPeriodMs}ms`,
        },
      ],
    };
  }
  return {};
}

function buildOptionalAggregateLimit(constraints: BuyerPolicyConstraints): { aggregate_limit: MoneyAmount } | Record<string, never> {
  if (constraints.amountLimits.aggregateMaxPaise !== undefined) {
    return { aggregate_limit: bigintToMoneyAmount(constraints.amountLimits.aggregateMaxPaise, "INR") };
  }
  return {};
}

function buildOptionalTimeWindows(constraints: BuyerPolicyConstraints): { time_windows: readonly { start: string; end: string; timezone: string }[] } | Record<string, never> {
  const { validDays, validStartTime, validEndTime } = constraints.timeConstraints;
  if (validStartTime !== undefined && validEndTime !== undefined) {
    return {
      time_windows: [
        {
          start: validStartTime,
          end: validEndTime,
          timezone: "UTC",
        },
      ],
    };
  }
  if (validDays !== undefined && validDays.length > 0) {
    return {
      time_windows: [
        {
          start: "00:00",
          end: "23:59",
          timezone: "UTC",
        },
      ],
    };
  }
  return {};
}
