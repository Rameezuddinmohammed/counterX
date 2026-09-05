/**
 * Testable seam between solana-settlement-provider.ts and the real Solana
 * network — same purpose as razorpay-adapter's RazorpayHttpPort: the
 * provider depends on this narrow interface, not directly on @solana/kit,
 * so unit tests can inject a mock port instead of hitting real devnet RPC.
 */
import type { FixedDelegationCoordinates } from "./types.js";

export interface TransferFixedParams {
  readonly coordinates: FixedDelegationCoordinates;
  readonly receiverAta: string;
  /** Smallest on-chain unit of the delegated token (see this package's
   * README-equivalent header comment in solana-settlement-provider.ts for
   * the deliberate INR-paise-as-token-minor-units simplification). */
  readonly amountMinor: bigint;
}

/** Mirrors the "never throw on a transport-level problem, return a typed
 * outcome" convention from real-http-client.ts — but for Solana, unlike
 * Razorpay's HTTP client, program-level rejection (over-cap, expired
 * delegation) and transport-level failure (RPC timeout/network) are BOTH
 * surfaced as thrown errors by @solana/kit, so telling them apart happens
 * in the real port implementation, not left to the caller. */
export type SolanaTransferOutcome =
  | { readonly kind: "landed"; readonly signature: string; readonly remainingCapMinor?: bigint }
  | { readonly kind: "declined"; readonly reason: string }
  | { readonly kind: "indeterminate"; readonly reason: string };

export interface SolanaSettlementPort {
  transferFixed(params: TransferFixedParams): Promise<SolanaTransferOutcome>;
  /** For re-querying an indeterminate outcome later — never re-broadcasts. */
  getSignatureStatus(
    signature: string,
  ): Promise<"confirmed" | "finalized" | "not_found" | "failed">;
}
