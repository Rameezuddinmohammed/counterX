/**
 * Solana-specific types for this adapter — kept separate from
 * @counter/payment-sdk's provider-agnostic types.
 */

/** A base58-encoded Solana address (32 raw bytes). Not branded/validated at
 * the type level — packages/data's merchant-wallet-connection-store.ts is
 * where address FORMAT is actually checked before one reaches this package. */
export type SolanaAddress = string;

/**
 * The public, non-secret coordinates of an on-chain spending delegation
 * (a `FixedDelegation`, from `@solana/subscriptions`) — everything a
 * settlement call needs to know about WHERE the mandate's authority lives
 * on-chain. Threaded through CreatePaymentInstruction.metadata as plain
 * strings (all public addresses — never a private key; see
 * solana-settlement-provider.ts's header for why a key never travels this
 * path). Produced by mandate-delegation.ts at mandate-ISSUANCE time,
 * consumed by solana-settlement-provider.ts at purchase-SETTLEMENT time —
 * distinct moments, distinct callers.
 */
export interface FixedDelegationCoordinates {
  readonly subscriptionAuthorityPda: SolanaAddress;
  readonly fixedDelegationPda: SolanaAddress;
  readonly delegatorAddress: SolanaAddress;
  readonly delegatorAta: SolanaAddress;
  readonly delegateeAddress: SolanaAddress;
  readonly tokenMint: SolanaAddress;
}

export type SolanaSettlementOutcomeKind = "confirmed" | "declined" | "indeterminate";

export interface SolanaSettlementResult {
  readonly kind: SolanaSettlementOutcomeKind;
  /** Transaction signature — present once broadcast, even for a later-declined
   * or indeterminate outcome, since a signature can exist before/independent
   * of confirmation. Independently verifiable on Solana's own devnet
   * explorer — see solana-settlement-provider.ts's header for why that
   * subsumes CTP envelope-signing for this rail's evidence. */
  readonly signature?: string;
  readonly declineReason?: string;
  readonly remainingCapMinor?: bigint;
}
