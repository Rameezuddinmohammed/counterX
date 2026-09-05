/**
 * Server-side verification + durable persistence for a Counter-native
 * WalletMandate backed by a PREPAID WALLET BALANCE — never by a Razorpay
 * (or any other) recurring provider mandate.
 *
 * WHY THIS IS A SEPARATE SERVICE, NOT A BRANCH INSIDE MandateBindingService:
 * that service's whole design is "clamp the requested authority to no more
 * than what an already-verified, human-authorized PROVIDER mandate grants"
 * (see its own header). A prepaid balance has no such provider grant to
 * clamp against — the wallet's own already-collected money (see
 * packages/data/src/wallet-balance-store.ts's header for the full
 * rationale: fund once via a real one-time payment, spend many times) IS
 * the collateral. Bolting a second, structurally different check onto
 * MandateBindingService would blur exactly the distinction CLAUDE.md's
 * "no silent consequential failure" invariant cares about — this service
 * exists so the recurring-mandate path stays completely untouched and
 * every reader can see at a glance which authority model backs a given
 * WalletMandate.
 *
 * BINDING RULE: a WalletMandate MAY ONLY be issued through this service
 * when the wallet already has a prepaid-balance account (has topped up at
 * least once — see PostgresWalletBalanceStore.hasBalanceAccount()). The
 * issued mandate's per-transaction ceiling and validity window are clamped
 * to a FOUNDER-CONFIGURED POLICY ceiling (MAX_TRANSACTION_AMOUNT_MINOR,
 * the same constant apps/worker's real money-moving enforcement
 * (enforceTransactionLimits) already uses) — deliberately NEVER against
 * the wallet's current balance, which fluctuates with every purchase and
 * top-up. Binding-time authority ("is this a legitimate, policy-bounded
 * grant") and spend-time funds-availability ("does the wallet actually
 * have the money right now") are different concerns: only
 * PostgresWalletBalanceStore.debit()'s atomic, row-locked check at the
 * moment of each purchase verifies money is actually there.
 *
 * paymentReferenceId is set to a WALLET-SCOPED sentinel
 * (`prepaid-balance:${walletId}`), never a single global constant.
 * MandateRepository.findByPaymentReference() is the cascade-revocation
 * join key (see WalletRevocationService#cascadeRevocation) — a shared
 * sentinel across every wallet would let one revocation call zero out
 * every prepaid-balance mandate in the entire environment at once. The
 * wallet-scoped sentinel gives this path the same per-wallet revocation
 * granularity a real provider reference already has.
 *
 * bindingKind: "prepaid-balance" is surfaced on every result so nothing
 * downstream (logs, receipts, evidence, a future dashboard) ever silently
 * treats this as equivalent in strength to a provider-verified mandate —
 * mirrors apps/worker/src/real-lifecycle.ts's buildPrepaidBalanceEvidence(),
 * which is equally explicit (fundedVia/testMode) about not overstating
 * what backs a prepaid-balance transaction.
 *
 * SECURITY: never reads or logs a private key. The envelope's signature is
 * verified against the agent's REGISTERED public key (identity
 * .agent_public_keys, via PostgresCtpKeyRegistry) — a request cannot vouch
 * for its own authenticity. Identical verification skeleton to
 * MandateBindingService (envelope hygiene, wallet match) — duplicated
 * rather than shared via inheritance, since the two services' actual
 * authority checks diverge completely and forcing a shared base class
 * would only recreate the blurring this split exists to avoid.
 */
import type { CtpEnvelope, KeyRegistry, MandatePayload } from "@counter/trust-protocol";
import { isCtpEnvelope, verifyEnvelope } from "@counter/trust-protocol";
import { MAX_TRANSACTION_AMOUNT_MINOR } from "@counter/payment-sdk";
import type {
  BuyerPolicyConstraints,
  MandateRepository,
  WalletMandate,
} from "@counter/wallet-domain";

/** The environment MandateService.issue() hardcodes into every mandate envelope it builds. */
const MANDATE_ENVELOPE_ENVIRONMENT = "pilot";

/** Default cap on how far in the future a prepaid-balance mandate's validity may extend. */
const DEFAULT_MAX_VALIDITY_MS = 365 * 24 * 60 * 60 * 1000;

export interface PrepaidBalanceMandateBindingError {
  readonly code:
    | "INVALID_ENVELOPE"
    | "SIGNATURE_INVALID"
    | "WALLET_MISMATCH"
    | "NO_PREPAID_BALANCE_ACCOUNT"
    | "EXCEEDS_PREPAID_POLICY"
    | "PERSIST_FAILED";
  readonly message: string;
}

