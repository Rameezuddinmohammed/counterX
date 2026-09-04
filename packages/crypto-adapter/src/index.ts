/**
 * packages/crypto-adapter
 *
 * Solana devnet settlement adapter: a real, on-chain buyer-to-merchant
 * transfer bounded by an on-chain spending delegation (the Solana
 * Subscriptions & Allowances program's `FixedDelegation`). Hackathon-scoped
 * — see solana-settlement-provider.ts's header for the deliberate
 * INR-paise-as-token-minor-units simplification and the no-CTP-envelope
 * reasoning, and real-solana-port.ts's header for exactly what has and
 * hasn't been verified against real devnet.
 *
 * Two distinct moments, two distinct entry points:
 *  - mandate-delegation.ts: mandate-ISSUANCE time (buyer authorizes an
 *    agent, once) — `initSubscriptionAuthority` / `createOnChainDelegation`.
 *  - solana-settlement-provider.ts: purchase-SETTLEMENT time (repeatable,
 *    per-purchase) — the `PaymentProvider` implementation.
 */

export const PACKAGE_NAME = "@counter/crypto-adapter";

// Config / environment gate
export {
  SUBSCRIPTIONS_PROGRAM_ADDRESS,
  DEFAULT_DEVNET_RPC_URL,
  DEFAULT_DEVNET_RPC_WS_URL,
  requireDevnetConfig,
} from "./config.js";
export type { SolanaAdapterConfig } from "./config.js";

// Solana-specific types
export type {
  SolanaAddress,
  FixedDelegationCoordinates,
  SolanaSettlementOutcomeKind,
  SolanaSettlementResult,
} from "./types.js";

// The testable seam to the real network
export type {
  SolanaSettlementPort,
  TransferFixedParams,
  SolanaTransferOutcome,
} from "./solana-port.js";

// Real port (talks to actual devnet — see its header for verification status)
export { createRealSolanaSettlementPort } from "./real-solana-port.js";

// Charge-time ATA derivation (merchant receiving address -> token account)
export { deriveAssociatedTokenAddress } from "./associated-token.js";

// Mandate-issuance-time helpers
export { initSubscriptionAuthority, createOnChainDelegation } from "./mandate-delegation.js";
export type {
  InitSubscriptionAuthorityParams,
  InitSubscriptionAuthorityResult,
  CreateOnChainDelegationParams,
  CreateOnChainDelegationResult,
} from "./mandate-delegation.js";

// Metadata codec (threads FixedDelegationCoordinates through
// CreatePaymentInstruction.metadata)
export { encodeSolanaMetadata, decodeSolanaMetadata } from "./metadata-codec.js";
export type { SolanaSettlementMetadata } from "./metadata-codec.js";

// Payment-reference codec (threads FixedDelegationCoordinates through a
// mandate's own payment_reference_id — see this file's own header for why)
export {
  SOLANA_PAYMENT_REFERENCE_PREFIX,
  encodeSolanaPaymentReference,
  isSolanaPaymentReference,
  decodeSolanaPaymentReference,
} from "./payment-reference-codec.js";

// The PaymentProvider implementation
export { SolanaSettlementProvider } from "./solana-settlement-provider.js";
export type { SolanaSettlementProviderConfig } from "./solana-settlement-provider.js";
