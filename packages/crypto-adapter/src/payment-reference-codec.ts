/**
 * Encodes/decodes a `FixedDelegationCoordinates` directly into a mandate's
 * `payment_reference_id` — the SAME field the recurring-mandate rail
 * already uses to say "what payment-rail authorization does this mandate
 * map onto" (see apps/control-plane-api/src/mandate-binding-store.ts).
 * `wallet.mandates.payment_reference_id` is a plain, unbounded `text`
 * column (packages/data/migrations/0019, no length CHECK), so this needs
 * no new table or store for a hackathon-scoped demo: the mapping from
 * "which mandate" to "which on-chain delegation" is stored durably where
 * the mandate itself already lives, and the worker-side lookup
 * (apps/worker/src/real-lifecycle.ts) is a pure, local, synchronous decode
 * — no extra database round trip.
 *
 * SCOPE NOTE: this is a real, defensible design for a single demo mandate,
 * not a permanent architecture decision. A production version handling
 * many mandates/wallets would likely want a real indexed lookup table
 * (mirroring merchant.wallet_connections' pattern) rather than parsing
 * coordinates back out of a text field on every charge — flagged here so
 * a future session doesn't mistake this shortcut for the intended design.
 *
 * All fields here are public on-chain addresses — never a private key.
 */
import type { FixedDelegationCoordinates } from "./types.js";

export const SOLANA_PAYMENT_REFERENCE_PREFIX = "solana-mandate:";

const REQUIRED_FIELDS: readonly (keyof FixedDelegationCoordinates)[] = [
  "subscriptionAuthorityPda",
  "fixedDelegationPda",
  "delegatorAddress",
  "delegatorAta",
  "delegateeAddress",
  "tokenMint",
];

export function encodeSolanaPaymentReference(coordinates: FixedDelegationCoordinates): string {
  const json = JSON.stringify(coordinates);
  const encoded = Buffer.from(json, "utf8").toString("base64url");
  return `${SOLANA_PAYMENT_REFERENCE_PREFIX}${encoded}`;
}

export function isSolanaPaymentReference(paymentReferenceId: string): boolean {
  return paymentReferenceId.startsWith(SOLANA_PAYMENT_REFERENCE_PREFIX);
}

/** Returns undefined on any malformed input — a corrupt/foreign reference
 * string is never thrown on, since the caller (real-lifecycle.ts) is
 * expected to treat "no coordinates found" as a normal, handled decline
 * path, not a crash. */
export function decodeSolanaPaymentReference(
  paymentReferenceId: string,
): FixedDelegationCoordinates | undefined {
  if (!isSolanaPaymentReference(paymentReferenceId)) return undefined;
  try {
    const encoded = paymentReferenceId.slice(SOLANA_PAYMENT_REFERENCE_PREFIX.length);
    const json = Buffer.from(encoded, "base64url").toString("utf8");
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const record = parsed as Record<string, unknown>;
    for (const field of REQUIRED_FIELDS) {
      if (typeof record[field] !== "string" || record[field].length === 0) return undefined;
    }
    return parsed as FixedDelegationCoordinates;
  } catch {
    return undefined;
  }
}