export interface PrepaidBalanceMandateBindingResult {
  readonly mandateId: string;
  readonly walletId: string;
  readonly agentId: string;
  readonly paymentReferenceId: string;
  readonly status: string;
  readonly validFrom: string;
  readonly validUntil: string;
  /** Always "prepaid-balance" — see this file's header for why this is surfaced explicitly. */
  readonly bindingKind: "prepaid-balance";
}

/** Structural port (not the concrete class) so tests can inject a double — same idiom as RecurringMandateProvisionerLike. */
export interface WalletBalanceAccountLookup {
  hasBalanceAccount(walletId: string): Promise<boolean>;
}

export interface PrepaidBalanceMandateBindingPolicy {
  readonly maxTransactionAmountMinor: bigint;
  readonly maxValidityMs: number;
}

export const DEFAULT_PREPAID_BALANCE_BINDING_POLICY: PrepaidBalanceMandateBindingPolicy =
  Object.freeze({
    maxTransactionAmountMinor: MAX_TRANSACTION_AMOUNT_MINOR,
    maxValidityMs: DEFAULT_MAX_VALIDITY_MS,
  });

function moneyAmountToPaise(amount: { readonly amount: number | string }): bigint {
  return typeof amount.amount === "string"
    ? BigInt(amount.amount)
    : BigInt(Math.trunc(amount.amount));
}

/** Wallet-scoped cascade-revocation key for a prepaid-balance mandate — see this file's header. */
export function prepaidBalancePaymentReference(walletId: string): string {
  return `prepaid-balance:${walletId}`;
}

/**
 * Reconstructs BuyerPolicyConstraints from the verified CTP wire payload —
 * identical to mandate-binding-store.ts's own payloadToConstraints (the
 * inverse of mandate-service.ts's constraints -> MandatePayload mapping).
 * Duplicated rather than imported to keep the two binding services fully
 * independent — see this file's header for why.
 */
function payloadToConstraints(payload: MandatePayload): BuyerPolicyConstraints {
  return {
    merchantAllowlist: {
      allowedMerchantIds: payload.allowed_merchants,
      allowedDomains: payload.allowed_domains ?? [],
    },
    geography: {
      allowedMerchantCountries: payload.merchant_countries ?? [],
      allowedDeliveryCountries: payload.delivery_countries ?? [],
    },
    category: {
      allowedCategories: payload.categories ?? [],
      ...(payload.skus !== undefined ? { allowedSkus: payload.skus } : {}),
    },
    currency: { allowedCurrencies: payload.currencies },
    amountLimits: {
      perTransactionMaxPaise: moneyAmountToPaise(payload.per_transaction_limit),
      ...(payload.rolling_limits !== undefined && payload.rolling_limits.length > 0
        ? {
            rollingPeriodMs: Number.parseInt(payload.rolling_limits[0]!.period, 10),
            rollingMaxPaise: moneyAmountToPaise(payload.rolling_limits[0]!),
          }
        : {}),
      ...(payload.aggregate_limit !== undefined
        ? { aggregateMaxPaise: moneyAmountToPaise(payload.aggregate_limit) }
        : {}),
    },
    countLimits: {
      ...(payload.quantity_limit !== undefined
        ? { maxQuantityPerTransaction: payload.quantity_limit }
        : {}),
      ...(payload.transaction_count_limit !== undefined
        ? { maxTransactions: payload.transaction_count_limit }
        : {}),
    },
    operations: { allowedOperations: payload.allowed_operations },
    timeConstraints: {
      ...(payload.time_windows !== undefined && payload.time_windows.length > 0
        ? {
            validStartTime: payload.time_windows[0]!.start,
            validEndTime: payload.time_windows[0]!.end,
          }
        : {}),
      expiresAt: payload.validity_end,
    },
    approvalThreshold: {
      thresholdPaise:
        payload.approval_threshold !== undefined
          ? moneyAmountToPaise(payload.approval_threshold)
          : moneyAmountToPaise(payload.per_transaction_limit),
    },
    paymentReferences: { allowedReferenceIds: [payload.payment_authorization_ref] },
  };
}

export class PrepaidBalanceMandateBindingService {
  constructor(
    private readonly mandateRepo: MandateRepository,
    private readonly keyRegistry: KeyRegistry,
    private readonly walletBalance: WalletBalanceAccountLookup,
    private readonly policy: PrepaidBalanceMandateBindingPolicy = DEFAULT_PREPAID_BALANCE_BINDING_POLICY,
  ) {}

