/**
 * Source authority rules for evidence claims.
 *
 * Each evidence source is authoritative for a specific subset of claim types.
 * Agent claims are NEVER authoritative for any claim type - they are advisory only.
 */

import type { CanonicalClaimType, EvidenceSource, SourceAuthorityMap } from "./types.js";

/**
 * Maps each evidence source to the canonical claim types it is authoritative for.
 *
 * - wallet_intent: intent, consent, mandate, approval, revocation
 * - merchant_connector: order, fulfillment (product, inventory, return)
 * - payment_provider: authorization, capture, void, refund, payment
 * - counter_service: policy, orchestration, audit (no canonical claims in this list)
 * - agent_claim: NEVER authoritative for any claim type
 */
export const AUTHORITY_MAP: SourceAuthorityMap = Object.freeze({
  wallet_intent: Object.freeze([
    "intent_created",
    "consent_given",
    "consent_revoked",
  ] as const),
  merchant_connector: Object.freeze([
    "order_committed",
    "order_cancelled",
    "fulfillment_shipped",
    "fulfillment_delivered",
  ] as const),
  payment_provider: Object.freeze([
    "payment_confirmed",
    "payment_declined",
    "payment_pending",
    "refund_issued",
    "refund_declined",
    "authorization_created",
    "authorization_voided",
  ] as const),
  counter_service: Object.freeze([] as const),
  agent_claim: Object.freeze([] as const),
});

/**
 * Returns true if the given source is authoritative for the given claim type.
 * Agent claims are NEVER authoritative.
 */
export function isAuthoritative(
  source: EvidenceSource,
  claimType: CanonicalClaimType,
): boolean {
  const authorizedClaims = AUTHORITY_MAP[source];
  return (authorizedClaims as readonly string[]).includes(claimType);
}

/**
 * Returns the authoritative source for a given claim type, or undefined
 * if no source is authoritative (should not happen for well-known claim types).
 */
export function getAuthoritativeSource(
  claimType: CanonicalClaimType,
): EvidenceSource | undefined {
  if (
    claimType === "intent_created" ||
    claimType === "consent_given" ||
    claimType === "consent_revoked"
  ) {
    return "wallet_intent";
  }
  if (
    claimType === "order_committed" ||
    claimType === "order_cancelled" ||
    claimType === "fulfillment_shipped" ||
    claimType === "fulfillment_delivered"
  ) {
    return "merchant_connector";
  }
  if (
    claimType === "payment_confirmed" ||
    claimType === "payment_declined" ||
    claimType === "payment_pending" ||
    claimType === "refund_issued" ||
    claimType === "refund_declined" ||
    claimType === "authorization_created" ||
    claimType === "authorization_voided"
  ) {
    return "payment_provider";
  }
  return undefined;
}
