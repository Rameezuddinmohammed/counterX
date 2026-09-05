/**
 * Server-side verification + durable persistence for a Counter-native
 * WalletMandate. When the envelope's payment_authorization_ref claims a
 * real provider mandate (a RecurringMandateSummary — e.g. a confirmed
 * Razorpay UPI Autopay registration), binding is clamped to that provider
 * mandate's own limits. See INTERIM BINDING RULE below for the case where
 * no provider mandate is being claimed at all.
 *
 * WHY THIS LIVES HERE, NOT IN wallet-application's MandateService:
 * MandateService.issue() is a CLIENT-SIDE orchestrator — it assumes the
 * caller already holds the buyer's own signing key (apps/local-mcp's
 * SecureKeyStore) and builds+signs the counter.mandate.v1 envelope itself.
 * A server can never hold that key without becoming a custodial signer,
 * which this codebase's key-custody model explicitly forbids. So the
 * server's job is the other half: given an ALREADY-SIGNED envelope, verify
 * it cryptographically (against the agent's registered public key), verify
 * any CLAIMED provider mandate for this wallet is real and active, verify
 * the requested authority doesn't exceed what that provider mandate
 * actually grants, and only then durably persist it — the same split as
 * recurring-mandate-store.ts's confirmRegistration (client proves; server
 * verifies + persists; never signs on the buyer's behalf).
 *
 * BINDING RULE when a provider mandate IS claimed (payment_authorization_ref
 * matches a real RecurringMandateSummary for this wallet): it MUST be
 * status === "active" — i.e. a human has already completed the Razorpay
 * registration checkout — and the issued mandate's per-transaction ceiling,
 * eligible merchants, and validity window are clamped to be no more
 * permissive than that provider mandate's own limits. An agent can never be
 * granted more authority than the human actually authorized at the payment
 * rail. Unchanged, and still the ONLY path once a real provider mandate is
 * in play (e.g. Phase 6's UPI Autopay flip).
 *
 * INTERIM BINDING RULE (Mandate Pivot Phase 1.3, until Phase 3's crypto
 * rail lands — see ~/.claude/plans/the-mandate-pivot.md): when
 * payment_authorization_ref does NOT match ANY RecurringMandateSummary for
 * this wallet, no provider mandate is being claimed at all — this is not a
 * bogus reference, it is the buyer opting into the mandate-first design the
 * pivot describes (a signed spending mandate IS the human authorization;
 * a payment rail is no longer a precondition of granting it). This route
 * accepts the envelope's own declared limits directly, on the strength of
 * what is ALREADY independently verified: (1) the signature, against the
 * agent's own registered key; (2) wallet ownership; (3) this route is
 * gated by payment.mandate.manage, which requires step-up assurance
 * (packages/authorization/src/assurance.ts) — a human, not just a session,
 * authorized this. The resulting WalletMandate is currently inert for real
 * money movement: Phase 2 retires the only rail that could act on one
 * without a provider mandate (the prepaid balance), and Phase 3 has not yet
 * built the crypto rail's own settlement path. A reference that DOES match
 * a RecurringMandateSummary but isn't active (revoked/pending/failed) is
 * still a hard deny — that's a real, broken provider-mandate claim, not an
 * absent one, and silently accepting it would grant authority the human
 * explicitly hasn't (or no longer) approved at that rail.
 *
 * SECURITY: never reads or logs a private key. The envelope's signature is
 * verified against the agent's REGISTERED public key (identity
 * .agent_public_keys, via PostgresCtpKeyRegistry) — a request cannot vouch
 * for its own authenticity.
 */
import type { CtpEnvelope, KeyRegistry, MandatePayload } from "@counter/trust-protocol";
import { isCtpEnvelope, verifyEnvelope } from "@counter/trust-protocol";
import type {
  BuyerPolicyConstraints,
  MandateRepository,
  WalletMandate,
} from "@counter/wallet-domain";
import type { RecurringMandateProvisionerLike } from "./recurring-mandate-store.js";

/** The environment MandateService.issue() hardcodes into every mandate envelope it builds. */
const MANDATE_ENVELOPE_ENVIRONMENT = "pilot";

export interface MandateBindingError {
  readonly code:
    | "INVALID_ENVELOPE"
    | "SIGNATURE_INVALID"
    | "WALLET_MISMATCH"
    | "AGENT_NOT_OWNED"
    | "NO_ACTIVE_PROVIDER_MANDATE"
    | "EXCEEDS_PROVIDER_MANDATE"
    | "PERSIST_FAILED";
  readonly message: string;
}

/**
 * Checks that `agentId` is a real, active agent registered under `walletId`
 * — independent of which key actually SIGNED the envelope. Required as of
 * the Mandate Pivot's "separate consent key from operating key" decision
 * (Phase 1.3, 2026-09-04, see ~/.claude/plans/the-mandate-pivot.md): the CTP
 * signature only proves the envelope's `kid` is a real, active, registered
 * key — it says nothing about whether `payload.agent_id` is real or
 * wallet-owned, since that's ordinary payload data, not something
 * verifyEnvelope's cryptographic check touches. Before this pivot every
 * real caller happened to sign with the SAME agent the mandate named, so
 * the gap was latent; once a dedicated consent key (registered as its own
 * agent record) can sign on a DIFFERENT agent's behalf, it becomes load-
 * bearing — without this, any wallet owner with any one registered key
 * could mint a mandate claiming to grant spending authority to an
 * arbitrary agent_id, including one they never registered.
 */
