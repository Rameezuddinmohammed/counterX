/**
 * Merchant policy enforcement at the checkout seam (transactionCreate).
 *
 * Reads the merchant's durable policy config from the SAME
 * merchant.policy_configs table control-plane-api's policy routes read and
 * write (via @counter/data's PostgresPolicyStore — the identical repository
 * class, just a second instance in this separate process), compiles it with
 * the real @counter/merchant-policy compiler, and checks the requested
 * purchase against it BEFORE any transaction.lifecycle job is enqueued —
 * "money-affecting checks run before the external effect", CLAUDE.md's
 * invariant, and the same pattern this file's caller already applies to
 * mandate-authority checks in checkMandateAuthority().
 *
 * Honest scope, disclosed here rather than left ambiguous:
 *
 *  - ENFORCED (real data is available at this call site): inr-only
 *    (currency), india-destination (billing address country),
 *    payment-path (requested payment method), operating-window (current
 *    time vs. the compiled policy's time window), quantity-limit (requested
 *    quantity), product-allowlist (matched against the quote's Shopify
 *    variant id — the closest real per-item identifier available here),
 *    freshness-requirement (the quote's own age).
 *
 *  - review-threshold is INTENTIONALLY NOT a hard deny: its own semantics
 *    (packages/merchant-policy/src/policy-config.ts's ReviewThresholdRule)
 *    is "requires human review above this amount", not a price ceiling —
 *    conflating the two would misrepresent what the merchant configured.
 *    An over-threshold purchase surfaces as the handler's existing
 *    `review_required` HandlerError variant (see merchant-handlers.ts),
 *    not `unauthorized`.
 *
 *  - COMPILED BUT NOT ENFORCED HERE, disclosed rather than silently
 *    skipped:
 *      - category-allowlist: no product-category data flows from the live
 *        Shopify catalog reads in shopify-catalog.ts today (only
 *        title/description/price/inventory are queried) — enforcing this
 *        honestly would require adding a category/productType field to
 *        that GraphQL query, out of scope for this pass.
 *      - count-limit: would need a durable per-merchant, per-window
 *        transaction counter this call site doesn't have.
 *      - cancellation-policy / refund-policy: these govern the
 *        cancel/refund handlers' behavior, not checkout admission — not a
 *        purchase-time gate at all.
 *
 *  - A merchant with NO policy configured at all: no policy-based
 *    restriction is enforced for that merchant. This matches this
 *    codebase's existing behavior for every merchant before this task
 *    (policy is opt-in configuration a merchant sets up — most onboarded
 *    merchants already have one synthesized by
 *    merchant-readiness-store.ts's Step 5, but a merchant who never ran
 *    that step has none yet). Requiring every merchant to have configured a
 *    policy before their first sale would be a new invariant this task
 *    does not ask for.
 */
import type { Environment, Instant, IsoCurrencyCode } from "@counter/domain";
import { compareDecimalQuantities, compareMoney, createDecimalQuantity } from "@counter/domain";
import type { TransactionalDatabase } from "@counter/data";
import { PostgresPolicyStore } from "@counter/data";
import {
  compileMerchantPolicy,
  ruleSetFromStored,
  type CompiledMerchantPolicy,
  type StoredRuleSet,
} from "@counter/merchant-policy";

export interface CheckoutPolicyInput {
  readonly variantId: string;
  readonly quantity: number;
  readonly currency: string;
  readonly totalAmountMinor: bigint;
  readonly destinationCountry: string | undefined;
  readonly paymentMethod: string;
  readonly quoteCreatedAtMs: number;
  readonly nowMs: number;
}

export type PolicyCheckOutcome =
  | { readonly kind: "allow" }
  | { readonly kind: "deny"; readonly reason: string }
  | { readonly kind: "review_required"; readonly reason: string };

function allow(): PolicyCheckOutcome {
  return { kind: "allow" };
}
function deny(reason: string): PolicyCheckOutcome {
  return { kind: "deny", reason };
}

/**
 * Checks a checkout request against an already-compiled merchant policy.
 * Pure and synchronous — no I/O — so it's independently unit-testable
 * without a database.
 */
