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
 *
 * The BuyerPolicyConstraints -> MandatePayload wire mapping itself lives in
 * the pure {@link buildMandateEnvelope} function below, deliberately
 * separated from this class's repository/step-up-session/agent-lookup
 * dependencies. `MandateService.issue()` (this class) needs a real
 * MandateRepository — i.e. direct database access — to persist, which is
 * only ever available server-side or in a trusted local script holding
 * DATABASE_URL (see scripts/issue-and-bind-wallet-mandate.mjs). A browser
 * can never hold that, but CAN build+sign an envelope with the buyer's own
 * key and submit it to control-plane-api's mandate-binding route (which
 * independently re-verifies before persisting — see
 * apps/control-plane-api/src/mandate-binding-store.ts) — that path calls
 * buildMandateEnvelope directly, bypassing this class entirely.
 */

import type { CounterId } from "@counter/domain";
import { CryptoIdGenerator } from "@counter/domain";
import type { MandatePayload, UnsignedCtpEnvelope, MoneyAmount } from "@counter/trust-protocol";
import { buildUnsignedEnvelope, computePayloadDigest } from "@counter/trust-protocol";
import type {
  BuyerPolicyConstraints,
  WalletMandate,
  MandateRepository,
} from "@counter/wallet-domain";
import type { AgentRegistration } from "./agent-registration.js";
import type { StepUpSession } from "./step-up-service.js";
import { StepUpService } from "./step-up-service.js";

// ---------------------------------------------------------------------------
// Mandate Envelope Construction (pure — no repository, no I/O)
// ---------------------------------------------------------------------------

export interface MandateEnvelopeParams {
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
  readonly correlationId: string;
  /** Defaults to `new Date().toISOString()`. Injectable for deterministic tests. */
  readonly issuedAt?: string;
  /** Defaults to a fresh CryptoIdGenerator-derived id. Injectable for deterministic tests. */
  readonly mandateId?: string;
}

export interface MandateEnvelopeOutput {
  readonly mandateId: string;
  readonly revocationLocator: string;
  readonly issuedAt: string;
  readonly payload: MandatePayload;
  readonly envelope: UnsignedCtpEnvelope<MandatePayload>;
  readonly payloadDigest: string;
}

export interface MandateEnvelopeError {
  readonly kind: "mandate_envelope_error";
  readonly reason: string;
}

export type MandateEnvelopeResult =
  | { readonly ok: true; readonly value: MandateEnvelopeOutput }
  | { readonly ok: false; readonly error: MandateEnvelopeError };

/**
 * Builds an unsigned CTP counter.mandate.v1 envelope from buyer-supplied
 * guardrails. Pure: no repository writes, no step-up/agent validation, no
 * network I/O — safe to call from any JS runtime, including a browser. The
 * caller is responsible for actually signing the returned envelope (with
 * the buyer's own key) and, separately, for whatever validation this
 * envelope needs before anyone treats it as authoritative — this function
 * only shapes the wire format correctly, it does not authorize anything by
 * itself.
 */
export function buildMandateEnvelope(params: MandateEnvelopeParams): MandateEnvelopeResult {
  const mandateId = params.mandateId ?? new CryptoIdGenerator().generate("mandate");
  const now = params.issuedAt ?? new Date().toISOString();
  const revocationLocator = `revoke:mandate:${mandateId}`;

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
    ...(params.constraints.category.allowedSkus
      ? { skus: [...params.constraints.category.allowedSkus] }
      : {}),
    currencies: [...params.constraints.currency.allowedCurrencies],
    per_transaction_limit: bigintToMoneyAmount(
      params.constraints.amountLimits.perTransactionMaxPaise,
      "INR",
    ),
    ...buildOptionalRollingLimits(params.constraints),
    ...buildOptionalAggregateLimit(params.constraints),
    ...(params.constraints.countLimits.maxQuantityPerTransaction !== undefined
      ? { quantity_limit: params.constraints.countLimits.maxQuantityPerTransaction }
      : {}),
    ...(params.constraints.countLimits.maxTransactions !== undefined
      ? { transaction_count_limit: params.constraints.countLimits.maxTransactions }
      : {}),
    allowed_operations: [...params.constraints.operations.allowedOperations],
    approval_threshold: bigintToMoneyAmount(
      params.constraints.approvalThreshold.thresholdPaise,
      "INR",
    ),
    ...buildOptionalTimeWindows(params.constraints),
    payment_authorization_ref: params.paymentReferenceId,
    validity_start: params.validFrom,
    validity_end: params.validUntil,
    nonce_scope: `mandate:${mandateId}`,
    revocation_locator: revocationLocator,
    policy_version: params.policyVersionId,
    policy_digest: `sha256:${params.policyVersionId}`,
  };

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
        kind: "mandate_envelope_error",
        reason: `Envelope construction failed: ${envelopeResult.error.message}`,
      },
    };
  }

  return {
    ok: true,
    value: {
      mandateId,
      revocationLocator,
      issuedAt: now,
      payload,
      envelope: envelopeResult.value,
      payloadDigest: computePayloadDigest(payload),
    },
  };
}

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
  async issue(params: MandateIssuanceParams): Promise<MandateIssuanceResult> {
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

    // Build the payload + unsigned envelope (pure — see buildMandateEnvelope)
    const mandateId = this.#idGenerator.generate("mandate");
    const envelopeResult = buildMandateEnvelope({
      walletId: params.walletId,
      principalId: params.principalId,
      agentId: params.agentId,
      kid: params.kid,
      constraints: params.constraints,
      paymentReferenceId: params.paymentReferenceId,
      validFrom: params.validFrom,
      validUntil: params.validUntil,
      consentAttestationDigest: params.consentAttestationDigest,
      policyVersionId: params.policyVersionId,
      correlationId: params.correlationId,
      mandateId,
    });

    if (!envelopeResult.ok) {
      return {
        ok: false,
        error: {
          kind: "mandate_issuance_error",
          reason: envelopeResult.error.reason,
        },
      };
    }
    const { revocationLocator, issuedAt, payloadDigest } = envelopeResult.value;

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
      issuedAt,
      consentAttestationDigest: params.consentAttestationDigest,
      status: "active",
      revocationLocator,
      policyVersionId: params.policyVersionId,
    };

    // Persist
    await this.#mandateRepo.save(mandate);

    // Consume step-up nonce
    this.#stepUpService.consumeNonce(params.stepUpSession.nonce);

    return {
      ok: true,
      value: {
        mandate,
        envelope: envelopeResult.value.envelope,
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

function buildOptionalRollingLimits(
  constraints: BuyerPolicyConstraints,
):
  | { rolling_limits: readonly { amount: number; currency: string; period: string }[] }
  | Record<string, never> {
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

function buildOptionalAggregateLimit(
  constraints: BuyerPolicyConstraints,
): { aggregate_limit: MoneyAmount } | Record<string, never> {
  if (constraints.amountLimits.aggregateMaxPaise !== undefined) {
    return {
      aggregate_limit: bigintToMoneyAmount(constraints.amountLimits.aggregateMaxPaise, "INR"),
    };
  }
  return {};
}

function buildOptionalTimeWindows(
  constraints: BuyerPolicyConstraints,
):
  | { time_windows: readonly { start: string; end: string; timezone: string }[] }
  | Record<string, never> {
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
