/**
 * Policy precheck service.
 *
 * Verifies current policy/mandate/revocation against a merchant quote,
 * producing effect-free precheck results (allowed/denied/review_required
 * with reasons). No mutations - purely evaluative.
 */

import type { BuyerPolicyConstraints, WalletMandate } from "@counter/wallet-domain";
import { evaluatePolicy } from "@counter/wallet-domain";
import type { AccumulatedUsage, PolicyDecision } from "@counter/wallet-domain";
import type { RevocationStore } from "./revocation-service.js";

// ---------------------------------------------------------------------------
// Merchant Quote (minimal shape for precheck)
// ---------------------------------------------------------------------------

export interface MerchantQuote {
  readonly quoteId: string;
  readonly merchantId: string;
  readonly merchantCountry: string;
  readonly deliveryCountry: string;
  readonly category?: string | undefined;
  readonly sku?: string | undefined;
  readonly currency: string;
  readonly totalAmountPaise: bigint;
  readonly expiresAt: string;
  readonly quoteDigest: string;
}

// ---------------------------------------------------------------------------
// Precheck Result
// ---------------------------------------------------------------------------

export interface PrecheckResult {
  readonly outcome: "allowed" | "denied" | "review_required";
  readonly reasons: readonly string[];
  readonly policyVersionId: string;
  readonly mandateId: string | undefined;
  readonly evaluatedAt: string;
}

// ---------------------------------------------------------------------------
// Policy Precheck Service
// ---------------------------------------------------------------------------

/**
 * PolicyPrecheckService evaluates a merchant quote against the current
 * policy, mandate, and revocation state. This is entirely effect-free -
 * no mutations, no signing, no side-effects.
 */
export class PolicyPrecheckService {
  readonly #revocationStore: RevocationStore;

  constructor(revocationStore: RevocationStore) {
    this.#revocationStore = revocationStore;
  }

  /**
   * Evaluates a merchant quote against the given policy, mandate, and accumulated usage.
   * Returns a PrecheckResult indicating whether the action is allowed, denied, or requires review.
   */
  precheck(params: {
    readonly quote: MerchantQuote;
    readonly policy: BuyerPolicyConstraints;
    readonly policyVersionId: string;
    readonly mandate: WalletMandate | undefined;
    readonly accumulatedUsage: AccumulatedUsage;
    readonly paymentReferenceId: string;
    readonly timestamp: string;
  }): PrecheckResult {
    const {
      quote,
      policy,
      policyVersionId,
      mandate,
      accumulatedUsage,
      paymentReferenceId,
      timestamp,
    } = params;

    // Check revocation first
    if (mandate) {
      if (this.#revocationStore.isRevoked("mandate", mandate.mandateId)) {
        return {
          outcome: "denied",
          reasons: ["Mandate has been revoked"],
          policyVersionId,
          mandateId: mandate.mandateId,
          evaluatedAt: timestamp,
        };
      }

      if (this.#revocationStore.isRevoked("wallet", mandate.walletId)) {
        return {
          outcome: "denied",
          reasons: ["Wallet has been revoked"],
          policyVersionId,
          mandateId: mandate.mandateId,
          evaluatedAt: timestamp,
        };
      }
    }

    // Build proposed action from quote
    const proposedAction = {
      merchantId: quote.merchantId,
      merchantCountry: quote.merchantCountry,
      deliveryCountry: quote.deliveryCountry,
      category: quote.category,
      sku: quote.sku,
      currency: quote.currency,
      amountPaise: quote.totalAmountPaise,
      operation: "purchase",
      paymentReferenceId,
      timestamp,
    };

    // Evaluate policy
    const decision: PolicyDecision = evaluatePolicy(
      policy,
      proposedAction,
      accumulatedUsage,
      policyVersionId,
    );

    return {
      outcome: decision.outcome,
      reasons: decision.reasons,
      policyVersionId,
      mandateId: mandate?.mandateId,
      evaluatedAt: decision.evaluatedAt,
    };
  }
}