export function checkCompiledPolicy(
  compiled: CompiledMerchantPolicy,
  input: CheckoutPolicyInput,
): PolicyCheckOutcome {
  const c = compiled.constraints;

  // operating-window
  if (input.nowMs < c.timeWindow.allowedFrom || input.nowMs > c.timeWindow.allowedUntil) {
    return deny("Outside the merchant policy's configured operating window");
  }

  // inr-only / allowed currencies
  if (
    c.allowedCurrencies.length > 0 &&
    !(c.allowedCurrencies as readonly string[]).includes(input.currency)
  ) {
    return deny(
      `Currency '${input.currency}' is not permitted by the merchant's policy (allowed: ${c.allowedCurrencies.join(", ")})`,
    );
  }

  // india-destination
  if (c.allowedDestinations.length > 0) {
    if (
      input.destinationCountry === undefined ||
      !c.allowedDestinations.includes(input.destinationCountry)
    ) {
      return deny(
        `Destination '${input.destinationCountry ?? "unknown"}' is not permitted by the merchant's policy (allowed: ${c.allowedDestinations.join(", ")})`,
      );
    }
  }

  // payment-path
  if (c.allowedPaymentPaths.length > 0) {
    const allowed = (c.allowedPaymentPaths as readonly string[]).includes(input.paymentMethod);
    if (!allowed) {
      return deny(
        `Payment method '${input.paymentMethod}' is not permitted by the merchant's policy (allowed: ${c.allowedPaymentPaths.join(", ")})`,
      );
    }
  }

  // product-allowlist (matched against the Shopify variant id — see this
  // file's header for why that's the closest real "product" identifier
  // available at this call site).
  if (c.allowedProducts.length > 0 && !c.allowedProducts.includes(input.variantId)) {
    return deny("Requested product is not on the merchant's allowed-product list");
  }

  // quantity-limit
  const requestedQuantity = createDecimalQuantity(String(input.quantity), c.maxQuantity.unit);
  if (requestedQuantity.ok) {
    const comparison = compareDecimalQuantities(requestedQuantity.value, c.maxQuantity);
    if (comparison.ok && comparison.value > 0) {
      return deny(
        `Requested quantity ${String(input.quantity)} exceeds the merchant policy's limit of ${c.maxQuantity.value} ${c.maxQuantity.unit}`,
      );
    }
    // A unit mismatch (comparison not ok) means the merchant's
    // quantity-limit rule uses a unit this call site's plain item-count
    // can't be honestly compared against — skip rather than guess.
  }

  // freshness-requirement
  if (compiled.freshnessMaxAgeMs !== undefined) {
    const ageMs = input.nowMs - input.quoteCreatedAtMs;
    if (ageMs > compiled.freshnessMaxAgeMs) {
      return deny(
        `Quote is ${String(ageMs)}ms old, exceeding the merchant policy's freshness requirement of ${String(compiled.freshnessMaxAgeMs)}ms`,
      );
    }
  }

  // review-threshold — NOT a deny; see this file's header.
  if (compiled.reviewThresholdAmount !== undefined) {
    const totalMoney = {
      amountMinor: input.totalAmountMinor,
      currency: input.currency as IsoCurrencyCode,
    };
    const comparison = compareMoney(totalMoney, compiled.reviewThresholdAmount);
    if (comparison.ok && comparison.value > 0) {
      return {
        kind: "review_required",
        reason: `Amount exceeds the merchant's configured review threshold (${compiled.reviewThresholdAmount.amountMinor.toString()} ${compiled.reviewThresholdAmount.currency})`,
      };
    }
    // A currency mismatch between the requested total and the configured
    // threshold can't be honestly compared — skip rather than guess.
  }

  return allow();
}

export interface MerchantPolicyResolver {
  /** Returns the merchant's currently compiled policy, or undefined when none is configured. */
  resolve(merchantId: string, now: Instant): Promise<CompiledMerchantPolicy | undefined>;
}

/** Deliberately uncached — same reasoning as MerchantShopifyConnectorResolver in real-handlers.ts: a merchant who just edited their policy must see it enforced on their very next request, not after some cache TTL expires. Policy reads are a single indexed primary-key lookup, negligible at pilot scale. */
export function createPostgresMerchantPolicyResolver(
  database: TransactionalDatabase,
  environment: Environment,
): MerchantPolicyResolver {
  const store = new PostgresPolicyStore(database, environment);
  return {
    async resolve(merchantId: string, now: Instant): Promise<CompiledMerchantPolicy | undefined> {
      const result = await store.get(merchantId);
      if (!result.ok) {
        throw new Error(`Failed to load merchant policy: ${result.error.message}`);
      }
      if (result.value === undefined) {
        return undefined;
      }
      const ruleSet = ruleSetFromStored(result.value.config as StoredRuleSet);
      const compiled = compileMerchantPolicy(ruleSet, now);
      if (!compiled.ok) {
        // A stored policy that no longer compiles (e.g. an ambiguity that
        // slipped past an earlier, laxer version of the write-side
        // validator) is a real operational problem — fail closed rather
        // than silently treating it as "no policy configured".
        throw new Error(`Merchant policy failed to compile: ${compiled.error.message}`);
      }
      return compiled.value;
    },
  };
}