  async bind(
    walletId: string,
    envelopeInput: unknown,
    now: Date,
  ): Promise<
    | { readonly ok: true; readonly value: PrepaidBalanceMandateBindingResult }
    | { readonly ok: false; readonly error: PrepaidBalanceMandateBindingError }
  > {
    if (!isCtpEnvelope(envelopeInput)) {
      return {
        ok: false,
        error: { code: "INVALID_ENVELOPE", message: "Not a valid signed CTP envelope" },
      };
    }
    if (envelopeInput.type !== "counter.mandate.v1") {
      return {
        ok: false,
        error: {
          code: "INVALID_ENVELOPE",
          message: `Expected a counter.mandate.v1 envelope, got '${envelopeInput.type}'`,
        },
      };
    }
    const envelope = envelopeInput as CtpEnvelope<MandatePayload>;

    const verifyResult = await verifyEnvelope(envelope, {
      keyRegistry: this.keyRegistry,
      currentTime: now.toISOString(),
      expectedAudience: `counter://wallet/${walletId}`,
      expectedEnvironment: MANDATE_ENVELOPE_ENVIRONMENT,
    });
    if (!verifyResult.ok) {
      // Same diagnostic forwarding as mandate-binding-store.ts — surface the
      // specific reason from verifyEnvelope rather than the generic canonical
      // fallback string, so the wallet UI shows something actionable.
      return {
        ok: false,
        error: {
          code: "SIGNATURE_INVALID",
          message: `Envelope verification failed: ${verifyResult.error.detail}`,
        },
      };
    }

    const payload = envelope.payload;
    if (payload.wallet_id !== walletId) {
      return {
        ok: false,
        error: {
          code: "WALLET_MISMATCH",
          message: "Envelope's wallet_id does not match the route's walletId",
        },
      };
    }

    // The wallet MUST already have a prepaid-balance account (topped up at
    // least once) — never trust the envelope's own claim; independently
    // re-verify against the real store, same discipline as the provider
    // path's recurring-mandate re-check.
    const hasAccount = await this.walletBalance.hasBalanceAccount(walletId);
    if (!hasAccount) {
      return {
        ok: false,
        error: {
          code: "NO_PREPAID_BALANCE_ACCOUNT",
          message:
            "This wallet has no prepaid-balance account (never topped up) — nothing to bind authority against",
        },
      };
    }

    const requestedCeiling = moneyAmountToPaise(payload.per_transaction_limit);
    if (requestedCeiling > this.policy.maxTransactionAmountMinor) {
      return {
        ok: false,
        error: {
          code: "EXCEEDS_PREPAID_POLICY",
          message: `Requested per-transaction ceiling (${requestedCeiling}) exceeds the configured policy ceiling (${this.policy.maxTransactionAmountMinor})`,
        },
      };
    }
    const requestedValidityMs = new Date(payload.validity_end).getTime() - now.getTime();
    if (requestedValidityMs > this.policy.maxValidityMs) {
      return {
        ok: false,
        error: {
          code: "EXCEEDS_PREPAID_POLICY",
          message: `Requested validity extends beyond the configured maximum of ${this.policy.maxValidityMs}ms from now`,
        },
      };
    }

    const expectedReference = prepaidBalancePaymentReference(walletId);
    if (payload.payment_authorization_ref !== expectedReference) {
      return {
        ok: false,
        error: {
          code: "WALLET_MISMATCH",
          message: `Prepaid-balance mandates must use payment_authorization_ref '${expectedReference}'`,
        },
      };
    }

    const mandate: WalletMandate = {
      mandateId: payload.mandate_id as WalletMandate["mandateId"],
      walletId: payload.wallet_id as WalletMandate["walletId"],
      principalId: payload.principal_id as WalletMandate["principalId"],
      agentId: payload.agent_id as WalletMandate["agentId"],
      kid: payload.kid,
      constraints: payloadToConstraints(payload),
      paymentReferenceId: payload.payment_authorization_ref,
      validFrom: payload.validity_start,
      validUntil: payload.validity_end,
      issuedAt: now.toISOString(),
      consentAttestationDigest:
        envelope.evidence_refs.find((e) => e.type === "consent-attestation")?.digest ??
        envelope.payload_digest,
      status: "active",
      revocationLocator: payload.revocation_locator ?? `revoke:mandate:${payload.mandate_id}`,
      policyVersionId: payload.policy_version,
    };

    try {
      await this.mandateRepo.save(mandate);
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "PERSIST_FAILED",
          message: error instanceof Error ? error.message : "Failed to persist mandate",
        },
      };
    }

    return {
      ok: true,
      value: {
        mandateId: mandate.mandateId,
        walletId: mandate.walletId,
        agentId: mandate.agentId,
        paymentReferenceId: mandate.paymentReferenceId,
        status: mandate.status,
        validFrom: mandate.validFrom,
        validUntil: mandate.validUntil,
        bindingKind: "prepaid-balance" as const,
      },
    };
  }
}