export type AgentOwnershipCheck = (walletId: string, agentId: string) => Promise<boolean>;

export interface MandateBindingResult {
  readonly mandateId: string;
  readonly walletId: string;
  readonly agentId: string;
  readonly paymentReferenceId: string;
  readonly status: string;
  readonly validFrom: string;
  readonly validUntil: string;
}

function moneyAmountToPaise(amount: { readonly amount: number | string }): bigint {
  return typeof amount.amount === "string"
    ? BigInt(amount.amount)
    : BigInt(Math.trunc(amount.amount));
}

/**
 * Reconstructs BuyerPolicyConstraints from the verified CTP wire payload —
 * the inverse of mandate-service.ts's constraints -> MandatePayload mapping.
 * One field has no wire counterpart (paymentReferences.allowedReferenceIds
 * was never serialized onto the wire by that forward mapping either — a
 * pre-existing gap, not introduced here); it defaults to the mandate's own
 * payment_authorization_ref, the only reference this mandate is ever bound
 * to in the current design.
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

export class MandateBindingService {
  constructor(
    private readonly mandateRepo: MandateRepository,
    private readonly keyRegistry: KeyRegistry,
    private readonly recurringMandates: RecurringMandateProvisionerLike,
    private readonly agentOwnershipCheck: AgentOwnershipCheck,
  ) {}

  async bind(
    walletId: string,
    envelopeInput: unknown,
    now: Date,
  ): Promise<
    | { readonly ok: true; readonly value: MandateBindingResult }
    | { readonly ok: false; readonly error: MandateBindingError }
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
      // verifyResult.error.detail is the specific diagnostic reason from
      // verifyEnvelope (e.g. "Envelope has expired: current time is after
      // expires_at", "Verifier is not in the envelope audience", etc.). Surface
      // it directly so the wallet UI can show something actionable instead of
      // the generic canonical fallback string.
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

    // The signature proves payload.kid is a real, active, registered key —
    // it says nothing about payload.agent_id, which is ordinary payload
    // data. Independently verify the target agent is real and wallet-owned
    // — see AgentOwnershipCheck's own doc for why this is required, not
    // optional, now that a dedicated consent key can sign for a different
    // agent than itself.
    const agentOwned = await this.agentOwnershipCheck(walletId, payload.agent_id);
    if (!agentOwned) {
      return {
        ok: false,
        error: {
          code: "AGENT_NOT_OWNED",
          message: "payload.agent_id is not a real, active agent registered under this wallet",
        },
      };
    }

    // If a provider mandate IS being claimed, it MUST already be
    // human-confirmed for THIS wallet — never trust the envelope's own
    // claim about what it's bound to; independently re-verify. See the
    // INTERIM BINDING RULE in this file's header for the (currently
    // expected, not an error) case where no provider mandate is claimed
    // at all.
    const recurringMandates = await this.recurringMandates.list(walletId);
    const providerMandate = recurringMandates.find(
      (m) => m.referenceId === payload.payment_authorization_ref,
    );
    if (providerMandate !== undefined && providerMandate.status !== "active") {
      return {
        ok: false,
        error: {
          code: "NO_ACTIVE_PROVIDER_MANDATE",
          message:
            "payment_authorization_ref resolves to a provider mandate for this wallet, but it is not active",
        },
      };
    }

    if (providerMandate !== undefined) {
      const requestedCeiling = moneyAmountToPaise(payload.per_transaction_limit);
      const providerCeiling = BigInt(providerMandate.ceilingMinor);
      if (requestedCeiling > providerCeiling) {
        return {
          ok: false,
          error: {
            code: "EXCEEDS_PROVIDER_MANDATE",
            message: `Requested per-transaction ceiling (${requestedCeiling}) exceeds the provider mandate's own ceiling (${providerCeiling})`,
          },
        };
      }
      if (
        providerMandate.eligibleMerchants.length > 0 &&
        !payload.allowed_merchants.every((m) => providerMandate.eligibleMerchants.includes(m))
      ) {
        return {
          ok: false,
          error: {
            code: "EXCEEDS_PROVIDER_MANDATE",
            message:
              "Requested merchant allowlist is not a subset of the provider mandate's eligible merchants",
          },
        };
      }
      if (
        providerMandate.eligibleOperations.length > 0 &&
        !payload.allowed_operations.every((o) => providerMandate.eligibleOperations.includes(o))
      ) {
        return {
          ok: false,
          error: {
            code: "EXCEEDS_PROVIDER_MANDATE",
            message:
              "Requested operations are not a subset of the provider mandate's eligible operations",
          },
        };
      }
      if (
        new Date(payload.validity_end).getTime() > new Date(providerMandate.validUntil).getTime()
      ) {
        return {
          ok: false,
          error: {
            code: "EXCEEDS_PROVIDER_MANDATE",
            message: "Requested validity extends beyond the provider mandate's own validUntil",
          },
        };
      }
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
      },
    };
  }
}
