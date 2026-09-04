/**
 * Devnet-only environment gate, mirroring razorpay-provider.ts's own
 * constructor-time gate (`environment !== "test"` there; the equivalent
 * here is "not devnet"). This adapter moves real (if valueless, testnet)
 * on-chain funds the instant it's used — never let it construct against
 * anything but a devnet RPC endpoint until a mainnet path is deliberately
 * built and reviewed.
 */
import type { Environment } from "@counter/domain";
import { createCanonicalError } from "@counter/domain";

/** The Solana Subscriptions & Allowances program, verified live on devnet
 * 2026-09-04 by direct getAccountInfo (executable: true, owner: the
 * upgradeable BPF loader) — see HANDOFF.md / the mandate-pivot plan for
 * that verification record. Hardcoded, not env-configurable: this is a
 * public, foundation-deployed program address, not a secret or a
 * per-deployment value.
 */
export const SUBSCRIPTIONS_PROGRAM_ADDRESS = "De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44";

export const DEFAULT_DEVNET_RPC_URL = "https://api.devnet.solana.com";
export const DEFAULT_DEVNET_RPC_WS_URL = "wss://api.devnet.solana.com";

export interface SolanaAdapterConfig {
  readonly rpcUrl: string;
  readonly rpcSubscriptionsUrl: string;
}

/**
 * Fails closed exactly like requireCounterTestPaymentSigner
 * (apps/worker/src/connector-env.ts): throws rather than silently
 * defaulting to devnet when the environment isn't explicitly devnet-safe.
 * Callers pass the SAME `environment` value boot.ts already resolves via
 * resolveCounterEnvironment — this adapter has no independent notion of
 * "prod-like," it defers entirely to that existing gate.
 */
export function requireDevnetConfig(
  environment: Environment,
  overrides?: Partial<SolanaAdapterConfig>,
): SolanaAdapterConfig {
  // @counter/crypto-adapter only supports devnet settlement; refuse to construct
  // against production/pilot. There is no mainnet path in this adapter yet —
  // building one is a deliberate, separate, reviewed follow-up, not a config flag.
  // (createCanonicalError's object form discards a custom `message` at this
  // boundary by design — see errors.ts's own comment — so the reasoning for
  // THIS specific throw lives here, not in the error payload a caller sees.)
  if (environment === "production" || environment === "pilot") {
    throw createCanonicalError("ENVIRONMENT_MISMATCH");
  }
  return {
    rpcUrl: overrides?.rpcUrl ?? DEFAULT_DEVNET_RPC_URL,
    rpcSubscriptionsUrl: overrides?.rpcSubscriptionsUrl ?? DEFAULT_DEVNET_RPC_WS_URL,
  };
}
